const db = require('../db');

let schemaReady = false;
let schemaPending = false;
let schemaQueue = [];
let messageSchemaReady = false;
let messageSchemaPending = false;
let messageSchemaQueue = [];

const RESOLVED_STATUSES = ['resolved_approved', 'resolved_rejected', 'cancelled', 'closed'];

function flushMessageSchemaQueue(error) {
    const queue = messageSchemaQueue;
    messageSchemaQueue = [];
    messageSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureMessageSchema(callback) {
    if (messageSchemaReady) {
        callback(null);
        return;
    }

    messageSchemaQueue.push(callback);

    if (messageSchemaPending) {
        return;
    }

    messageSchemaPending = true;

    ensureSchema((requestSchemaError) => {
        if (requestSchemaError) {
            flushMessageSchemaQueue(requestSchemaError);
            return;
        }

        const sql = `
            CREATE TABLE IF NOT EXISTS support_messages (
                message_id INT NOT NULL AUTO_INCREMENT,
                request_id INT NOT NULL,
                sender_user_id INT DEFAULT NULL,
                sender_role VARCHAR(30) NOT NULL DEFAULT 'customer',
                message_body TEXT,
                screenshot_path VARCHAR(255) DEFAULT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (message_id),
                KEY idx_support_messages_request (request_id, created_at),
                CONSTRAINT fk_support_messages_request
                    FOREIGN KEY (request_id) REFERENCES support_requests (request_id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `;

        db.query(sql, (error) => {
            if (!error) {
                messageSchemaReady = true;
            }

            flushMessageSchemaQueue(error);
        });
    });
}

function flushSchemaQueue(error) {
    const queue = schemaQueue;
    schemaQueue = [];
    schemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    schemaQueue.push(callback);

    if (schemaPending) {
        return;
    }

    schemaPending = true;

    const sql = `
        CREATE TABLE IF NOT EXISTS support_requests (
            request_id INT NOT NULL AUTO_INCREMENT,
            customer_user_id INT NOT NULL,
            merchant_user_id INT DEFAULT NULL,
            admin_user_id INT DEFAULT NULL,
            request_type VARCHAR(40) NOT NULL,
            target_type VARCHAR(20) NOT NULL,
            target_id VARCHAR(80) NOT NULL,
            receipt_id VARCHAR(80) DEFAULT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'pending_admin_review',
            merchant_decision VARCHAR(30) NOT NULL DEFAULT 'pending',
            admin_decision VARCHAR(30) NOT NULL DEFAULT 'pending',
            reason VARCHAR(160) DEFAULT NULL,
            customer_note TEXT,
            requested_change TEXT,
            merchant_note TEXT,
            admin_note TEXT,
            refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            late_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            is_late_cancellation TINYINT(1) NOT NULL DEFAULT 0,
            delivery_status VARCHAR(30) DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            resolved_at TIMESTAMP NULL DEFAULT NULL,
            PRIMARY KEY (request_id),
            KEY idx_support_customer (customer_user_id, status, created_at),
            KEY idx_support_merchant (merchant_user_id, status, created_at),
            KEY idx_support_status (status, created_at),
            KEY idx_support_target (target_type, target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) {
            schemaReady = true;
        }

        flushSchemaQueue(error);
    });
}

function mapRow(row = {}) {
    return {
        id: row.request_id,
        customerUserId: row.customer_user_id,
        customerName: row.customer_name || 'Customer',
        customerEmail: row.customer_email || '',
        merchantUserId: row.merchant_user_id,
        merchantName: row.merchant_name || 'Merchant',
        adminUserId: row.admin_user_id,
        requestType: row.request_type,
        targetType: row.target_type,
        targetId: row.target_id,
        receiptId: row.receipt_id,
        status: row.status,
        merchantDecision: row.merchant_decision,
        adminDecision: row.admin_decision,
        reason: row.reason,
        customerNote: row.customer_note,
        requestedChange: row.requested_change,
        merchantNote: row.merchant_note,
        adminNote: row.admin_note,
        refundAmount: Number(row.refund_amount || 0),
        lateFeeAmount: Number(row.late_fee_amount || 0),
        isLateCancellation: Boolean(row.is_late_cancellation),
        deliveryStatus: row.delivery_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at
    };
}

function mapMessageRow(row = {}) {
    return {
        id: row.message_id,
        requestId: row.request_id,
        senderUserId: row.sender_user_id,
        senderRole: row.sender_role,
        senderName: row.sender_name || row.sender_role || 'Support',
        messageBody: row.message_body || '',
        screenshotPath: row.screenshot_path || '',
        createdAt: row.created_at
    };
}

function selectSql(whereClause = '') {
    return `
        SELECT
            support_requests.*,
            customers.name AS customer_name,
            customers.email AS customer_email,
            COALESCE(merchants.name, merchant_salons.salon_name) AS merchant_name
        FROM support_requests
        INNER JOIN users AS customers ON customers.user_id = support_requests.customer_user_id
        LEFT JOIN users AS merchants ON merchants.user_id = support_requests.merchant_user_id
        LEFT JOIN (
            SELECT merchant_id, MIN(salon_name) AS salon_name
            FROM salons
            GROUP BY merchant_id
        ) AS merchant_salons ON merchant_salons.merchant_id = support_requests.merchant_user_id
        ${whereClause}
        ORDER BY
            CASE
                WHEN support_requests.status IN ('pending_admin_review', 'pending_merchant_review') THEN 0
                WHEN support_requests.status IN ('merchant_approved', 'merchant_declined') THEN 1
                ELSE 2
            END,
            support_requests.created_at DESC,
            support_requests.request_id DESC
    `;
}

function create(data, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO support_requests
                (
                    customer_user_id,
                    merchant_user_id,
                    request_type,
                    target_type,
                    target_id,
                    receipt_id,
                    status,
                    reason,
                    customer_note,
                    requested_change,
                    refund_amount,
                    late_fee_amount,
                    is_late_cancellation,
                    delivery_status
                )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            data.customerUserId,
            data.merchantUserId || null,
            data.requestType,
            data.targetType,
            String(data.targetId),
            data.receiptId || null,
            data.status || 'pending_admin_review',
            data.reason || null,
            data.customerNote || null,
            data.requestedChange || null,
            Number(data.refundAmount || 0),
            Number(data.lateFeeAmount || 0),
            data.isLateCancellation ? 1 : 0,
            data.deliveryStatus || null
        ];

        db.query(sql, values, callback);
    });
}

function getForCustomer(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            selectSql('WHERE support_requests.customer_user_id = ?'),
            [userId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows.map(mapRow));
            }
        );
    });
}

function getForMerchant(merchantUserId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            selectSql('WHERE support_requests.merchant_user_id = ?'),
            [merchantUserId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows.map(mapRow));
            }
        );
    });
}

function getForAdmin(callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(selectSql(''), (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapRow));
        });
    });
}

function findById(requestId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `${selectSql('WHERE support_requests.request_id = ?')} LIMIT 1`,
            [requestId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows[0] ? mapRow(rows[0]) : null);
            }
        );
    });
}

function hasActiveRequest(customerUserId, targetType, targetId, requestTypes, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const types = Array.isArray(requestTypes) ? requestTypes.filter(Boolean) : [];
        const params = [
            customerUserId,
            targetType,
            String(targetId),
            ...RESOLVED_STATUSES
        ];
        let typeClause = '';

        if (types.length > 0) {
            typeClause = `AND request_type IN (${types.map(() => '?').join(', ')})`;
            params.push(...types);
        }

        const sql = `
            SELECT request_id
            FROM support_requests
            WHERE customer_user_id = ?
                AND target_type = ?
                AND target_id = ?
                AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')})
                ${typeClause}
            LIMIT 1
        `;

        db.query(sql, params, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.length > 0);
        });
    });
}

function countOpenByCustomer(customerUserId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT COUNT(*) AS open_count
            FROM support_requests
            WHERE customer_user_id = ?
                AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [customerUserId, ...RESOLVED_STATUSES], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, Number(rows[0]?.open_count || 0));
        });
    });
}

function getSummary(callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN request_type IN ('order_refund', 'booking_refund') AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS pending_refund_count,
                COALESCE(SUM(CASE WHEN request_type IN ('order_refund', 'booking_refund') AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')}) THEN refund_amount ELSE 0 END), 0) AS pending_refund_amount
            FROM support_requests
        `;

        db.query(sql, [...RESOLVED_STATUSES, ...RESOLVED_STATUSES, ...RESOLVED_STATUSES], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                totalCount: Number(rows[0]?.total_count || 0),
                openCount: Number(rows[0]?.open_count || 0),
                pendingRefundCount: Number(rows[0]?.pending_refund_count || 0),
                pendingRefundAmount: Number(rows[0]?.pending_refund_amount || 0)
            });
        });
    });
}

