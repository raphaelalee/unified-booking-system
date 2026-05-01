const db = require('../db');
const Transaction = require('./Transaction');

const PRIZE_TYPES = ['glints', 'voucher', 'benefit'];
const PRIZE_STATUSES = ['active', 'inactive'];

function formatDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().slice(0, 10);
}

function getWeekStart(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return formatDate(date);
}

function getWeeksBetween(fromDate, toDate) {
    if (!fromDate) {
        return 1;
    }

    const start = new Date(fromDate);
    const end = new Date(toDate);
    const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;

    return Math.max(0, Math.floor((end - start) / millisecondsPerWeek));
}

function mapSettings(row = {}) {
    return {
        weeklyFreePlays: Number(row.weekly_free_plays ?? 1),
        spendPerBonusPlay: Number(row.spend_per_bonus_play ?? 80),
        bonusPlaysPerThreshold: Number(row.bonus_plays_per_threshold ?? 1),
        isEnabled: row.is_enabled === undefined ? true : Boolean(Number(row.is_enabled))
    };
}

function mapPrize(row) {
    return {
        id: row.prize_id,
        prizeId: row.prize_id,
        salonId: row.salon_id,
        salonName: row.salon_name || 'Vaniday',
        title: row.title,
        description: row.description || '',
        prizeType: row.prize_type,
        rewardValue: row.reward_value === null || row.reward_value === undefined ? null : Number(row.reward_value),
        weight: Number(row.weight || 1),
        status: row.status
    };
}

function mapPlay(row) {
    return {
        id: row.play_id,
        prizeId: row.prize_id,
        prizeTitle: row.prize_title,
        prizeType: row.prize_type,
        rewardValue: row.reward_value === null || row.reward_value === undefined ? null : Number(row.reward_value),
        createdAt: row.created_at
    };
}

function getSettings(callback) {
    db.query('SELECT * FROM game_settings WHERE setting_id = 1 LIMIT 1', (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        if (rows.length > 0) {
            callback(null, mapSettings(rows[0]));
            return;
        }

        const insertSql = `
            INSERT INTO game_settings (setting_id, weekly_free_plays, spend_per_bonus_play, bonus_plays_per_threshold, is_enabled)
            VALUES (1, 1, 80.00, 1, 1)
        `;

        db.query(insertSql, (insertError) => {
            if (insertError) {
                callback(insertError);
                return;
            }

            callback(null, mapSettings());
        });
    });
}

function updateSettings(settings, callback) {
    const sql = `
        UPDATE game_settings
        SET weekly_free_plays = ?,
            spend_per_bonus_play = ?,
            bonus_plays_per_threshold = ?,
            is_enabled = ?
        WHERE setting_id = 1
    `;

    db.query(sql, [
        settings.weeklyFreePlays,
        settings.spendPerBonusPlay,
        settings.bonusPlaysPerThreshold,
        settings.isEnabled ? 1 : 0
    ], callback);
}

function ensureWallet(userId, callback) {
    const sql = `
        INSERT INTO game_wallets (user_id, play_balance, last_weekly_grant, bonus_milestones_granted)
        VALUES (?, 0, NULL, 0)
        ON DUPLICATE KEY UPDATE user_id = user_id
    `;

    db.query(sql, [userId], (error) => {
        if (error) {
            callback(error);
            return;
        }

        db.query('SELECT * FROM game_wallets WHERE user_id = ? LIMIT 1', [userId], (lookupError, rows) => {
            if (lookupError) {
                callback(lookupError);
                return;
            }

            callback(null, rows[0]);
        });
    });
}

