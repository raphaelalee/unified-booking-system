const db = require('../db');
const Loyalty = require('./Loyalty');

let fulfilmentSchemaReady = false;
const DEFAULT_COMMISSION_RATE = 15;
let merchantCommissionSchemaReady = false;
let orderRefundSchemaReady = false;

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

        if (!fields.has('currency')) {
            alters.push("ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'SGD'");
        }

        if (!fields.has('payment_provider')) {
            alters.push('ADD COLUMN payment_provider VARCHAR(40) DEFAULT NULL');
        }

        if (!fields.has('provider_payment_id')) {
            alters.push('ADD COLUMN provider_payment_id VARCHAR(190) DEFAULT NULL');
        }

        if (!fields.has('provider_session_id')) {
            alters.push('ADD COLUMN provider_session_id VARCHAR(190) DEFAULT NULL');
        }

        if (!fields.has('provider_capture_id')) {
            alters.push('ADD COLUMN provider_capture_id VARCHAR(190) DEFAULT NULL');
        }

        if (!fields.has('provider_refund_id')) {
            alters.push('ADD COLUMN provider_refund_id VARCHAR(190) DEFAULT NULL');
        }

        if (!fields.has('refund_reason')) {
            alters.push('ADD COLUMN refund_reason TEXT DEFAULT NULL');
        }

        if (!fields.has('refunded_by')) {
            alters.push('ADD COLUMN refunded_by INT DEFAULT NULL');
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

function ensureOrderRefundSchema(callback) {
    if (orderRefundSchemaReady) {
        callback(null);
        return;
    }

    db.query('SHOW TABLES LIKE "orders"', (tableError, tableRows = []) => {
        if (tableError) {
            callback(tableError);
            return;
        }

        if (!tableRows.length) {
            orderRefundSchemaReady = true;
            callback(null);
            return;
        }

        db.query('SHOW COLUMNS FROM orders', (columnError, columns = []) => {
            if (columnError) {
                callback(columnError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('order_status')) {
                alters.push("ADD COLUMN order_status VARCHAR(40) NOT NULL DEFAULT 'processing'");
            }

            if (!fields.has('refund_status')) {
                alters.push("ADD COLUMN refund_status VARCHAR(40) NOT NULL DEFAULT 'none'");
            }

            if (!fields.has('refunded_amount')) {
                alters.push('ADD COLUMN refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
            }

            if (!fields.has('refunded_at')) {
                alters.push('ADD COLUMN refunded_at DATETIME DEFAULT NULL');
            }

            if (!fields.has('refund_reason')) {
                alters.push('ADD COLUMN refund_reason TEXT DEFAULT NULL');
            }

            if (!fields.has('provider_refund_id')) {
                alters.push('ADD COLUMN provider_refund_id VARCHAR(190) DEFAULT NULL');
            }

            if (!fields.has('refunded_by')) {
                alters.push('ADD COLUMN refunded_by INT DEFAULT NULL');
            }

            if (!alters.length) {
                orderRefundSchemaReady = true;
                callback(null);
                return;
            }

            db.query(`ALTER TABLE orders ${alters.join(', ')}`, (alterError) => {
                if (!alterError) {
                    orderRefundSchemaReady = true;
                }

                callback(alterError);
            });
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
                INSERT INTO transactions (
                    user_id,
                    total_amount,
                    payment_status,
                    payment_method,
                    booking_id,
                    original_amount,
                    cashback_used,
                    currency,
                    payment_provider,
                    provider_payment_id,
                    provider_session_id,
                    provider_capture_id
                )
                VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            connection.query(transactionSql, [
                userId,
                amount,
                paymentMethod || 'card',
                transactionOptions.bookingId || null,
                Number(transactionOptions.originalAmount || amount || 0),
                Number(transactionOptions.cashbackUsed || 0),
                transactionOptions.currency || 'SGD',
                transactionOptions.paymentProvider || null,
                transactionOptions.providerPaymentId || null,
                transactionOptions.providerSessionId || null,
                transactionOptions.providerCaptureId || null
            ], (insertError, transactionResult) => {
                if (insertError) {
                    return connection.rollback(() => {
                        connection.release();
                        done(insertError);
                    });
                }

                const productItems = (items || [])
                    .filter((item) => String(item.type || '').trim().toLowerCase() === 'product'
                        && Number.isInteger(Number(item.serviceId))
                        && Number(item.serviceId) > 0);

                const commitTransaction = () => connection.commit((commitError) => {
                    connection.release();
                    done(commitError, transactionResult);
                });

                const decrementProductStock = (index, callback) => {
                    if (index >= productItems.length) {
                        callback(null);
                        return;
                    }

                    const item = productItems[index];
                    const quantity = Math.max(1, Number(item.quantity || 1));
                    const productId = Number(item.serviceId);
                    const stockSql = `
                        UPDATE products
                        SET stock_quantity = stock_quantity - ?
                        WHERE product_id = ?
                            AND stock_quantity >= ?
                    `;

                    connection.query(stockSql, [quantity, productId, quantity], (stockError, stockResult) => {
                        if (stockError) {
                            callback(stockError);
                            return;
                        }

                        if (stockResult.affectedRows === 0) {
                            callback(new Error(`${item.name || 'A product'} does not have enough stock for this order.`));
                            return;
                        }

                        decrementProductStock(index + 1, callback);
                    });
                };

                const insertOrderItems = (orderId = null) => {
                    if (productItems.length === 0) {
                        commitTransaction();
                        return;
                    }

                    const orderItems = productItems.map((item) => [
                        transactionResult.insertId,
                        Number(item.serviceId),
                        Math.max(1, Number(item.quantity || 1)),
                        Number(item.price || 0),
                        orderId
                    ]);
                    const itemSql = `
                        INSERT INTO order_items (transaction_id, product_id, quantity, price_at_purchase, order_id)
                        VALUES ?
                    `;

                    connection.query(itemSql, [orderItems], (itemError, itemResult) => {
                        if (itemError) {
                            return connection.rollback(() => {
                                connection.release();
                                done(itemError);
                            });
                        }

                        connection.query(
                            'UPDATE transactions SET order_item_id = ? WHERE transaction_id = ?',
                            [itemResult.insertId, transactionResult.insertId],
                            (linkError) => {
                                if (linkError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        done(linkError);
                                    });
                                }

                                decrementProductStock(0, (stockError) => {
                                    if (stockError) {
                                        return connection.rollback(() => {
                                            connection.release();
                                            done(stockError);
                                        });
                                    }

                                    commitTransaction();
                                });
                            }
                        );
                    });
                };

                if (transactionOptions.createOrder !== true) {
                    insertOrderItems();
                    return;
                }

                connection.query(
                    'INSERT INTO orders (user_id, transaction_id, total_amount) VALUES (?, ?, ?)',
                    [userId, transactionResult.insertId, amount],
                    (orderError, orderResult) => {
                        if (orderError) {
                            return connection.rollback(() => {
                                connection.release();
                                done(orderError);
                            });
                        }

                        connection.query(
                            'UPDATE transactions SET order_id = ? WHERE transaction_id = ?',
                            [orderResult.insertId, transactionResult.insertId],
                            (linkError) => {
                                if (linkError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        done(linkError);
                                    });
                                }

                                insertOrderItems(orderResult.insertId);
                            }
                        );
                    }
                );
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
                transactions.currency,
                transactions.payment_provider,
                transactions.provider_payment_id,
                transactions.provider_session_id,
                transactions.provider_capture_id,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.refund_reason,
                transactions.refunded_by,
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
                transactions.currency,
                transactions.payment_provider,
                transactions.provider_payment_id,
                transactions.provider_session_id,
                transactions.provider_capture_id,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.refund_reason,
                transactions.refunded_by,
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
                currency: row.currency || 'SGD',
                paymentProvider: row.payment_provider || '',
                providerPaymentId: row.provider_payment_id || '',
                providerSessionId: row.provider_session_id || '',
                providerCaptureId: row.provider_capture_id || '',
                providerRefundId: row.provider_refund_id || '',
                deliveryStatus: row.delivery_status || 'processing',
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                refundReason: row.refund_reason || '',
                refundedBy: row.refunded_by || null,
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
                transactions.currency,
                transactions.payment_provider,
                transactions.provider_payment_id,
                transactions.provider_session_id,
                transactions.provider_capture_id,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.refund_reason,
                transactions.refunded_by,
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
                transactions.currency,
                transactions.payment_provider,
                transactions.provider_payment_id,
                transactions.provider_session_id,
                transactions.provider_capture_id,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.refund_reason,
                transactions.refunded_by,
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
                currency: row.currency || 'SGD',
                paymentProvider: row.payment_provider || '',
                providerPaymentId: row.provider_payment_id || '',
                providerSessionId: row.provider_session_id || '',
                providerCaptureId: row.provider_capture_id || '',
                providerRefundId: row.provider_refund_id || '',
                deliveryStatus: row.delivery_status || 'processing',
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                refundReason: row.refund_reason || '',
                refundedBy: row.refunded_by || null,
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

function recordRefund(transactionId, amount, options = {}, callback) {
    const done = typeof options === 'function' ? options : callback;
    const refundOptions = typeof options === 'function' ? {} : options || {};

    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
            return;
        }

        ensureOrderRefundSchema((orderSchemaError) => {
        if (orderSchemaError) {
            done(orderSchemaError);
            return;
        }

        const sql = `
            UPDATE transactions
            SET
                refund_status = ?,
                refunded_amount = ?,
                refunded_at = CURRENT_TIMESTAMP,
                delivery_status = CASE
                    WHEN ? IN ('refunded', 'partially_refunded', 'manual_required') THEN 'cancelled'
                    ELSE delivery_status
                END,
                provider_refund_id = COALESCE(?, provider_refund_id),
                refund_reason = COALESCE(?, refund_reason),
                refunded_by = COALESCE(?, refunded_by)
            WHERE transaction_id = ?
        `;

        const executor = refundOptions.connection || db;
        const refundStatus = refundOptions.refundStatus || 'refunded';
        const refundedAmount = Number(amount || 0);
        const providerRefundId = refundOptions.providerRefundId || null;
        const refundReason = refundOptions.refundReason || null;
        const refundedBy = refundOptions.refundedBy || null;

        console.log('[refund:sql:transactions:update:start]', {
            transactionId,
            refundStatus,
            refundedAmount,
            providerRefundId,
            refundedBy
        });

        executor.query(sql, [
            refundStatus,
            refundedAmount,
            refundStatus,
            providerRefundId,
            refundReason,
            refundedBy,
            transactionId
        ], (error, result) => {
            if (error) {
                console.error('[refund:sql:transactions:update:error]', error);
                done(error);
                return;
            }

            console.log('[refund:sql:transactions:update:result]', {
                transactionId,
                affectedRows: result?.affectedRows,
                changedRows: result?.changedRows
            });

            const orderSql = `
                UPDATE orders
                SET
                    order_status = CASE
                        WHEN ? IN ('refunded', 'partially_refunded') THEN 'cancelled_refunded'
                        WHEN ? = 'manual_required' THEN 'refund_pending'
                        ELSE order_status
                    END,
                    refund_status = ?,
                    refunded_amount = ?,
                    refunded_at = CURRENT_TIMESTAMP,
                    provider_refund_id = COALESCE(?, provider_refund_id),
                    refund_reason = COALESCE(?, refund_reason),
                    refunded_by = COALESCE(?, refunded_by)
                WHERE transaction_id = ?
            `;

            console.log('[refund:sql:orders:update:start]', {
                transactionId,
                refundStatus,
                refundedAmount,
                providerRefundId,
                refundedBy
            });

            executor.query(orderSql, [
                refundStatus,
                refundStatus,
                refundStatus,
                refundedAmount,
                providerRefundId,
                refundReason,
                refundedBy,
                transactionId
            ], (orderError, orderResult) => {
                if (orderError) {
                    console.error('[refund:sql:orders:update:error]', orderError);
                    done(orderError);
                    return;
                }

                console.log('[refund:sql:orders:update:result]', {
                    transactionId,
                    affectedRows: orderResult?.affectedRows,
                    changedRows: orderResult?.changedRows
                });

                if (refundOptions.skipLoyaltyReverse) {
                    done(null, result);
                    return;
                }

                Loyalty.reverseCampaignCashbackForReceipt(`order-${transactionId}`, (reverseError) => {
                if (reverseError) {
                    console.error('[refund:loyalty:reverse:error]', reverseError);
                    done(reverseError);
                    return;
                }

                done(null, result);
            });
            });
        });
        });
    });
}

function getById(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT
                transaction_id,
                user_id,
                total_amount,
                payment_status,
                payment_method,
                booking_id,
                order_id,
                currency,
                payment_provider,
                provider_payment_id,
                provider_session_id,
                provider_capture_id,
                provider_refund_id,
                refund_status,
                refunded_amount,
                refund_reason,
                refunded_by,
                refunded_at,
                created_at
             FROM transactions
             WHERE transaction_id = ?
             LIMIT 1`,
            [transactionId],
            (error, rows = []) => {
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
                    transactionId: row.transaction_id,
                    userId: row.user_id,
                    totalAmount: Number(row.total_amount || 0),
                    paymentStatus: row.payment_status || 'pending',
                    paymentMethod: row.payment_method || '',
                    bookingId: row.booking_id || null,
                    orderId: row.order_id || null,
                    currency: row.currency || 'SGD',
                    paymentProvider: row.payment_provider || '',
                    providerPaymentId: row.provider_payment_id || '',
                    providerSessionId: row.provider_session_id || '',
                    providerCaptureId: row.provider_capture_id || '',
                    providerRefundId: row.provider_refund_id || '',
                    refundStatus: row.refund_status || 'none',
                    refundedAmount: Number(row.refunded_amount || 0),
                    refundReason: row.refund_reason || '',
                    refundedBy: row.refunded_by || null,
                    refundedAt: row.refunded_at,
                    createdAt: row.created_at
                });
            }
        );
    });
}

module.exports = {
    createPaidTransaction,
    getById,
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
