const db = require('../db');
const Loyalty = require('./Loyalty');

let fulfilmentSchemaReady = false;
const DEFAULT_COMMISSION_RATE = 15;
let merchantCommissionSchemaReady = false;

function normalizeCommissionRate(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric) || numeric < 0) {
        return DEFAULT_COMMISSION_RATE;
    }

    return Math.min(100, Math.round(numeric * 100) / 100);
}

function buildCommissionBreakdown(grossAmount, commissionRate) {
    const gross = Number(grossAmount || 0);
    const rate = normalizeCommissionRate(commissionRate);
    const commissionAmount = Math.round(gross * (rate / 100) * 100) / 100;
    const payoutAmount = Math.round((gross - commissionAmount) * 100) / 100;

    return {
        grossAmount: gross,
        commissionRate: rate,
        commissionAmount,
        payoutAmount
    };
}

function ensureFulfilmentSchema(callback) {
    if (fulfilmentSchemaReady) {
        callback(null);
        return;
    }

    db.query('SHOW COLUMNS FROM transactions', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('delivery_status')) {
            alters.push("ADD COLUMN delivery_status VARCHAR(30) NOT NULL DEFAULT 'processing'");
        }

        if (!fields.has('shipped_at')) {
            alters.push('ADD COLUMN shipped_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('delivered_at')) {
            alters.push('ADD COLUMN delivered_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('refund_status')) {
            alters.push("ADD COLUMN refund_status VARCHAR(30) NOT NULL DEFAULT 'none'");
        }

        if (!fields.has('refunded_amount')) {
            alters.push('ADD COLUMN refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }

        if (!fields.has('refunded_at')) {
            alters.push('ADD COLUMN refunded_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('pickup_status')) {
            alters.push("ADD COLUMN pickup_status VARCHAR(40) NOT NULL DEFAULT 'pending_pickup'");
        }

        if (!fields.has('collected_at')) {
            alters.push('ADD COLUMN collected_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('original_amount')) {
            alters.push('ADD COLUMN original_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }

        if (!fields.has('cashback_used')) {
            alters.push('ADD COLUMN cashback_used DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }

        if (alters.length === 0) {
            fulfilmentSchemaReady = true;
            callback(null);
            return;
        }

        db.query(`ALTER TABLE transactions ${alters.join(', ')}`, (alterError) => {
            if (!alterError) {
                fulfilmentSchemaReady = true;
            }

            callback(alterError);
        });
    });
}

function normalizeDeliveryStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    const allowed = ['processing', 'packed', 'shipped', 'delivered', 'cancelled'];
    return allowed.includes(value) ? value : 'processing';
}

function normalizePickupStatus(status, deliveryStatus) {
    const value = String(status || '').trim().toLowerCase();

    if (['picked_up', 'collected'].includes(value) || String(deliveryStatus || '').toLowerCase() === 'delivered') {
        return 'picked_up';
    }

    if (value === 'cancelled') {
        return 'cancelled';
    }

    return 'pending_pickup';
}

function createPaidTransaction(userId, amount, paymentMethod, items, options = {}, callback) {
    const done = typeof options === 'function' ? options : callback;
    const transactionOptions = typeof options === 'function' ? {} : options || {};

    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
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

            const transactionSql = `
                INSERT INTO transactions (user_id, total_amount, payment_status, payment_method, original_amount, cashback_used)
                VALUES (?, ?, 'paid', ?, ?, ?)
            `;

            connection.query(transactionSql, [
                userId,
                amount,
                paymentMethod || 'card',
                Number(transactionOptions.originalAmount || amount || 0),
                Number(transactionOptions.cashbackUsed || 0)
            ], (insertError, transactionResult) => {
                if (insertError) {
                    return connection.rollback(() => {
                        connection.release();
                        done(insertError);
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
                        done(commitError, transactionResult);
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
                            done(itemError);
                        });
                    }

                    return connection.commit((commitError) => {
                        connection.release();
                        done(commitError, transactionResult);
                    });
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
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.shipped_at,
                transactions.delivered_at,
                transactions.created_at,
                users.name AS customer_name,
                products.name AS product_name,
                salons.salon_name AS merchant_name,
                order_items.quantity,
                order_items.price_at_purchase
            FROM transactions
            INNER JOIN users ON users.user_id = transactions.user_id
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
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
                deliveryStatus: first.delivery_status || 'processing',
                shippedAt: first.shipped_at,
                deliveredAt: first.delivered_at,
                createdAt: first.created_at,
                merchantName: Array.from(new Set(rows.map((row) => row.merchant_name).filter(Boolean))).join(', ') || 'Vaniday merchant',
                items: rows.map((row) => ({
                    name: row.product_name,
                    type: 'Product',
                    quantity: Number(row.quantity || 1),
                    unitPrice: Number(row.price_at_purchase || 0),
                    lineTotal: Number(row.quantity || 1) * Number(row.price_at_purchase || 0),
                    merchantName: row.merchant_name || ''
                }))
            });
        });
    });
}

function getPickupVerificationById(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.pickup_status,
                transactions.collected_at,
                transactions.created_at,
                users.name AS customer_name,
                products.name AS product_name,
                salons.salon_name AS merchant_name,
                salons.merchant_id AS merchant_user_id,
                order_items.quantity,
                order_items.price_at_purchase
            FROM transactions
            INNER JOIN users ON users.user_id = transactions.user_id
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.transaction_id = ?
            ORDER BY order_items.order_item_id ASC
        `;

        db.query(sql, [transactionId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            if (!rows.length) {
                callback(null, null);
                return;
            }

            const first = rows[0];
            const merchantNames = Array.from(new Set(rows.map((row) => row.merchant_name).filter(Boolean)));
            const merchantUserIds = Array.from(new Set(rows.map((row) => Number(row.merchant_user_id)).filter(Boolean)));

            callback(null, {
                id: first.id,
                receiptId: `order-${first.id}`,
                userId: first.user_id,
                customerName: first.customer_name || 'Customer',
                merchantName: merchantNames.join(', ') || 'Vaniday merchant',
                merchantUserIds,
                totalAmount: Number(first.total_amount || 0),
                paymentStatus: first.payment_status || 'paid',
                paymentMethod: first.payment_method || 'card',
                deliveryStatus: first.delivery_status || 'processing',
                pickupStatus: normalizePickupStatus(first.pickup_status, first.delivery_status),
                collectedAt: first.collected_at,
                createdAt: first.created_at,
                items: rows.map((row) => ({
                    name: row.product_name,
                    type: 'Product',
                    merchantName: row.merchant_name || '',
                    merchantUserId: row.merchant_user_id || null,
                    quantity: Number(row.quantity || 1),
                    unitPrice: Number(row.price_at_purchase || 0),
                    lineTotal: Number(row.quantity || 1) * Number(row.price_at_purchase || 0)
                }))
            });
        });
    });
}

function getMerchantOrderReport(merchantUserId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        ensureMerchantCommissionSchema((commissionSchemaError) => {
            if (commissionSchemaError) {
                callback(commissionSchemaError);
                return;
            }

            const sql = `
                SELECT
                    transactions.transaction_id,
                    transactions.user_id,
                    transactions.total_amount,
                    transactions.payment_method,
                    transactions.payment_status,
                    transactions.delivery_status,
                    transactions.created_at,
                    users.name AS customer_name,
                    COUNT(order_items.order_item_id) AS item_count,
                    SUM(order_items.quantity * order_items.price_at_purchase) AS merchant_total,
                    GROUP_CONCAT(
                        CONCAT(
                            products.product_id,
                            '::',
                            REPLACE(REPLACE(products.name, '|', ' '), '::', ' - '),
                            '::',
                            order_items.quantity,
                            '::',
                            order_items.price_at_purchase
                        )
                        ORDER BY order_items.order_item_id ASC
                        SEPARATOR '||'
                    ) AS item_lines,
                    COALESCE(salons.commission_rate, 15.00) AS commission_rate
                FROM transactions
                INNER JOIN users ON users.user_id = transactions.user_id
                INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
                INNER JOIN products ON products.product_id = order_items.product_id
                INNER JOIN salons ON salons.salon_id = products.salon_id
                WHERE salons.merchant_id = ?
                    AND transactions.payment_status = 'paid'
                GROUP BY
                    transactions.transaction_id,
                    transactions.user_id,
                    transactions.total_amount,
                    transactions.payment_method,
                    transactions.payment_status,
                    transactions.delivery_status,
                    transactions.created_at,
                    users.name,
                    salons.commission_rate
                ORDER BY transactions.created_at DESC, transactions.transaction_id DESC
            `;

            db.query(sql, [merchantUserId], (error, rows) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, rows.map((row) => {
                    const commission = buildCommissionBreakdown(row.merchant_total || row.total_amount || 0, row.commission_rate);
                    const items = String(row.item_lines || '')
                        .split('||')
                        .filter(Boolean)
                        .map((line) => {
                            const [productId, name, quantity, price] = line.split('::');
                            const itemQuantity = Number(quantity || 1);
                            const unitPrice = Number(price || 0);

                            return {
                                productId: Number(productId || 0),
                                name: name || 'Product',
                                quantity: itemQuantity,
                                unitPrice,
                                lineTotal: itemQuantity * unitPrice
                            };
                        });

                    return {
                        id: row.transaction_id,
                        userId: row.user_id,
                        customerName: row.customer_name || 'Customer',
                        items,
                        totalAmount: commission.grossAmount,
                        grossAmount: commission.grossAmount,
                        commissionRate: commission.commissionRate,
                        commissionAmount: commission.commissionAmount,
                        payoutAmount: commission.payoutAmount,
                        paymentMethod: row.payment_method || 'card',
                        paymentStatus: row.payment_status || 'paid',
                        deliveryStatus: row.delivery_status || 'processing',
                        itemCount: Number(row.item_count || 0),
                        createdAt: row.created_at
                    };
                }));
            });
        });
    });
}

function ensureMerchantCommissionSchema(callback) {
    if (merchantCommissionSchemaReady) {
        callback(null);
        return;
    }

    db.query('SHOW COLUMNS FROM salons', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));

        if (fields.has('commission_rate')) {
            merchantCommissionSchemaReady = true;
            callback(null);
            return;
        }

        db.query(
            'ALTER TABLE salons ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 15.00',
            (alterError) => {
                if (!alterError) {
                    merchantCommissionSchemaReady = true;
                }

                callback(alterError);
            }
        );
    });
}

function getMerchantOrderRecipients(transactionId, callback) {
    ensureMerchantCommissionSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                salons.merchant_id AS merchant_user_id,
                salons.salon_name,
                COUNT(order_items.order_item_id) AS item_count,
                SUM(order_items.quantity * order_items.price_at_purchase) AS merchant_total,
                COALESCE(salons.commission_rate, 15.00) AS commission_rate
            FROM order_items
            INNER JOIN products ON products.product_id = order_items.product_id
            INNER JOIN salons ON salons.salon_id = products.salon_id
            WHERE order_items.transaction_id = ?
            GROUP BY salons.merchant_id, salons.salon_name, salons.commission_rate
            ORDER BY salons.salon_name
        `;

        db.query(sql, [transactionId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => {
                const commission = buildCommissionBreakdown(row.merchant_total || 0, row.commission_rate);

                return {
                    merchantUserId: row.merchant_user_id,
                    salonName: row.salon_name,
                    itemCount: Number(row.item_count || 0),
                    totalAmount: commission.grossAmount,
                    grossAmount: commission.grossAmount,
                    commissionRate: commission.commissionRate,
                    commissionAmount: commission.commissionAmount,
                    payoutAmount: commission.payoutAmount
                };
            }));
        });
    });
}

