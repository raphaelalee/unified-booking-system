const crypto = require('crypto');
const db = require('../db');

function generateCode(prefix = 'VANI') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function create(payload, callback, attemptsRemaining = 3) {
    const code = payload.code || generateCode();
    const amount = Number(payload.amount || 0);
    const values = [
        code,
        amount,
        amount,
        payload.senderUserId || null,
        payload.senderName || null,
        payload.recipientName || null,
        payload.recipientEmail || null,
        payload.message || null,
        payload.deliveryOption || 'self',
        payload.scheduledSendDate || null,
        payload.expiryDate || null,
        payload.status || 'active',
        payload.sourceReference || null
    ];

    db.query(
        `
            INSERT INTO gift_card_vouchers
                (voucher_code, amount, balance, sender_user_id, sender_name, recipient_name, recipient_email, message, delivery_option, scheduled_send_date, expiry_date, status, source_reference)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        values,
        (error, result) => {
            if (error) {
                if (error.code === 'ER_DUP_ENTRY' && attemptsRemaining > 0) {
                    create({ ...payload, code: generateCode() }, callback, attemptsRemaining - 1);
                    return;
                }

                callback(error);
                return;
            }

            callback(null, {
                insertId: result.insertId,
                voucherCode: code,
                duplicate: false
            });
        }
    );
}

module.exports = {
    generateCode,
    create
};
