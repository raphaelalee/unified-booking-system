const db = require('../db');
const User = require('./User');
const { isBirthdayMonthForDate } = require('../utils/birthdayPromotions');

const DEFAULT_RULES = {
    pointsPerDollar: 10,
    cashbackPercent: 5,
    minPointsToRedeem: 100,
    pointsToCashRate: 0.01,
    maxDiscountPercent: 20,
    pointsExpiryDays: 365,
    isEnabled: true
};

const DEFAULT_MERCHANT_RULES = {
    isEnabled: true,
    maxDiscountPercent: null,
    promotionLabel: '',
    promotionMultiplier: 1
};

const ACTIVITY_TYPES = {
    EARNED: 'EARNED',
    REDEEMED: 'REDEEMED',
    POINTS_USED: 'POINTS_USED',
    CASHBACK_USED: 'CASHBACK_USED'
};

const LEGACY_TYPE_MAP = {
    earn: ACTIVITY_TYPES.EARNED,
    redeem_points: ACTIVITY_TYPES.REDEEMED,
    redeem: ACTIVITY_TYPES.CASHBACK_USED
};

function runSeries(tasks, callback) {
    let index = 0;

    function next(error) {
        if (error || index >= tasks.length) {
            callback(error);
            return;
        }

        const task = tasks[index];
        index += 1;
        task(next);
    }

    next();
}

function ensureColumns(tableName, definitions, callback) {
    db.query(`SHOW COLUMNS FROM ${tableName}`, (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = Object.entries(definitions)
            .filter(([field]) => !fields.has(field))
            .map(([, definition]) => `ADD COLUMN ${definition}`);

        if (!alters.length) {
            callback(null);
            return;
        }

        db.query(`ALTER TABLE ${tableName} ${alters.join(', ')}`, callback);
    });
}

function ensureTables(callback) {
    const walletSql = `
        CREATE TABLE IF NOT EXISTS loyalty_wallets (
            user_id INT NOT NULL,
            points_balance INT NOT NULL DEFAULT 0,
            cashback_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
            lifetime_points INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id)
        )
    `;
    const transactionSql = `
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            loyalty_transaction_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            source_receipt_id VARCHAR(80) DEFAULT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            points_delta INT NOT NULL DEFAULT 0,
            cashback_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
            description VARCHAR(255) NOT NULL,
            expires_at DATETIME DEFAULT NULL,
            booking_reference VARCHAR(80) DEFAULT NULL,
            merchant_name VARCHAR(120) DEFAULT NULL,
            reward_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (loyalty_transaction_id),
            UNIQUE KEY uniq_loyalty_source_type (source_receipt_id, transaction_type),
            KEY idx_loyalty_user_created (user_id, created_at)
        )
    `;
    const rulesSql = `
        CREATE TABLE IF NOT EXISTS loyalty_rules (
            rule_id INT NOT NULL,
            points_per_dollar DECIMAL(10,2) NOT NULL DEFAULT 10,
            cashback_percent DECIMAL(5,2) NOT NULL DEFAULT 5,
            min_points_to_redeem INT NOT NULL DEFAULT 100,
            points_to_cash_rate DECIMAL(10,4) NOT NULL DEFAULT 0.01,
            max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 20,
            points_expiry_days INT NOT NULL DEFAULT 365,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (rule_id)
        )
    `;
    const merchantRulesSql = `
        CREATE TABLE IF NOT EXISTS merchant_loyalty_rules (
            merchant_id INT NOT NULL,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            max_discount_percent DECIMAL(5,2) DEFAULT NULL,
            promotion_label VARCHAR(120) DEFAULT NULL,
            promotion_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (merchant_id)
        )
    `;
    const merchantServicesSql = `
        CREATE TABLE IF NOT EXISTS merchant_loyalty_services (
            merchant_id INT NOT NULL,
            service_id INT NOT NULL,
            redemption_enabled TINYINT(1) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (merchant_id, service_id),
            KEY idx_merchant_loyalty_service (service_id)
        )
    `;
    const seedRulesSql = `
        INSERT INTO loyalty_rules
            (rule_id, points_per_dollar, cashback_percent, min_points_to_redeem, points_to_cash_rate, max_discount_percent, points_expiry_days, is_enabled)
        VALUES (1, 10, 5, 100, 0.01, 20, 365, 1)
        ON DUPLICATE KEY UPDATE rule_id = rule_id
    `;

    runSeries([
        (next) => db.query(walletSql, next),
        (next) => db.query(transactionSql, next),
        (next) => ensureColumns('loyalty_transactions', {
            expires_at: 'expires_at DATETIME DEFAULT NULL AFTER description',
            booking_reference: 'booking_reference VARCHAR(80) DEFAULT NULL AFTER expires_at',
            merchant_name: 'merchant_name VARCHAR(120) DEFAULT NULL AFTER booking_reference',
            reward_discount: 'reward_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER merchant_name'
        }, next),
        (next) => db.query(rulesSql, next),
        (next) => ensureColumns('loyalty_rules', {
            max_discount_percent: 'max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 20 AFTER points_to_cash_rate',
            points_expiry_days: 'points_expiry_days INT NOT NULL DEFAULT 365 AFTER max_discount_percent'
        }, next),
        (next) => db.query(merchantRulesSql, next),
        (next) => ensureColumns('merchant_loyalty_rules', {
            promotion_label: 'promotion_label VARCHAR(120) DEFAULT NULL AFTER max_discount_percent',
            promotion_multiplier: 'promotion_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1 AFTER promotion_label'
        }, next),
        (next) => db.query(merchantServicesSql, next),
        (next) => db.query(seedRulesSql, next)
    ], callback);
}

