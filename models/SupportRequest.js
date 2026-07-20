const db = require('../db');
const {
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');

let schemaReady = false;
let schemaPending = false;
let schemaQueue = [];
let messageSchemaReady = false;
let messageSchemaPending = false;
let messageSchemaQueue = [];

const REVIEWABLE_STATUSES = ['pending_merchant_review', 'under_review'];
const ACTIVE_STATUSES = ['pending_merchant_review', 'under_review', 'more_information_required', 'return_required', 'approved', 'refund_processing', 'refund_failed', 'refund_reconciliation_required'];
const RESOLVED_STATUSES = ['partially_refunded', 'refunded', 'rejected', 'cancelled', 'closed'];

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
            action_type VARCHAR(40) DEFAULT NULL,
            eligibility_status_code VARCHAR(80) DEFAULT NULL,
            eligibility_deadline DATETIME DEFAULT NULL,
            return_required TINYINT(1) NOT NULL DEFAULT 0,
            evidence_required TINYINT(1) NOT NULL DEFAULT 0,
            target_type VARCHAR(20) NOT NULL,
            target_id VARCHAR(80) NOT NULL,
            receipt_id VARCHAR(80) DEFAULT NULL,
            target_label VARCHAR(255) DEFAULT NULL,
            payment_method VARCHAR(40) DEFAULT NULL,
            status VARCHAR(40) NOT NULL DEFAULT 'pending_merchant_review',
            merchant_decision VARCHAR(30) NOT NULL DEFAULT 'pending',
            admin_decision VARCHAR(30) NOT NULL DEFAULT 'pending',
            reason VARCHAR(160) DEFAULT NULL,
            customer_note TEXT,
            requested_change TEXT,
            merchant_note TEXT,
            admin_note TEXT,
            refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            approved_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            approved_refund_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
            refund_base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            gross_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            processing_fee_deduction DECIMAL(10,2) NOT NULL DEFAULT 0,
            other_deduction_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            net_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            original_processing_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            processing_fee_source VARCHAR(40) NOT NULL DEFAULT 'unknown',
            refund_reason_category VARCHAR(60) DEFAULT NULL,
            refund_responsibility VARCHAR(40) DEFAULT NULL,
            merchant_decision_reason TEXT DEFAULT NULL,
            merchant_internal_notes TEXT DEFAULT NULL,
            fee_deduction_applies TINYINT(1) NOT NULL DEFAULT 0,
            fee_acknowledged_at DATETIME DEFAULT NULL,
            fee_acknowledgement_version VARCHAR(80) DEFAULT NULL,
            payment_transaction_id INT DEFAULT NULL,
            reviewed_by INT DEFAULT NULL,
            reviewed_at TIMESTAMP NULL DEFAULT NULL,
            provider_refund_id VARCHAR(190) DEFAULT NULL,
            refunded_at TIMESTAMP NULL DEFAULT NULL,
            failure_reason TEXT DEFAULT NULL,
            late_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            is_late_cancellation TINYINT(1) NOT NULL DEFAULT 0,
            customer_terms_accepted TINYINT(1) NOT NULL DEFAULT 0,
            customer_terms_version VARCHAR(40) DEFAULT NULL,
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
        if (error) {
            flushSchemaQueue(error);
            return;
        }

        db.query('SHOW COLUMNS FROM support_requests', (columnError, columns = []) => {
            if (columnError) {
                flushSchemaQueue(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('approved_refund_amount')) {
                alters.push('ADD COLUMN approved_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER refund_amount');
            }
            if (!fields.has('action_type')) {
                alters.push('ADD COLUMN action_type VARCHAR(40) DEFAULT NULL AFTER request_type');
            }
            if (!fields.has('eligibility_status_code')) {
                alters.push('ADD COLUMN eligibility_status_code VARCHAR(80) DEFAULT NULL AFTER action_type');
            }
            if (!fields.has('eligibility_deadline')) {
                alters.push('ADD COLUMN eligibility_deadline DATETIME DEFAULT NULL AFTER eligibility_status_code');
            }
            if (!fields.has('return_required')) {
                alters.push('ADD COLUMN return_required TINYINT(1) NOT NULL DEFAULT 0 AFTER eligibility_deadline');
            }
            if (!fields.has('evidence_required')) {
                alters.push('ADD COLUMN evidence_required TINYINT(1) NOT NULL DEFAULT 0 AFTER return_required');
            }
            if (!fields.has('approved_refund_percentage')) {
                alters.push('ADD COLUMN approved_refund_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00 AFTER approved_refund_amount');
            }
            if (!fields.has('refund_base_amount')) {
                alters.push('ADD COLUMN refund_base_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER approved_refund_percentage');
            }
            if (!fields.has('gross_refund_amount')) {
                alters.push('ADD COLUMN gross_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER approved_refund_amount');
            }
            if (!fields.has('processing_fee_deduction')) {
                alters.push('ADD COLUMN processing_fee_deduction DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER gross_refund_amount');
            }
            if (!fields.has('other_deduction_amount')) {
                alters.push('ADD COLUMN other_deduction_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER processing_fee_deduction');
            }
            if (!fields.has('net_refund_amount')) {
                alters.push('ADD COLUMN net_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER processing_fee_deduction');
            }
            if (!fields.has('original_processing_fee_amount')) {
                alters.push('ADD COLUMN original_processing_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER net_refund_amount');
            }
            if (!fields.has('processing_fee_source')) {
                alters.push("ADD COLUMN processing_fee_source VARCHAR(40) NOT NULL DEFAULT 'unknown' AFTER original_processing_fee_amount");
            }
            if (!fields.has('refund_reason_category')) {
                alters.push('ADD COLUMN refund_reason_category VARCHAR(60) DEFAULT NULL AFTER reason');
            }
            if (!fields.has('refund_responsibility')) {
                alters.push('ADD COLUMN refund_responsibility VARCHAR(40) DEFAULT NULL AFTER refund_reason_category');
            }
            if (!fields.has('merchant_decision_reason')) {
                alters.push('ADD COLUMN merchant_decision_reason TEXT DEFAULT NULL AFTER merchant_note');
            }
            if (!fields.has('merchant_internal_notes')) {
                alters.push('ADD COLUMN merchant_internal_notes TEXT DEFAULT NULL AFTER merchant_decision_reason');
            }
            if (!fields.has('fee_deduction_applies')) {
                alters.push('ADD COLUMN fee_deduction_applies TINYINT(1) NOT NULL DEFAULT 0 AFTER refund_responsibility');
            }
            if (!fields.has('fee_acknowledged_at')) {
                alters.push('ADD COLUMN fee_acknowledged_at DATETIME DEFAULT NULL AFTER fee_deduction_applies');
            }
            if (!fields.has('fee_acknowledgement_version')) {
                alters.push('ADD COLUMN fee_acknowledgement_version VARCHAR(80) DEFAULT NULL AFTER fee_acknowledged_at');
            }
            if (!fields.has('target_label')) {
                alters.push('ADD COLUMN target_label VARCHAR(255) DEFAULT NULL AFTER receipt_id');
            }
            if (!fields.has('payment_method')) {
                alters.push('ADD COLUMN payment_method VARCHAR(40) DEFAULT NULL AFTER target_label');
            }
            if (!fields.has('customer_terms_accepted')) {
                alters.push('ADD COLUMN customer_terms_accepted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_late_cancellation');
            }
            if (!fields.has('customer_terms_version')) {
                alters.push('ADD COLUMN customer_terms_version VARCHAR(40) DEFAULT NULL AFTER customer_terms_accepted');
            }
            if (!fields.has('payment_transaction_id')) {
                alters.push('ADD COLUMN payment_transaction_id INT DEFAULT NULL AFTER approved_refund_amount');
            }
            if (!fields.has('reviewed_by')) {
                alters.push('ADD COLUMN reviewed_by INT DEFAULT NULL AFTER payment_transaction_id');
            }
            if (!fields.has('reviewed_at')) {
                alters.push('ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL AFTER reviewed_by');
            }
            if (!fields.has('provider_refund_id')) {
                alters.push('ADD COLUMN provider_refund_id VARCHAR(190) DEFAULT NULL AFTER reviewed_at');
            }
            if (!fields.has('refunded_at')) {
                alters.push('ADD COLUMN refunded_at TIMESTAMP NULL DEFAULT NULL AFTER provider_refund_id');
            }
            if (!fields.has('failure_reason')) {
                alters.push('ADD COLUMN failure_reason TEXT DEFAULT NULL AFTER refunded_at');
            }

            const finish = () => {
                const finishSupportMigration = () => {
                    const migrationSql = `
                    UPDATE support_requests
                    SET status = CASE
                            WHEN status IN ('pending_admin_review', 'forwarded_to_merchant') THEN 'pending_merchant_review'
                            WHEN status = 'merchant_approved' THEN 'approved'
                            WHEN status = 'merchant_declined' THEN 'rejected'
                            WHEN status = 'resolved_approved' THEN 'refunded'
                            WHEN status = 'resolved_rejected' THEN 'rejected'
                            ELSE status
                        END,
                        admin_decision = CASE
                            WHEN status IN ('pending_admin_review', 'forwarded_to_merchant', 'merchant_approved', 'merchant_declined') THEN 'not_required'
                            ELSE admin_decision
                        END
                    WHERE status IN (
                        'pending_admin_review',
                        'forwarded_to_merchant',
                        'merchant_approved',
                        'merchant_declined',
                        'resolved_approved',
                        'resolved_rejected'
                    )
                `;

                    db.query(migrationSql, (migrationError) => {
                        if (!migrationError) {
                            schemaReady = true;
                        }
                        flushSchemaQueue(migrationError);
                    });
                };

                db.query('SHOW COLUMNS FROM transactions', (transactionColumnError, transactionColumns = []) => {
                    if (transactionColumnError) {
                        finishSupportMigration();
                        return;
                    }

                    const transactionFields = new Set(transactionColumns.map((column) => column.Field));
                    const transactionAlters = [];
                    if (!transactionFields.has('processing_fee_amount')) {
                        transactionAlters.push('ADD COLUMN processing_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
                    }
                    if (!transactionFields.has('processing_fee_source')) {
                        transactionAlters.push("ADD COLUMN processing_fee_source VARCHAR(40) NOT NULL DEFAULT 'unknown'");
                    }

                    if (!transactionAlters.length) {
                        finishSupportMigration();
                        return;
                    }

                    db.query(`ALTER TABLE transactions ${transactionAlters.join(', ')}`, (transactionAlterError) => {
                        if (transactionAlterError) {
                            flushSchemaQueue(transactionAlterError);
                            return;
                        }
                        finishSupportMigration();
                    });
                });
            };

            if (!alters.length) {
                finish();
                return;
            }

            db.query(`ALTER TABLE support_requests ${alters.join(', ')}`, (alterError) => {
                if (alterError) {
                    flushSchemaQueue(alterError);
                    return;
                }
                finish();
            });
        });
    });
}

