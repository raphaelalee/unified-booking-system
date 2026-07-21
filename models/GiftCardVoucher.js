const crypto = require('crypto');
const db = require('../db');

function generateCode(prefix = 'VANI') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase();
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

function claimForUser(user, rawCode, callback) {
    const code = normalizeCode(rawCode);
    const userId = Number(user?.id || user?.user_id || 0);
    const userEmail = String(user?.email || '').trim().toLowerCase();

    if (!userId || !code) {
        callback(new Error('Gift card code is required.'));
        return;
    }

    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const rollback = (error) => connection.rollback(() => {
                connection.release();
                callback(error);
            });

            connection.query(
                'SELECT * FROM gift_card_vouchers WHERE voucher_code = ? LIMIT 1 FOR UPDATE',
                [code],
                (lookupError, rows = []) => {
                    if (lookupError) {
                        rollback(lookupError);
                        return;
                    }

                    const giftCard = rows[0];
                    if (!giftCard) {
                        rollback(new Error('Gift card code could not be found.'));
                        return;
                    }

                    const recipientEmail = String(giftCard.recipient_email || '').trim().toLowerCase();
                    if (recipientEmail && userEmail && recipientEmail !== userEmail) {
                        rollback(new Error('This gift card was sent to another email address.'));
                        return;
                    }

                    const expiryDate = giftCard.expiry_date ? new Date(giftCard.expiry_date) : null;
                    if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate < new Date()) {
                        rollback(new Error('This gift card has expired.'));
                        return;
                    }

                    connection.query(
                        `
                            SELECT user_voucher_id
                                , status
                                , remaining_value
                            FROM user_vouchers
                            WHERE user_id = ?
                                AND source_type = 'gift_card'
                                AND source_reference = ?
                            LIMIT 1
                        `,
                        [userId, code],
                        (existingError, existingRows = []) => {
                            if (existingError) {
                                rollback(existingError);
                                return;
                            }

                            if (existingRows[0]) {
                                connection.commit((commitError) => {
                                    connection.release();
                                    callback(commitError, {
                                        claimed: false,
                                        alreadyClaimed: true,
                                        userVoucherId: existingRows[0].user_voucher_id,
                                        code,
                                        status: existingRows[0].status,
                                        remainingValue: Number(existingRows[0].remaining_value || 0)
                                    });
                                });
                                return;
                            }

                            if (String(giftCard.status || '').toLowerCase() !== 'active' || Number(giftCard.balance || 0) <= 0) {
                                rollback(new Error('This gift card has already been claimed or used.'));
                                return;
                            }

                            const amount = Math.round(Number(giftCard.balance || giftCard.amount || 0) * 100) / 100;
                            connection.query(
                                `
                                    INSERT INTO user_vouchers
                                        (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, discount_type, discount_percent,
                                            status, booking_only, first_booking_only, voucher_definition_id, merchant_id, linked_item_type, linked_item_id,
                                            minimum_spend, code, expires_at)
                                    VALUES (?, 'gift_card', ?, ?, ?, ?, ?, 'fixed', 0, 'active', 0, 0, NULL, NULL, NULL, NULL, 0, ?, ?)
                                `,
                                [
                                    userId,
                                    code,
                                    `Vaniday Gift Card $${amount.toFixed(2)}`,
                                    giftCard.message || 'Gift card balance for Vaniday purchases.',
                                    amount,
                                    amount,
                                    code,
                                    giftCard.expiry_date || null
                                ],
                                (insertError, result) => {
                                    if (insertError) {
                                        rollback(insertError);
                                        return;
                                    }

                                    connection.query(
                                        `
                                            UPDATE gift_card_vouchers
                                            SET status = 'claimed',
                                                balance = 0.00
                                            WHERE gift_card_voucher_id = ?
                                        `,
                                        [giftCard.gift_card_voucher_id],
                                        (updateError) => {
                                            if (updateError) {
                                                rollback(updateError);
                                                return;
                                            }

                                            connection.commit((commitError) => {
                                                connection.release();
                                                callback(commitError, {
                                                    claimed: true,
                                                    userVoucherId: result.insertId,
                                                    code,
                                                    amount
                                                });
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    });
}

module.exports = {
    claimForUser,
    generateCode,
    create
};
