const db = require('../db');

function ensureTransactionColumn(callback) {
    db.query("SHOW COLUMNS FROM e_wallet_transactions LIKE 'payment_attempt_id'", (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        if (rows.length) {
            callback(null);
            return;
        }

        db.query('ALTER TABLE e_wallet_transactions ADD COLUMN payment_attempt_id VARCHAR(100) NULL AFTER reference_id', callback);
    });
}

function normalizePaymentMethodForStorage(method = '') {
    const normalized = String(method || '').trim().toUpperCase();

    if (normalized === 'PAYPAL') return 'PAYPAL';
    if (normalized === 'HITPAY' || normalized === 'PAYNOW') return 'PAYNOW';
    if (normalized === 'NETS' || normalized === 'NETS_QR') return 'NETS_QR';
    if (normalized === 'EWALLET' || normalized === 'WALLET') return 'EWALLET';
    if (normalized === 'STRIPE') return 'STRIPE';

    return 'SYSTEM';
}

function mapWallet(row = {}) {
    return {
        walletId: Number(row.wallet_id || 0),
        userId: Number(row.user_id || 0),
        balance: Number(row.balance || 0),
        currency: row.currency || 'SGD',
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

function mapTransaction(row = {}) {
    return {
        transactionId: Number(row.transaction_id || 0),
        walletId: Number(row.wallet_id || 0),
        userId: Number(row.user_id || 0),
        transactionType: row.transaction_type || 'TOPUP',
        paymentMethod: row.payment_method || 'SYSTEM',
        amount: Number(row.amount || 0),
        balanceBefore: Number(row.balance_before || 0),
        balanceAfter: Number(row.balance_after || 0),
        status: row.status || 'PENDING',
        referenceId: row.reference_id || '',
        description: row.description || '',
        paymentAttemptId: row.payment_attempt_id || '',
        createdAt: row.created_at || null
    };
}

function ensureWalletForUser(userId, callback) {
    db.query('SELECT * FROM e_wallets WHERE user_id = ? LIMIT 1', [userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        if (rows[0]) {
            callback(null, mapWallet(rows[0]));
            return;
        }

        db.query('INSERT INTO e_wallets (user_id, balance, currency) VALUES (?, 0.00, ?)', [userId, 'SGD'], (insertError) => {
            if (insertError) {
                callback(insertError);
                return;
            }

            db.query('SELECT * FROM e_wallets WHERE user_id = ? LIMIT 1', [userId], (selectError, freshRows = []) => {
                if (selectError) {
                    callback(selectError);
                    return;
                }

                callback(null, mapWallet(freshRows[0]));
            });
        });
    });
}

function getWalletSummary(userId, callback) {
    ensureWalletForUser(userId, (walletError, wallet) => {
        if (walletError) {
            callback(walletError);
            return;
        }

        ensureTransactionColumn((columnError) => {
            if (columnError) {
                callback(columnError);
                return;
            }

            db.query('SELECT * FROM e_wallet_transactions WHERE user_id = ? ORDER BY created_at DESC, transaction_id DESC LIMIT 10', [userId], (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, {
                    wallet,
                    transactions: (rows || []).map(mapTransaction),
                    recentTransactions: (rows || []).slice(0, 3).map(mapTransaction)
                });
            });
        });
    });
}

function createPendingTopup(payload, callback) {
    ensureTransactionColumn((columnError) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        ensureWalletForUser(payload.userId, (walletError, wallet) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            const amount = Number(payload.amount || 0);
            const balanceBefore = Number(wallet.balance || 0);
            const description = String(payload.description || 'Wallet top-up created').slice(0, 255);

            db.query(`
                INSERT INTO e_wallet_transactions
                    (wallet_id, user_id, transaction_type, payment_method, amount, balance_before, balance_after, status, reference_id, description, payment_attempt_id)
                VALUES (?, ?, 'TOPUP', ?, ?, ?, ?, 'PENDING', ?, ?, ?)
            `, [
                wallet.walletId,
                payload.userId,
                normalizePaymentMethodForStorage(payload.paymentMethod || 'SYSTEM'),
                amount,
                balanceBefore,
                balanceBefore,
                payload.referenceId || null,
                description,
                payload.paymentAttemptId || null
            ], (error, result) => {
                if (error) {
                    callback(error);
                    return;
                }

                db.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? LIMIT 1', [result.insertId], (selectError, rows = []) => {
                    if (selectError) {
                        callback(selectError);
                        return;
                    }

                    callback(null, mapTransaction(rows[0]));
                });
            });
        });
    });
}

