const crypto = require('crypto');
const db = require('../db');

let schemaReady = false;
let schemaPending = false;
let schemaQueue = [];

function flushQueue(error) {
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

    const createSql = `
        CREATE TABLE IF NOT EXISTS gift_card_vouchers (
            gift_card_voucher_id INT NOT NULL AUTO_INCREMENT,
            voucher_code VARCHAR(40) NOT NULL,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            sender_user_id INT NULL,
            sender_name VARCHAR(120) NULL,
            recipient_name VARCHAR(120) NULL,
            recipient_email VARCHAR(255) NULL,
            message TEXT NULL,
            delivery_option VARCHAR(20) NOT NULL DEFAULT 'self',
            scheduled_send_date DATETIME NULL,
            expiry_date DATETIME NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            source_reference VARCHAR(120) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (gift_card_voucher_id),
            UNIQUE KEY uq_gift_card_voucher_code (voucher_code),
            UNIQUE KEY uq_gift_card_voucher_source (source_reference)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(createSql, (createError) => {
        if (createError) {
            flushQueue(createError);
            return;
        }

        schemaReady = true;
        flushQueue(null);
    });
}

function generateCode(prefix = 'VANI') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function create(payload, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const code = payload.code || generateCode();
        const values = [
            code,
            Number(payload.amount || 0),
            Number(payload.balance || payload.amount || 0),
            payload.senderUserId || null,
            payload.senderName || null,
            payload.recipientName || null,
            payload.recipientEmail || null,
            payload.message || null,
            payload.deliveryOption || 'self',
            payload.scheduledSendDate || null,
            payload.expiryDate || null,
            payload.status || 'active'
            ,
            payload.sourceReference || null
        ];

        db.query(
            `
                INSERT INTO gift_card_vouchers
                    (voucher_code, amount, balance, sender_user_id, sender_name, recipient_name, recipient_email, message, delivery_option, scheduled_send_date, expiry_date, status, source_reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE gift_card_voucher_id = LAST_INSERT_ID(gift_card_voucher_id)
            `,
            values,
            (error, result) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, {
                    insertId: result.insertId,
                    voucherCode: code,
                    duplicate: result.affectedRows > 1
                });
            }
        );
    });
}

module.exports = {
    ensureSchema,
    generateCode,
    create
};