function mapRow(row = {}) {
    return {
        id: row.request_id,
        customerUserId: row.customer_user_id,
        customerName: row.customer_name || 'Customer',
        customerEmail: row.customer_email || '',
        customerPhone: row.customer_phone || '',
        merchantUserId: row.merchant_user_id,
        merchantName: row.merchant_name || 'Merchant',
        adminUserId: row.admin_user_id,
        requestType: row.request_type,
        actionType: row.action_type || '',
        eligibilityStatusCode: row.eligibility_status_code || '',
        eligibilityDeadline: row.eligibility_deadline || null,
        returnRequired: Number(row.return_required || 0) === 1,
        evidenceRequired: Number(row.evidence_required || 0) === 1,
        targetType: row.target_type,
        targetId: row.target_id,
        receiptId: row.receipt_id,
        targetLabel: row.target_label || '',
        paymentMethod: normalizePaymentMethod(row.original_payment_method || row.payment_method || ''),
        paymentProvider: normalizePaymentProvider(row.original_payment_provider || '', row.original_payment_method || row.payment_method || ''),
        paymentMethodLabel: row.original_payment_method
            ? formatPaymentMethod(row.original_payment_method, row.original_payment_provider)
            : (row.payment_method ? formatPaymentMethod(row.payment_method, row.original_payment_provider || '') : ''),
        originalPaidAmount: Number(row.original_paid_amount || row.original_total_amount || 0),
        originalGrossAmount: Number(row.original_gross_amount || row.original_total_amount || 0),
        originalRefundedAmount: Number(row.original_refunded_amount || 0),
        originalProcessingFeeAmount: Number(row.original_processing_fee_amount || row.transaction_processing_fee_amount || 0),
        processingFeeSource: row.processing_fee_source || row.transaction_processing_fee_source || 'unknown',
        remainingRefundableAmount: Math.max(Number(row.original_paid_amount || row.original_total_amount || 0) - Number(row.original_refunded_amount || 0), 0),
        currency: row.original_currency || 'SGD',
        paymentDate: row.original_payment_date || null,
        paymentTransactionReference: row.original_provider_transaction_id || row.original_provider_capture_id || row.original_provider_payment_id || row.original_provider_session_id || '',
        status: row.status,
        merchantDecision: row.merchant_decision,
        adminDecision: row.admin_decision,
        reason: row.reason,
        customerNote: row.customer_note,
        requestedChange: row.requested_change,
        merchantNote: row.merchant_note,
        adminNote: row.admin_note,
        merchantDecisionReason: row.merchant_decision_reason || row.merchant_note || '',
        merchantInternalNotes: row.merchant_internal_notes || '',
        refundAmount: Number(row.refund_amount || 0),
        approvedRefundAmount: Number(row.approved_refund_amount || 0),
        approvedRefundPercentage: Number(row.approved_refund_percentage || 100),
        refundBaseAmount: Number(row.refund_base_amount || 0),
        grossRefundAmount: Number(row.gross_refund_amount || row.refund_amount || 0),
        processingFeeDeduction: Number(row.processing_fee_deduction || 0),
        otherDeductionAmount: Number(row.other_deduction_amount || row.late_fee_amount || 0),
        netRefundAmount: Number(row.net_refund_amount || row.approved_refund_amount || row.refund_amount || 0),
        refundReasonCategory: row.refund_reason_category || '',
        refundResponsibility: row.refund_responsibility || '',
        feeDeductionApplies: Number(row.fee_deduction_applies || 0) === 1,
        feeAcknowledgedAt: row.fee_acknowledged_at || null,
        feeAcknowledgementVersion: row.fee_acknowledgement_version || '',
        paymentTransactionId: row.payment_transaction_id ? Number(row.payment_transaction_id) : null,
        reviewedBy: row.reviewed_by ? Number(row.reviewed_by) : null,
        reviewedAt: row.reviewed_at,
        providerRefundId: row.provider_refund_id || '',
        refundedAt: row.refunded_at,
        failureReason: row.failure_reason || '',
        lateFeeAmount: Number(row.late_fee_amount || 0),
        isLateCancellation: Boolean(row.is_late_cancellation),
        customerTermsAccepted: Boolean(row.customer_terms_accepted),
        customerTermsVersion: row.customer_terms_version || '',
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
            customers.phone AS customer_phone,
            COALESCE(merchants.name, merchant_salons.salon_name) AS merchant_name,
            payment_txn.total_amount AS original_total_amount,
            payment_txn.gross_amount AS original_gross_amount,
            payment_txn.paid_amount AS original_paid_amount,
            payment_txn.refunded_amount AS original_refunded_amount,
            payment_txn.currency AS original_currency,
            payment_txn.payment_method AS original_payment_method,
            payment_txn.payment_provider AS original_payment_provider,
            payment_txn.processing_fee_amount AS transaction_processing_fee_amount,
            payment_txn.processing_fee_source AS transaction_processing_fee_source,
            payment_txn.provider_payment_id AS original_provider_payment_id,
            payment_txn.provider_session_id AS original_provider_session_id,
            payment_txn.provider_capture_id AS original_provider_capture_id,
            payment_txn.provider_transaction_id AS original_provider_transaction_id,
            payment_txn.payment_date AS original_payment_date
        FROM support_requests
        INNER JOIN users AS customers ON customers.user_id = support_requests.customer_user_id
        LEFT JOIN users AS merchants ON merchants.user_id = support_requests.merchant_user_id
        LEFT JOIN transactions AS payment_txn ON payment_txn.transaction_id = support_requests.payment_transaction_id
        LEFT JOIN (
            SELECT merchant_id, MIN(salon_name) AS salon_name
            FROM salons
            GROUP BY merchant_id
        ) AS merchant_salons ON merchant_salons.merchant_id = support_requests.merchant_user_id
        ${whereClause}
        ORDER BY
            CASE
                WHEN support_requests.status IN ('pending_merchant_review', 'under_review') THEN 0
                WHEN support_requests.status = 'more_information_required' THEN 1
                WHEN support_requests.status IN ('approved', 'refund_processing', 'refund_failed') THEN 1
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
                    action_type,
                    eligibility_status_code,
                    eligibility_deadline,
                    return_required,
                    evidence_required,
                    target_type,
                    target_id,
                    receipt_id,
                    target_label,
                    payment_method,
                    status,
                    reason,
                    customer_note,
                    requested_change,
                    refund_amount,
                    approved_refund_amount,
                    approved_refund_percentage,
                    refund_base_amount,
                    gross_refund_amount,
                    processing_fee_deduction,
                    other_deduction_amount,
                    net_refund_amount,
                    original_processing_fee_amount,
                    processing_fee_source,
                    refund_reason_category,
                    refund_responsibility,
                    merchant_decision_reason,
                    merchant_internal_notes,
                    fee_deduction_applies,
                    fee_acknowledged_at,
                    fee_acknowledgement_version,
                    payment_transaction_id,
                    late_fee_amount,
                    is_late_cancellation,
                    customer_terms_accepted,
                    customer_terms_version,
                    delivery_status
                )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            data.customerUserId,
            data.merchantUserId || null,
            data.requestType,
            data.actionType || null,
            data.eligibilityStatusCode || null,
            data.eligibilityDeadline || null,
            data.returnRequired ? 1 : 0,
            data.evidenceRequired ? 1 : 0,
            data.targetType,
            String(data.targetId),
            data.receiptId || null,
            data.targetLabel || null,
            data.paymentMethod || null,
            data.status || 'pending_merchant_review',
            data.reason || null,
            data.customerNote || null,
            data.requestedChange || null,
            Number(data.refundAmount || 0),
            Number(data.approvedRefundAmount || 0),
            Number(data.approvedRefundPercentage || 100),
            Number(data.refundBaseAmount || data.refundAmount || 0),
            Number(data.grossRefundAmount || data.refundAmount || 0),
            Number(data.processingFeeDeduction || 0),
            Number(data.otherDeductionAmount || data.lateFeeAmount || 0),
            Number(data.netRefundAmount || data.approvedRefundAmount || data.refundAmount || 0),
            Number(data.originalProcessingFeeAmount || 0),
            data.processingFeeSource || 'unknown',
            data.refundReasonCategory || null,
            data.refundResponsibility || null,
            data.merchantDecisionReason || null,
            data.merchantInternalNotes || null,
            data.feeDeductionApplies ? 1 : 0,
            data.feeAcknowledgedAt || null,
            data.feeAcknowledgementVersion || null,
            data.paymentTransactionId || null,
            Number(data.lateFeeAmount || 0),
            data.isLateCancellation ? 1 : 0,
            data.customerTermsAccepted ? 1 : 0,
            data.customerTermsVersion || null,
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
            selectSql(`WHERE support_requests.merchant_user_id = ?
                AND support_requests.request_type IN ('order_refund', 'booking_refund')
                AND support_requests.status IN ('pending_merchant_review', 'under_review', 'more_information_required', 'return_required', 'approved', 'refund_processing', 'partially_refunded', 'refunded', 'rejected', 'refund_failed', 'refund_reconciliation_required', 'cancelled')`),
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

        db.query(selectSql(`WHERE support_requests.request_type IN ('order_refund', 'booking_refund')`), (error, rows = []) => {
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
            ...ACTIVE_STATUSES
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
                AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
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

function getMerchantRefundStats(merchantUserId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                SUM(CASE WHEN status IN ('pending_merchant_review', 'under_review') THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN status = 'refund_processing' THEN 1 ELSE 0 END) AS processing_count,
                SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded_count,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
                SUM(CASE WHEN status = 'refund_failed' THEN 1 ELSE 0 END) AS failed_count
            FROM support_requests
            WHERE merchant_user_id = ?
                AND request_type IN ('order_refund', 'booking_refund')
        `;

        db.query(sql, [merchantUserId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                pendingCount: Number(rows[0]?.pending_count || 0),
                approvedCount: Number(rows[0]?.approved_count || 0),
                processingCount: Number(rows[0]?.processing_count || 0),
                refundedCount: Number(rows[0]?.refunded_count || 0),
                rejectedCount: Number(rows[0]?.rejected_count || 0),
                failedCount: Number(rows[0]?.failed_count || 0)
            });
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
                AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [customerUserId, ...ACTIVE_STATUSES], (error, rows = []) => {
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
                SUM(CASE WHEN status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN request_type IN ('order_refund', 'booking_refund') AND status IN ('pending_merchant_review', 'under_review') THEN 1 ELSE 0 END) AS pending_refund_count,
                COALESCE(SUM(CASE WHEN request_type IN ('order_refund', 'booking_refund') AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')}) THEN refund_amount ELSE 0 END), 0) AS pending_refund_amount,
                SUM(CASE WHEN request_type IN ('order_refund', 'booking_refund') AND status IN ('refund_failed', 'refund_reconciliation_required') THEN 1 ELSE 0 END) AS failed_refund_count
            FROM support_requests
        `;

        db.query(sql, [...ACTIVE_STATUSES, ...ACTIVE_STATUSES], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                totalCount: Number(rows[0]?.total_count || 0),
                openCount: Number(rows[0]?.open_count || 0),
                pendingRefundCount: Number(rows[0]?.pending_refund_count || 0),
                pendingRefundAmount: Number(rows[0]?.pending_refund_amount || 0),
                failedRefundCount: Number(rows[0]?.failed_refund_count || 0)
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

function merchantReject(requestId, merchantUserId, rejectionReason, merchantNotes, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'rejected',
                merchant_note = ?,
                merchant_decision_reason = ?,
                merchant_internal_notes = ?,
                admin_decision = 'not_required',
                admin_note = NULL,
                status = 'rejected',
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                resolved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status IN (${REVIEWABLE_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [
            rejectionReason || null,
            rejectionReason || null,
            merchantNotes || null,
            merchantUserId,
            requestId,
            merchantUserId,
            ...REVIEWABLE_STATUSES
        ], callback);
    });
}

function markMoreInformationRequired(requestId, merchantUserId, customerMessage, internalNotes, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'more_information_required',
                merchant_note = ?,
                merchant_decision_reason = ?,
                merchant_internal_notes = ?,
                admin_decision = 'not_required',
                status = 'more_information_required',
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status IN (${REVIEWABLE_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [
            customerMessage || null,
            customerMessage || null,
            internalNotes || null,
            merchantUserId,
            requestId,
            merchantUserId,
            ...REVIEWABLE_STATUSES
        ], callback);
    });
}

function markMoreInformationSubmitted(requestId, customerUserId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'pending',
                status = 'under_review',
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND customer_user_id = ?
                AND status = 'more_information_required'
        `;

        db.query(sql, [requestId, customerUserId], callback);
    });
}

function markReturnSubmitted(requestId, customerUserId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'return_submitted',
                status = 'under_review',
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND customer_user_id = ?
                AND status = 'return_required'
                AND return_required = 1
        `;

        db.query(sql, [requestId, customerUserId], callback);
    });
}

function markReturnRequired(requestId, merchantUserId, customerMessage, internalNotes, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'return_required',
                merchant_note = ?,
                merchant_decision_reason = ?,
                merchant_internal_notes = ?,
                admin_decision = 'not_required',
                status = 'return_required',
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status IN (${REVIEWABLE_STATUSES.map(() => '?').join(', ')})
                AND return_required = 1
        `;

        db.query(sql, [
            customerMessage || null,
            customerMessage || null,
            internalNotes || null,
            merchantUserId,
            requestId,
            merchantUserId,
            ...REVIEWABLE_STATUSES
        ], callback);
    });
}

function markMerchantApproved(requestId, merchantUserId, merchantNotes, approval = {}, callback) {
    const done = typeof approval === 'function' ? approval : callback;
    const details = typeof approval === 'function' ? {} : approval || {};

    ensureSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                merchant_decision = 'approved',
                merchant_note = ?,
                merchant_decision_reason = ?,
                merchant_internal_notes = ?,
                admin_decision = 'not_required',
                status = 'refund_processing',
                reviewed_by = ?,
                reviewed_at = CURRENT_TIMESTAMP,
                approved_refund_percentage = ?,
                refund_base_amount = ?,
                gross_refund_amount = ?,
                processing_fee_deduction = ?,
                other_deduction_amount = ?,
                net_refund_amount = ?,
                approved_refund_amount = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status IN (${REVIEWABLE_STATUSES.map(() => '?').join(', ')})
        `;

        db.query(sql, [
            details.customerFacingReason || merchantNotes || null,
            details.customerFacingReason || merchantNotes || null,
            details.internalNotes || null,
            merchantUserId,
            Number(details.approvedRefundPercentage || 100),
            Number(details.refundBaseAmount || 0),
            Number(details.grossRefundAmount || details.approvedGrossRefund || 0),
            Number(details.processingFeeDeduction || 0),
            Number(details.otherDeductionAmount || 0),
            Number(details.netRefundAmount || 0),
            Number(details.netRefundAmount || 0),
            requestId,
            merchantUserId,
            ...REVIEWABLE_STATUSES
        ], done);
    });
}

