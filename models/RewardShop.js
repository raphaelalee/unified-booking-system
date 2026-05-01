const db = require('../db');

const DAILY_REWARD_VALUES = [10, 10, 20, 20, 30, 50, 100];

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

function getPreviousDateString(dateString) {
    const date = new Date(`${dateString}T00:00:00+08:00`);
    date.setDate(date.getDate() - 1);
    return formatDateOnly(date);
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

        const today = getTodayDateString();
        const lastClaimDate = formatDateOnly(wallet.last_claim_date);
        const hasClaimedToday = lastClaimDate === today;
        const currentDay = Number(wallet.current_day || 0);

        callback(null, {
            userId,
            cycleStartDate: formatDateOnly(wallet.cycle_start_date) || today,
            currentDay,
            lastClaimDate,
            hasClaimedToday,
            nextRewardValue: DAILY_REWARD_VALUES[Math.min(currentDay, DAILY_REWARD_VALUES.length - 1)],
            rewardValues: DAILY_REWARD_VALUES
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

        const previousDate = getPreviousDateString(today);
        const currentDay = Number(wallet.current_day || 0);
        const nextDay = lastClaimDate === previousDate
            ? Math.min(currentDay + 1, DAILY_REWARD_VALUES.length)
            : 1;
        const rewardValue = DAILY_REWARD_VALUES[nextDay - 1];

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
}

module.exports = {
    DAILY_REWARD_VALUES,
    initializeForUser,
    getWallet,
    claimDailyReward
};
