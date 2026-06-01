const crypto = require('crypto');
const db = require('../db');
const {
    buildBirthdayVoucherData,
    getBirthdayPromotionContext
} = require('../utils/birthdayPromotions');

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
        CREATE TABLE IF NOT EXISTS user_vouchers (
            user_voucher_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            source_type VARCHAR(30) NOT NULL DEFAULT 'reward_shop',
            source_reference VARCHAR(120) DEFAULT NULL,
            title VARCHAR(120) NOT NULL,
            detail TEXT NULL,
            voucher_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            remaining_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            discount_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
            discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            booking_only TINYINT(1) NOT NULL DEFAULT 1,
            first_booking_only TINYINT(1) NOT NULL DEFAULT 0,
            voucher_definition_id INT DEFAULT NULL,
            merchant_id INT DEFAULT NULL,
            minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            code VARCHAR(40) NOT NULL,
            expires_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            redeemed_at DATETIME DEFAULT NULL,
            used_booking_id INT DEFAULT NULL,
            used_transaction_id INT DEFAULT NULL,
            used_at DATETIME DEFAULT NULL,
            PRIMARY KEY (user_voucher_id),
            UNIQUE KEY uq_user_vouchers_code (code),
            KEY idx_user_vouchers_user_status (user_id, status, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(createSql, (createError) => {
        if (createError) {
            flushQueue(createError);
            return;
        }

        db.query('SHOW COLUMNS FROM user_vouchers', (columnError, columns = []) => {
            if (columnError) {
                flushQueue(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('discount_type')) {
                alters.push("ADD COLUMN discount_type VARCHAR(20) NOT NULL DEFAULT 'fixed' AFTER remaining_value");
            }

            if (!fields.has('discount_percent')) {
                alters.push("ADD COLUMN discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER discount_type");
            }

            if (!fields.has('expires_at')) {
                alters.push('ADD COLUMN expires_at DATETIME DEFAULT NULL AFTER code');
            }

            if (!fields.has('voucher_definition_id')) {
                alters.push('ADD COLUMN voucher_definition_id INT DEFAULT NULL AFTER first_booking_only');
            }

            if (!fields.has('merchant_id')) {
                alters.push('ADD COLUMN merchant_id INT DEFAULT NULL AFTER voucher_definition_id');
            }

            if (!fields.has('minimum_spend')) {
                alters.push('ADD COLUMN minimum_spend DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER merchant_id');
            }

            if (!fields.has('used_booking_id')) {
                alters.push('ADD COLUMN used_booking_id INT DEFAULT NULL AFTER redeemed_at');
            }

            if (!fields.has('used_transaction_id')) {
                alters.push('ADD COLUMN used_transaction_id INT DEFAULT NULL AFTER used_booking_id');
            }

            if (!fields.has('used_at')) {
                alters.push('ADD COLUMN used_at DATETIME DEFAULT NULL AFTER used_transaction_id');
            }

            if (alters.length === 0) {
                schemaReady = true;
                flushQueue(null);
                return;
            }

            db.query(`ALTER TABLE user_vouchers ${alters.join(', ')}`, (alterError) => {
                if (!alterError) {
                    schemaReady = true;
                }

                flushQueue(alterError);
            });
        });
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
        discountType: row.discount_type || 'fixed',
        discountPercent: Number(row.discount_percent || 0),
        status: row.status || 'active',
        bookingOnly: Boolean(row.booking_only),
        firstBookingOnly: Boolean(row.first_booking_only),
        voucherDefinitionId: row.voucher_definition_id ? Number(row.voucher_definition_id) : null,
        merchantId: row.merchant_id ? Number(row.merchant_id) : null,
        merchantName: row.merchant_name || '',
        linkedItemType: row.linked_item_type || '',
        linkedItemId: row.linked_item_id ? Number(row.linked_item_id) : null,
        linkedItemName: row.linked_item_name || '',
        minimumSpend: Number(row.minimum_spend || 0),
        code: row.code || '',
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        redeemedAt: row.redeemed_at,
        usedBookingId: row.used_booking_id ? Number(row.used_booking_id) : null,
        usedTransactionId: row.used_transaction_id ? Number(row.used_transaction_id) : null,
        usedAt: row.used_at || null
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
                    (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, discount_type, discount_percent, status,
                        booking_only, first_booking_only, voucher_definition_id, merchant_id, minimum_spend, code, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                data.userId,
                data.sourceType || 'reward_shop',
                data.sourceReference || null,
                data.title,
                data.detail || null,
                Number(data.voucherValue || 0),
                Number(data.remainingValue || data.voucherValue || 0),
                data.discountType || 'fixed',
                Number(data.discountPercent || 0),
                data.bookingOnly === false ? 0 : 1,
                data.firstBookingOnly ? 1 : 0,
                data.voucherDefinitionId || null,
                data.merchantId || null,
                Number(data.minimumSpend || 0),
                code,
                data.expiresAt || null
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

function expireExpiredVouchers(userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const params = [];
        let whereClause = "status = 'active' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP";

        if (userId) {
            whereClause += ' AND user_id = ?';
            params.push(userId);
        }

        db.query(
            `UPDATE user_vouchers SET status = 'expired' WHERE ${whereClause}`,
            params,
            callback
        );
    });
}

function findExistingBirthdayVoucher(userId, sourceReference, callback) {
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
                    AND source_type = 'birthday'
                    AND source_reference = ?
                ORDER BY user_voucher_id DESC
                LIMIT 1
            `,
            [userId, sourceReference],
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

function ensureBirthdayVoucherForUser(user, callback) {
    const birthdayVoucher = buildBirthdayVoucherData(user?.user_id || user?.id, user?.birthday);

    if (!birthdayVoucher) {
        callback(null, {
            issued: false,
            voucher: null,
            context: getBirthdayPromotionContext(user?.birthday)
        });
        return;
    }

    return findExistingBirthdayVoucher(birthdayVoucher.userId, birthdayVoucher.sourceReference, (lookupError, existingVoucher) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (existingVoucher) {
            callback(null, {
                issued: false,
                voucher: existingVoucher,
                context: getBirthdayPromotionContext(user?.birthday)
            });
            return;
        }

        // Birthday vouchers are issued lazily when the customer opens profile, wallet, or payment.
        return issueVoucher(birthdayVoucher, (issueError, result) => {
            if (issueError) {
                callback(issueError);
                return;
            }

            findByIdForUser(result.insertId, birthdayVoucher.userId, (reloadError, issuedVoucher) => {
                if (reloadError) {
                    callback(reloadError);
                    return;
                }

                callback(null, {
                    issued: true,
                    voucher: issuedVoucher,
                    context: getBirthdayPromotionContext(user?.birthday)
                });
            });
        });
    });
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
                        const cost = Number(offer.pointsRequired || offer.glintsCost || 0);
                        const usageLimitTotal = offer.usageLimitTotal === null || offer.usageLimitTotal === undefined
                            ? null
                            : Number(offer.usageLimitTotal);
                        const usageLimitPerUser = offer.usageLimitPerUser === null || offer.usageLimitPerUser === undefined
                            ? null
                            : Number(offer.usageLimitPerUser);
                        const startDate = offer.startDate ? new Date(offer.startDate) : null;
                        const expiryDate = offer.expiryDate ? new Date(offer.expiryDate) : null;
                        const now = new Date();

                        if (balance < cost) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('Not enough VaniGlints to redeem this voucher.'));
                            });
                        }

                        if (String(offer.status || 'active') !== 'active') {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('This voucher is no longer active.'));
                            });
                        }

                        if (startDate && !Number.isNaN(startDate.getTime()) && startDate > now) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('This voucher is not redeemable yet.'));
                            });
                        }

                        if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate < now) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('This voucher has expired.'));
                            });
                        }

                        if (usageLimitTotal !== null && Number(offer.redemptionCount || 0) >= usageLimitTotal) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(new Error('This voucher has reached its redemption limit.'));
                            });
                        }

                        const continueWithInsert = () => {
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
                                    const discountType = offer.discountType === 'percentage' ? 'percentage' : 'fixed';
                                    const discountValue = Number(offer.discountValue || offer.voucherValue || 0);
                                    const voucherValue = discountType === 'fixed' ? discountValue : 0;
                                    const remainingValue = discountType === 'fixed' ? discountValue : 0;
                                    const bookingOnly = offer.linkedItemType === 'product' ? 0 : 1;

                                    connection.query(
                                        `
                                            INSERT INTO user_vouchers
                                                (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, discount_type, discount_percent,
                                                    status, booking_only, first_booking_only, voucher_definition_id, merchant_id, minimum_spend, code, expires_at)
                                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?)
                                        `,
                                        [
                                            userId,
                                            offer.voucherSource === 'merchant' ? 'reward_shop_merchant' : 'reward_shop',
                                            String(offer.voucherId || offer.id || ''),
                                            offer.title,
                                            offer.detail || null,
                                            voucherValue,
                                            remainingValue,
                                            discountType,
                                            discountType === 'percentage' ? discountValue : 0,
                                            bookingOnly,
                                            Number(offer.voucherId || offer.id || 0) || null,
                                            offer.merchantId || null,
                                            Number(offer.minimumSpend || 0),
                                            code,
                                            offer.expiryDate || null
                                        ],
                                        (insertError, result) => {
                                            if (insertError) {
                                                return connection.rollback(() => {
                                                    connection.release();
                                                    callback(insertError);
                                                });
                                            }

                                            const incrementSql = Number(offer.voucherId || offer.id || 0) > 0
                                                ? 'UPDATE reward_shop_vouchers SET redemption_count = COALESCE(redemption_count, 0) + 1 WHERE voucher_id = ?'
                                                : null;

                                            const finalizeCommit = () => {
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
                                                        voucherValue,
                                                        discountType,
                                                        discountPercent: discountType === 'percentage' ? discountValue : 0,
                                                        discountValue,
                                                        glintsCost: cost,
                                                        bookingOnly: bookingOnly === 1,
                                                        merchantId: offer.merchantId || null,
                                                        merchantName: offer.merchantName || '',
                                                        expiresAt: offer.expiryDate || null
                                                    });
                                                });
                                            };

                                            if (!incrementSql) {
                                                finalizeCommit();
                                                return;
                                            }

                                            connection.query(
                                                incrementSql,
                                                [offer.voucherId || offer.id],
                                                (incrementError) => {
                                                    if (incrementError) {
                                                        return connection.rollback(() => {
                                                            connection.release();
                                                            callback(incrementError);
                                                        });
                                                    }

                                                    finalizeCommit();
                                                }
                                            );
                                        }
                                    );
                                }
                            );
                        };

                        if (usageLimitPerUser === null || !Number(offer.voucherId || offer.id || 0)) {
                            continueWithInsert();
                            return;
                        }

                        connection.query(
                            `
                                SELECT COUNT(*) AS total
                                FROM user_vouchers
                                WHERE user_id = ?
                                    AND voucher_definition_id = ?
                            `,
                            [userId, Number(offer.voucherId || offer.id || 0)],
                            (countError, countRows = []) => {
                                if (countError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(countError);
                                    });
                                }

                                const redemptionTotal = Number(countRows[0]?.total || 0);

                                if (redemptionTotal >= usageLimitPerUser) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(new Error('You have already reached the redemption limit for this voucher.'));
                                    });
                                }

                                continueWithInsert();
                            }
                        );
                    }
                );
            });
        });
    });
}

function getByUserId(userId, callback) {
    expireExpiredVouchers(userId, (expireError) => {
        if (expireError) {
            callback(expireError);
            return;
        }

        ensureSchema((schemaError) => {
            if (schemaError) {
                callback(schemaError);
                return;
            }

            db.query(
                `
                    SELECT
                        user_vouchers.*,
                        salons.salon_name AS merchant_name,
                        reward_shop_vouchers.linked_item_type,
                        reward_shop_vouchers.linked_item_id,
                        CASE
                            WHEN reward_shop_vouchers.linked_item_type = 'service' THEN services.service_name
                            WHEN reward_shop_vouchers.linked_item_type = 'product' THEN products.name
                            ELSE ''
                        END AS linked_item_name
                    FROM user_vouchers
                    LEFT JOIN salons ON salons.salon_id = user_vouchers.merchant_id
                    LEFT JOIN reward_shop_vouchers
                        ON reward_shop_vouchers.voucher_id = user_vouchers.voucher_definition_id
                    LEFT JOIN services
                        ON services.service_id = reward_shop_vouchers.linked_item_id
                        AND reward_shop_vouchers.linked_item_type = 'service'
                    LEFT JOIN products
                        ON products.product_id = reward_shop_vouchers.linked_item_id
                        AND reward_shop_vouchers.linked_item_type = 'product'
                    WHERE user_id = ?
                    ORDER BY
                        CASE WHEN user_vouchers.status = 'active' THEN 0 ELSE 1 END,
                        user_vouchers.created_at DESC,
                        user_vouchers.user_voucher_id DESC
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
    });
}

function getActiveForUser(userId, callback) {
    getByUserId(userId, (error, vouchers = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, vouchers.filter((voucher) => {
            if (voucher.status !== 'active') {
                return false;
            }

            if (voucher.discountType === 'percentage') {
                return Number(voucher.discountPercent || 0) > 0;
            }

            return Number(voucher.remainingValue || 0) > 0;
        }));
    });
}