function mapRules(row = {}) {
    return {
        pointsPerDollar: Number(row.points_per_dollar ?? DEFAULT_RULES.pointsPerDollar),
        cashbackPercent: Number(row.cashback_percent ?? DEFAULT_RULES.cashbackPercent),
        minPointsToRedeem: Number(row.min_points_to_redeem ?? DEFAULT_RULES.minPointsToRedeem),
        pointsToCashRate: Number(row.points_to_cash_rate ?? DEFAULT_RULES.pointsToCashRate),
        maxDiscountPercent: Number(row.max_discount_percent ?? DEFAULT_RULES.maxDiscountPercent),
        pointsExpiryDays: Number(row.points_expiry_days ?? DEFAULT_RULES.pointsExpiryDays),
        isEnabled: row.is_enabled === undefined ? DEFAULT_RULES.isEnabled : Boolean(Number(row.is_enabled))
    };
}

function mapMerchantRules(row = {}) {
    return {
        merchantId: row.merchant_id ? Number(row.merchant_id) : null,
        isEnabled: row.is_enabled === undefined ? DEFAULT_MERCHANT_RULES.isEnabled : Boolean(Number(row.is_enabled)),
        maxDiscountPercent: row.max_discount_percent === null || row.max_discount_percent === undefined
            ? DEFAULT_MERCHANT_RULES.maxDiscountPercent
            : Number(row.max_discount_percent),
        promotionLabel: row.promotion_label || DEFAULT_MERCHANT_RULES.promotionLabel,
        promotionMultiplier: Number(row.promotion_multiplier || DEFAULT_MERCHANT_RULES.promotionMultiplier)
    };
}

function mapWallet(row = {}) {
    return {
        userId: row.user_id,
        pointsBalance: Number(row.points_balance || 0),
        cashbackBalance: Number(row.cashback_balance || 0),
        lifetimePoints: Number(row.lifetime_points || 0)
    };
}

function mapTransaction(row = {}) {
    const rawType = String(row.transaction_type || '').trim();

    return {
        id: row.loyalty_transaction_id,
        activityId: row.loyalty_transaction_id,
        sourceReceiptId: row.source_receipt_id,
        receiptId: row.source_receipt_id,
        type: LEGACY_TYPE_MAP[rawType] || rawType.toUpperCase(),
        activityType: LEGACY_TYPE_MAP[rawType] || rawType.toUpperCase(),
        pointsDelta: Number(row.points_delta || 0),
        pointsChange: Number(row.points_delta || 0),
        cashbackDelta: Number(row.cashback_delta || 0),
        cashbackChange: Number(row.cashback_delta || 0),
        description: row.description,
        expiresAt: row.expires_at || null,
        bookingReference: row.booking_reference || row.source_receipt_id || '',
        merchantName: row.merchant_name || '',
        rewardDiscount: Number(row.reward_discount || 0),
        createdAt: row.created_at
    };
}

function getRules(callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SELECT * FROM loyalty_rules WHERE rule_id = 1 LIMIT 1', (error, rows) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, mapRules(rows[0]));
        });
    });
}

