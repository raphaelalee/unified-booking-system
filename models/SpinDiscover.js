const crypto = require('crypto');
const db = require('../db');

const TOKEN_EXPIRY_DAYS = 30;

function generateVoucherCode() {
    return `SPIN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function ensureSchema(callback) {
    const statements = [
        `
            CREATE TABLE IF NOT EXISTS spin_settings (
                setting_id TINYINT NOT NULL DEFAULT 1,
                is_enabled TINYINT(1) NOT NULL DEFAULT 1,
                token_expiry_days INT NOT NULL DEFAULT 30,
                try_again_weight INT NOT NULL DEFAULT 8,
                platform_points_weight INT NOT NULL DEFAULT 6,
                platform_cashback_weight INT NOT NULL DEFAULT 4,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (setting_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        `
            CREATE TABLE IF NOT EXISTS spin_tokens (
                token_id INT NOT NULL AUTO_INCREMENT,
                user_id INT NOT NULL,
                source_type ENUM('booking','order','manual') NOT NULL,
                source_transaction_id INT DEFAULT NULL,
                source_reference_id INT DEFAULT NULL,
                status ENUM('available','used','expired') NOT NULL DEFAULT 'available',
                earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME DEFAULT NULL,
                used_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (token_id),
                UNIQUE KEY uq_spin_token_source (user_id, source_type, source_transaction_id),
                KEY idx_spin_tokens_user_status_expiry (user_id, status, expires_at),
                KEY idx_spin_tokens_source_transaction (source_transaction_id),
                CONSTRAINT fk_spin_tokens_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
                CONSTRAINT fk_spin_tokens_transaction FOREIGN KEY (source_transaction_id) REFERENCES transactions (transaction_id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        `
            CREATE TABLE IF NOT EXISTS spin_results (
                result_id INT NOT NULL AUTO_INCREMENT,
                token_id INT NOT NULL,
                user_id INT NOT NULL,
                reward_type ENUM('promotion','service_discount','product_discount','voucher','loyalty_points','cashback','try_again') NOT NULL,
                reward_source_type VARCHAR(40) DEFAULT NULL,
                reward_source_id INT DEFAULT NULL,
                title VARCHAR(180) NOT NULL,
                description TEXT DEFAULT NULL,
                reward_value DECIMAL(10,2) DEFAULT NULL,
                reward_payload_json JSON DEFAULT NULL,
                status ENUM('claimed','no_prize','failed') NOT NULL DEFAULT 'claimed',
                user_voucher_id INT DEFAULT NULL,
                loyalty_transaction_id INT DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (result_id),
                UNIQUE KEY uq_spin_results_token (token_id),
                KEY idx_spin_results_user_created (user_id, created_at),
                KEY idx_spin_results_reward_source (reward_source_type, reward_source_id),
                CONSTRAINT fk_spin_results_token FOREIGN KEY (token_id) REFERENCES spin_tokens (token_id) ON DELETE CASCADE,
                CONSTRAINT fk_spin_results_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
                CONSTRAINT fk_spin_results_voucher FOREIGN KEY (user_voucher_id) REFERENCES user_vouchers (user_voucher_id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        `
            INSERT INTO spin_settings (setting_id, is_enabled, token_expiry_days, try_again_weight, platform_points_weight, platform_cashback_weight)
            VALUES (1, 1, 30, 8, 6, 4)
            ON DUPLICATE KEY UPDATE setting_id = setting_id
        `
    ];

    let index = 0;

    function next(error) {
        if (error || index >= statements.length) {
            callback(error || null);
            return;
        }

        db.query(statements[index], (statementError) => {
            index += 1;
            next(statementError);
        });
    }

    next();
}

function getSettings(callback) {
    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query('SELECT * FROM spin_settings WHERE setting_id = 1 LIMIT 1', (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            const row = rows[0] || {};
            callback(null, {
                isEnabled: row.is_enabled === undefined ? true : Boolean(Number(row.is_enabled)),
                tokenExpiryDays: Number(row.token_expiry_days || TOKEN_EXPIRY_DAYS),
                tryAgainWeight: Number(row.try_again_weight || 8),
                platformPointsWeight: Number(row.platform_points_weight || 6),
                platformCashbackWeight: Number(row.platform_cashback_weight || 4)
            });
        });
    });
}

function syncTokens(userId, callback) {
    getSettings((settingsError, settings) => {
        if (settingsError) {
            callback(settingsError);
            return;
        }

        const expiryDays = Number(settings.tokenExpiryDays || TOKEN_EXPIRY_DAYS);
        const statements = [
            {
                sql: `
                    INSERT IGNORE INTO spin_tokens (user_id, source_type, source_transaction_id, source_reference_id, earned_at, expires_at)
                    SELECT
                        transactions.user_id,
                        'booking',
                        transactions.transaction_id,
                        transactions.booking_id,
                        transactions.created_at,
                        DATE_ADD(transactions.created_at, INTERVAL ? DAY)
                    FROM transactions
                    INNER JOIN bookings ON bookings.booking_id = transactions.booking_id
                    WHERE transactions.user_id = ?
                        AND transactions.payment_status = 'paid'
                        AND transactions.booking_id IS NOT NULL
                        AND COALESCE(transactions.refund_status, 'none') NOT IN ('refunded','refund_completed','full_refund')
                        AND bookings.status IN ('paid','checked_in','completed')
                `,
                values: [expiryDays, userId]
            },
            {
                sql: `
                    INSERT IGNORE INTO spin_tokens (user_id, source_type, source_transaction_id, source_reference_id, earned_at, expires_at)
                    SELECT
                        transactions.user_id,
                        'order',
                        transactions.transaction_id,
                        COALESCE(transactions.order_id, transactions.order_item_id, transactions.transaction_id),
                        transactions.created_at,
                        DATE_ADD(transactions.created_at, INTERVAL ? DAY)
                    FROM transactions
                    WHERE transactions.user_id = ?
                        AND transactions.payment_status = 'paid'
                        AND (transactions.order_id IS NOT NULL OR transactions.order_item_id IS NOT NULL)
                        AND COALESCE(transactions.refund_status, 'none') NOT IN ('refunded','refund_completed','full_refund')
                `,
                values: [expiryDays, userId]
            },
            {
                sql: `
                    UPDATE spin_tokens
                    SET status = 'expired'
                    WHERE user_id = ?
                        AND status = 'available'
                        AND expires_at IS NOT NULL
                        AND expires_at < NOW()
                `,
                values: [userId]
            }
        ];

        let index = 0;

        function next(error) {
            if (error || index >= statements.length) {
                callback(error || null, settings);
                return;
            }

            const statement = statements[index];
            index += 1;
            db.query(statement.sql, statement.values, next);
        }

        next();
    });
}

function getTokenSummary(userId, callback) {
    if (!userId) {
        callback(null, { available: 0, used: 0, expired: 0, tokens: [] });
        return;
    }

    syncTokens(userId, (syncError, settings) => {
        if (syncError) {
            callback(syncError);
            return;
        }

        const sql = `
            SELECT *
            FROM spin_tokens
            WHERE user_id = ?
            ORDER BY
                CASE status WHEN 'available' THEN 0 WHEN 'used' THEN 1 ELSE 2 END,
                expires_at ASC,
                token_id DESC
        `;

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                settings,
                available: rows.filter((row) => row.status === 'available').length,
                used: rows.filter((row) => row.status === 'used').length,
                expired: rows.filter((row) => row.status === 'expired').length,
                tokens: rows
            });
        });
    });
}

