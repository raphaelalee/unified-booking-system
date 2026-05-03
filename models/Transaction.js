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

function getOrderReceiptById(transactionId, userId, callback) {
    const sql = `
        SELECT
            transactions.transaction_id AS id,
            transactions.user_id,
            transactions.total_amount,
            transactions.payment_status,
            transactions.payment_method,
            transactions.created_at,
            users.name AS customer_name,
            products.name AS product_name,
            order_items.quantity,
            order_items.price_at_purchase
        FROM transactions
        INNER JOIN users ON users.user_id = transactions.user_id
        INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
        INNER JOIN products ON products.product_id = order_items.product_id
        WHERE transactions.transaction_id = ?
            AND transactions.user_id = ?
        ORDER BY order_items.order_item_id ASC
    `;

    db.query(sql, [transactionId, userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        if (!rows.length) {
            callback(null, null);
            return;
        }

        const first = rows[0];
        callback(null, {
            id: first.id,
            userId: first.user_id,
            userName: first.customer_name,
            totalAmount: Number(first.total_amount || 0),
            paymentStatus: first.payment_status || 'paid',
            paymentMethod: first.payment_method || 'card',
            createdAt: first.created_at,
            items: rows.map((row) => ({
                name: row.product_name,
                type: 'Product',
                quantity: Number(row.quantity || 1),
                unitPrice: Number(row.price_at_purchase || 0),
                lineTotal: Number(row.quantity || 1) * Number(row.price_at_purchase || 0)
            }))
        });
    });
}

module.exports = {
    createPaidTransaction,
    getOrderReceiptById,
    getPaidSpendByUserId
};
