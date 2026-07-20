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
let orderNumberSchemaReady = false;

function formatOrderNumberDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}${month}${day}`;
}

function buildOrderNumber(orderId, date = new Date()) {
    return `ORD-${formatOrderNumberDate(date)}-${String(orderId).padStart(6, '0')}`;
}

function mapOrderRow(row = {}) {
    if (!row || !row.order_id) {
        return null;
    }

    return {
        orderId: Number(row.order_id),
        order_number: row.order_number || '',
        orderNumber: row.order_number || ''
    };
}

function ensureOrderNumberSchema(callback) {
    if (orderNumberSchemaReady) {
        callback(null);
        return;
    }

    db.query('SHOW COLUMNS FROM orders', (columnError, columns = []) => {
        if (columnError) {
            callback(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));

        if (fields.has('order_number')) {
            orderNumberSchemaReady = true;
            callback(null);
            return;
        }

        db.query('ALTER TABLE orders ADD COLUMN order_number VARCHAR(32) DEFAULT NULL', (alterError) => {
            if (!alterError) {
                orderNumberSchemaReady = true;
            }

            callback(alterError);
        });
    });
}

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

        if (!fields.has('fulfilment_type')) {
            alters.push("ADD COLUMN fulfilment_type VARCHAR(20) NOT NULL DEFAULT 'pickup'");
        }

        if (!fields.has('collected_at')) {
            alters.push('ADD COLUMN collected_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('pickup_ready_at')) {
            alters.push('ADD COLUMN pickup_ready_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('pickup_verified_at')) {
            alters.push('ADD COLUMN pickup_verified_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('pickup_verified_by')) {
            alters.push('ADD COLUMN pickup_verified_by INT DEFAULT NULL');
        }

        if (!fields.has('pickup_qr_used')) {
            alters.push('ADD COLUMN pickup_qr_used TINYINT(1) NOT NULL DEFAULT 0');
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
        if (!fields.has('processing_fee_amount')) {
            alters.push('ADD COLUMN processing_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
        }
        if (!fields.has('processing_fee_currency')) {
            alters.push("ADD COLUMN processing_fee_currency VARCHAR(10) NOT NULL DEFAULT 'SGD'");
        }
        if (!fields.has('processing_fee_percentage')) {
            alters.push('ADD COLUMN processing_fee_percentage DECIMAL(7,4) DEFAULT NULL');
        }
        if (!fields.has('processing_fee_fixed_amount')) {
            alters.push('ADD COLUMN processing_fee_fixed_amount DECIMAL(10,2) DEFAULT NULL');
        }
        if (!fields.has('processing_fee_source')) {
            alters.push("ADD COLUMN processing_fee_source VARCHAR(40) NOT NULL DEFAULT 'unknown'");
        }
        if (!fields.has('processing_fee_captured_at')) {
            alters.push('ADD COLUMN processing_fee_captured_at DATETIME DEFAULT NULL');
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

function updateRefundAllocationRows(executor, transactionId, refundOptions, callback) {
    const explicitAllocations = Array.isArray(refundOptions.fundingAllocations)
        ? refundOptions.fundingAllocations.filter((allocation) => Number(allocation.refundAmount || 0) > 0)
        : [];

    if (explicitAllocations.length) {
        let index = 0;
        const next = (error) => {
            if (error || index >= explicitAllocations.length) {
                callback(error || null);
                return;
            }

            const allocation = explicitAllocations[index];
            index += 1;
            const amount = Number(allocation.refundAmount || 0);
            const params = [amount, transactionId];
            let where = 'transaction_id = ?';

            if (allocation.allocationId) {
                where += ' AND allocation_id = ?';
                params.push(allocation.allocationId);
            } else {
                where += ' AND source_type = ?';
                params.push(allocation.sourceType);
                if (allocation.sourceReferenceId) {
                    where += ' AND source_reference_id = ?';
                    params.push(allocation.sourceReferenceId);
                }
            }

            executor.query(`
                UPDATE payment_allocations
                SET refunded_amount = LEAST(allocated_amount, refunded_amount + ?)
                WHERE ${where}
            `, params, (allocationError, result) => {
                if (allocationError) {
                    next(allocationError);
                    return;
                }
                if (result.affectedRows === 0) {
                    next(new Error(`Refund allocation could not be recorded for ${allocation.sourceType || 'source'}.`));
                    return;
                }
                next();
            });
        };

        next();
        return;
    }

    let remaining = Math.round(Number(refundOptions.allocationFallbackAmount || 0) * 100) / 100;
    if (remaining <= 0) {
        callback(null);
        return;
    }

    executor.query(`
        SELECT allocation_id, allocated_amount, refunded_amount
        FROM payment_allocations
        WHERE transaction_id = ?
            AND source_type IN ('external', 'wallet', 'cashback', 'loyalty_points')
            AND refunded_amount < allocated_amount
        ORDER BY FIELD(source_type, 'external', 'wallet', 'cashback', 'loyalty_points'), allocation_id ASC
        FOR UPDATE
    `, [transactionId], (selectError, rows = []) => {
        if (selectError) {
            callback(selectError);
            return;
        }

        let index = 0;
        const next = (error) => {
            if (error || index >= rows.length || remaining <= 0) {
                callback(error || null);
                return;
            }

            const row = rows[index];
            index += 1;
            const capacity = Math.max(Number(row.allocated_amount || 0) - Number(row.refunded_amount || 0), 0);
            const amount = Math.min(capacity, remaining);
            remaining = Math.round((remaining - amount) * 100) / 100;

            executor.query(
                'UPDATE payment_allocations SET refunded_amount = LEAST(allocated_amount, refunded_amount + ?) WHERE allocation_id = ?',
                [amount, row.allocation_id],
                next
            );
        };

        next();
    });
}

function validateRecordRefundSchema(callback) {
    db.query('SHOW COLUMNS FROM transactions', (transactionError, transactionColumns = []) => {
        if (transactionError) {
            callback(transactionError);
            return;
        }

        const transactionFields = new Set(transactionColumns.map((column) => column.Field));
        const requiredTransactionFields = ['refunded_amount', 'refund_status', 'payment_status', 'refunded_at', 'provider_refund_id', 'refund_reason', 'refunded_by'];
        const missingTransactionFields = requiredTransactionFields.filter((field) => !transactionFields.has(field));
        if (missingTransactionFields.length) {
            callback(new Error(`Missing transaction refund columns: ${missingTransactionFields.join(', ')}. Run the refund financial integrity migration or canonical schema.`));
            return;
        }

        db.query('SHOW TABLES LIKE "orders"', (orderTableError, orderTables = []) => {
            if (orderTableError) {
                callback(orderTableError);
                return;
            }

            if (!orderTables.length) {
                callback(null);
                return;
            }

            db.query('SHOW COLUMNS FROM orders', (orderColumnError, orderColumns = []) => {
                if (orderColumnError) {
                    callback(orderColumnError);
                    return;
                }

                const orderFields = new Set(orderColumns.map((column) => column.Field));
                const requiredOrderFields = ['transaction_id', 'refunded_amount', 'refund_status', 'payment_status', 'refunded_at', 'provider_refund_id', 'refund_reason', 'refunded_by'];
                const missingOrderFields = requiredOrderFields.filter((field) => !orderFields.has(field));
                if (missingOrderFields.length) {
                    callback(new Error(`Missing order refund columns: ${missingOrderFields.join(', ')}. Run the refund financial integrity migration or canonical schema.`));
                    return;
                }

                callback(null);
            });
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
    const allowed = [
        'processing',
        'packed',
        'shipped',
        'out_for_delivery',
        'delivered',
        'ready_for_pickup',
        'delivered_to_pickup_location',
        'completed',
        'cancelled'
    ];
    return allowed.includes(value) ? value : 'processing';
}

function isKnownDeliveryStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return [
        'processing',
        'packed',
        'shipped',
        'out_for_delivery',
        'delivered',
        'ready_for_pickup',
        'delivered_to_pickup_location',
        'completed',
        'cancelled'
    ].includes(value);
}

function normalizeFulfilmentType(value) {
    return String(value || '').trim().toLowerCase() === 'delivery' ? 'delivery' : 'pickup';
}

function isPickupReadyStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return value === 'ready_for_pickup' || value === 'delivered_to_pickup_location';
}

function isPickupCollectedStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return ['picked_up', 'collected'].includes(value);
}

function normalizePickupStatus(status, deliveryStatus, fulfilmentType = 'pickup') {
    if (normalizeFulfilmentType(fulfilmentType) === 'delivery') {
        return 'not_applicable';
    }

    const value = String(status || '').trim().toLowerCase();

    if (isPickupCollectedStatus(value) || String(deliveryStatus || '').toLowerCase() === 'completed') {
        return 'picked_up';
    }

    if (isPickupReadyStatus(value)) {
        return value;
    }

    if (isPickupReadyStatus(deliveryStatus)) {
        return String(deliveryStatus || '').trim().toLowerCase();
    }

    if (value === 'cancelled') {
        return 'cancelled';
    }

    return 'pending_pickup';
}

function buildStatusConflict(message) {
    return {
        affectedRows: 0,
        changedRows: 0,
        conflict: true,
        message
    };
}

function canTransitionOrderStatus(row, requestedStatus) {
    const fulfilmentType = normalizeFulfilmentType(row.fulfilment_type);
    const isPickup = fulfilmentType === 'pickup';
    const currentDeliveryStatus = normalizeDeliveryStatus(row.delivery_status || 'processing');
    const currentPickupStatus = normalizePickupStatus(row.pickup_status, currentDeliveryStatus, fulfilmentType);
    const pickupAlreadyCollected = Number(row.pickup_qr_used || 0) === 1
        || Boolean(row.pickup_verified_at)
        || isPickupCollectedStatus(currentPickupStatus)
        || currentDeliveryStatus === 'completed';

    if (isPickup && pickupAlreadyCollected) {
        return buildStatusConflict('Collected pickup orders cannot be moved back to an active status.');
    }

    const deliveryTransitions = {
        processing: new Set(['packed', 'cancelled']),
        packed: new Set(['shipped', 'cancelled']),
        shipped: new Set(['out_for_delivery']),
        out_for_delivery: new Set(['delivered']),
        delivered: new Set([]),
        cancelled: new Set([])
    };
    const pickupTransitions = {
        processing: new Set(['packed', 'cancelled']),
        packed: new Set(['ready_for_pickup', 'delivered_to_pickup_location', 'cancelled']),
        ready_for_pickup: new Set(['delivered_to_pickup_location']),
        delivered_to_pickup_location: new Set([]),
        cancelled: new Set([])
    };

    const allowedStatuses = isPickup ? pickupTransitions : deliveryTransitions;
    const currentStatus = isPickup
        ? (isPickupReadyStatus(currentPickupStatus) ? currentPickupStatus : currentDeliveryStatus)
        : currentDeliveryStatus;

    if (!Object.prototype.hasOwnProperty.call(allowedStatuses, requestedStatus)) {
        return buildStatusConflict(isPickup
            ? 'This status is not valid for pickup orders.'
            : 'This status is not valid for delivery orders.');
    }

    if (requestedStatus === currentStatus) {
        return null;
    }

    if (!allowedStatuses[currentStatus] || !allowedStatuses[currentStatus].has(requestedStatus)) {
        return buildStatusConflict('This order status change is no longer valid from the current order state.');
    }

    return null;
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
    const hasProductItems = (items || []).some((item) => String(item.type || '').trim().toLowerCase() === 'product');
    const fulfilmentType = normalizeFulfilmentType(transactionOptions.fulfilmentType || transactionOptions.fulfilment || (hasProductItems ? 'pickup' : 'pickup'));
    const initialDeliveryStatus = normalizeDeliveryStatus(transactionOptions.deliveryStatus || 'processing');
    const initialPickupStatus = normalizePickupStatus(transactionOptions.pickupStatus, initialDeliveryStatus, fulfilmentType);

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

        const ensureOrderNumber = transactionOptions.createOrder === true
            ? ensureOrderNumberSchema
            : (next) => next(null);

        ensureOrderNumber((orderNumberSchemaError) => {
            if (orderNumberSchemaError) {
                done(orderNumberSchemaError);
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
                    delivery_status,
                    pickup_status,
                    fulfilment_type,
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
                    provider_metadata_json,
                    processing_fee_amount,
                    processing_fee_currency,
                    processing_fee_percentage,
                    processing_fee_fixed_amount,
                    processing_fee_source,
                    processing_fee_captured_at
                )
                VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            connection.query(transactionSql, [
                userId,
                amount,
                normalizedMethod,
                transactionOptions.bookingId || null,
                initialDeliveryStatus,
                initialPickupStatus,
                fulfilmentType,
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
                transactionOptions.providerMetadata ? JSON.stringify(transactionOptions.providerMetadata) : null,
                Number(transactionOptions.processingFeeAmount || 0),
                transactionOptions.processingFeeCurrency || transactionOptions.currency || 'SGD',
                transactionOptions.processingFeePercentage ?? null,
                transactionOptions.processingFeeFixedAmount ?? null,
                transactionOptions.processingFeeSource || 'unknown',
                transactionOptions.processingFeeCapturedAt || (transactionOptions.processingFeeSource ? new Date() : null)
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

                const paymentTransactionId = transactionResult.insertId;
                const allocations = buildPaymentAllocations(paymentTransactionId, normalizedMethod, normalizedProvider, paidAmount, {
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
                        paymentTransactionId,
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
                            [itemResult.insertId, paymentTransactionId],
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
                    [userId, paymentTransactionId, amount],
                    (orderInsertError) => {
                        if (orderInsertError) {
                            return connection.rollback(() => {
                                connection.release();
                                done(orderInsertError);
                            });
                        }

                        connection.query(
                            'SELECT order_id, order_number FROM orders WHERE transaction_id = ? LIMIT 1',
                            [paymentTransactionId],
                            (createdOrderLookupError, createdOrderRows = []) => {
                                if (createdOrderLookupError || !createdOrderRows[0]) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        done(createdOrderLookupError || new Error('Created order could not be loaded.'));
                                    });
                                }

                                const createdOrderRow = createdOrderRows[0];
                                const createdOrderId = Number(createdOrderRow.order_id);
                                const createdOrderNumber = createdOrderRow.order_number || buildOrderNumber(createdOrderId);
                                transactionResult.orderId = createdOrderId;
                                transactionResult.order_number = createdOrderNumber;
                                transactionResult.orderNumber = createdOrderNumber;

                                connection.query(
                                    'UPDATE orders SET order_number = ? WHERE order_id = ?',
                                    [createdOrderNumber, createdOrderId],
                                    (orderNumberError) => {
                                        if (orderNumberError) {
                                            return connection.rollback(() => {
                                                connection.release();
                                                done(orderNumberError);
                                            });
                                        }

                                        connection.query(
                                            'UPDATE transactions SET order_id = ? WHERE transaction_id = ?',
                                            [createdOrderId, paymentTransactionId],
                                            (linkError) => {
                                                if (linkError) {
                                                    return connection.rollback(() => {
                                                        connection.release();
                                                        done(linkError);
                                                    });
                                                }

                                                insertOrderItems(createdOrderId);
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            });
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
                            THEN COALESCE(pr.completed_at, pr.processing_at, pr.updated_at, pr.created_at)
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

        ensureOrderNumberSchema((orderNumberSchemaError) => {
            if (orderNumberSchemaError) {
                callback(orderNumberSchemaError);
                return;
            }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                o.order_id,
                o.order_number,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.payment_provider,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
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
            LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE (transactions.transaction_id = ? OR o.order_number = ?)
                AND transactions.user_id = ?
            ORDER BY order_items.order_item_id ASC
        `;

        db.query(sql, [transactionId, transactionId, userId], (error, rows) => {
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
                orderId: first.order_id || null,
                order_number: first.order_number || '',
                orderNumber: first.order_number || '',
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
                fulfilmentType: normalizeFulfilmentType(first.fulfilment_type),
                pickupStatus: normalizePickupStatus(first.pickup_status, first.delivery_status, first.fulfilment_type),
                pickupReadyAt: first.pickup_ready_at,
                pickupVerifiedAt: first.pickup_verified_at,
                pickupVerifiedBy: first.pickup_verified_by || null,
                pickupQrUsed: Number(first.pickup_qr_used || 0) === 1,
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
    });
}