function getPromotionRewards(callback) {
    const sql = `
        SELECT
            promotions.promotion_id,
            promotions.salon_id,
            promotions.service_id,
            promotions.product_id,
            promotions.title,
            promotions.discount_type,
            promotions.discount_value,
            promotions.description,
            promotions.end_date,
            promotions.spin_reward_type,
            promotions.minimum_spend,
            promotions.spin_claim_limit,
            promotions.spin_inventory_remaining,
            salons.salon_name,
            services.service_name,
            products.name AS product_name,
            COALESCE(spin_stats.spin_claim_count, 0) AS spin_claim_count
        FROM promotions
        INNER JOIN salons ON salons.salon_id = promotions.salon_id
        LEFT JOIN services ON services.service_id = promotions.service_id
        LEFT JOIN products ON products.product_id = promotions.product_id
        LEFT JOIN (
            SELECT reward_source_id AS promotion_id, COUNT(*) AS spin_claim_count
            FROM spin_results
            WHERE reward_source_type = 'promotion'
                AND status = 'claimed'
            GROUP BY reward_source_id
        ) spin_stats ON spin_stats.promotion_id = promotions.promotion_id
        WHERE promotions.status = 'active'
            AND promotions.spin_eligible = 1
            AND salons.approval_status = 'approved'
            AND promotions.start_date <= NOW()
            AND promotions.end_date >= NOW()
            AND (promotions.spin_claim_limit IS NULL OR COALESCE(spin_stats.spin_claim_count, 0) < promotions.spin_claim_limit)
            AND (promotions.spin_inventory_remaining IS NULL OR promotions.spin_inventory_remaining > 0)
        ORDER BY promotions.start_date DESC, promotions.promotion_id DESC
        LIMIT 24
    `;

    db.query(sql, (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map((row) => {
            const hasService = Boolean(row.service_id);
            const hasProduct = Boolean(row.product_id);
            const discountType = row.discount_type === 'percentage' ? 'percentage' : 'fixed';
            const discountValue = Number(row.discount_value || 0);
            const rewardType = row.spin_reward_type === 'product_discount' || hasProduct
                ? 'product_discount'
                : (row.spin_reward_type === 'cashback' ? 'cashback' : (hasService ? 'service_discount' : 'promotion'));

            return {
                rewardType,
                sourceType: 'promotion',
                sourceId: row.promotion_id,
                title: row.title,
                description: row.description || `${row.salon_name} promotion${row.service_name || row.product_name ? ` for ${row.service_name || row.product_name}` : ''}.`,
                value: discountValue,
                weight: hasService || hasProduct ? 14 : 11,
                payload: {
                    salonId: row.salon_id,
                    salonName: row.salon_name,
                    serviceId: row.service_id,
                    serviceName: row.service_name,
                    productId: row.product_id,
                    productName: row.product_name,
                    discountType,
                    discountValue,
                    minimumSpend: Number(row.minimum_spend || 0),
                    expiresAt: row.end_date,
                    hasLimitedInventory: row.spin_inventory_remaining !== null && row.spin_inventory_remaining !== undefined
                }
            };
        }));
    });
}

