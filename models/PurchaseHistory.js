const db = require('../db');

function ensureTable(callback) {
    const sql = `
        CREATE TABLE IF NOT EXISTS purchase_history (
            history_id INT NOT NULL AUTO_INCREMENT,
            receipt_id VARCHAR(64) NOT NULL,
            user_id INT NOT NULL,
            purchase_type VARCHAR(20) NOT NULL,
            item_names TEXT NOT NULL,
            items_json LONGTEXT NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
            payment_method VARCHAR(50) DEFAULT NULL,
            payment_status VARCHAR(50) DEFAULT 'paid',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (history_id),
            UNIQUE KEY uniq_purchase_history_receipt (receipt_id),
            KEY idx_purchase_history_user (user_id)
        )
    `;

    db.query(sql, (tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SHOW COLUMNS FROM purchase_history', (columnError, columns = []) => {
            if (columnError) {
                callback(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('delivery_status')) {
                alters.push("ADD COLUMN delivery_status VARCHAR(30) NOT NULL DEFAULT 'processing'");
            }

            if (!fields.has('refund_status')) {
                alters.push("ADD COLUMN refund_status VARCHAR(30) NOT NULL DEFAULT 'none'");
            }

            if (!fields.has('refunded_amount')) {
                alters.push('ADD COLUMN refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
            }

            if (!fields.has('refunded_at')) {
                alters.push('ADD COLUMN refunded_at DATETIME DEFAULT NULL');
            }

            if (!fields.has('fulfilment')) {
                alters.push("ADD COLUMN fulfilment VARCHAR(30) DEFAULT NULL");
            }

            if (!fields.has('pickup_merchant_id')) {
                alters.push('ADD COLUMN pickup_merchant_id VARCHAR(64) DEFAULT NULL');
            }

            if (!fields.has('pickup_merchant_name')) {
                alters.push('ADD COLUMN pickup_merchant_name VARCHAR(120) DEFAULT NULL');
            }

            if (!fields.has('pickup_status')) {
                alters.push("ADD COLUMN pickup_status VARCHAR(40) DEFAULT NULL");
            }

            if (!fields.has('pickup_at')) {
                alters.push('ADD COLUMN pickup_at DATETIME DEFAULT NULL');
            }

            if (!fields.has('original_amount')) {
                alters.push('ADD COLUMN original_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
            }

            if (!fields.has('cashback_used')) {
                alters.push('ADD COLUMN cashback_used DECIMAL(10,2) NOT NULL DEFAULT 0.00');
            }

            if (!alters.length) {
                callback(null);
                return;
            }

            db.query(`ALTER TABLE purchase_history ${alters.join(', ')}`, callback);
        });
    });
}

function formatItemNames(items = []) {
    return items.map((item) => {
        const quantity = Number(item.quantity || 1);
        return quantity > 1 ? `${item.name} x${quantity}` : item.name;
    }).filter(Boolean).join(', ');
}

function save(receipt, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const items = Array.isArray(receipt.items) ? receipt.items : [];
        const itemNames = formatItemNames(items) || (receipt.type === 'booking' ? 'Service booking' : 'Product order');
        const sql = `
            INSERT INTO purchase_history
                (receipt_id, user_id, purchase_type, item_names, items_json, total_amount, payment_method, payment_status, created_at, fulfilment, pickup_merchant_id, pickup_merchant_name, pickup_status, pickup_at, original_amount, cashback_used)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                item_names = VALUES(item_names),
                items_json = VALUES(items_json),
                total_amount = VALUES(total_amount),
                payment_method = VALUES(payment_method),
                payment_status = VALUES(payment_status),
                fulfilment = VALUES(fulfilment),
                pickup_merchant_id = VALUES(pickup_merchant_id),
                pickup_merchant_name = VALUES(pickup_merchant_name),
                pickup_status = VALUES(pickup_status),
                pickup_at = VALUES(pickup_at),
                original_amount = VALUES(original_amount),
                cashback_used = VALUES(cashback_used)
        `;

        db.query(sql, [
            String(receipt.id),
            receipt.userId,
            receipt.type === 'booking' ? 'booking' : 'product',
            itemNames,
            JSON.stringify(items),
            Number(receipt.totalAmount || 0),
            receipt.paymentMethod || 'paid',
            receipt.paymentStatus || 'paid',
            receipt.paidAt ? new Date(receipt.paidAt) : new Date(),
            receipt.fulfilment || null,
            receipt.pickupMerchantId || null,
            receipt.pickupMerchantName || null,
            receipt.pickupStatus || (receipt.fulfilment === 'pickup' ? 'pending_pickup' : null),
            receipt.pickupAt ? new Date(receipt.pickupAt) : null,
            Number(receipt.originalAmount || receipt.totalAmount || 0),
            Number(receipt.cashbackRedeemed || receipt.cashbackUsed || 0)
        ], callback);
    });
}