function getPickupVerificationById(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        ensureOrderNumberSchema((orderNumberSchemaError) => {
            if (orderNumberSchemaError) {
                callback(orderNumberSchemaError);
                return;
            }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                o.order_id,
                o.order_number,
                transactions.user_id,
                transactions.total_amount,
                transactions.payment_status,
                transactions.payment_method,
                transactions.payment_provider,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.provider_refund_id,
                transactions.delivery_status,
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
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
            LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.transaction_id = ? OR o.order_number = ?
            ORDER BY order_items.order_item_id ASC
        `;

        db.query(sql, [transactionId, transactionId], (error, rows = []) => {
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
                receiptId: first.order_number || String(first.id),
                orderId: first.order_id || null,
                order_number: first.order_number || '',
                orderNumber: first.order_number || '',
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
                fulfilmentType: normalizeFulfilmentType(first.fulfilment_type),
                pickupStatus: normalizePickupStatus(first.pickup_status, first.delivery_status, first.fulfilment_type),
                pickupReadyAt: first.pickup_ready_at,
                pickupVerifiedAt: first.pickup_verified_at,
                pickupVerifiedBy: first.pickup_verified_by || null,
                pickupQrUsed: Number(first.pickup_qr_used || 0) === 1,
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

            ensureOrderNumberSchema((orderNumberSchemaError) => {
                if (orderNumberSchemaError) {
                    callback(orderNumberSchemaError);
                    return;
                }

            const sql = `
                SELECT
                    transactions.transaction_id,
                    o.order_id,
                    o.order_number,
                    transactions.user_id,
                    transactions.total_amount,
                    transactions.payment_method,
                    transactions.payment_status,
                    transactions.delivery_status,
                    transactions.fulfilment_type,
                    transactions.pickup_status,
                    transactions.pickup_ready_at,
                    transactions.pickup_verified_at,
                    transactions.pickup_verified_by,
                    transactions.pickup_qr_used,
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
                LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
                WHERE salons.merchant_id = ?
                    AND transactions.payment_status = 'paid'
                GROUP BY
                    transactions.transaction_id,
                    o.order_id,
                    o.order_number,
                    transactions.user_id,
                    transactions.total_amount,
                    transactions.payment_method,
                    transactions.payment_status,
                    transactions.delivery_status,
                    transactions.fulfilment_type,
                    transactions.pickup_status,
                    transactions.pickup_ready_at,
                    transactions.pickup_verified_at,
                    transactions.pickup_verified_by,
                    transactions.pickup_qr_used,
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
                        orderId: row.order_id || null,
                        order_number: row.order_number || '',
                        orderNumber: row.order_number || '',
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
                        fulfilmentType: normalizeFulfilmentType(row.fulfilment_type),
                        pickupStatus: normalizePickupStatus(row.pickup_status, row.delivery_status, row.fulfilment_type),
                        pickupReadyAt: row.pickup_ready_at,
                        pickupVerifiedAt: row.pickup_verified_at,
                        pickupVerifiedBy: row.pickup_verified_by || null,
                        pickupQrUsed: Number(row.pickup_qr_used || 0) === 1,
                        itemCount: Number(row.item_count || 0),
                        createdAt: row.created_at
                    };
                }));
            });
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

        ensureOrderNumberSchema((orderNumberSchemaError) => {
            if (orderNumberSchemaError) {
                callback(orderNumberSchemaError);
                return;
            }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                o.order_id,
                o.order_number,
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
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
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
            LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.user_id = ?
                AND transactions.payment_status IN ('paid', 'partially_refunded', 'refunded')
            GROUP BY
                transactions.transaction_id,
                o.order_id,
                o.order_number,
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
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
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
                receiptId: row.order_number || String(row.id),
                orderId: row.order_id || null,
                order_number: row.order_number || '',
                orderNumber: row.order_number || '',
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
                fulfilmentType: normalizeFulfilmentType(row.fulfilment_type),
                pickupStatus: normalizePickupStatus(row.pickup_status, row.delivery_status, row.fulfilment_type),
                pickupReadyAt: row.pickup_ready_at,
                pickupVerifiedAt: row.pickup_verified_at,
                pickupVerifiedBy: row.pickup_verified_by || null,
                pickupQrUsed: Number(row.pickup_qr_used || 0) === 1,
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                refundReason: row.refund_reason || '',
                refundedBy: row.refunded_by || null,
                createdAt: row.created_at
            })));
        });
        });
    });
}