function markRefundSucceeded(requestId, merchantUserId, result, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const status = result?.manualRequired
            ? 'refund_processing'
            : (result?.refundStatus === 'partially_refunded' ? 'partially_refunded' : 'refunded');
        const sql = `
            UPDATE support_requests
            SET
                status = ?,
                provider_refund_id = ?,
                approved_refund_amount = ?,
                approved_refund_percentage = ?,
                refund_base_amount = ?,
                gross_refund_amount = ?,
                processing_fee_deduction = ?,
                other_deduction_amount = ?,
                net_refund_amount = ?,
                refunded_at = CASE WHEN ? IN ('refunded', 'partially_refunded') THEN CURRENT_TIMESTAMP ELSE refunded_at END,
                resolved_at = CASE WHEN ? IN ('refunded', 'partially_refunded') THEN CURRENT_TIMESTAMP ELSE resolved_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status = 'refund_processing'
        `;

        db.query(sql, [
            status,
            result?.providerRefundId || null,
            Number(result?.amount || 0),
            Number(result?.approvedRefundPercentage || 100),
            Number(result?.refundBaseAmount || result?.grossRefundAmount || result?.amount || 0),
            Number(result?.grossRefundAmount || result?.amount || 0),
            Number(result?.processingFeeDeduction || 0),
            Number(result?.otherDeductionAmount || 0),
            Number(result?.netRefundAmount || result?.amount || 0),
            status,
            status,
            requestId,
            merchantUserId
        ], callback);
    });
}

function markRefundFailed(requestId, merchantUserId, failureReason, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                status = 'refund_failed',
                failure_reason = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status = 'refund_processing'
        `;

        db.query(sql, [failureReason || null, requestId, merchantUserId], callback);
    });
}

function markRefundReconciliationRequired(requestId, merchantUserId, failureReason, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE support_requests
            SET
                status = 'refund_reconciliation_required',
                failure_reason = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
                AND merchant_user_id = ?
                AND status = 'refund_processing'
        `;

        db.query(sql, [failureReason || null, requestId, merchantUserId], callback);
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
    countOpenByCustomer,
    create,
    createMessage,
    findById,
    getForAdmin,
    getForCustomer,
    getForMerchant,
    getMerchantRefundStats,
    getMessagesForRequests,
    getSummary,
    hasActiveRequest,
    markMoreInformationRequired,
    markMoreInformationSubmitted,
    markMerchantApproved,
    markReturnRequired,
    markReturnSubmitted,
    markRefundFailed,
    markRefundReconciliationRequired,
    markRefundSucceeded,
    merchantReject
};