function getCustomerOrders(userId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.created_at,
                COUNT(order_items.order_item_id) AS item_count,
                GROUP_CONCAT(products.name ORDER BY order_items.order_item_id SEPARATOR ', ') AS item_names,
                GROUP_CONCAT(DISTINCT salons.merchant_id ORDER BY salons.merchant_id SEPARATOR ',') AS merchant_user_ids,
                GROUP_CONCAT(DISTINCT salons.salon_name ORDER BY salons.salon_name SEPARATOR ', ') AS merchant_names
            FROM transactions
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.user_id = ?
                AND transactions.payment_status = 'paid'
            GROUP BY
                transactions.transaction_id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.created_at
            ORDER BY transactions.created_at DESC, transactions.transaction_id DESC
        `;

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map((row) => ({
                id: row.id,
                receiptId: `order-${row.id}`,
                userId: row.user_id,
                itemNames: row.item_names || 'Product order',
                merchantName: row.merchant_names || 'Vaniday merchant',
                merchantUserIds: String(row.merchant_user_ids || '')
                    .split(',')
                    .map((id) => Number(id))
                    .filter(Boolean),
                itemCount: Number(row.item_count || 0),
                totalAmount: Number(row.total_amount || 0),
                paymentStatus: row.payment_status || 'paid',
                paymentMethod: row.payment_method || 'card',
                deliveryStatus: row.delivery_status || 'processing',
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                createdAt: row.created_at
            })));
        });
    });
}

function getOrderById(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.created_at,
                users.name AS customer_name,
                users.email AS customer_email,
                COUNT(order_items.order_item_id) AS item_count,
                GROUP_CONCAT(products.name ORDER BY order_items.order_item_id SEPARATOR ', ') AS item_names,
                GROUP_CONCAT(DISTINCT salons.merchant_id ORDER BY salons.merchant_id SEPARATOR ',') AS merchant_user_ids,
                GROUP_CONCAT(DISTINCT salons.salon_name ORDER BY salons.salon_name SEPARATOR ', ') AS merchant_names
            FROM transactions
            INNER JOIN users ON users.user_id = transactions.user_id
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.transaction_id = ?
            GROUP BY
                transactions.transaction_id,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.created_at,
                users.name,
                users.email
            LIMIT 1
        `;

        db.query(sql, [transactionId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            const row = rows[0];

            if (!row) {
                callback(null, null);
                return;
            }

            callback(null, {
                id: row.id,
                receiptId: `order-${row.id}`,
                userId: row.user_id,
                customerName: row.customer_name || 'Customer',
                customerEmail: row.customer_email || '',
                itemNames: row.item_names || 'Product order',
                merchantName: row.merchant_names || 'Vaniday merchant',
                merchantUserIds: String(row.merchant_user_ids || '')
                    .split(',')
                    .map((id) => Number(id))
                    .filter(Boolean),
                itemCount: Number(row.item_count || 0),
                totalAmount: Number(row.total_amount || 0),
                paymentStatus: row.payment_status || 'paid',
                paymentMethod: row.payment_method || 'card',
                deliveryStatus: row.delivery_status || 'processing',
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                createdAt: row.created_at
            });
        });
    });
}