function getOrderById(transactionId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        ensureOrderNumberSchema((orderNumberSchemaError) => {
            if (orderNumberSchemaError) {
                callback(orderNumberSchemaError);
                return;
            }

        const sql = `
            SELECT
                transactions.transaction_id AS id,
                o.order_id,
                o.order_number,
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
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
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
            LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
            INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
            INNER JOIN products ON products.product_id = order_items.product_id
            LEFT JOIN salons ON salons.salon_id = products.salon_id
            WHERE transactions.transaction_id = ? OR o.order_number = ?
            GROUP BY
                transactions.transaction_id,
                o.order_id,
                o.order_number,
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
                transactions.fulfilment_type,
                transactions.pickup_status,
                transactions.pickup_ready_at,
                transactions.pickup_verified_at,
                transactions.pickup_verified_by,
                transactions.pickup_qr_used,
                transactions.refund_status,
                transactions.refunded_amount,
                transactions.refund_reason,
                transactions.refunded_by,
                transactions.created_at,
                users.name,
                users.email
            LIMIT 1
        `;

        db.query(sql, [transactionId, transactionId], (error, rows = []) => {
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
                receiptId: row.order_number || String(row.id),
                orderId: row.order_id || null,
                order_number: row.order_number || '',
                orderNumber: row.order_number || '',
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
                fulfilmentType: normalizeFulfilmentType(row.fulfilment_type),
                pickupStatus: normalizePickupStatus(row.pickup_status, row.delivery_status, row.fulfilment_type),
                pickupReadyAt: row.pickup_ready_at,
                pickupVerifiedAt: row.pickup_verified_at,
                pickupVerifiedBy: row.pickup_verified_by || null,
                pickupQrUsed: Number(row.pickup_qr_used || 0) === 1,
                refundStatus: row.refund_status || 'none',
                refundedAmount: Number(row.refunded_amount || 0),
                refundReason: row.refund_reason || '',
                refundedBy: row.refunded_by || null,
                createdAt: row.created_at
            });
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

        callback(null, orders.find((order) => {
            return String(order.id) === String(transactionId)
                || String(order.orderNumber || order.order_number || '') === String(transactionId)
                || String(order.receiptId || '') === String(transactionId);
        }) || null);
    });
}

