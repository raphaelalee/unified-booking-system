const db = require('../db');
const Loyalty = require('./Loyalty');
const {
    formatPaymentBreakdown,
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');

let fulfilmentSchemaReady = false;
const DEFAULT_COMMISSION_RATE = 15;
let merchantCommissionSchemaReady = false;
let orderRefundSchemaReady = false;
let paymentAllocationSchemaReady = false;

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
        if (!fields.has('gross_amount')) {
            alters.push('ADD COLUMN gross_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('discount_amount')) {
            alters.push('ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('voucher_discount_amount')) {
            alters.push('ADD COLUMN voucher_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('wallet_amount_used')) {
            alters.push('ADD COLUMN wallet_amount_used DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('cashback_amount_used')) {
            alters.push('ADD COLUMN cashback_amount_used DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('loyalty_points_used')) {
            alters.push('ADD COLUMN loyalty_points_used INT NOT NULL DEFAULT 0');
        }
        if (!fields.has('loyalty_points_value')) {
            alters.push('ADD COLUMN loyalty_points_value DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('external_payment_amount')) {
            alters.push('ADD COLUMN external_payment_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('paid_amount')) {
            alters.push('ADD COLUMN paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('payment_date')) {
            alters.push('ADD COLUMN payment_date DATETIME DEFAULT NULL');
        }
        if (!fields.has('provider_transaction_id')) {
            alters.push('ADD COLUMN provider_transaction_id VARCHAR(190) DEFAULT NULL');
        }
        if (!fields.has('provider_order_id')) {
            alters.push('ADD COLUMN provider_order_id VARCHAR(190) DEFAULT NULL');
        }
        if (!fields.has('provider_charge_id')) {
            alters.push('ADD COLUMN provider_charge_id VARCHAR(190) DEFAULT NULL');
        }
        if (!fields.has('provider_metadata_json')) {
            alters.push('ADD COLUMN provider_metadata_json LONGTEXT DEFAULT NULL');
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

function ensurePaymentAllocationSchema(callback) {
    if (paymentAllocationSchemaReady) {
        callback(null);
        return;
    }

    const sql = `
        CREATE TABLE IF NOT EXISTS payment_allocations (
            allocation_id INT NOT NULL AUTO_INCREMENT,
            transaction_id INT NOT NULL,
            source_type ENUM('external','wallet','cashback','loyalty_points','voucher','discount') NOT NULL,
            payment_method VARCHAR(50) DEFAULT NULL,
            payment_provider VARCHAR(40) DEFAULT NULL,
            source_reference_id VARCHAR(190) DEFAULT NULL,
            allocated_amount DECIMAL(10,2) NOT NULL,
            refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            remaining_refundable_amount DECIMAL(10,2) GENERATED ALWAYS AS (GREATEST(allocated_amount - refunded_amount, 0.00)) STORED,
            metadata_json LONGTEXT DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (allocation_id),
            UNIQUE KEY uq_payment_allocation_source (transaction_id, source_type, source_reference_id),
            KEY idx_payment_allocations_transaction (transaction_id),
            CONSTRAINT fk_payment_allocations_transaction
                FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) paymentAllocationSchemaReady = true;
        callback(error);
    });
}

function buildPaymentAllocations(transactionId, paymentMethod, paymentProvider, amount, options = {}) {
    const allocations = [];
    const paidAmount = Math.round(Number(amount || 0) * 100) / 100;
    const cashback = Math.round(Number(options.cashbackUsed || options.cashbackAmountUsed || 0) * 100) / 100;
    const wallet = Math.round(Number(options.walletAmountUsed || 0) * 100) / 100;
    const pointsValue = Math.round(Number(options.loyaltyPointsValue || options.pointsDiscount || 0) * 100) / 100;
    const voucher = Math.round(Number(options.voucherDiscountAmount || options.voucherDiscount || 0) * 100) / 100;
    const gross = Math.round(Number(options.originalAmount || paidAmount + cashback + wallet + pointsValue + voucher) * 100) / 100;
    const method = normalizePaymentMethod(paymentMethod);
    const provider = normalizePaymentProvider(paymentProvider, method);
    const walletPaid = method === 'wallet' ? paidAmount : wallet;
    const externalPaid = method === 'wallet' ? 0 : paidAmount;

    if (externalPaid > 0) {
        allocations.push({
            transactionId,
            sourceType: 'external',
            paymentMethod: method,
            paymentProvider: provider,
            sourceReferenceId: options.providerPaymentId || options.providerCaptureId || options.providerSessionId || `external-${transactionId}`,
            allocatedAmount: externalPaid
        });
    }
    if (walletPaid > 0) {
        allocations.push({
            transactionId,
            sourceType: 'wallet',
            paymentMethod: 'wallet',
            paymentProvider: 'internal_wallet',
            sourceReferenceId: options.walletReferenceId || `wallet-${transactionId}`,
            allocatedAmount: walletPaid
        });
    }
    if (cashback > 0) {
        allocations.push({
            transactionId,
            sourceType: 'cashback',
            paymentMethod: 'cashback_wallet',
            paymentProvider: 'internal_wallet',
            sourceReferenceId: `cashback-${transactionId}`,
            allocatedAmount: cashback
        });
    }
    if (pointsValue > 0) {
        allocations.push({
            transactionId,
            sourceType: 'loyalty_points',
            paymentMethod: 'loyalty_points',
            paymentProvider: 'internal_wallet',
            sourceReferenceId: `points-${transactionId}`,
            allocatedAmount: pointsValue
        });
    }
    if (voucher > 0) {
        allocations.push({
            transactionId,
            sourceType: 'voucher',
            paymentMethod: 'voucher',
            paymentProvider: 'internal_discount',
            sourceReferenceId: options.voucherId ? `voucher-${options.voucherId}` : `voucher-${transactionId}`,
            allocatedAmount: voucher
        });
    }

    const discount = Math.max(0, Math.round((gross - paidAmount - cashback - walletPaid - pointsValue - voucher) * 100) / 100);
    if (discount > 0) {
        allocations.push({
            transactionId,
            sourceType: 'discount',
            paymentMethod: 'discount',
            paymentProvider: 'internal_discount',
            sourceReferenceId: `discount-${transactionId}`,
            allocatedAmount: discount
        });
    }

    return allocations;
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
    const normalizedMethod = normalizePaymentMethod(paymentMethod || transactionOptions.paymentMethod || 'card');
    const normalizedProvider = normalizePaymentProvider(transactionOptions.paymentProvider, normalizedMethod);
    const paidAmount = Number(amount || 0);
    const originalAmount = Number(transactionOptions.originalAmount || amount || 0);
    const cashbackUsed = Number(transactionOptions.cashbackUsed || 0);
    const walletAmountUsed = normalizedMethod === 'wallet' ? paidAmount : Number(transactionOptions.walletAmountUsed || 0);
    const externalPaymentAmount = normalizedMethod === 'wallet' ? 0 : paidAmount;
    const voucherDiscountAmount = Number(transactionOptions.voucherDiscountAmount || transactionOptions.voucherDiscount || 0);
    const loyaltyPointsUsed = Number(transactionOptions.loyaltyPointsUsed || transactionOptions.pointsRedeemed || 0);
    const loyaltyPointsValue = Number(transactionOptions.loyaltyPointsValue || transactionOptions.pointsDiscount || 0);

    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
            return;
        }

        ensurePaymentAllocationSchema((allocationSchemaError) => {
            if (allocationSchemaError) {
                done(allocationSchemaError);
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
                    provider_capture_id,
                    gross_amount,
                    discount_amount,
                    voucher_discount_amount,
                    wallet_amount_used,
                    cashback_amount_used,
                    loyalty_points_used,
                    loyalty_points_value,
                    external_payment_amount,
                    paid_amount,
                    payment_date,
                    provider_transaction_id,
                    provider_order_id,
                    provider_charge_id,
                    provider_metadata_json
                )
                VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
            `;

            connection.query(transactionSql, [
                userId,
                amount,
                normalizedMethod,
                transactionOptions.bookingId || null,
                originalAmount,
                cashbackUsed,
                transactionOptions.currency || 'SGD',
                normalizedProvider || null,
                transactionOptions.providerPaymentId || null,
                transactionOptions.providerSessionId || null,
                transactionOptions.providerCaptureId || null,
                originalAmount,
                voucherDiscountAmount + loyaltyPointsValue,
                voucherDiscountAmount,
                walletAmountUsed,
                cashbackUsed,
                loyaltyPointsUsed,
                loyaltyPointsValue,
                externalPaymentAmount,
                paidAmount,
                transactionOptions.providerTransactionId || transactionOptions.providerPaymentId || null,
                transactionOptions.providerOrderId || transactionOptions.paypalOrderId || null,
                transactionOptions.providerChargeId || null,
                transactionOptions.providerMetadata ? JSON.stringify(transactionOptions.providerMetadata) : null
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

                const transactionId = transactionResult.insertId;
                const allocations = buildPaymentAllocations(transactionId, normalizedMethod, normalizedProvider, paidAmount, {
                    ...transactionOptions,
                    providerPaymentId: transactionOptions.providerPaymentId,
                    providerCaptureId: transactionOptions.providerCaptureId,
                    providerSessionId: transactionOptions.providerSessionId,
                    originalAmount,
                    cashbackUsed,
                    walletAmountUsed,
                    voucherDiscountAmount,
                    loyaltyPointsUsed,
                    loyaltyPointsValue
                });

                const insertAllocations = (callback) => {
                    if (!allocations.length) {
                        callback(null);
                        return;
                    }

                    const sql = `
                        INSERT IGNORE INTO payment_allocations
                            (transaction_id, source_type, payment_method, payment_provider, source_reference_id, allocated_amount)
                        VALUES ?
                    `;
                    const values = allocations.map((allocation) => [
                        allocation.transactionId,
                        allocation.sourceType,
                        allocation.paymentMethod,
                        allocation.paymentProvider,
                        allocation.sourceReferenceId,
                        allocation.allocatedAmount
                    ]);

                    connection.query(sql, [values], callback);
                };

                const commitTransaction = () => insertAllocations((allocationError) => {
                    if (allocationError) {
                        return connection.rollback(() => {
                            connection.release();
                            done(allocationError);
                        });
                    }

                    connection.commit((commitError) => {
                        connection.release();
                        done(commitError, transactionResult);
                    });
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
    });
}

function getPaymentSummary(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        ensurePaymentAllocationSchema((allocationSchemaError) => {
            if (allocationSchemaError) {
                callback(allocationSchemaError);
                return;
            }

            const transactionSql = `
                SELECT
                    t.transaction_id,
                    t.user_id,
                    t.booking_id,
                    t.order_id,
                    t.total_amount,
                    t.original_amount,
                    t.gross_amount,
                    t.discount_amount,
                    t.voucher_discount_amount,
                    t.wallet_amount_used,
                    t.cashback_amount_used,
                    t.loyalty_points_used,
                    t.loyalty_points_value,
                    t.external_payment_amount,
                    t.paid_amount,
                    t.refunded_amount,
                    t.currency,
                    t.payment_status,
                    t.refund_status,
                    t.payment_method,
                    t.payment_provider,
                    t.provider_payment_id,
                    t.provider_session_id,
                    t.provider_capture_id,
                    t.provider_transaction_id,
                    t.provider_order_id,
                    t.provider_charge_id,
                    t.payment_date,
                    t.created_at,
                    t.updated_at,
                    COALESCE(SUM(CASE
                        WHEN pr.refund_status IN ('succeeded', 'refunded', 'manual_required')
                            THEN pr.refund_amount
                        ELSE 0
                    END), 0) AS successful_refunded_amount,
                    MAX(CASE
                        WHEN pr.refund_status IN ('succeeded', 'refunded', 'manual_required')
                            THEN COALESCE(pr.processed_at, pr.updated_at, pr.created_at)
                        ELSE NULL
                    END) AS last_refunded_at,
                    GROUP_CONCAT(DISTINCT CASE
                        WHEN pr.refund_status IN ('succeeded', 'refunded', 'manual_required')
                            THEN pr.provider_refund_id
                        ELSE NULL
                    END SEPARATOR ', ') AS provider_refund_refs
                FROM transactions t
                LEFT JOIN payment_refunds pr ON pr.transaction_id = t.transaction_id
                WHERE t.transaction_id = ?
                GROUP BY
                    t.transaction_id,
                    t.user_id,
                    t.booking_id,
                    t.order_id,
                    t.total_amount,
                    t.original_amount,
                    t.gross_amount,
                    t.discount_amount,
                    t.voucher_discount_amount,
                    t.wallet_amount_used,
                    t.cashback_amount_used,
                    t.loyalty_points_used,
                    t.loyalty_points_value,
                    t.external_payment_amount,
                    t.paid_amount,
                    t.refunded_amount,
                    t.currency,
                    t.payment_status,
                    t.refund_status,
                    t.payment_method,
                    t.payment_provider,
                    t.provider_payment_id,
                    t.provider_session_id,
                    t.provider_capture_id,
                    t.provider_transaction_id,
                    t.provider_order_id,
                    t.provider_charge_id,
                    t.payment_date,
                    t.created_at,
                    t.updated_at
                LIMIT 1
            `;

            db.query(transactionSql, [transactionId], (transactionError, transactionRows = []) => {
                if (transactionError) {
                    callback(transactionError);
                    return;
                }

                const row = transactionRows[0];
                if (!row) {
                    callback(null, null);
                    return;
                }

                const allocationSql = `
                    SELECT
                        source_type,
                        payment_method,
                        payment_provider,
                        source_reference_id,
                        allocated_amount,
                        refunded_amount,
                        remaining_refundable_amount
                    FROM payment_allocations
                    WHERE transaction_id = ?
                    ORDER BY FIELD(source_type, 'wallet', 'cashback', 'loyalty_points', 'voucher', 'discount', 'external'), allocation_id ASC
                `;

                db.query(allocationSql, [transactionId], (allocationError, allocationRows = []) => {
                    if (allocationError) {
                        callback(allocationError);
                        return;
                    }

                    const paidAmount = Number(row.paid_amount || row.total_amount || 0);
                    const storedRefunded = Number(row.refunded_amount || 0);
                    const successfulRefunded = Math.max(Number(row.successful_refunded_amount || 0), storedRefunded);
                    const remainingRefundable = Math.max(paidAmount - successfulRefunded, 0);
                    const paymentMethod = normalizePaymentMethod(row.payment_method || 'card');
                    const paymentProvider = normalizePaymentProvider(row.payment_provider, paymentMethod);
                    const allocations = allocationRows.length
                        ? allocationRows.map((allocation) => ({
                            sourceType: allocation.source_type,
                            paymentMethod: normalizePaymentMethod(allocation.payment_method || paymentMethod),
                            paymentProvider: normalizePaymentProvider(allocation.payment_provider || paymentProvider, allocation.payment_method || paymentMethod),
                            sourceReferenceId: allocation.source_reference_id || '',
                            allocatedAmount: Number(allocation.allocated_amount || 0),
                            refundedAmount: Number(allocation.refunded_amount || 0),
                            remainingRefundableAmount: Number(allocation.remaining_refundable_amount || 0)
                        }))
                        : buildPaymentAllocations(transactionId, paymentMethod, paymentProvider, paidAmount, {
                            originalAmount: Number(row.original_amount || row.gross_amount || paidAmount),
                            cashbackUsed: Number(row.cashback_amount_used || 0),
                            walletAmountUsed: Number(row.wallet_amount_used || 0),
                            voucherDiscountAmount: Number(row.voucher_discount_amount || 0),
                            loyaltyPointsValue: Number(row.loyalty_points_value || 0),
                            loyaltyPointsUsed: Number(row.loyalty_points_used || 0),
                            providerPaymentId: row.provider_payment_id,
                            providerCaptureId: row.provider_capture_id,
                            providerSessionId: row.provider_session_id
                        }).map((allocation) => ({
                            sourceType: allocation.sourceType,
                            paymentMethod: allocation.paymentMethod,
                            paymentProvider: allocation.paymentProvider,
                            sourceReferenceId: allocation.sourceReferenceId,
                            allocatedAmount: allocation.allocatedAmount,
                            refundedAmount: 0,
                            remainingRefundableAmount: allocation.allocatedAmount
                        }));

                    const paymentBreakdown = formatPaymentBreakdown(allocations, {
                        paymentMethod,
                        paymentProvider,
                        amount: paidAmount
                    });
                    const providerReference = row.provider_transaction_id
                        || row.provider_capture_id
                        || row.provider_payment_id
                        || row.provider_session_id
                        || row.provider_order_id
                        || '';

                    callback(null, {
                        transactionId: row.transaction_id,
                        userId: row.user_id,
                        bookingId: row.booking_id,
                        orderId: row.order_id,
                        currency: row.currency || 'SGD',
                        grossAmount: Number(row.gross_amount || row.original_amount || row.total_amount || 0),
                        discountAmount: Number(row.discount_amount || 0),
                        voucherDiscountAmount: Number(row.voucher_discount_amount || 0),
                        walletAmountUsed: Number(row.wallet_amount_used || 0),
                        cashbackAmountUsed: Number(row.cashback_amount_used || 0),
                        loyaltyPointsUsed: Number(row.loyalty_points_used || 0),
                        loyaltyPointsValue: Number(row.loyalty_points_value || 0),
                        externalPaymentAmount: Number(row.external_payment_amount || 0),
                        paidAmount,
                        refundedAmount: successfulRefunded,
                        remainingRefundableAmount: remainingRefundable,
                        remainingPaidAmount: remainingRefundable,
                        paymentStatus: row.payment_status || (successfulRefunded > 0 ? 'partially_refunded' : 'paid'),
                        refundStatus: row.refund_status || (successfulRefunded > 0 ? 'partially_refunded' : 'none'),
                        paymentMethod,
                        paymentProvider,
                        paymentMethodLabel: formatPaymentMethod(paymentMethod, paymentProvider, {
                            cardBrand: row.card_brand,
                            cardLast4: row.card_last4
                        }),
                        paymentBreakdown,
                        providerPaymentId: row.provider_payment_id || '',
                        providerSessionId: row.provider_session_id || '',
                        providerCaptureId: row.provider_capture_id || '',
                        providerTransactionId: providerReference,
                        providerOrderId: row.provider_order_id || '',
                        providerChargeId: row.provider_charge_id || '',
                        providerRefundReference: row.provider_refund_refs || '',
                        paymentDate: row.payment_date || row.created_at,
                        lastRefundedAt: row.last_refunded_at || null,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
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
                transactions.payment_provider,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.provider_refund_id,
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
                paymentProvider: first.payment_provider || '',
                refundStatus: first.refund_status || 'none',
                refundedAmount: Number(first.refunded_amount || 0),
                providerRefundId: first.provider_refund_id || '',
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
                transactions.payment_provider,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.provider_refund_id,
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
                paymentProvider: first.payment_provider || '',
                refundStatus: first.refund_status || 'none',
                refundedAmount: Number(first.refunded_amount || 0),
                providerRefundId: first.provider_refund_id || '',
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
                AND transactions.payment_status IN ('paid', 'partially_refunded', 'refunded')
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
                refunded_amount = LEAST(COALESCE(paid_amount, total_amount), COALESCE(refunded_amount, 0) + ?),
                refund_status = CASE
                    WHEN ? IN ('manual_required', 'manual_refund_required') THEN 'manual_refund_required'
                    WHEN LEAST(COALESCE(paid_amount, total_amount), COALESCE(refunded_amount, 0) + ?) >= COALESCE(paid_amount, total_amount) THEN 'refunded'
                    WHEN LEAST(COALESCE(paid_amount, total_amount), COALESCE(refunded_amount, 0) + ?) > 0 THEN 'partially_refunded'
                    ELSE ?
                END,
                payment_status = CASE
                    WHEN ? IN ('manual_required', 'manual_refund_required') THEN payment_status
                    WHEN LEAST(COALESCE(paid_amount, total_amount), COALESCE(refunded_amount, 0) + ?) >= COALESCE(paid_amount, total_amount) THEN 'refunded'
                    WHEN LEAST(COALESCE(paid_amount, total_amount), COALESCE(refunded_amount, 0) + ?) > 0 THEN 'partially_refunded'
                    ELSE payment_status
                END,
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
            refundedAmount,
            refundStatus,
            refundedAmount,
            refundedAmount,
            refundStatus,
            refundStatus,
            refundedAmount,
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
                    refunded_amount = LEAST(COALESCE(total_amount, 0), COALESCE(refunded_amount, 0) + ?),
                    refund_status = CASE
                        WHEN ? IN ('manual_required', 'manual_refund_required') THEN 'manual_refund_required'
                        WHEN LEAST(COALESCE(total_amount, 0), COALESCE(refunded_amount, 0) + ?) >= COALESCE(total_amount, 0) THEN 'refunded'
                        WHEN LEAST(COALESCE(total_amount, 0), COALESCE(refunded_amount, 0) + ?) > 0 THEN 'partially_refunded'
                        ELSE ?
                    END,
                    payment_status = CASE
                        WHEN ? IN ('manual_required', 'manual_refund_required') THEN payment_status
                        WHEN LEAST(COALESCE(total_amount, 0), COALESCE(refunded_amount, 0) + ?) >= COALESCE(total_amount, 0) THEN 'refunded'
                        WHEN LEAST(COALESCE(total_amount, 0), COALESCE(refunded_amount, 0) + ?) > 0 THEN 'partially_refunded'
                        ELSE payment_status
                    END,
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
                refundedAmount,
                refundStatus,
                refundedAmount,
                refundedAmount,
                refundStatus,
                refundStatus,
                refundedAmount,
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

                const allocationSql = `
                    UPDATE payment_allocations
                    SET refunded_amount = LEAST(allocated_amount, refunded_amount + ?)
                    WHERE transaction_id = ?
                        AND source_type IN ('external', 'wallet', 'cashback')
                        AND refunded_amount < allocated_amount
                    ORDER BY FIELD(source_type, 'external', 'wallet', 'cashback'), allocation_id ASC
                    LIMIT 1
                `;

                executor.query(allocationSql, [refundedAmount, transactionId], (allocationError) => {
                    if (allocationError) {
                        done(allocationError);
                        return;
                    }

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
    getPaymentSummary,
    getPickupVerificationById,
    getPaidSpendByUserId,
    markPickupCollected,
    recordRefund,
    updateDeliveryStatus
};