function getOrderForCustomer(userId, transactionId, callback) {
    getCustomerOrders(userId, (error, orders = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, orders.find((order) => String(order.id) === String(transactionId)) || null);
    });
}

function updateDeliveryStatus(transactionId, status, options = {}, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const deliveryStatus = normalizeDeliveryStatus(status);
        const timestampColumn = deliveryStatus === 'shipped'
            ? ', shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP)'
            : deliveryStatus === 'delivered'
                ? ', delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)'
                : '';
        const params = [deliveryStatus, transactionId];
        let ownershipClause = '';

        if (options.merchantUserId) {
            ownershipClause = `
                AND EXISTS (
                    SELECT 1
                    FROM order_items
                    INNER JOIN products ON products.product_id = order_items.product_id
                    INNER JOIN salons ON salons.salon_id = products.salon_id
                    WHERE order_items.transaction_id = transactions.transaction_id
                        AND salons.merchant_id = ?
                )
            `;
            params.push(options.merchantUserId);
        }

        const sql = `
            UPDATE transactions
            SET delivery_status = ?${timestampColumn}
            WHERE transaction_id = ?
            ${ownershipClause}
        `;

        db.query(sql, params, callback);
    });
}

function markPickupCollected(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE transactions
            SET
                pickup_status = 'picked_up',
                delivery_status = 'delivered',
                collected_at = COALESCE(collected_at, CURRENT_TIMESTAMP),
                delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
            WHERE transaction_id = ?
                AND payment_status = 'paid'
                AND COALESCE(pickup_status, 'pending_pickup') NOT IN ('picked_up', 'collected')
                AND COALESCE(delivery_status, 'processing') <> 'delivered'
        `;

        db.query(sql, [transactionId], callback);
    });
}

function recordRefund(transactionId, amount, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE transactions
            SET
                refund_status = 'refunded',
                refunded_amount = ?,
                refunded_at = CURRENT_TIMESTAMP
            WHERE transaction_id = ?
        `;

        db.query(sql, [Number(amount || 0), transactionId], (error, result) => {
            if (error) {
                callback(error);
                return;
            }

            Loyalty.reverseCampaignCashbackForReceipt(`order-${transactionId}`, (reverseError) => {
                if (reverseError) {
                    callback(reverseError);
                    return;
                }

                callback(null, result);
            });
        });
    });
}

module.exports = {
    createPaidTransaction,
    getOrderById,
    getMerchantOrderReport,
    getMerchantOrderRecipients,
    getCustomerOrders,
    getOrderForCustomer,
    getOrderReceiptById,
    getPickupVerificationById,
    getPaidSpendByUserId,
    markPickupCollected,
    recordRefund,
    updateDeliveryStatus
};
