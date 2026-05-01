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

    db.query(sql, callback);
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
                (receipt_id, user_id, purchase_type, item_names, items_json, total_amount, payment_method, payment_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                item_names = VALUES(item_names),
                items_json = VALUES(items_json),
                total_amount = VALUES(total_amount),
                payment_method = VALUES(payment_method),
                payment_status = VALUES(payment_status)
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
            receipt.paidAt ? new Date(receipt.paidAt) : new Date()
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

    return {
        id: row.receipt_id,
        displayId: row.receipt_id.replace(/^order-/, ''),
        type: row.purchase_type === 'booking' ? 'booking' : 'order',
        userId: row.user_id,
        userName: '',
        merchantName: 'Vaniday',
        items: parseItems(row.items_json),
        totalAmount: Number(row.total_amount || 0),
        paymentMethod: row.payment_method || 'paid',
        paymentStatus: row.payment_status || 'paid',
        paidAt: row.created_at
    };
}

module.exports = {
    getByReceiptId,
    getByUserId,
    mapReceipt,
    save
};