function findByIdForUser(userVoucherId, userId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
                `
                SELECT
                    user_vouchers.*,
                    salons.salon_name AS merchant_name,
                    reward_shop_vouchers.linked_item_type,
                    reward_shop_vouchers.linked_item_id,
                    CASE
                        WHEN reward_shop_vouchers.linked_item_type = 'service' THEN services.service_name
                        WHEN reward_shop_vouchers.linked_item_type = 'product' THEN products.name
                        ELSE ''
                    END AS linked_item_name
                FROM user_vouchers
                LEFT JOIN salons ON salons.salon_id = user_vouchers.merchant_id
                LEFT JOIN reward_shop_vouchers
                    ON reward_shop_vouchers.voucher_id = user_vouchers.voucher_definition_id
                LEFT JOIN services
                    ON services.service_id = reward_shop_vouchers.linked_item_id
                    AND reward_shop_vouchers.linked_item_type = 'service'
                LEFT JOIN products
                    ON products.product_id = reward_shop_vouchers.linked_item_id
                    AND reward_shop_vouchers.linked_item_type = 'product'
                WHERE user_vouchers.user_voucher_id = ?
                    AND user_vouchers.user_id = ?
                LIMIT 1
            `,
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

    const isPercentageVoucher = voucher.discountType === 'percentage';
    const hasValue = isPercentageVoucher
        ? Number(voucher.discountPercent || 0) > 0
        : Number(voucher.remainingValue || 0) > 0;

    if (voucher.status !== 'active' || !hasValue) {
        callback(new Error('This voucher is no longer active.'));
        return;
    }

    if (voucher.expiresAt) {
        const expiry = new Date(voucher.expiresAt);

        if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
            callback(new Error('This voucher has expired.'));
            return;
        }
    }

    if (!payment.bookingId || payment.kind !== 'booking') {
        callback(new Error('This voucher can only be used on service bookings.'));
        return;
    }

    if (Number(voucher.minimumSpend || 0) > 0 && Number(payment.amount || 0) < Number(voucher.minimumSpend || 0)) {
        callback(new Error(`This voucher requires a minimum spend of $${Number(voucher.minimumSpend || 0).toFixed(2)}.`));
        return;
    }

    if (voucher.merchantId && String(voucher.merchantId) !== String(payment.merchantId || '')) {
        callback(new Error('This voucher is only valid for another merchant.'));
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

function getEligibleOrderProductTotal(voucher, payment) {
    const items = Array.isArray(payment?.items) ? payment.items : [];

    return items.reduce((sum, item) => {
        if (String(item.type || '') !== 'Product') {
            return sum;
        }

        if (voucher.merchantId && String(voucher.merchantId) !== String(item.merchantId || item.salonId || '')) {
            return sum;
        }

        if (voucher.linkedItemType === 'product' && voucher.linkedItemId && String(voucher.linkedItemId) !== String(item.serviceId || item.productId || '')) {
            return sum;
        }

        return sum + Number(item.lineTotal || 0);
    }, 0);
}

function validateForOrder(voucher, payment, callback) {
    if (!voucher) {
        callback(new Error('Voucher could not be found.'));
        return;
    }

    const isPercentageVoucher = voucher.discountType === 'percentage';
    const hasValue = isPercentageVoucher
        ? Number(voucher.discountPercent || 0) > 0
        : Number(voucher.remainingValue || 0) > 0;

    if (voucher.status !== 'active' || !hasValue) {
        callback(new Error('This voucher is no longer active.'));
        return;
    }

    if (voucher.expiresAt) {
        const expiry = new Date(voucher.expiresAt);

        if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
            callback(new Error('This voucher has expired.'));
            return;
        }
    }

    if (payment.kind !== 'order') {
        callback(new Error('This voucher can only be used on product checkout.'));
        return;
    }

    if (voucher.bookingOnly === true) {
        callback(new Error('This voucher can only be used on service bookings.'));
        return;
    }

    if (voucher.linkedItemType && voucher.linkedItemType !== 'product') {
        callback(new Error('This voucher is not valid for product checkout.'));
        return;
    }

    const eligibleSubtotal = getEligibleOrderProductTotal(voucher, payment);

    if (eligibleSubtotal <= 0) {
        callback(new Error('This voucher does not match any eligible products in your cart.'));
        return;
    }

    if (Number(voucher.minimumSpend || 0) > 0 && eligibleSubtotal < Number(voucher.minimumSpend || 0)) {
        callback(new Error(`This voucher requires a minimum spend of $${Number(voucher.minimumSpend || 0).toFixed(2)} on eligible products.`));
        return;
    }

    callback(null, {
        ...voucher,
        eligibleSubtotal
    });
}

function markRedeemed(userVoucherId, usageContext, callback) {
    let context = usageContext;
    let done = callback;

    if (typeof usageContext === 'function') {
        done = usageContext;
        context = {};
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
            return;
        }

        db.query(
            `
                UPDATE user_vouchers
                SET remaining_value = 0.00,
                    status = 'used',
                    redeemed_at = CURRENT_TIMESTAMP,
                    used_at = CURRENT_TIMESTAMP,
                    used_booking_id = COALESCE(?, used_booking_id),
                    used_transaction_id = COALESCE(?, used_transaction_id)
                WHERE user_voucher_id = ?
                    AND status = 'active'
            `,
            [
                context?.bookingId || null,
                context?.transactionId || null,
                userVoucherId
            ],
            done
        );
    });
}

module.exports = {
    ensureBirthdayVoucherForUser,
    expireExpiredVouchers,
    issueVoucher,
    issueReferralVoucher,
    redeemRewardShopVoucher,
    getByUserId,
    getActiveForUser,
    findByIdForUser,
    validateForBooking,
    validateForOrder,
    markRedeemed
};
