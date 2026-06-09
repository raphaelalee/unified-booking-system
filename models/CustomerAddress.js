const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    db.query(`
        CREATE TABLE IF NOT EXISTS customer_addresses (
            address_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            label VARCHAR(80) NOT NULL DEFAULT 'Delivery address',
            recipient_name VARCHAR(120) DEFAULT NULL,
            phone VARCHAR(20) DEFAULT NULL,
            address_line1 VARCHAR(255) NOT NULL,
            address_line2 VARCHAR(120) DEFAULT NULL,
            postal_code VARCHAR(6) NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            source_receipt_id VARCHAR(80) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (address_id),
            UNIQUE KEY uq_customer_addresses_user_receipt (user_id, source_receipt_id),
            KEY idx_customer_addresses_user_default (user_id, is_default, updated_at),
            KEY idx_customer_addresses_receipt (source_receipt_id),
            CONSTRAINT fk_customer_addresses_user
                FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, (error) => {
        if (!error) schemaReady = true;
        callback(error);
    });
}

function normalizePhone(value) {
    return String(value || '').replace(/[\s-]/g, '').replace(/^\+65/, '').slice(0, 20) || null;
}

function saveFromReceipt(receipt, callback) {
    if (!receipt || String(receipt.fulfilment || '').toLowerCase() !== 'delivery') {
        callback(null, null);
        return;
    }

    const userId = Number(receipt.userId || 0);
    const addressLine1 = String(receipt.deliveryAddress || '').trim();
    const addressLine2 = String(receipt.deliveryUnit || '').trim();
    const postalCode = String(receipt.deliveryPostal || '').trim();

    if (!userId || !addressLine1 || !postalCode) {
        callback(null, null);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO customer_addresses
                (user_id, label, recipient_name, phone, address_line1, address_line2, postal_code, is_default, source_receipt_id)
            VALUES (?, 'Delivery address', ?, ?, ?, ?, ?, 1, ?)
            ON DUPLICATE KEY UPDATE
                recipient_name = VALUES(recipient_name),
                phone = VALUES(phone),
                address_line1 = VALUES(address_line1),
                address_line2 = VALUES(address_line2),
                postal_code = VALUES(postal_code),
                is_default = 1,
                updated_at = CURRENT_TIMESTAMP
        `;

        db.query(sql, [
            userId,
            receipt.userName || null,
            normalizePhone(receipt.deliveryPhone),
            addressLine1,
            addressLine2 || null,
            postalCode,
            receipt.id || null
        ], callback);
    });
}

module.exports = {
    ensureSchema,
    saveFromReceipt
};
