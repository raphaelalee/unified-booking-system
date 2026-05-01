const db = require('../db');

function createPaidTransaction(userId, amount, paymentMethod, items, callback) {
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

            const transactionSql = `
                INSERT INTO transactions (user_id, total_amount, payment_status, payment_method)
                VALUES (?, ?, 'paid', ?)
            `;

            connection.query(transactionSql, [userId, amount, paymentMethod || 'card'], (insertError, transactionResult) => {
                if (insertError) {
                    return connection.rollback(() => {
                        connection.release();
                        callback(insertError);
                    });
                }

                const orderItems = (items || [])
                    .filter((item) => item.type === 'Product' && Number.isInteger(Number(item.serviceId)))
                    .map((item) => [
                        transactionResult.insertId,
                        Number(item.serviceId),
                        Number(item.quantity || 1),
                        Number(item.price || 0)
                    ]);

                if (orderItems.length === 0) {
                    return connection.commit((commitError) => {
                        connection.release();
                        callback(commitError, transactionResult);
                    });
                }

                const itemSql = `
                    INSERT INTO order_items (transaction_id, product_id, quantity, price_at_purchase)
                    VALUES ?
                `;

                return connection.query(itemSql, [orderItems], (itemError) => {
                    if (itemError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(itemError);
                        });
                    }

                    return connection.commit((commitError) => {
                        connection.release();
                        callback(commitError, transactionResult);
                    });
                });
            });
        });
    });
}

function getPaidSpendByUserId(userId, callback) {
    const sql = `
        SELECT COALESCE(SUM(total_amount), 0) AS total_spend
        FROM transactions
        WHERE user_id = ?
            AND payment_status = 'paid'
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, Number(rows[0]?.total_spend || 0));
    });
}

module.exports = {
    createPaidTransaction,
    getPaidSpendByUserId
};