function refreshWallet(userId, callback) {
    return getSettings((settingsError, settings) => {
        if (settingsError) {
            callback(settingsError);
            return;
        }

        return ensureWallet(userId, (walletError, wallet) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            return Transaction.getPaidSpendByUserId(userId, (spendError, totalSpend) => {
                if (spendError) {
                    callback(spendError);
                    return;
                }

                const currentWeekStart = getWeekStart();
                const lastWeekStart = formatDate(wallet.last_weekly_grant);
                const weeksToGrant = settings.isEnabled ? getWeeksBetween(lastWeekStart, currentWeekStart) : 0;
                const weeklyAdded = weeksToGrant * settings.weeklyFreePlays;
                const eligibleMilestones = settings.spendPerBonusPlay > 0
                    ? Math.floor(totalSpend / settings.spendPerBonusPlay)
                    : 0;
                const grantedMilestones = Number(wallet.bonus_milestones_granted || 0);
                const newMilestones = Math.max(0, eligibleMilestones - grantedMilestones);
                const bonusAdded = settings.isEnabled ? newMilestones * settings.bonusPlaysPerThreshold : 0;
                const playBalance = Number(wallet.play_balance || 0) + weeklyAdded + bonusAdded;
                const progressSpend = settings.spendPerBonusPlay > 0
                    ? totalSpend % settings.spendPerBonusPlay
                    : 0;
                const spendToNextPlay = settings.spendPerBonusPlay > 0
                    ? Math.max(settings.spendPerBonusPlay - progressSpend, 0)
                    : 0;

                const updateSql = `
                    UPDATE game_wallets
                    SET play_balance = ?,
                        last_weekly_grant = ?,
                        bonus_milestones_granted = ?
                    WHERE user_id = ?
                `;

                db.query(updateSql, [
                    playBalance,
                    weeklyAdded > 0 ? currentWeekStart : lastWeekStart,
                    Math.max(grantedMilestones, eligibleMilestones),
                    userId
                ], (updateError) => {
                    if (updateError) {
                        callback(updateError);
                        return;
                    }

                    callback(null, {
                        playBalance,
                        weeklyAdded,
                        bonusAdded,
                        totalSpend,
                        spendToNextPlay,
                        settings
                    });
                });
            });
        });
    });
}

function getPrizes(callback) {
    const sql = `
        SELECT game_prizes.*, salons.salon_name
        FROM game_prizes
        LEFT JOIN salons ON salons.salon_id = game_prizes.salon_id
        ORDER BY game_prizes.status, game_prizes.salon_id IS NOT NULL, game_prizes.prize_id DESC
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapPrize));
    });
}

function getActivePrizes(callback) {
    const sql = `
        SELECT game_prizes.*, salons.salon_name
        FROM game_prizes
        LEFT JOIN salons ON salons.salon_id = game_prizes.salon_id
        WHERE game_prizes.status = 'active'
            AND game_prizes.weight > 0
        ORDER BY game_prizes.salon_id IS NOT NULL, game_prizes.prize_id DESC
    `;

    db.query(sql, (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapPrize));
    });
}

function getPrizesByMerchantUserId(userId, callback) {
    const sql = `
        SELECT game_prizes.*, salons.salon_name
        FROM game_prizes
        INNER JOIN salons ON salons.salon_id = game_prizes.salon_id
        WHERE salons.merchant_id = ?
        ORDER BY game_prizes.prize_id DESC
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapPrize));
    });
}

function findPrizeById(prizeId, callback) {
    const sql = `
        SELECT game_prizes.*, salons.salon_name
        FROM game_prizes
        LEFT JOIN salons ON salons.salon_id = game_prizes.salon_id
        WHERE game_prizes.prize_id = ?
        LIMIT 1
    `;

    db.query(sql, [prizeId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] ? mapPrize(rows[0]) : null);
    });
}

function findPrizeForMerchant(userId, prizeId, callback) {
    const sql = `
        SELECT game_prizes.*, salons.salon_name
        FROM game_prizes
        INNER JOIN salons ON salons.salon_id = game_prizes.salon_id
        WHERE salons.merchant_id = ?
            AND game_prizes.prize_id = ?
        LIMIT 1
    `;

    db.query(sql, [userId, prizeId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] ? mapPrize(rows[0]) : null);
    });
}

function createPrize(prize, callback) {
    const sql = `
        INSERT INTO game_prizes (salon_id, title, description, prize_type, reward_value, weight, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        prize.salonId || null,
        prize.title,
        prize.description || null,
        prize.prizeType,
        prize.rewardValue,
        prize.weight,
        prize.status,
        prize.createdBy || null
    ], callback);
}

function updatePrize(prizeId, prize, callback) {
    const sql = `
        UPDATE game_prizes
        SET salon_id = ?,
            title = ?,
            description = ?,
            prize_type = ?,
            reward_value = ?,
            weight = ?,
            status = ?
        WHERE prize_id = ?
    `;

    db.query(sql, [
        prize.salonId || null,
        prize.title,
        prize.description || null,
        prize.prizeType,
        prize.rewardValue,
        prize.weight,
        prize.status,
        prizeId
    ], callback);
}

function updatePrizeForMerchant(userId, prizeId, prize, callback) {
    const sql = `
        UPDATE game_prizes
        INNER JOIN salons ON salons.salon_id = game_prizes.salon_id
        SET game_prizes.title = ?,
            game_prizes.description = ?,
            game_prizes.prize_type = ?,
            game_prizes.reward_value = ?,
            game_prizes.weight = ?,
            game_prizes.status = ?
        WHERE game_prizes.prize_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [
        prize.title,
        prize.description || null,
        prize.prizeType,
        prize.rewardValue,
        prize.weight,
        prize.status,
        prizeId,
        userId
    ], callback);
}