function updateRules(rules, callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            UPDATE loyalty_rules
            SET points_per_dollar = ?,
                cashback_percent = ?,
                min_points_to_redeem = ?,
                points_to_cash_rate = ?,
                max_discount_percent = ?,
                points_expiry_days = ?,
                is_enabled = ?
            WHERE rule_id = 1
        `;

        db.query(sql, [
            rules.pointsPerDollar,
            rules.cashbackPercent,
            rules.minPointsToRedeem,
            rules.pointsToCashRate,
            rules.maxDiscountPercent,
            rules.pointsExpiryDays,
            rules.isEnabled ? 1 : 0
        ], callback);
    });
}

function ensureWallet(userId, callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const insertSql = `
            INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
            VALUES (?, 0, 0, 0)
            ON DUPLICATE KEY UPDATE user_id = user_id
        `;

        db.query(insertSql, [userId], (insertError) => {
            if (insertError) {
                callback(insertError);
                return;
            }

            db.query('SELECT * FROM loyalty_wallets WHERE user_id = ? LIMIT 1', [userId], (lookupError, rows) => {
                if (lookupError) {
                    callback(lookupError);
                    return;
                }

                callback(null, mapWallet(rows[0]));
            });
        });
    });
}

function getTransactions(userId, limit, callback) {
    const sql = `
        SELECT *
        FROM loyalty_transactions
        WHERE user_id = ?
        ORDER BY loyalty_transaction_id DESC
        LIMIT ?
    `;

    db.query(sql, [userId, Number(limit || 20)], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapTransaction));
    });
}

function getWalletView(userId, callback) {
    return ensureWallet(userId, (walletError, wallet) => {
        if (walletError) {
            callback(walletError);
            return;
        }

        return getRules((rulesError, rules) => {
            if (rulesError) {
                callback(rulesError);
                return;
            }

            return getTransactions(userId, 25, (historyError, transactions) => {
                if (historyError) {
                    callback(historyError);
                    return;
                }

                callback(null, { wallet, rules, transactions });
            });
        });
    });
}

function getPlatformSummary(callback) {
    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                COUNT(*) AS transaction_count,
                SUM(CASE WHEN transaction_type IN ('REDEEMED', 'POINTS_USED', 'redeem_points') THEN 1 ELSE 0 END) AS redemption_count,
                COALESCE(SUM(points_delta), 0) AS points_delta_total,
                COALESCE(SUM(cashback_delta), 0) AS cashback_delta_total
            FROM loyalty_transactions
        `;

        db.query(sql, (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                transactionCount: Number(rows[0]?.transaction_count || 0),
                redemptionCount: Number(rows[0]?.redemption_count || 0),
                pointsDeltaTotal: Number(rows[0]?.points_delta_total || 0),
                cashbackDeltaTotal: Number(rows[0]?.cashback_delta_total || 0)
            });
        });
    });
}

function getMerchantRewardAnalytics(merchantId, callback) {
    const salonId = Number(merchantId || 0);

    if (!salonId) {
        callback(null, {
            rewardBookingCount: 0,
            totalRedeemedValue: 0,
            loyaltyDrivenRevenue: 0,
            repeatRewardCustomers: 0
        });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const sql = `
            SELECT
                COUNT(DISTINCT bookings.booking_id) AS reward_booking_count,
                COALESCE(SUM(loyalty_transactions.reward_discount), 0) AS total_redeemed_value,
                COALESCE(SUM(transactions.total_amount), 0) AS loyalty_driven_revenue,
                COUNT(DISTINCT CASE WHEN customer_counts.booking_count > 1 THEN bookings.user_id END) AS repeat_reward_customers
            FROM loyalty_transactions
            INNER JOIN bookings
                ON loyalty_transactions.source_receipt_id = CONCAT('points-', bookings.booking_id)
            LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
            LEFT JOIN (
                SELECT user_id, merchant_id, COUNT(*) AS booking_count
                FROM bookings
                WHERE status NOT IN ('cancelled', 'rejected')
                GROUP BY user_id, merchant_id
            ) AS customer_counts
                ON customer_counts.user_id = bookings.user_id
                AND customer_counts.merchant_id = bookings.merchant_id
            WHERE bookings.merchant_id = ?
                AND loyalty_transactions.transaction_type = 'POINTS_USED'
        `;

        db.query(sql, [salonId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                rewardBookingCount: Number(rows[0]?.reward_booking_count || 0),
                totalRedeemedValue: Number(rows[0]?.total_redeemed_value || 0),
                loyaltyDrivenRevenue: Number(rows[0]?.loyalty_driven_revenue || 0),
                repeatRewardCustomers: Number(rows[0]?.repeat_reward_customers || 0)
            });
        });
    });
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePercent(value, fallback = 0) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