function updateDeliveryStatus(transactionId, status, options = {}, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        if (!isKnownDeliveryStatus(status)) {
            callback(null, buildStatusConflict('Please choose a valid order status.'));
            return;
        }

        const requestedStatus = normalizeDeliveryStatus(status);

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

                const rollback = (error, result) => connection.rollback(() => {
                    connection.release();
                    callback(error, result);
                });
                const params = [transactionId];
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

                const lookupSql = `
                    SELECT
                        transaction_id,
                        fulfilment_type,
                        delivery_status,
                        pickup_status,
                        pickup_verified_at,
                        pickup_qr_used
                    FROM transactions
                    WHERE transaction_id = ?
                    ${ownershipClause}
                    LIMIT 1
                    FOR UPDATE
                `;

                connection.query(lookupSql, params, (lookupError, rows = []) => {
                    if (lookupError) {
                        rollback(lookupError);
                        return;
                    }

                    const row = rows[0];

                    if (!row) {
                        rollback(null, { affectedRows: 0, changedRows: 0 });
                        return;
                    }

                    const transitionConflict = canTransitionOrderStatus(row, requestedStatus);

                    if (transitionConflict) {
                        rollback(null, transitionConflict);
                        return;
                    }

                    const fulfilmentType = normalizeFulfilmentType(row.fulfilment_type);
                    const isPickup = fulfilmentType === 'pickup';
                    const updateFields = [];
                    const updateValues = [];

                    updateFields.push('delivery_status = ?');
                    updateValues.push(requestedStatus);

                    if (requestedStatus === 'shipped' || requestedStatus === 'out_for_delivery') {
                        updateFields.push('shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP)');
                    }

                    if (requestedStatus === 'delivered') {
                        updateFields.push('delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)');
                    }

                    if (isPickup) {
                        const pickupStatus = requestedStatus === 'ready_for_pickup' || requestedStatus === 'delivered_to_pickup_location'
                            ? requestedStatus
                            : requestedStatus === 'cancelled'
                                ? 'cancelled'
                                : 'pending_pickup';

                        updateFields.push('pickup_status = ?');
                        updateValues.push(pickupStatus);

                        if (isPickupReadyStatus(pickupStatus)) {
                            updateFields.push('pickup_ready_at = COALESCE(pickup_ready_at, CURRENT_TIMESTAMP)');
                        }
                    }

                    const updateSql = `
                        UPDATE transactions
                        SET ${updateFields.join(', ')}
                        WHERE transaction_id = ?
                    `;

                    connection.query(updateSql, [...updateValues, transactionId], (updateError, updateResult) => {
                        if (updateError || !updateResult?.affectedRows) {
                            rollback(updateError, updateResult);
                            return;
                        }

                        const historyFields = ['delivery_status = ?'];
                        const historyValues = [requestedStatus];

                        if (isPickup) {
                            const historyPickupStatus = requestedStatus === 'ready_for_pickup' || requestedStatus === 'delivered_to_pickup_location'
                                ? requestedStatus
                                : requestedStatus === 'cancelled'
                                    ? 'cancelled'
                                    : 'pending_pickup';

                            historyFields.push('pickup_status = ?');
                            historyValues.push(historyPickupStatus);
                        }

                        const historySql = `
                            UPDATE purchase_history ph
                            INNER JOIN orders o
                                ON ph.receipt_id = o.order_number
                            SET ${historyFields.map((field) => `ph.${field}`).join(', ')}
                            WHERE o.transaction_id = ?
                                AND ph.purchase_type = 'product'
                        `;

                        connection.query(historySql, [...historyValues, transactionId], (historyError) => {
                            if (historyError) {
                                rollback(historyError);
                                return;
                            }

                            connection.commit((commitError) => {
                                if (commitError) {
                                    rollback(commitError);
                                    return;
                                }

                                connection.release();
                                callback(null, updateResult);
                            });
                        });
                    });
                });
            });
        });
    });
}