function adminSendToMerchant(requestId, adminUserId, note, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                admin_user_id = ?,
                admin_note = ?,
                status = 'pending_merchant_review',
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id IS NOT NULL
                AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [adminUserId, note || null, requestId, ...RESOLVED_STATUSES], callback);
    });
}

function merchantRespond(requestId, merchantUserId, decision, note, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const merchantDecision = decision === 'approved' ? 'approved' : 'declined';
        const status = merchantDecision === 'approved' ? 'merchant_approved' : 'merchant_declined';

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = ?,
                merchant_note = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status = 'pending_merchant_review'
        `;

        db.query(sql, [merchantDecision, note || null, status, requestId, merchantUserId], callback);
    });
}

function adminResolve(requestId, adminUserId, decision, note, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const adminDecision = decision === 'approved' ? 'approved' : 'rejected';
        const status = adminDecision === 'approved' ? 'resolved_approved' : 'resolved_rejected';

        const sql = `
            UPDATE support_requests
            SET
                admin_user_id = ?,
                admin_decision = ?,
                admin_note = ?,
                status = ?,
                resolved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND status NOT IN (${RESOLVED_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [adminUserId, adminDecision, note || null, status, requestId, ...RESOLVED_STATUSES], callback);
    });
}

function createMessage(data, callback) {
    ensureMessageSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO support_messages
                (request_id, sender_user_id, sender_role, message_body, screenshot_path)
            VALUES (?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            data.requestId,
            data.senderUserId || null,
            data.senderRole || 'customer',
            data.messageBody || null,
            data.screenshotPath || null
        ], callback);
    });
}

function getMessagesForRequests(requestIds, callback) {
    const ids = (Array.isArray(requestIds) ? requestIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

    if (!ids.length) {
        callback(null, {});
        return;
    }

    ensureMessageSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const placeholders = ids.map(() => '?').join(', ');
        const sql = `
            SELECT
                support_messages.*,
                users.name AS sender_name
            FROM support_messages
            LEFT JOIN users ON users.user_id = support_messages.sender_user_id
            WHERE support_messages.request_id IN (${placeholders})
            ORDER BY support_messages.created_at ASC, support_messages.message_id ASC
        `;

        db.query(sql, ids, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            const grouped = ids.reduce((map, id) => {
                map[String(id)] = [];
                return map;
            }, {});

            rows.forEach((row) => {
                const key = String(row.request_id);
                grouped[key] = grouped[key] || [];
                grouped[key].push(mapMessageRow(row));
            });

            callback(null, grouped);
        });
    });
}

module.exports = {
    adminResolve,
    adminSendToMerchant,
    countOpenByCustomer,
    create,
    createMessage,
    findById,
    getForAdmin,
    getForCustomer,
    getForMerchant,
    getMessagesForRequests,
    getSummary,
    hasActiveRequest,
    merchantRespond
};