function getMerchantRules(merchantId, callback) {
    const salonId = Number(merchantId || 0);

    if (!salonId) {
        callback(new Error('Merchant is required.'));
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        db.query('SELECT * FROM merchant_loyalty_rules WHERE merchant_id = ? LIMIT 1', [salonId], (rulesError, rulesRows = []) => {
            if (rulesError) {
                callback(rulesError);
                return;
            }

            db.query(
                'SELECT service_id, redemption_enabled FROM merchant_loyalty_services WHERE merchant_id = ?',
                [salonId],
                (servicesError, serviceRows = []) => {
                    if (servicesError) {
                        callback(servicesError);
                        return;
                    }

                    const serviceRedemptions = {};
                    serviceRows.forEach((row) => {
                        serviceRedemptions[Number(row.service_id)] = Boolean(Number(row.redemption_enabled));
                    });

                    callback(null, {
                        ...mapMerchantRules(rulesRows[0]),
                        merchantId: salonId,
                        serviceRedemptions
                    });
                }
            );
        });
    });
}

function updateMerchantRules(merchantId, settings = {}, callback) {
    const salonId = Number(merchantId || 0);
    const serviceIds = Array.isArray(settings.serviceIds)
        ? settings.serviceIds.map((id) => Number(id)).filter(Boolean)
        : [];
    const enabledServiceIds = new Set(
        (Array.isArray(settings.enabledServiceIds) ? settings.enabledServiceIds : [])
            .map((id) => Number(id))
            .filter(Boolean)
    );
    const maxDiscountPercent = settings.maxDiscountPercent === null || settings.maxDiscountPercent === ''
        ? null
        : normalizePercent(settings.maxDiscountPercent, DEFAULT_RULES.maxDiscountPercent);

    if (!salonId) {
        callback(new Error('Merchant is required.'));
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
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

                const ruleSql = `
                    INSERT INTO merchant_loyalty_rules
                        (merchant_id, is_enabled, max_discount_percent, promotion_label, promotion_multiplier)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        is_enabled = VALUES(is_enabled),
                        max_discount_percent = VALUES(max_discount_percent),
                        promotion_label = VALUES(promotion_label),
                        promotion_multiplier = VALUES(promotion_multiplier)
                `;

                connection.query(ruleSql, [
                    salonId,
                    settings.isEnabled ? 1 : 0,
                    maxDiscountPercent,
                    String(settings.promotionLabel || '').trim().slice(0, 120) || null,
                    Math.max(0, Math.min(Number(settings.promotionMultiplier || 1), 1))
                ], (ruleError) => {
                    if (ruleError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(ruleError);
                        });
                    }

                    connection.query('DELETE FROM merchant_loyalty_services WHERE merchant_id = ?', [salonId], (deleteError) => {
                        if (deleteError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(deleteError);
                            });
                        }

                        if (!serviceIds.length) {
                            return connection.commit((commitError) => {
                                connection.release();
                                callback(commitError);
                            });
                        }

                        const rows = serviceIds.map((serviceId) => [
                            salonId,
                            serviceId,
                            enabledServiceIds.has(serviceId) ? 1 : 0
                        ]);

                        connection.query(
                            'INSERT INTO merchant_loyalty_services (merchant_id, service_id, redemption_enabled) VALUES ?',
                            [rows],
                            (serviceError) => {
                                if (serviceError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(serviceError);
                                    });
                                }

                                return connection.commit((commitError) => {
                                    connection.release();
                                    callback(commitError);
                                });
                            }
                        );
                    });
                });
            });
        });
    });
}