function getByUserId(userId, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT *
            FROM purchase_history
            WHERE user_id = ?
            ORDER BY created_at DESC, history_id DESC
        `;

        db.query(sql, [userId], callback);
    });
}

function getByReceiptId(receiptId, userId, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT *
            FROM purchase_history
            WHERE receipt_id = ?
                AND user_id = ?
            LIMIT 1
        `;

        db.query(sql, [String(receiptId), userId], (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] || null);
        });
    });
}

function getByReceiptIdAny(receiptId, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT *
            FROM purchase_history
            WHERE receipt_id = ?
            LIMIT 1
        `;

        db.query(sql, [String(receiptId)], (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] || null);
        });
    });
}

function getSupportOrdersByUserId(userId, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                receipt_id,
                user_id,
                item_names,
                total_amount,
                payment_method,
                payment_status,
                delivery_status,
                refund_status,
                refunded_amount,
                refunded_at,
                created_at
            FROM purchase_history
            WHERE user_id = ?
                AND purchase_type = 'product'
                AND payment_status = 'paid'
            ORDER BY created_at DESC, history_id DESC
        `;

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                id: row.receipt_id,
                receiptId: row.receipt_id,
                targetId: row.receipt_id,
                source: 'purchase_history',
                userId: row.user_id,
                itemNames: row.item_names || 'Product order',
                merchantName: 'Vaniday merchant',
                merchantUserIds: [],
                itemCount: 1,
                totalAmount: Number(row.total_amount || 0),
                paymentStatus: row.payment_status || 'paid',
                paymentMethod: row.payment_method || 'card',
                deliveryStatus: row.delivery_status || 'processing',
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                refundedAt: row.refunded_at,
                createdAt: row.created_at
            })));
        });
    });
}

function getSupportOrderForCustomer(userId, receiptId, callback) {
    getSupportOrdersByUserId(userId, (error, orders = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, orders.find((order) => String(order.receiptId) === String(receiptId)) || null);
    });
}

function updateDeliveryStatus(receiptId, status, callback) {
    const value = ['processing', 'packed', 'shipped', 'delivered', 'cancelled'].includes(status)
        ? status
        : 'processing';

    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query(
            `UPDATE purchase_history SET delivery_status = ? WHERE receipt_id = ? AND purchase_type = 'product'`,
            [value, receiptId],
            callback
        );
    });
}

function recordRefund(receiptId, amount, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query(
            `UPDATE purchase_history
             SET refund_status = 'refunded', refunded_amount = ?, refunded_at = CURRENT_TIMESTAMP
             WHERE receipt_id = ? AND purchase_type = 'product'`,
            [Number(amount || 0), receiptId],
            callback
        );
    });
}

function parseItems(value) {
    if (Array.isArray(value)) {
        return value;
    }

    try {
        return JSON.parse(value || '[]');
    } catch (error) {
        return [];
    }
}

function mapReceipt(row) {
    if (!row) {
        return null;
    }

    const items = parseItems(row.items_json);
    const merchantNames = Array.from(new Set(items.map((item) => item.merchantName || item.detail).filter(Boolean)));

    return {
        id: row.receipt_id,
        displayId: row.receipt_id.replace(/^order-/, ''),
        type: row.purchase_type === 'booking' ? 'booking' : 'order',
        userId: row.user_id,
        userName: '',
        merchantName: row.pickup_merchant_name || merchantNames.join(', ') || 'Vaniday merchant',
        items,
        totalAmount: Number(row.total_amount || 0),
        originalAmount: Number(row.original_amount || row.total_amount || 0),
        cashbackRedeemed: Number(row.cashback_used || 0),
        paymentMethod: row.payment_method || 'paid',
        paymentStatus: row.payment_status || 'paid',
        deliveryStatus: row.delivery_status || 'processing',
        refundStatus: row.refund_status || 'none',
        fulfilment: row.fulfilment || '',
        pickupMerchantId: row.pickup_merchant_id || '',
        pickupMerchantName: row.pickup_merchant_name || '',
        pickupStatus: row.pickup_status || (row.fulfilment === 'pickup' ? 'pending_pickup' : ''),
        pickupAt: row.pickup_at || null,
        paidAt: row.created_at
    };
}

function markPickupCollected(receiptId, callback) {
    ensureTable((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query(
            `UPDATE purchase_history
             SET pickup_status = 'picked_up', pickup_at = COALESCE(pickup_at, CURRENT_TIMESTAMP), delivery_status = 'delivered'
             WHERE receipt_id = ? AND purchase_type = 'product'`,
            [receiptId],
            callback
        );
    });
}

module.exports = {
    getByReceiptId,
    getByReceiptIdAny,
    getSupportOrderForCustomer,
    getSupportOrdersByUserId,
    getByUserId,
    markPickupCollected,
    mapReceipt,
    recordRefund,
    updateDeliveryStatus,
    save
};