function deletePrize(prizeId, callback) {
    db.query('DELETE FROM game_prizes WHERE prize_id = ?', [prizeId], callback);
}

function deletePrizeForMerchant(userId, prizeId, callback) {
    const sql = `
        DELETE game_prizes
        FROM game_prizes
        INNER JOIN salons ON salons.salon_id = game_prizes.salon_id
        WHERE game_prizes.prize_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [prizeId, userId], callback);
}

function pickWeightedPrize(prizes) {
    const totalWeight = prizes.reduce((sum, prize) => sum + Number(prize.weight || 0), 0);
    let cursor = Math.random() * totalWeight;

    return prizes.find((prize) => {
        cursor -= Number(prize.weight || 0);
        return cursor <= 0;
    }) || prizes[0];
}

function play(userId, callback) {
    return refreshWallet(userId, (walletError, wallet) => {
        if (walletError) {
            callback(walletError);
            return;
        }

        if (!wallet.settings.isEnabled) {
            callback(null, { wallet, disabled: true, prize: null });
            return;
        }

        if (wallet.playBalance < 1) {
            callback(null, { wallet, noPlays: true, prize: null });
            return;
        }

        return getActivePrizes((prizeError, prizes) => {
            if (prizeError) {
                callback(prizeError);
                return;
            }

            if (prizes.length === 0) {
                callback(null, { wallet, noPrizes: true, prize: null });
                return;
            }

            const prize = pickWeightedPrize(prizes);

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

                    const decrementSql = `
                        UPDATE game_wallets
                        SET play_balance = play_balance - 1
                        WHERE user_id = ? AND play_balance > 0
                    `;

                    connection.query(decrementSql, [userId], (decrementError, result) => {
                        if (decrementError || result.affectedRows === 0) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(decrementError || new Error('No plays available.'));
                            });
                        }

                        const playSql = `
                            INSERT INTO game_plays (user_id, prize_id, prize_title, prize_type, reward_value)
                            VALUES (?, ?, ?, ?, ?)
                        `;

                        connection.query(playSql, [
                            userId,
                            prize.id,
                            prize.title,
                            prize.prizeType,
                            prize.rewardValue
                        ], (playError) => {
                            if (playError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(playError);
                                });
                            }

                            const finish = () => connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, {
                                    wallet: {
                                        ...wallet,
                                        playBalance: wallet.playBalance - 1
                                    },
                                    prize
                                });
                            });

                            if (prize.prizeType !== 'glints' || !prize.rewardValue) {
                                return finish();
                            }

                            return connection.query(
                                'UPDATE users SET glints_balance = COALESCE(glints_balance, 0) + ? WHERE user_id = ?',
                                [prize.rewardValue, userId],
                                (rewardError) => {
                                    if (rewardError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(rewardError);
                                        });
                                    }

                                    return finish();
                                }
                            );
                        });
                    });
                });
            });
        });
    });
}

function getRecentPlays(userId, callback) {
    const sql = `
        SELECT *
        FROM game_plays
        WHERE user_id = ?
        ORDER BY play_id DESC
        LIMIT 8
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map(mapPlay));
    });
}

module.exports = {
    PRIZE_TYPES,
    PRIZE_STATUSES,
    getSettings,
    updateSettings,
    refreshWallet,
    getPrizes,
    getActivePrizes,
    getPrizesByMerchantUserId,
    findPrizeById,
    findPrizeForMerchant,
    createPrize,
    updatePrize,
    updatePrizeForMerchant,
    deletePrize,
    deletePrizeForMerchant,
    play,
    getRecentPlays
};