function getCashbackRewards(callback) {
    const sql = `
        SELECT
            merchant_cashback_campaigns.campaign_id,
            merchant_cashback_campaigns.salon_id,
            merchant_cashback_campaigns.title,
            merchant_cashback_campaigns.cashback_percent,
            merchant_cashback_campaigns.minimum_spend,
            merchant_cashback_campaigns.applicable_type,
            merchant_cashback_campaigns.end_at,
            salons.salon_name
        FROM merchant_cashback_campaigns
        INNER JOIN salons ON salons.salon_id = merchant_cashback_campaigns.salon_id
        WHERE merchant_cashback_campaigns.status = 'active'
            AND salons.approval_status = 'approved'
            AND merchant_cashback_campaigns.start_at <= NOW()
            AND merchant_cashback_campaigns.end_at >= NOW()
        ORDER BY merchant_cashback_campaigns.cashback_percent DESC, merchant_cashback_campaigns.campaign_id DESC
        LIMIT 16
    `;

    db.query(sql, (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map((row) => ({
            rewardType: 'cashback',
            sourceType: 'cashback_campaign',
            sourceId: row.campaign_id,
            title: row.title,
            description: `${Number(row.cashback_percent || 0).toFixed(0)}% cashback at ${row.salon_name}.`,
            value: Number(row.cashback_percent || 0),
            weight: 10,
            payload: {
                campaignId: row.campaign_id,
                salonId: row.salon_id,
                salonName: row.salon_name,
                cashbackPercent: Number(row.cashback_percent || 0),
                minimumSpend: Number(row.minimum_spend || 0),
                applicableType: row.applicable_type,
                expiresAt: row.end_at
            }
        })));
    });
}