function debitWalletForPayment(payload, callback) {
    ensureTransactionColumn((columnError) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        ensureWalletForUser(payload.userId, (walletError, wallet) => {
            if (walletError) {
                callback(walletError);
                return;
            }

            const amount = Number(payload.amount || 0);
            const balanceBefore = Number(wallet.balance || 0);

            if (!Number.isFinite(amount) || amount <= 0) {
                callback(new Error('Invalid wallet payment amount.'));
                return;
            }

            if (balanceBefore < amount) {
                callback(new Error('Insufficient wallet balance.'));
                return;
            }

            const balanceAfter = balanceBefore - amount;
            const description = String(payload.description || 'Wallet payment').slice(0, 255);
            const referenceId = String(payload.referenceId || '').slice(0, 255);

            db.getConnection((connectError, connection) => {
                if (connectError) {
                    callback(connectError);
                    return;
                }

                connection.beginTransaction((txError) => {
                    if (txError) {
                        connection.release();
                        callback(txError);
                        return;
                    }

                    connection.query('SELECT * FROM e_wallets WHERE wallet_id = ? AND user_id = ? FOR UPDATE', [wallet.walletId, payload.userId], (walletSelectError, rows = []) => {
                        if (walletSelectError) {
                            connection.rollback(() => connection.release());
                            callback(walletSelectError);
                            return;
                        }

                        const currentWallet = rows[0];
                        if (!currentWallet) {
                            connection.rollback(() => connection.release());
                            callback(new Error('Wallet not found.'));
                            return;
                        }

                        const liveBalance = Number(currentWallet.balance || 0);
                        if (liveBalance < amount) {
                            connection.rollback(() => connection.release());
                            callback(new Error('Insufficient wallet balance.'));
                            return;
                        }

                        connection.query('UPDATE e_wallets SET balance = ? WHERE wallet_id = ? AND user_id = ?', [liveBalance - amount, wallet.walletId, payload.userId], (updateError) => {
                            if (updateError) {
                                connection.rollback(() => connection.release());
                                callback(updateError);
                                return;
                            }

                            connection.query(`
                                INSERT INTO e_wallet_transactions
                                    (wallet_id, user_id, transaction_type, payment_method, amount, balance_before, balance_after, status, reference_id, description, payment_attempt_id)
                                VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)
                            `, [
                                wallet.walletId,
                                payload.userId,
                                normalizePaymentMethodForStorage(payload.paymentMethod || 'EWALLET'),
                                amount,
                                liveBalance,
                                liveBalance - amount,
                                referenceId || null,
                                description,
                                payload.paymentAttemptId || null
                            ], (insertError, result) => {
                                if (insertError) {
                                    connection.rollback(() => connection.release());
                                    callback(insertError);
                                    return;
                                }

                                connection.commit((commitError) => {
                                    if (commitError) {
                                        connection.rollback(() => connection.release());
                                        callback(commitError);
                                        return;
                                    }

                                    connection.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? LIMIT 1', [result.insertId], (selectError, rows = []) => {
                                        connection.release();
                                        if (selectError) {
                                            callback(selectError);
                                            return;
                                        }

                                        callback(null, mapTransaction(rows[0]));
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

function completePendingTransaction(transactionId, userId, metadata = {}, callback) {
    ensureTransactionColumn((columnError) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        db.getConnection((connectError, connection) => {
            if (connectError) {
                callback(connectError);
                return;
            }

            connection.beginTransaction((txError) => {
                if (txError) {
                    connection.release();
                    callback(txError);
                    return;
                }

                connection.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? AND user_id = ? FOR UPDATE', [transactionId, userId], (selectError, rows = []) => {
                    if (selectError) {
                        connection.rollback(() => connection.release());
                        callback(selectError);
                        return;
                    }

                    const transaction = rows[0];
                    if (!transaction) {
                        connection.rollback(() => connection.release());
                        callback(null, null);
                        return;
                    }

                    const currentStatus = String(transaction.status || '').toUpperCase();
                    if (currentStatus !== 'PENDING') {
                        connection.commit(() => connection.release());
                        callback(null, mapTransaction(transaction));
                        return;
                    }

                    const amount = Number(transaction.amount || 0);
                    const balanceBefore = Number(transaction.balance_before || 0);
                    const balanceAfter = balanceBefore + amount;
                    const description = String(metadata.description || 'Wallet top-up completed').slice(0, 255);
                    const providerReference = String(metadata.providerReference || transaction.reference_id || '').slice(0, 255);

                    connection.query('SELECT * FROM e_wallets WHERE wallet_id = ? AND user_id = ? FOR UPDATE', [transaction.wallet_id, userId], (walletError, walletRows = []) => {
                        if (walletError) {
                            connection.rollback(() => connection.release());
                            callback(walletError);
                            return;
                        }

                        const wallet = walletRows[0];
                        if (!wallet) {
                            connection.rollback(() => connection.release());
                            callback(new Error('Wallet not found.'));
                            return;
                        }

                        connection.query('UPDATE e_wallets SET balance = ? WHERE wallet_id = ? AND user_id = ?', [balanceAfter, transaction.wallet_id, userId], (walletUpdateError) => {
                            if (walletUpdateError) {
                                connection.rollback(() => connection.release());
                                callback(walletUpdateError);
                                return;
                            }

                            connection.query(`
                                UPDATE e_wallet_transactions
                                SET status = 'COMPLETED', balance_before = ?, balance_after = ?, reference_id = ?, description = ?
                                WHERE transaction_id = ? AND user_id = ?
                            `, [balanceBefore, balanceAfter, providerReference || null, description, transactionId, userId], (updateError) => {
                                if (updateError) {
                                    connection.rollback(() => connection.release());
                                    callback(updateError);
                                    return;
                                }

                                connection.commit((commitError) => {
                                    if (commitError) {
                                        connection.rollback(() => connection.release());
                                        callback(commitError);
                                        return;
                                    }

                                    connection.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? LIMIT 1', [transactionId], (fetchError, updatedRows = []) => {
                                        connection.release();
                                        if (fetchError) {
                                            callback(fetchError);
                                            return;
                                        }

                                        callback(null, mapTransaction(updatedRows[0]));
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

function updateTransactionStatus(transactionId, userId, status, description, providerReference, callback) {
    ensureTransactionColumn((columnError) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        db.query(`
            UPDATE e_wallet_transactions
            SET status = ?, description = ?, reference_id = COALESCE(NULLIF(?, ''), reference_id)
            WHERE transaction_id = ? AND user_id = ?
        `, [status, String(description || '').slice(0, 255), String(providerReference || ''), transactionId, userId], (error) => {
            if (error) {
                callback(error);
                return;
            }

            db.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? LIMIT 1', [transactionId], (fetchError, rows = []) => {
                if (fetchError) {
                    callback(fetchError);
                    return;
                }

                callback(null, mapTransaction(rows[0]));
            });
        });
    });
}

function getTransactionById(transactionId, userId, callback) {
    db.query('SELECT * FROM e_wallet_transactions WHERE transaction_id = ? AND user_id = ? LIMIT 1', [transactionId, userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, mapTransaction(rows[0]));
    });
}

module.exports = {
    ensureWalletForUser,
    getWalletSummary,
    createPendingTopup,
    debitWalletForPayment,
    completePendingTransaction,
    updateTransactionStatus,
    getTransactionById
};