function getEffectiveRedemptionRules(options = {}, callback) {
    const merchantId = Number(options.merchantId || 0);
    const serviceId = Number(options.serviceId || 0);

    return getRules((rulesError, adminRules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!merchantId) {
            callback(null, {
                enabled: false,
                reason: 'Merchant rewards are unavailable.',
                adminRules,
                merchantRules: mapMerchantRules(),
                maxDiscountPercent: 0,
                minPointsToRedeem: adminRules.minPointsToRedeem,
                pointsToCashRate: adminRules.pointsToCashRate
            });
            return;
        }

        return getMerchantRules(merchantId, (merchantError, merchantRules) => {
            if (merchantError) {
                callback(merchantError);
                return;
            }

            const serviceSetting = serviceId ? merchantRules.serviceRedemptions[serviceId] : undefined;
            const serviceEnabled = serviceSetting === undefined ? true : Boolean(serviceSetting);
            const merchantMax = merchantRules.maxDiscountPercent === null || merchantRules.maxDiscountPercent === undefined
                ? adminRules.maxDiscountPercent
                : merchantRules.maxDiscountPercent;
            const maxDiscountPercent = Math.min(
                normalizePercent(adminRules.maxDiscountPercent, DEFAULT_RULES.maxDiscountPercent),
                normalizePercent(merchantMax, adminRules.maxDiscountPercent)
            );
            const enabled = Boolean(adminRules.isEnabled && merchantRules.isEnabled && serviceEnabled);
            let reason = '';

            if (!adminRules.isEnabled) {
                reason = 'Rewards are disabled platform-wide.';
            } else if (!merchantRules.isEnabled) {
                reason = 'This merchant has disabled rewards.';
            } else if (!serviceEnabled) {
                reason = 'This service does not allow reward redemption.';
            }

            callback(null, {
                enabled,
                reason,
                adminRules,
                merchantRules,
                serviceEnabled,
                maxDiscountPercent,
                minPointsToRedeem: adminRules.minPointsToRedeem,
                pointsToCashRate: Math.round(adminRules.pointsToCashRate * Math.max(0, Math.min(Number(merchantRules.promotionMultiplier || 1), 1)) * 10000) / 10000,
                pointsPerDollar: adminRules.pointsPerDollar,
                pointsExpiryDays: adminRules.pointsExpiryDays
            });
        });
    });
}

function calculatePointRedemption(options = {}, callback) {
    const requestedPoints = Math.floor(Number(options.requestedPoints || 0));
    const amount = roundMoney(options.amount || 0);

    if (requestedPoints <= 0 || amount <= 0) {
        callback(null, { points: 0, discount: 0, rules: null });
        return;
    }

    return getEffectiveRedemptionRules(options, (rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.enabled) {
            callback(new Error(rules.reason || 'Rewards cannot be redeemed for this booking.'));
            return;
        }

        if (requestedPoints < rules.minPointsToRedeem) {
            callback(new Error(`Minimum redemption is ${rules.minPointsToRedeem} points.`));
            return;
        }

        if (Number(rules.pointsToCashRate || 0) <= 0) {
            callback(new Error('This merchant has set points redemption value to zero.'));
            return;
        }

        return ensureWallet(options.userId, (walletError, wallet) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            const availablePoints = Math.max(0, Number(wallet.pointsBalance || 0));

            if (requestedPoints > availablePoints) {
                callback(new Error('Not enough points to redeem.'));
                return;
            }

            const rawDiscount = roundMoney(requestedPoints * rules.pointsToCashRate);
            const maxDiscount = roundMoney(amount * (rules.maxDiscountPercent / 100));
            const discount = Math.min(rawDiscount, maxDiscount, amount);
            const appliedPoints = Math.min(requestedPoints, Math.floor(discount / rules.pointsToCashRate));

            if (discount <= 0 || appliedPoints <= 0) {
                callback(null, { points: 0, discount: 0, rules, wallet });
                return;
            }

            callback(null, {
                points: appliedPoints,
                requestedPoints,
                discount,
                maxDiscount,
                rawDiscount,
                rules,
                wallet
            });
        });
    });
}