function getVoucherRewards(callback) {
    const sql = `
        SELECT
            reward_shop_vouchers.*,
            salons.salon_name
        FROM reward_shop_vouchers
        LEFT JOIN salons ON salons.salon_id = reward_shop_vouchers.merchant_id
        WHERE reward_shop_vouchers.status = 'active'
            AND (salons.salon_id IS NULL OR salons.approval_status = 'approved')
            AND (reward_shop_vouchers.start_date IS NULL OR reward_shop_vouchers.start_date <= NOW())
            AND (reward_shop_vouchers.expiry_date IS NULL OR reward_shop_vouchers.expiry_date >= NOW())
        ORDER BY reward_shop_vouchers.sort_order, reward_shop_vouchers.voucher_id DESC
        LIMIT 20
    `;

    db.query(sql, (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map((row) => {
            const linkedProductId = row.linked_product_id || (row.linked_item_type === 'product' ? row.linked_item_id : null);
            const linkedServiceId = row.linked_service_id || (row.linked_item_type === 'service' ? row.linked_item_id : null);
            const rewardType = linkedProductId ? 'product_discount' : (linkedServiceId ? 'service_discount' : 'voucher');

            return {
                rewardType,
                sourceType: 'reward_shop_voucher',
                sourceId: row.voucher_id,
                title: row.title,
                description: row.detail || `${row.salon_name || 'Vaniday'} voucher reward.`,
                value: Number(row.discount_value || row.voucher_value || 0),
                weight: linkedProductId || linkedServiceId ? 12 : 8,
                payload: {
                    voucherDefinitionId: row.voucher_id,
                    merchantId: row.merchant_id,
                    merchantName: row.salon_name || '',
                    discountType: row.discount_type || 'fixed',
                    discountValue: Number(row.discount_value || row.voucher_value || 0),
                    discountPercent: Number(row.discount_type === 'percentage' ? row.discount_value : 0),
                    voucherValue: Number(row.voucher_value || row.discount_value || 0),
                    minimumSpend: Number(row.minimum_spend || 0),
                    bookingOnly: Boolean(row.applies_to_booking),
                    linkedItemType: row.linked_item_type || (linkedProductId ? 'product' : (linkedServiceId ? 'service' : null)),
                    linkedItemId: linkedProductId || linkedServiceId || null,
                    expiresAt: row.expiry_date
                }
            };
        }));
    });
}

function getDynamicRewards(settings, callback) {
    getPromotionRewards((promotionError, promotions = []) => {
        if (promotionError) {
            callback(promotionError);
            return;
        }

        getCashbackRewards((cashbackError, cashbacks = []) => {
            if (cashbackError) {
                callback(cashbackError);
                return;
            }

            getVoucherRewards((voucherError, vouchers = []) => {
                if (voucherError) {
                    callback(voucherError);
                    return;
                }

                const fallbackRewards = [
                    {
                        rewardType: 'loyalty_points',
                        sourceType: 'platform',
                        sourceId: null,
                        title: '120 VaniGlints',
                        description: 'Bonus loyalty points added to your Vaniday wallet.',
                        value: 120,
                        weight: settings.platformPointsWeight,
                        payload: { points: 120 }
                    },
                    {
                        rewardType: 'cashback',
                        sourceType: 'platform',
                        sourceId: null,
                        title: '$1 wallet cashback',
                        description: 'Small cashback boost for your next eligible checkout.',
                        value: 1,
                        weight: settings.platformCashbackWeight,
                        payload: { cashback: 1 }
                    },
                    {
                        rewardType: 'try_again',
                        sourceType: 'platform',
                        sourceId: null,
                        title: 'Try again next time',
                        description: 'No prize this spin, but new completed bookings and orders can earn more chances.',
                        value: 0,
                        weight: settings.tryAgainWeight,
                        payload: {}
                    }
                ];

                callback(null, [...promotions, ...cashbacks, ...vouchers, ...fallbackRewards]);
            });
        });
    });
}

function pickWeightedReward(rewards) {
    const totalWeight = rewards.reduce((sum, reward) => sum + Math.max(1, Number(reward.weight || 1)), 0);
    let cursor = Math.random() * totalWeight;

    return rewards.find((reward) => {
        cursor -= Math.max(1, Number(reward.weight || 1));
        return cursor <= 0;
    }) || rewards[0];
}

