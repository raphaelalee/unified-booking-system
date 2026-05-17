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

    const sql = `
        CREATE TABLE IF NOT EXISTS user_vouchers (
            user_voucher_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            source_type VARCHAR(30) NOT NULL DEFAULT 'reward_shop',
            source_reference VARCHAR(120) DEFAULT NULL,
            title VARCHAR(120) NOT NULL,
            detail TEXT NULL,
            voucher_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            remaining_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            booking_only TINYINT(1) NOT NULL DEFAULT 1,
            first_booking_only TINYINT(1) NOT NULL DEFAULT 0,
            code VARCHAR(40) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            redeemed_at DATETIME DEFAULT NULL,
            PRIMARY KEY (user_voucher_id),
            UNIQUE KEY uq_user_vouchers_code (code),
            KEY idx_user_vouchers_user_status (user_id, status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (error) {
            flushQueue(error);
            return;
        }

        schemaReady = true;
        flushQueue(null);
    });
}

function mapRow(row = {}) {
    return {
        id: row.user_voucher_id,
        userId: row.user_id,
        sourceType: row.source_type || 'reward_shop',
        sourceReference: row.source_reference || '',
        title: row.title || '',
        detail: row.detail || '',
        voucherValue: Number(row.voucher_value || 0),
        remainingValue: Number(row.remaining_value || 0),
        status: row.status || 'active',
        bookingOnly: Boolean(row.booking_only),
        firstBookingOnly: Boolean(row.first_booking_only),
        code: row.code || '',
        createdAt: row.created_at,
        redeemedAt: row.redeemed_at
    };
}

function generateCode(prefix = 'VANI') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function issueVoucher(data, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const code = data.code || generateCode(data.sourceType === 'referral' ? 'REF' : 'RWD');
        db.query(
            `
                INSERT INTO user_vouchers
                    (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, status, booking_only, first_booking_only, code)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
            `,
            [
                data.userId,
                data.sourceType || 'reward_shop',
                data.sourceReference || null,
                data.title,
                data.detail || null,
                Number(data.voucherValue || 0),
                Number(data.remainingValue || data.voucherValue || 0),
                data.bookingOnly === false ? 0 : 1,
                data.firstBookingOnly ? 1 : 0,
                code
            ],
            callback
        );
    });
}

function issueReferralVoucher(userId, referralCode, callback) {
    issueVoucher({
        userId,
        sourceType: 'referral',
        sourceReference: referralCode,
        title: '$10 Off First Booking',
        detail: 'Referral reward voucher for your first paid booking.',
        voucherValue: 10,
        bookingOnly: true,
        firstBookingOnly: true
    }, callback);
}

function redeemRewardShopVoucher(userId, offer, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
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

                connection.query(
                    'SELECT glints_balance FROM users WHERE user_id = ? LIMIT 1',
                    [userId],
                    (lookupError, rows = []) => {
                        if (lookupError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(lookupError);
                            });
                        }

                        const balance = Number(rows[0]?.glints_balance || 0);
                        const cost = Number(offer.glintsCost || 0);

                        if (balance < cost) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('Not enough VaniGlints to redeem this voucher.'));
                            });
                        }

                        connection.query(
                            'UPDATE users SET glints_balance = COALESCE(glints_balance, 0) - ? WHERE user_id = ?',
                            [cost, userId],
                            (debitError) => {
                                if (debitError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(debitError);
                                    });
                                }

                                const code = generateCode('RWD');
                                connection.query(
                                    `
                                        INSERT INTO user_vouchers
                                            (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, status, booking_only, first_booking_only, code)
                                        VALUES (?, 'reward_shop', ?, ?, ?, ?, ?, 'active', 1, 0, ?)
                                    `,
                                    [
                                        userId,
                                        String(offer.voucherId || offer.id || ''),
                                        offer.title,
                                        offer.detail || null,
                                        Number(offer.voucherValue || 0),
                                        Number(offer.voucherValue || 0),
                                        code
                                    ],
                                    (insertError, result) => {
                                        if (insertError) {
                                            return connection.rollback(() => {
                                                connection.release();
                                                callback(insertError);
                                            });
                                        }

                                        return connection.commit((commitError) => {
                                            connection.release();

                                            if (commitError) {
                                                callback(commitError);
                                                return;
                                            }

                                            callback(null, {
                                                id: result.insertId,
                                                code,
                                                title: offer.title,
                                                voucherValue: Number(offer.voucherValue || 0),
                                                glintsCost: cost
                                            });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    });
}

function getByUserId(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `
                SELECT *
                FROM user_vouchers
                WHERE user_id = ?
                ORDER BY
                    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                    created_at DESC,
                    user_voucher_id DESC
            `,
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

function getActiveForUser(userId, callback) {
    getByUserId(userId, (error, vouchers = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, vouchers.filter((voucher) => voucher.status === 'active' && voucher.remainingValue > 0));
    });
}

function findByIdForUser(userVoucherId, userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            'SELECT * FROM user_vouchers WHERE user_voucher_id = ? AND user_id = ? LIMIT 1',
            [userVoucherId, userId],
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

function countPaidBookingsBefore(userId, bookingId, callback) {
    db.query(
        `
            SELECT COUNT(*) AS total
            FROM bookings
            WHERE user_id = ?
                AND transaction_id IS NOT NULL
                AND booking_id <> ?
        `,
        [userId, Number(bookingId || 0)],
        (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, Number(rows[0]?.total || 0));
        }
    );
}

function validateForBooking(voucher, payment, callback) {
    if (!voucher) {
        callback(new Error('Voucher could not be found.'));
        return;
    }

    if (voucher.status !== 'active' || voucher.remainingValue <= 0) {
        callback(new Error('This voucher is no longer active.'));
        return;
    }

    if (!payment.bookingId || payment.kind !== 'booking') {
        callback(new Error('This voucher can only be used on service bookings.'));
        return;
    }

    if (voucher.bookingOnly !== true) {
        callback(null, voucher);
        return;
    }

    if (!voucher.firstBookingOnly) {
        callback(null, voucher);
        return;
    }

    countPaidBookingsBefore(voucher.userId, payment.bookingId, (error, priorPaidBookings) => {
        if (error) {
            callback(error);
            return;
        }

        if (priorPaidBookings > 0) {
            callback(new Error('This referral voucher is only valid on your first paid booking.'));
            return;
        }

        callback(null, voucher);
    });
}

function markRedeemed(userVoucherId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `
                UPDATE user_vouchers
                SET remaining_value = 0.00,
                    status = 'used',
                    redeemed_at = CURRENT_TIMESTAMP
                WHERE user_voucher_id = ?
                    AND status = 'active'
            `,
            [userVoucherId],
            callback
        );
    });
}

module.exports = {
    issueVoucher,
    issueReferralVoucher,
    redeemRewardShopVoucher,
    getByUserId,
    getActiveForUser,
    findByIdForUser,
    validateForBooking,
    markRedeemed
};