function redeemPointsForPayment(userId, points, discount, sourceReceiptId, options = {}, callback) {
    const done = typeof options === 'function' ? options : callback;
    const metadata = typeof options === 'function' ? {} : options || {};
    const requestedPoints = Math.floor(Number(points || 0));
    const redeemDiscount = roundMoney(discount || 0);

    if (!userId || requestedPoints <= 0 || redeemDiscount <= 0) {
        done(null, { redeemed: false, points: 0, discount: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            done(tableError);
            return;
        }

        db.getConnection((connectionError, connection) => {
            if (connectionError) {
                done(connectionError);
                return;
            }

            connection.beginTransaction((transactionError) => {
                if (transactionError) {
                    connection.release();
                    done(transactionError);
                    return;
                }

                const updateSql = `
                    UPDATE loyalty_wallets
                    SET points_balance = points_balance - ?
                    WHERE user_id = ?
                        AND points_balance >= ?
                `;

                connection.query(updateSql, [requestedPoints, userId, requestedPoints], (updateError, result) => {
                    if (updateError || result.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            done(updateError || new Error('Not enough points to redeem.'));
                        });
                    }

                    const insertSql = `
                        INSERT IGNORE INTO loyalty_transactions
                            (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description, booking_reference, merchant_name, reward_discount)
                        VALUES (?, ?, 'POINTS_USED', ?, 0, ?, ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        String(sourceReceiptId),
                        -requestedPoints,
                        `Redeemed ${requestedPoints} points for $${redeemDiscount.toFixed(2)} booking discount`,
                        metadata.bookingReference || String(sourceReceiptId).replace(/^points-/, ''),
                        metadata.merchantName || '',
                        redeemDiscount
                    ], (insertError, insertResult) => {
                        if (insertError || insertResult.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                done(insertError || null, { redeemed: false, duplicate: true, points: 0, discount: 0 });
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            done(commitError, {
                                redeemed: !commitError,
                                points: requestedPoints,
                                discount: redeemDiscount
                            });
                        });
                    });
                });
            });
        });
    });
}

function getReceiptBirthdayMultiplier(receipt, callback) {
    if (!receipt?.userId || String(receipt.type || '').toLowerCase() !== 'booking') {
        callback(null, {
            multiplier: 1,
            birthdayApplied: false
        });
        return;
    }

    User.findById(receipt.userId, (error, user) => {
        if (error) {
            callback(error);
            return;
        }

        // Birthday rewards follow the payment month because points are granted when the receipt is paid.
        const birthdayApplied = isBirthdayMonthForDate(user?.birthday, receipt.paidAt || new Date());
        callback(null, {
            multiplier: birthdayApplied ? 2 : 1,
            birthdayApplied
        });
    });
}

function awardForReceipt(receipt, callback) {
    const totalAmount = Number(receipt.totalAmount || 0);
    const paymentStatus = String(receipt.paymentStatus || '').toLowerCase();

    if (!receipt.userId || totalAmount <= 0 || paymentStatus !== 'paid') {
        callback(null, { awarded: false });
        return;
    }

    return getRules((rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.isEnabled) {
            callback(null, { awarded: false, disabled: true });
            return;
        }

        return getReceiptBirthdayMultiplier(receipt, (birthdayError, birthdayReward) => {
            if (birthdayError) {
                callback(birthdayError);
                return;
            }

            const basePoints = Math.floor(totalAmount * rules.pointsPerDollar);
            const multiplier = Number(birthdayReward?.multiplier || 1);
            const points = basePoints * multiplier;
            const birthdayApplied = Boolean(birthdayReward?.birthdayApplied);
            const bonusPoints = Math.max(0, points - basePoints);
            const description = birthdayApplied
                ? `Earned from receipt ${receipt.displayId || receipt.id} with birthday month 2X points`
                : `Earned from receipt ${receipt.displayId || receipt.id}`;
            const sourceReceiptId = String(receipt.id);

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
                        `SELECT loyalty_transaction_id
                         FROM loyalty_transactions
                         WHERE source_receipt_id = ?
                            AND transaction_type IN ('EARNED', 'earn')
                         LIMIT 1`,
                        [sourceReceiptId],
                        (duplicateError, duplicateRows = []) => {
                            if (duplicateError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(duplicateError);
                                });
                            }

                            if (duplicateRows.length) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(null, { awarded: false, duplicate: true });
                                });
                            }

                            const insertSql = `
                                INSERT IGNORE INTO loyalty_transactions
                                    (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description, expires_at, booking_reference, merchant_name)
                                VALUES (?, ?, 'EARNED', ?, 0, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY), ?, ?)
                            `;

                            connection.query(insertSql, [
                                receipt.userId,
                                sourceReceiptId,
                                points,
                                description,
                                Math.max(1, Number(rules.pointsExpiryDays || DEFAULT_RULES.pointsExpiryDays)),
                                receipt.displayId || receipt.id || sourceReceiptId,
                                receipt.merchantName || ''
                            ], (insertError, result) => {
                                if (insertError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(insertError);
                                    });
                                }

                                if (!result.affectedRows) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(null, { awarded: false, duplicate: true });
                                    });
                                }

                                const updateSql = `
                                    INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
                                    VALUES (?, ?, 0, ?)
                                    ON DUPLICATE KEY UPDATE
                                        points_balance = points_balance + VALUES(points_balance),
                                        lifetime_points = lifetime_points + VALUES(lifetime_points)
                                `;

                                connection.query(updateSql, [
                                    receipt.userId,
                                    points,
                                    points
                                ], (updateError) => {
                                    if (updateError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(updateError);
                                        });
                                    }

                                    return connection.commit((commitError) => {
                                        connection.release();
                                        callback(commitError, {
                                            awarded: !commitError,
                                            points,
                                            cashback: 0,
                                            basePoints,
                                            bonusPoints,
                                            multiplier,
                                            birthdayApplied
                                        });
                                    });
                                });
                            });
                        }
                    );
                });
            });
        });
    });
}

function loadReceiptForAward(userId, receiptId, callback) {
    const receiptKey = String(receiptId || '').trim();

    if (!userId || !receiptKey) {
        callback(null, null);
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        const historySql = `
            SELECT
                receipt_id AS id,
                user_id,
                purchase_type,
                total_amount,
                payment_status,
                created_at
            FROM purchase_history
            WHERE receipt_id = ?
                AND user_id = ?
            LIMIT 1
        `;

        db.query(historySql, [receiptKey, userId], (historyError, rows = []) => {
            if (historyError) {
                callback(historyError);
                return;
            }

            if (rows[0]) {
                callback(null, {
                    id: rows[0].id,
                    userId: rows[0].user_id,
                    type: rows[0].purchase_type === 'booking' ? 'booking' : 'order',
                    totalAmount: Number(rows[0].total_amount || 0),
                    paymentStatus: rows[0].payment_status || 'paid',
                    paidAt: rows[0].created_at
                });
                return;
            }

            const bookingId = receiptKey.replace(/^booking-/, '');

            if (!/^\d+$/.test(bookingId)) {
                callback(null, null);
                return;
            }

            const bookingSql = `
                SELECT
                    bookings.booking_id AS id,
                    bookings.user_id,
                    services.price AS total_amount,
                    COALESCE(transactions.payment_status, CASE WHEN bookings.transaction_id IS NOT NULL OR bookings.status = 'paid' THEN 'paid' ELSE bookings.status END) AS payment_status
                FROM bookings
                INNER JOIN services ON services.service_id = bookings.service_id
                LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
                WHERE bookings.booking_id = ?
                    AND bookings.user_id = ?
                LIMIT 1
            `;

            db.query(bookingSql, [bookingId, userId], (bookingError, bookingRows = []) => {
                if (bookingError) {
                    callback(bookingError);
                    return;
                }

                const booking = bookingRows[0];

                if (!booking) {
                    callback(null, null);
                    return;
                }

                callback(null, {
                    id: booking.id,
                    userId: booking.user_id,
                    type: 'booking',
                    totalAmount: Number(booking.total_amount || 0),
                    paymentStatus: booking.payment_status || 'pending'
                });
            });
        });
    });
}

function awardPointsForReceipt(userId, receiptId, callback) {
    loadReceiptForAward(userId, receiptId, (lookupError, receipt) => {
        if (lookupError) {
            callback(lookupError);
            return;
        }

        if (!receipt) {
            callback(null, { awarded: false, missing: true });
            return;
        }

        awardForReceipt(receipt, callback);
    });
}

function awardReviewBonus(userId, bookingId, options = {}, callback) {
    const basePoints = Number(options.basePoints || 0);
    const mediaPoints = Number(options.mediaPoints || 0);
    const detailPoints = Number(options.detailPoints || 0);
    const totalPoints = Math.max(0, Math.floor(basePoints + mediaPoints + detailPoints));

    if (!userId || !bookingId || totalPoints <= 0) {
        callback(null, { awarded: false, points: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
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

                const sourceReceiptId = `booking-review-${bookingId}`;
                const descriptionParts = [`Review reward for booking #${bookingId}`];

                if (basePoints > 0) descriptionParts.push(`+${Math.floor(basePoints)} rating`);
                if (mediaPoints > 0) descriptionParts.push(`+${Math.floor(mediaPoints)} media`);
                if (detailPoints > 0) descriptionParts.push(`+${Math.floor(detailPoints)} detail`);

                const insertSql = `
                    INSERT IGNORE INTO loyalty_transactions
                        (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                    VALUES (?, ?, 'review_bonus', ?, 0, ?)
                `;

                connection.query(insertSql, [
                    userId,
                    sourceReceiptId,
                    totalPoints,
                    descriptionParts.join(' ')
                ], (insertError, result) => {
                    if (insertError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(insertError);
                        });
                    }

                    if (!result.affectedRows) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { awarded: false, duplicate: true, points: 0 });
                        });
                    }

                    const updateSql = `
                        INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
                        VALUES (?, ?, 0, ?)
                        ON DUPLICATE KEY UPDATE
                            points_balance = points_balance + VALUES(points_balance),
                            lifetime_points = lifetime_points + VALUES(lifetime_points)
                    `;

                    connection.query(updateSql, [userId, totalPoints, totalPoints], (updateError) => {
                        if (updateError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(updateError);
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            callback(commitError, {
                                awarded: !commitError,
                                points: totalPoints,
                                breakdown: {
                                    basePoints: Math.floor(basePoints),
                                    mediaPoints: Math.floor(mediaPoints),
                                    detailPoints: Math.floor(detailPoints)
                                }
                            });
                        });
                    });
                });
            });
        });
    });
}

