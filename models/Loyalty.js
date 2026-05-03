const db = require('../db');

const DEFAULT_RULES = {
    pointsPerDollar: 10,
    cashbackPercent: 5,
    minPointsToRedeem: 100,
    pointsToCashRate: 0.01,
    isEnabled: true
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
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (rule_id)
        )
    `;
    const seedRulesSql = `
        INSERT INTO loyalty_rules
            (rule_id, points_per_dollar, cashback_percent, min_points_to_redeem, points_to_cash_rate, is_enabled)
        VALUES (1, 10, 5, 100, 0.01, 1)
        ON DUPLICATE KEY UPDATE rule_id = rule_id
    `;

    runSeries([
        (next) => db.query(walletSql, next),
        (next) => db.query(transactionSql, next),
        (next) => db.query(rulesSql, next),
        (next) => db.query(seedRulesSql, next)
    ], callback);
}

function mapRules(row = {}) {
    return {
        pointsPerDollar: Number(row.points_per_dollar ?? DEFAULT_RULES.pointsPerDollar),
        cashbackPercent: Number(row.cashback_percent ?? DEFAULT_RULES.cashbackPercent),
        minPointsToRedeem: Number(row.min_points_to_redeem ?? DEFAULT_RULES.minPointsToRedeem),
        pointsToCashRate: Number(row.points_to_cash_rate ?? DEFAULT_RULES.pointsToCashRate),
        isEnabled: row.is_enabled === undefined ? DEFAULT_RULES.isEnabled : Boolean(Number(row.is_enabled))
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
    return {
        id: row.loyalty_transaction_id,
        sourceReceiptId: row.source_receipt_id,
        type: row.transaction_type,
        pointsDelta: Number(row.points_delta || 0),
        cashbackDelta: Number(row.cashback_delta || 0),
        description: row.description,
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
                is_enabled = ?
            WHERE rule_id = 1
        `;

        db.query(sql, [
            rules.pointsPerDollar,
            rules.cashbackPercent,
            rules.minPointsToRedeem,
            rules.pointsToCashRate,
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

function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function awardForReceipt(receipt, callback) {
    const totalAmount = Number(receipt.totalAmount || 0);

    if (!receipt.userId || totalAmount <= 0 || !['paid', 'completed'].includes(String(receipt.paymentStatus || '').toLowerCase())) {
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

        const points = Math.floor(totalAmount * rules.pointsPerDollar);
        const cashback = roundMoney(totalAmount * (rules.cashbackPercent / 100));
        const description = `Earned from receipt ${receipt.displayId || receipt.id}`;
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

                const insertSql = `
                    INSERT IGNORE INTO loyalty_transactions
                        (user_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description)
                    VALUES (?, ?, 'earn', ?, ?, ?)
                `;

                connection.query(insertSql, [
                    receipt.userId,
                    sourceReceiptId,
                    points,
                    cashback,
                    description
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
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            points_balance = points_balance + VALUES(points_balance),
                            cashback_balance = cashback_balance + VALUES(cashback_balance),
                            lifetime_points = lifetime_points + VALUES(lifetime_points)
                    `;

                    connection.query(updateSql, [
                        receipt.userId,
                        points,
                        cashback,
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
                                cashback
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
                    VALUES (?, ?, 'redeem', 0, ?, ?)
                `;

                connection.query(insertSql, [
                    userId,
                    String(sourceReceiptId),
                    -redeemAmount,
                    `Redeemed for receipt ${sourceReceiptId}`
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
            callback(new Error(`Redeem at least ${rules.minPointsToRedeem} points.`));
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
                        VALUES (?, ?, 'redeem_points', ?, ?, ?)
                    `;

                    connection.query(insertSql, [
                        userId,
                        `points-${Date.now()}`,
                        -requestedPoints,
                        cashback,
                        'Converted reward points into booking cashback'
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
    awardForReceipt,
    ensureWallet,
    getRules,
    getWalletView,
    redeemCashback,
    redeemPointsForCashback,
    updateRules
};