function verifyPickupByQr(transactionId, customerUserId, callback) {
    ensureFulfilmentSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
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

                const lockSql = `
                    SELECT
                        transactions.transaction_id,
                        o.order_number,
                        transactions.user_id,
                        transactions.payment_status,
                        transactions.delivery_status,
                        transactions.pickup_status,
                        transactions.fulfilment_type,
                        transactions.pickup_ready_at,
                        transactions.pickup_verified_at,
                        transactions.pickup_verified_by,
                        transactions.pickup_qr_used,
                        transactions.collected_at
                    FROM transactions
                    LEFT JOIN orders o ON o.transaction_id = transactions.transaction_id
                    WHERE transactions.transaction_id = ? OR o.order_number = ?
                    FOR UPDATE
                `;

                connection.query(lockSql, [transactionId, transactionId], (lookupError, rows = []) => {
                    if (lookupError) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(lookupError);
                        });
                    }

                    const order = rows[0];

                    if (!order) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { ok: false, code: 'not_found' });
                        });
                    }

                    if (normalizeFulfilmentType(order.fulfilment_type) !== 'pickup') {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { ok: false, code: 'not_pickup' });
                        });
                    }

                    if (String(order.payment_status || '').toLowerCase() !== 'paid') {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { ok: false, code: 'not_paid' });
                        });
                    }

                    const alreadyVerified = Number(order.pickup_qr_used || 0) === 1
                        || Boolean(order.pickup_verified_at)
                        || isPickupCollectedStatus(order.pickup_status);

                    if (alreadyVerified) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, {
                                ok: false,
                                code: 'already_verified',
                                pickupVerifiedAt: order.pickup_verified_at || order.collected_at || null,
                                pickupVerifiedBy: order.pickup_verified_by || null
                            });
                        });
                    }

                    const readyByPickupStatus = isPickupReadyStatus(order.pickup_status);
                    const readyByDeliveryStatus = isPickupReadyStatus(order.delivery_status);

                    if (!readyByPickupStatus && !readyByDeliveryStatus) {
                        return connection.rollback(() => {
                            connection.release();
                            callback(null, { ok: false, code: 'not_ready' });
                        });
                    }

                    const updateTransactionSql = `
                        UPDATE transactions
                        SET
                            pickup_status = 'picked_up',
                            delivery_status = 'completed',
                            pickup_qr_used = 1,
                            pickup_verified_at = COALESCE(pickup_verified_at, CURRENT_TIMESTAMP),
                            pickup_verified_by = COALESCE(pickup_verified_by, ?),
                            collected_at = COALESCE(collected_at, CURRENT_TIMESTAMP),
                            delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
                        WHERE transaction_id = ?
                            AND COALESCE(pickup_qr_used, 0) = 0
                            AND COALESCE(pickup_status, 'pending_pickup') NOT IN ('picked_up', 'collected')
                    `;

                    connection.query(updateTransactionSql, [customerUserId, order.transaction_id], (updateError, updateResult) => {
                        if (updateError) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(updateError);
                            });
                        }

                        if (!updateResult?.affectedRows) {
                            return connection.rollback(() => {
                                connection.release();
                                callback(null, { ok: false, code: 'already_verified' });
                            });
                        }

                        const receiptId = order.order_number || String(order.transaction_id);
                        const updateHistorySql = `
                            UPDATE purchase_history ph
                            INNER JOIN orders o
                                ON ph.receipt_id = o.order_number
                            SET
                                ph.pickup_status = 'picked_up',
                                ph.pickup_at = COALESCE(ph.pickup_at, CURRENT_TIMESTAMP),
                                ph.delivery_status = 'completed'
                            WHERE o.transaction_id = ?
                                AND ph.purchase_type = 'product'
                        `;

                        connection.query(updateHistorySql, [order.transaction_id], (historyError) => {
                            if (historyError) {
                                return connection.rollback(() => {
                                    connection.release();
                                    callback(historyError);
                                });
                            }

                            connection.commit((commitError) => {
                                if (commitError) {
                                    return connection.rollback(() => {
                                        connection.release();
                                        callback(commitError);
                                    });
                                }

                                connection.release();
                                callback(null, {
                                    ok: true,
                                    code: 'verified',
                                    receiptId,
                                    transactionId
                                });
                            });
                        });
                    });
                });
            });
        });
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

    validateRecordRefundSchema((schemaError) => {
        if (schemaError) {
            done(schemaError);
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
                    WHEN ? = 1 AND ? IN ('refunded', 'manual_required') THEN 'cancelled'
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
            cancelFulfilment: refundOptions.cancelFulfilment ? 1 : 0,
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
            refundOptions.cancelFulfilment ? 1 : 0,
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
                        WHEN ? = 1 AND ? = 'refunded' THEN 'cancelled_refunded'
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
                refundOptions.cancelFulfilment ? 1 : 0,
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

                updateRefundAllocationRows(executor, transactionId, {
                    ...refundOptions,
                    allocationFallbackAmount: refundedAmount
                }, (allocationError) => {
                    if (allocationError) {
                        done(allocationError);
                        return;
                    }

                    if (refundOptions.skipLoyaltyReverse) {
                        done(null, result);
                        return;
                    }

                    getOrderRowByTransactionId(transactionId, (orderLookupError, orderRow) => {
                        if (orderLookupError) {
                            done(orderLookupError);
                            return;
                        }

                        Loyalty.reverseCampaignCashbackForReceipt(orderRow?.orderNumber || orderRow?.order_number || String(transactionId), (reverseError) => {
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
                original_amount,
                gross_amount,
                discount_amount,
                voucher_discount_amount,
                wallet_amount_used,
                cashback_amount_used,
                loyalty_points_used,
                loyalty_points_value,
                external_payment_amount,
                paid_amount,
                provider_transaction_id,
                provider_order_id,
                provider_charge_id,
                provider_metadata_json,
                processing_fee_amount,
                processing_fee_currency,
                processing_fee_percentage,
                processing_fee_fixed_amount,
                processing_fee_source,
                processing_fee_captured_at,
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
                    originalAmount: Number(row.original_amount || row.total_amount || 0),
                    grossAmount: Number(row.gross_amount || row.original_amount || row.total_amount || 0),
                    discountAmount: Number(row.discount_amount || 0),
                    voucherDiscountAmount: Number(row.voucher_discount_amount || 0),
                    walletAmountUsed: Number(row.wallet_amount_used || 0),
                    cashbackAmountUsed: Number(row.cashback_amount_used || 0),
                    loyaltyPointsUsed: Number(row.loyalty_points_used || 0),
                    loyaltyPointsValue: Number(row.loyalty_points_value || 0),
                    externalPaymentAmount: Number(row.external_payment_amount || 0),
                    paidAmount: Number(row.paid_amount || row.total_amount || 0),
                    providerTransactionId: row.provider_transaction_id || '',
                    providerOrderId: row.provider_order_id || '',
                    providerChargeId: row.provider_charge_id || '',
                    providerMetadata: row.provider_metadata_json || '',
                    processingFeeAmount: Number(row.processing_fee_amount || 0),
                    processingFeeCurrency: row.processing_fee_currency || row.currency || 'SGD',
                    processingFeePercentage: row.processing_fee_percentage == null ? null : Number(row.processing_fee_percentage),
                    processingFeeFixedAmount: row.processing_fee_fixed_amount == null ? null : Number(row.processing_fee_fixed_amount),
                    processingFeeSource: row.processing_fee_source || 'unknown',
                    processingFeeCapturedAt: row.processing_fee_captured_at,
                    createdAt: row.created_at
                });
            }
        );
    });
}

function getOrderRowByTransactionId(paymentTransactionId, callback) {
    if (!paymentTransactionId) {
        callback(null, null);
        return;
    }

    ensureOrderNumberSchema((orderNumberSchemaError) => {
        if (orderNumberSchemaError) {
            callback(orderNumberSchemaError);
            return;
        }

        db.query(
            'SELECT order_id, order_number FROM orders WHERE transaction_id = ? LIMIT 1',
            [paymentTransactionId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, mapOrderRow(rows[0]));
            }
        );
    });
}

module.exports = {
    createPaidTransaction,
    getById,
    getOrderRowByTransactionId,
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
    updateDeliveryStatus,
    verifyPickupByQr
};