function redeemCashback(userId, amount, sourceReceiptId, callback) {
    const redeemAmount = roundMoney(amount);

    if (!userId || redeemAmount <= 0) {
        callback(null, { redeemed: false, amount: 0 });
        return;
    }

    ensureTables((tableError) => {
        if (tableError) {
            callback(tableError);
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

                const insertSql = `
                    INSERT IGNORE INTO loyalty_transactions
                        (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                    VALUES (?, ?, 'CASHBACK_USED', 0, ?, ?)
                `;

                connection.query(insertSql, [
                    userId,
                    String(sourceReceiptId),
                    -redeemAmount,
                    `Cashback used at checkout for ${String(sourceReceiptId).replace(/^cashback-/, '')}`
                ], (insertError, insertResult) => {
                    if (insertError || insertResult.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(insertError || null, { redeemed: false, duplicate: true, amount: 0 });
                        });
                    }

                    const updateSql = `
                        UPDATE loyalty_wallets
                        SET cashback_balance = cashback_balance - ?
                        WHERE user_id = ?
                            AND cashback_balance >= ?
                    `;

                    connection.query(updateSql, [redeemAmount, userId, redeemAmount], (updateError, result) => {
                        if (updateError || result.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(updateError || new Error('Not enough cashback balance.'));
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            callback(commitError, {
                                redeemed: !commitError,
                                amount: redeemAmount
                            });
                        });
                    });
                });
            });
        });
    });
}