function insertVoucherReward(connection, userId, reward, resultId, callback) {
    const payload = reward.payload || {};
    const discountType = payload.discountType === 'percentage' ? 'percentage' : 'fixed';
    const voucherValue = discountType === 'percentage' ? 0 : roundMoney(payload.voucherValue || payload.discountValue || reward.value || 0);
    const discountPercent = discountType === 'percentage' ? Number(payload.discountPercent || payload.discountValue || reward.value || 0) : 0;
    const code = generateVoucherCode();
    const expiresAt = payload.expiresAt || null;

    const sql = `
        INSERT INTO user_vouchers
            (user_id, source_type, source_reference, title, detail, voucher_value, remaining_value, discount_type, discount_percent, status,
                booking_only, first_booking_only, voucher_definition_id, merchant_id, linked_item_type, linked_item_id, minimum_spend, code, expires_at)
        VALUES (?, 'spin_discover', ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `;

    connection.query(sql, [
        userId,
        String(resultId),
        reward.title,
        reward.description || null,
        voucherValue,
        voucherValue,
        discountType,
        discountPercent,
        payload.bookingOnly === false ? 0 : 1,
        payload.voucherDefinitionId || null,
        payload.merchantId || payload.salonId || null,
        payload.linkedItemType || (payload.serviceId ? 'service' : null),
        payload.linkedItemId || payload.serviceId || null,
        Number(payload.minimumSpend || 0),
        code,
        expiresAt
    ], callback);
}

function insertLoyaltyReward(connection, userId, reward, resultId, callback) {
    const points = reward.rewardType === 'loyalty_points' ? Number(reward.value || reward.payload?.points || 0) : 0;
    const cashback = reward.rewardType === 'cashback' && reward.sourceType === 'platform'
        ? roundMoney(reward.value || reward.payload?.cashback || 0)
        : 0;

    if (points <= 0 && cashback <= 0) {
        callback(null, { insertId: null });
        return;
    }

    const source = `spin-${resultId}`;

    connection.query(
        `
            INSERT INTO loyalty_wallets (user_id, points_balance, cashback_balance, lifetime_points)
            VALUES (?, 0, 0.00, 0)
            ON DUPLICATE KEY UPDATE user_id = user_id
        `,
        [userId],
        (walletError) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            connection.query(
                `
                    UPDATE loyalty_wallets
                    SET points_balance = points_balance + ?,
                        cashback_balance = cashback_balance + ?,
                        lifetime_points = lifetime_points + ?
                    WHERE user_id = ?
                `,
                [points, cashback, Math.max(0, points), userId],
                (updateError) => {
                    if (updateError) {
                        callback(updateError);
                        return;
                    }

                    connection.query(
                        `
                            INSERT INTO loyalty_transactions
                                (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                            VALUES (?, ?, 'spin', ?, ?, ?)
                        `,
                        [userId, source, points, cashback, reward.description || reward.title],
                        callback
                    );
                }
            );
        }
    );
}

function applyReward(connection, userId, reward, resultId, callback) {
    if (reward.rewardType === 'try_again') {
        callback(null, {});
        return;
    }

    if (['promotion', 'service_discount', 'product_discount', 'voucher'].includes(reward.rewardType)) {
        insertVoucherReward(connection, userId, reward, resultId, (error, result) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, { userVoucherId: result.insertId });
        });
        return;
    }

    insertLoyaltyReward(connection, userId, reward, resultId, (error, result) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, { loyaltyTransactionId: result.insertId || null });
    });
}

function consumePromotionInventory(connection, reward, callback) {
    if (reward.sourceType !== 'promotion' || !reward.payload?.hasLimitedInventory) {
        callback(null);
        return;
    }

    connection.query(
        `
            UPDATE promotions
            SET spin_inventory_remaining = spin_inventory_remaining - 1
            WHERE promotion_id = ?
                AND spin_inventory_remaining IS NOT NULL
                AND spin_inventory_remaining > 0
        `,
        [reward.sourceId],
        (error, result) => {
            if (error || result.affectedRows === 0) {
                callback(error || new Error('This Spin & Discover reward is no longer available.'));
                return;
            }

            callback(null);
        }
    );
}

