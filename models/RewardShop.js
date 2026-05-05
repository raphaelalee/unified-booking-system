const db = require('../db');

const DEFAULT_DAILY_REWARD_VALUES = [10, 10, 20, 20, 30, 50, 100];

function isMissingTable(error) {
    return error && error.code === 'ER_NO_SUCH_TABLE';
}

function normalizeDailyRewardValues(rows = []) {
    const values = [...DEFAULT_DAILY_REWARD_VALUES];

    rows.forEach((row) => {
        const dayNumber = Number(row.day_number);
        const points = Number(row.points);

        if (Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= values.length
            && Number.isInteger(points) && points >= 0) {
            values[dayNumber - 1] = points;
        }
    });

    return values;
}

function getDailyRewardValues(callback) {
    db.query(
        'SELECT day_number, points FROM daily_reward_settings ORDER BY day_number ASC',
        (error, rows) => {
            if (isMissingTable(error)) {
                callback(null, DEFAULT_DAILY_REWARD_VALUES, { isDefault: true });
                return;
            }

            if (error) {
                callback(error);
                return;
            }

            callback(null, normalizeDailyRewardValues(rows), { isDefault: false });
        }
    );
}

function getTodayDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function formatDateOnly(value) {
    if (!value) {
        return null;
    }

    if (typeof value === 'string') {
        return value.slice(0, 10);
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function ensureWallet(userId, callback) {
    const sql = `
        INSERT INTO daily_reward_wallets (user_id, cycle_start_date, current_day, last_claim_date)
        VALUES (?, CURDATE(), 0, NULL)
        ON DUPLICATE KEY UPDATE reward_wallet_id = reward_wallet_id
    `;

    db.query(sql, [userId], (error) => {
        if (error) {
            callback(error);
            return;
        }

        db.query(
            'SELECT user_id, cycle_start_date, current_day, last_claim_date, created_at, updated_at FROM daily_reward_wallets WHERE user_id = ? LIMIT 1',
            [userId],
            (lookupError, rows) => {
                if (lookupError) {
                    callback(lookupError);
                    return;
                }

                callback(null, rows[0] || null);
            }
        );
    });
}

function initializeForUser(userId, callback) {
    ensureWallet(userId, callback);
}

function getWallet(userId, callback) {
    ensureWallet(userId, (error, wallet) => {
        if (error) {
            callback(error);
            return;
        }

        return getDailyRewardValues((rewardError, rewardValues) => {
            if (rewardError) {
                callback(rewardError);
                return;
            }

            const today = getTodayDateString();
            const lastClaimDate = formatDateOnly(wallet.last_claim_date);
            const hasClaimedToday = lastClaimDate === today;
            const currentDay = Number(wallet.current_day || 0);
            const nextRewardIndex = currentDay >= rewardValues.length ? 0 : currentDay;

            callback(null, {
                userId,
                cycleStartDate: formatDateOnly(wallet.cycle_start_date) || today,
                currentDay,
                lastClaimDate,
                hasClaimedToday,
                nextRewardValue: rewardValues[nextRewardIndex],
                rewardValues
            });
        });
    });
}

function claimDailyReward(userId, callback) {
    ensureWallet(userId, (walletError, wallet) => {
        if (walletError) {
            callback(walletError);
            return;
        }

        const today = getTodayDateString();
        const lastClaimDate = formatDateOnly(wallet.last_claim_date);

        if (lastClaimDate === today) {
            callback(null, {
                alreadyClaimed: true,
                rewardValue: 0
            });
            return;
        }

        return getDailyRewardValues((rewardError, rewardValues) => {
            if (rewardError) {
                callback(rewardError);
                return;
            }

            const currentDay = Number(wallet.current_day || 0);
            const nextDay = currentDay >= rewardValues.length ? 1 : currentDay + 1;
            const rewardValue = rewardValues[nextDay - 1];

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
                        `
                            UPDATE daily_reward_wallets
                            SET cycle_start_date = ?,
                                current_day = ?,
                                last_claim_date = ?
                            WHERE user_id = ?
                        `,
                        [
                            nextDay === 1 ? today : formatDateOnly(wallet.cycle_start_date) || today,
                            nextDay,
                            today,
                            userId
                        ],
                        (walletUpdateError) => {
                            if (walletUpdateError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(walletUpdateError);
                                });
                            }

                            connection.query(
                                'UPDATE users SET glints_balance = COALESCE(glints_balance, 0) + ? WHERE user_id = ?',
                                [rewardValue, userId],
                                (userUpdateError) => {
                                    if (userUpdateError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            callback(userUpdateError);
                                        });
                                    }

                                    return connection.commit((commitError) => {
                                        connection.release();

                                        if (commitError) {
                                            callback(commitError);
                                            return;
                                        }

                                        callback(null, {
                                            alreadyClaimed: false,
                                            rewardValue,
                                            currentDay: nextDay
                                        });
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    });
}

function updateDailyRewardValues(values, callback) {
    const normalizedValues = DEFAULT_DAILY_REWARD_VALUES.map((fallbackValue, index) => {
        const points = Number(values[index]);
        return Number.isInteger(points) && points >= 0 ? points : fallbackValue;
    });
    const rows = normalizedValues.map((points, index) => [index + 1, points]);

    const sql = `
        INSERT INTO daily_reward_settings (day_number, points)
        VALUES ?
        ON DUPLICATE KEY UPDATE points = VALUES(points)
    `;

    db.query(sql, [rows], callback);
}

module.exports = {
    DAILY_REWARD_VALUES: DEFAULT_DAILY_REWARD_VALUES,
    DEFAULT_DAILY_REWARD_VALUES,
    initializeForUser,
    getWallet,
    claimDailyReward,
    getDailyRewardValues,
    updateDailyRewardValues
};