function redeemPointsForCashback(userId, points, callback) {
    const requestedPoints = Math.floor(Number(points || 0));

    return getRules((rulesError, rules) => {
        if (rulesError) {
            callback(rulesError);
            return;
        }

        if (!rules.isEnabled) {
            callback(new Error('Loyalty rewards are currently disabled.'));
            return;
        }

        if (requestedPoints < rules.minPointsToRedeem) {
            callback(new Error(`Minimum redemption is ${rules.minPointsToRedeem} points`));
            return;
        }

        const cashback = roundMoney(requestedPoints * rules.pointsToCashRate);

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

                const updateSql = `
                    UPDATE loyalty_wallets
                    SET points_balance = points_balance - ?,
                        cashback_balance = cashback_balance + ?
                    WHERE user_id = ?
                        AND points_balance >= ?
                `;

                connection.query(updateSql, [requestedPoints, cashback, userId, requestedPoints], (updateError, result) => {
                    if (updateError || result.affectedRows === 0) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(updateError || new Error('Not enough points to redeem.'));
                        });
                    }

                    const insertSql = `
                        INSERT INTO loyalty_transactions
                            (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                        VALUES (?, ?, 'REDEEMED', ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        `points-${Date.now()}`,
                        -requestedPoints,
                        cashback,
                        `Redeemed ${requestedPoints} points for $${cashback.toFixed(2)} cashback`
                    ], (insertError) => {
                        if (insertError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(insertError);
                            });
                        }

                        return connection.commit((commitError) => {
                            connection.release();
                            callback(commitError, {
                                points: requestedPoints,
                                cashback
                            });
                        });
                    });
                });
            });
        });
    });
}

module.exports = {
    ACTIVITY_TYPES,
    awardForReceipt,
    awardPointsForReceipt,
    awardReviewBonus,
    ensureWallet,
    calculatePointRedemption,
    getEffectiveRedemptionRules,
    getMerchantRules,
    getMerchantRewardAnalytics,
    getPlatformSummary,
    getRules,
    getWalletView,
    redeemCashback,
    redeemPointsForPayment,
    redeemPointsForCashback,
    updateMerchantRules,
    updateRules
};