function spin(userId, callback) {
    syncTokens(userId, (syncError, settings) => {
        if (syncError) {
            callback(syncError);
            return;
        }

        if (!settings.isEnabled) {
            callback(null, { ok: false, reason: 'disabled', message: 'Spin & Discover is not active right now.' });
            return;
        }

        getDynamicRewards(settings, (rewardError, rewards = []) => {
            if (rewardError) {
                callback(rewardError);
                return;
            }

            if (!rewards.length) {
                callback(null, { ok: false, reason: 'no_rewards', message: 'No spin rewards are available right now.' });
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

                    const tokenSql = `
                        SELECT *
                        FROM spin_tokens
                        WHERE user_id = ?
                            AND status = 'available'
                            AND (expires_at IS NULL OR expires_at >= NOW())
                        ORDER BY expires_at ASC, token_id ASC
                        LIMIT 1
                        FOR UPDATE
                    `;

                    connection.query(tokenSql, [userId], (tokenError, tokens = []) => {
                        if (tokenError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(tokenError);
                            });
                        }

                        if (!tokens.length) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(null, {
                                    ok: false,
                                    reason: 'no_token',
                                    message: 'Complete a booking or product order to earn a spin chance.'
                                });
                            });
                        }

                        const token = tokens[0];
                        const reward = pickWeightedReward(rewards);
                        const status = reward.rewardType === 'try_again' ? 'no_prize' : 'claimed';

                        const resultSql = `
                            INSERT INTO spin_results
                                (token_id, user_id, reward_type, reward_source_type, reward_source_id, title, description, reward_value, reward_payload_json, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;

                        connection.query(resultSql, [
                            token.token_id,
                            userId,
                            reward.rewardType,
                            reward.sourceType,
                            reward.sourceId,
                            reward.title,
                            reward.description || null,
                            reward.value === null || reward.value === undefined ? null : Number(reward.value || 0),
                            JSON.stringify(reward.payload || {}),
                            status
                        ], (resultError, result) => {
                            if (resultError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(resultError);
                                });
                            }

                            const resultId = result.insertId;

                            consumePromotionInventory(connection, reward, (inventoryError) => {
                                if (inventoryError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(inventoryError);
                                    });
                                }

                            applyReward(connection, userId, reward, resultId, (applyError, applied = {}) => {
                                if (applyError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(applyError);
                                    });
                                }

                                const updateResultSql = `
                                    UPDATE spin_results
                                    SET user_voucher_id = ?,
                                        loyalty_transaction_id = ?
                                    WHERE result_id = ?
                                `;

                                connection.query(updateResultSql, [
                                    applied.userVoucherId || null,
                                    applied.loyaltyTransactionId || null,
                                    resultId
                                ], (updateResultError) => {
                                    if (updateResultError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(updateResultError);
                                        });
                                    }

                                    connection.query(
                                        "UPDATE spin_tokens SET status = 'used', used_at = NOW() WHERE token_id = ? AND status = 'available'",
                                        [token.token_id],
                                        (updateTokenError, tokenUpdateResult) => {
                                            if (updateTokenError || tokenUpdateResult.affectedRows === 0) {
                                                return connection.rollback(() => {
                                                    connection.release();
                                                    callback(updateTokenError || new Error('Spin token was already used.'));
                                                });
                                            }

                                            connection.commit((commitError) => {
                                                connection.release();

                                                if (commitError) {
                                                    callback(commitError);
                                                    return;
                                                }

                                                callback(null, {
                                                    ok: true,
                                                    tokenId: token.token_id,
                                                    resultId,
                                                    reward: {
                                                        ...reward,
                                                        status,
                                                        userVoucherId: applied.userVoucherId || null,
                                                        loyaltyTransactionId: applied.loyaltyTransactionId || null
                                                    }
                                                });
                                            });
                                        }
                                    );
                                });
                            });
                            });
                        });
                    });
                });
            });
        });
    });
}

function getRecentResults(userId, callback) {
    if (!userId) {
        callback(null, []);
        return;
    }

    ensureSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT *
            FROM spin_results
            WHERE user_id = ?
            ORDER BY result_id DESC
            LIMIT 8
        `;

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                id: row.result_id,
                rewardType: row.reward_type,
                title: row.title,
                description: row.description || '',
                status: row.status,
                value: row.reward_value,
                createdAt: row.created_at
            })));
        });
    });
}

function getPageData(userId, callback) {
    getSettings((settingsError, settings) => {
        if (settingsError) {
            callback(settingsError);
            return;
        }

        getDynamicRewards(settings, (rewardError, rewards = []) => {
            if (rewardError) {
                callback(rewardError);
                return;
            }

            getTokenSummary(userId, (tokenError, tokenSummary) => {
                if (tokenError) {
                    callback(tokenError);
                    return;
                }

                getRecentResults(userId, (historyError, history = []) => {
                    if (historyError) {
                        callback(historyError);
                        return;
                    }

                    callback(null, {
                        settings,
                        rewards: rewards.slice(0, 16),
                        tokenSummary,
                        history
                    });
                });
            });
        });
    });
}

module.exports = {
    ensureSchema,
    getPageData,
    getTokenSummary,
    getDynamicRewards,
    spin,
    syncTokens
};
