const db = require('../db');
const { fromCents, toCents } = require('./refundCalculation');
const {
    calculatePointsRestored,
    calculateRefundFundingAllocation
} = require('./refundAllocation');

const ADJUSTMENT_COLUMNS = {
    refund_request_id: 'refund_request_id INT DEFAULT NULL AFTER reward_discount',
    refund_id: 'refund_id INT DEFAULT NULL AFTER refund_request_id',
    refund_reference: 'refund_reference VARCHAR(80) DEFAULT NULL AFTER refund_id',
    adjustment_type: 'adjustment_type VARCHAR(60) DEFAULT NULL AFTER refund_reference',
    adjustment_status: "adjustment_status VARCHAR(30) NOT NULL DEFAULT 'completed' AFTER adjustment_type",
    idempotency_key: 'idempotency_key VARCHAR(190) DEFAULT NULL AFTER adjustment_status',
    completed_at: 'completed_at DATETIME DEFAULT NULL AFTER idempotency_key'
};

const PAYMENT_REFUND_COLUMNS = {
    external_gross_refund_amount: 'external_gross_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER net_refund_amount',
    external_refund_amount: 'external_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER net_refund_amount',
    wallet_restored_amount: 'wallet_restored_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER external_refund_amount',
    points_restored: 'points_restored INT NOT NULL DEFAULT 0 AFTER wallet_restored_amount',
    points_reversed: 'points_reversed INT NOT NULL DEFAULT 0 AFTER points_restored',
    cashback_restored_amount: 'cashback_restored_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER points_reversed',
    cashback_reversed_amount: 'cashback_reversed_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER cashback_restored_amount',
    membership_progress_adjustment: 'membership_progress_adjustment DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER cashback_reversed_amount',
    merchant_processing_fee_loss: 'merchant_processing_fee_loss DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER membership_progress_adjustment',
    reward_adjustment_status: "reward_adjustment_status VARCHAR(40) NOT NULL DEFAULT 'not_applied' AFTER membership_progress_adjustment"
};

function query(executor, sql, params = []) {
    return new Promise((resolve, reject) => {
        executor.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function validateColumns(tableName, definitions) {
    return new Promise((resolve, reject) => {
        db.query(`SHOW COLUMNS FROM ${tableName}`, (error, columns = []) => {
            if (error) return reject(error);
            const fields = new Set(columns.map((column) => column.Field));
            const missing = Object.entries(definitions)
                .filter(([field]) => !fields.has(field))
                .map(([field]) => field);
            if (missing.length) {
                reject(new Error(`Missing ${tableName} refund columns: ${missing.join(', ')}. Run the refund financial integrity migration.`));
                return;
            }
            resolve();
        });
    });
}

async function ensureRewardAdjustmentSchema() {
    await validateColumns('loyalty_transactions', ADJUSTMENT_COLUMNS);
    await validateColumns('payment_refunds', PAYMENT_REFUND_COLUMNS);

    const requiredIndexes = [
        { tableName: 'loyalty_transactions', indexName: 'uq_loyalty_refund_adjustment' },
        { tableName: 'e_wallet_transactions', indexName: 'uq_wallet_refund_adjustment' }
    ];

    for (const required of requiredIndexes) {
        await new Promise((resolve, reject) => {
            db.query(
                'SHOW INDEX FROM ?? WHERE Key_name = ?',
                [required.tableName, required.indexName],
                (error, rows = []) => {
                    if (error) return reject(error);
                    if (!rows.length) {
                        reject(new Error(`Missing refund idempotency index ${required.indexName}. Run the refund financial integrity migration.`));
                        return;
                    }
                    resolve();
                }
            );
        });
    }
}

function getReceiptKeys(transaction = {}) {
    return [...new Set([
        transaction.orderNumber || transaction.order_number || '',
        String(transaction.transactionId || ''),
        transaction.orderId ? String(transaction.orderId) : ''
    ].filter(Boolean))];
}

function roundProportional(total, cumulativeGross, base, previous, finalRefund = false) {
    const totalCents = toCents(total);
    if (totalCents <= 0 || base <= 0) return 0;
    const required = finalRefund ? totalCents : Math.round((totalCents * toCents(cumulativeGross)) / toCents(base));
    return fromCents(Math.max(required - toCents(previous), 0));
}

function roundProportionalPoints(total, cumulativeGross, base, previous, finalRefund = false) {
    const points = Math.max(Math.floor(Number(total || 0)), 0);
    if (points <= 0 || base <= 0) return 0;
    const required = finalRefund ? points : Math.round((points * toCents(cumulativeGross)) / toCents(base));
    return Math.max(required - Math.floor(Number(previous || 0)), 0);
}

async function getExistingAdjustmentTotals(connection, transaction, refundIdToExclude = null) {
    const keys = getReceiptKeys(transaction);
    const params = [transaction.userId, ...keys];
    let refundClause = '';
    if (refundIdToExclude) {
        refundClause = 'AND (refund_id IS NULL OR refund_id <> ?)';
        params.push(refundIdToExclude);
    }

    const rows = await query(connection, `
        SELECT
            COALESCE(SUM(CASE WHEN adjustment_type = 'points_payment_restored' THEN points_delta ELSE 0 END), 0) AS points_restored,
            COALESCE(SUM(CASE WHEN adjustment_type = 'points_earned_reversed' THEN -points_delta ELSE 0 END), 0) AS points_reversed,
            COALESCE(SUM(CASE WHEN adjustment_type = 'cashback_payment_restored' THEN cashback_delta ELSE 0 END), 0) AS cashback_restored,
            COALESCE(SUM(CASE WHEN adjustment_type = 'cashback_earned_reversed' THEN -cashback_delta ELSE 0 END), 0) AS cashback_reversed
        FROM loyalty_transactions
        WHERE user_id = ?
            AND source_receipt_id IN (${keys.map(() => '?').join(', ')})
            ${refundClause}
    `, params);

    return {
        walletRestored: 0,
        pointsRestored: Number(rows[0]?.points_restored || 0),
        pointsReversed: Number(rows[0]?.points_reversed || 0),
        cashbackRestored: Number(rows[0]?.cashback_restored || 0),
        cashbackReversed: Number(rows[0]?.cashback_reversed || 0)
    };
}

async function getPreviousRefundFinancialTotals(connection, transactionId, refundIdToExclude = null) {
    const params = [transactionId];
    let refundClause = '';
    if (refundIdToExclude) {
        refundClause = 'AND refund_id <> ?';
        params.push(refundIdToExclude);
    }

    const rows = await query(connection, `
        SELECT
            COALESCE(SUM(external_gross_refund_amount), 0) AS external_gross_refunded,
            COALESCE(SUM(wallet_restored_amount), 0) AS wallet_restored,
            COALESCE(SUM(cashback_restored_amount), 0) AS cashback_restored,
            COALESCE(SUM(processing_fee_deduction), 0) AS fee_deductions,
            COALESCE(SUM(merchant_processing_fee_loss), 0) AS merchant_fee_loss
        FROM payment_refunds
        WHERE transaction_id = ?
            AND refund_status IN ('processing', 'succeeded', 'refunded', 'manual_required', 'refund_reconciliation_required')
            ${refundClause}
    `, params);

    return {
        externalGrossRefunded: Number(rows[0]?.external_gross_refunded || 0),
        walletRestored: Number(rows[0]?.wallet_restored || 0),
        cashbackRestored: Number(rows[0]?.cashback_restored || 0),
        feeDeductions: Number(rows[0]?.fee_deductions || 0),
        merchantFeeLoss: Number(rows[0]?.merchant_fee_loss || 0)
    };
}

async function getOriginalRewardEntries(connection, transaction) {
    const keys = getReceiptKeys(transaction);
    const rows = await query(connection, `
        SELECT
            COALESCE(SUM(CASE WHEN points_delta > 0 THEN points_delta ELSE 0 END), 0) AS earned_points,
            COALESCE(SUM(CASE WHEN cashback_delta > 0 THEN cashback_delta ELSE 0 END), 0) AS earned_cashback,
            MAX(booking_reference) AS booking_reference,
            MAX(merchant_name) AS merchant_name
        FROM loyalty_transactions
        WHERE user_id = ?
            AND source_receipt_id IN (${keys.map(() => '?').join(', ')})
            AND transaction_type IN ('EARNED', 'CASHBACK_EARNED', 'PRODUCT_ORDER_REWARD', 'BOOKING_REWARD')
    `, [transaction.userId, ...keys]);

    return {
        earnedPoints: Number(rows[0]?.earned_points || 0),
        earnedCashback: Number(rows[0]?.earned_cashback || 0),
        bookingReference: rows[0]?.booking_reference || '',
        merchantName: rows[0]?.merchant_name || ''
    };
}

function buildRewardEffects(transaction, refund, original, previous) {
    const cumulativeGross = Number(refund.totalRefunded || 0);
    const finalRefund = String(refund.refundStatus || '').toLowerCase() === 'refunded';
    const grossRefund = Number(refund.grossRefundAmount || 0);
    const allocation = calculateRefundFundingAllocation({
        transaction,
        cumulativeGrossRefund: cumulativeGross,
        currentGrossRefund: grossRefund,
        netCustomerRefund: refund.netRefundAmount || refund.amount || 0,
        previousSourceRefunds: {
            wallet: previous.walletRestored,
            cashback: previous.cashbackRestored
        }
    });
    const walletRestored = allocation.walletRestoredAmount;
    const cashbackRestored = allocation.cashbackRestoredAmount;
    const pointsRestored = calculatePointsRestored({
        pointsUsed: transaction.loyaltyPointsUsed || 0,
        pointsValue: transaction.loyaltyPointsValue || 0,
        pointsValueRestored: allocation.pointsRestoredValue,
        previousPointsRestored: previous.pointsRestored
    });
    const paidBase = Math.max(Number(allocation.eligibleBaseAmount || transaction.paidAmount || transaction.totalAmount || 0), 0);
    const pointsReversed = roundProportionalPoints(original.earnedPoints, cumulativeGross, paidBase, previous.pointsReversed, finalRefund);
    const cashbackReversed = roundProportional(original.earnedCashback, cumulativeGross, paidBase, previous.cashbackReversed, finalRefund);
    const externalRefundAmount = allocation.externalRefundAmount;

    return {
        externalRefundAmount,
        externalGrossRefundAmount: allocation.externalGrossRefundAmount,
        walletRestoredAmount: walletRestored,
        pointsRestored,
        pointsReversed,
        cashbackRestoredAmount: cashbackRestored,
        cashbackReversedAmount: cashbackReversed,
        membershipProgressAdjustment: grossRefund,
        netValueReturned: allocation.totalCustomerValueReturned,
        fundingAllocations: allocation.allocations,
        rewardAdjustmentStatus: 'applied'
    };
}

async function insertLoyaltyAdjustment(connection, transaction, refund, original, adjustmentType, pointsDelta, cashbackDelta, description) {
    if (!pointsDelta && !cashbackDelta) return false;
    const sourceReceiptId = transaction.orderNumber || transaction.order_number || String(transaction.transactionId);
    const idempotencyKey = `refund:${refund.refundReference}:${adjustmentType}`;
    const result = await query(connection, `
        INSERT IGNORE INTO loyalty_transactions
            (user_id, order_id, source_receipt_id, transaction_type, points_delta, cashback_delta, description, booking_reference, merchant_name, refund_request_id, refund_id, refund_reference, adjustment_type, adjustment_status, idempotency_key, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, CURRENT_TIMESTAMP)
    `, [
        transaction.userId,
        transaction.orderId || null,
        sourceReceiptId,
        adjustmentType === 'cashback_earned_reversed' ? 'CASHBACK_REVERSED' : 'REFUND_REVERSAL',
        pointsDelta,
        cashbackDelta,
        description,
        original.bookingReference || transaction.orderNumber || sourceReceiptId,
        original.merchantName || '',
        refund.refundRequestId || null,
        refund.refundId || null,
        refund.refundReference,
        adjustmentType,
        idempotencyKey
    ]);
    return Number(result?.affectedRows || 0) > 0;
}

async function creditWalletRestoration(connection, transaction, refund, amount) {
    if (toCents(amount) <= 0) return false;
    const idempotencyKey = `refund:${refund.refundReference}:wallet_restored`;
    const existingRows = await query(connection, 'SELECT transaction_id FROM e_wallet_transactions WHERE payment_attempt_id = ? LIMIT 1 FOR UPDATE', [idempotencyKey]);
    if (existingRows.length) return false;
    const walletRows = await query(connection, 'SELECT * FROM e_wallets WHERE user_id = ? FOR UPDATE', [transaction.userId]);
    if (!walletRows.length) {
        await query(connection, 'INSERT INTO e_wallets (user_id, balance, currency) VALUES (?, 0.00, ?)', [transaction.userId, transaction.currency || 'SGD']);
    }
    const [wallet] = await query(connection, 'SELECT * FROM e_wallets WHERE user_id = ? FOR UPDATE', [transaction.userId]);
    const before = Number(wallet.balance || 0);
    const after = fromCents(toCents(before) + toCents(amount));
    await query(connection, 'UPDATE e_wallets SET balance = ? WHERE wallet_id = ? AND user_id = ?', [after, wallet.wallet_id, transaction.userId]);
    await query(connection, `
        INSERT INTO e_wallet_transactions
            (wallet_id, user_id, transaction_type, payment_method, amount, balance_before, balance_after, status, reference_id, description, payment_attempt_id)
        VALUES (?, ?, 'REFUND', 'EWALLET', ?, ?, ?, 'COMPLETED', ?, ?, ?)
    `, [
        wallet.wallet_id,
        transaction.userId,
        Number(amount || 0),
        before,
        after,
        refund.refundReference,
        `Wallet restored for Refund ${refund.refundReference}`,
        idempotencyKey
    ]);
    return true;
}

async function applyRefundRewardAdjustments({ connection, transaction, refund }) {
    if (!connection) throw new Error('Reward adjustments require an active database transaction.');
    if (!transaction?.transactionId || !refund?.refundReference) {
        return { rewardAdjustmentStatus: 'skipped' };
    }

    if (refund.refundId) {
        const rows = await query(connection, `
            SELECT
                external_refund_amount,
                wallet_restored_amount,
                points_restored,
                points_reversed,
                cashback_restored_amount,
                cashback_reversed_amount,
                membership_progress_adjustment,
                reward_adjustment_status
            FROM payment_refunds
            WHERE refund_id = ?
                AND reward_adjustment_status IN ('applied', 'completed')
            LIMIT 1
        `, [refund.refundId]);

        if (rows[0]) {
            return {
                externalRefundAmount: Number(rows[0].external_refund_amount || 0),
                walletRestoredAmount: Number(rows[0].wallet_restored_amount || 0),
                pointsRestored: Number(rows[0].points_restored || 0),
                pointsReversed: Number(rows[0].points_reversed || 0),
                cashbackRestoredAmount: Number(rows[0].cashback_restored_amount || 0),
                cashbackReversedAmount: Number(rows[0].cashback_reversed_amount || 0),
                membershipProgressAdjustment: Number(rows[0].membership_progress_adjustment || 0),
                rewardAdjustmentStatus: rows[0].reward_adjustment_status || 'applied'
            };
        }
    }

    if (refund.refundId) {
        const transition = await query(connection, `
            UPDATE payment_refunds
            SET reward_adjustment_status = 'applying'
            WHERE refund_id = ?
                AND reward_adjustment_status = 'not_applied'
        `, [refund.refundId]);
        if (Number(transition?.affectedRows || 0) !== 1) {
            const [current] = await query(connection, 'SELECT reward_adjustment_status FROM payment_refunds WHERE refund_id = ? FOR UPDATE', [refund.refundId]);
            throw new Error(`Refund reward adjustments are already ${current?.reward_adjustment_status || 'being processed'}.`);
        }
    }

    const original = await getOriginalRewardEntries(connection, transaction);
    const [previousLedger, previousRefunds] = await Promise.all([
        getExistingAdjustmentTotals(connection, transaction, refund.refundId),
        getPreviousRefundFinancialTotals(connection, transaction.transactionId, refund.refundId)
    ]);
    const previous = {
        ...previousLedger,
        walletRestored: previousRefunds.walletRestored || previousLedger.walletRestored || 0,
        cashbackRestored: Math.max(previousRefunds.cashbackRestored || 0, previousLedger.cashbackRestored || 0)
    };
    const effects = buildRewardEffects(transaction, refund, original, previous);

    const walletInserted = await creditWalletRestoration(connection, transaction, refund, effects.walletRestoredAmount);
    const pointsRestoreInserted = await insertLoyaltyAdjustment(connection, transaction, refund, original, 'points_payment_restored', effects.pointsRestored, 0, `Points restored for Refund ${refund.refundReference}`);
    const pointsReverseInserted = await insertLoyaltyAdjustment(connection, transaction, refund, original, 'points_earned_reversed', -effects.pointsReversed, 0, `Points reversed for Refund ${refund.refundReference}`);
    const cashbackRestoreInserted = await insertLoyaltyAdjustment(connection, transaction, refund, original, 'cashback_payment_restored', 0, effects.cashbackRestoredAmount, `Cashback restored for Refund ${refund.refundReference}`);
    const cashbackReverseInserted = await insertLoyaltyAdjustment(connection, transaction, refund, original, 'cashback_earned_reversed', 0, -effects.cashbackReversedAmount, `Cashback reversed for Refund ${refund.refundReference}`);

    if (pointsRestoreInserted || pointsReverseInserted || cashbackRestoreInserted || cashbackReverseInserted) {
        await query(connection, `
        UPDATE loyalty_wallets
        SET points_balance = points_balance + ? - ?,
            cashback_balance = cashback_balance + ? - ?
        WHERE user_id = ?
        `, [
            pointsRestoreInserted ? effects.pointsRestored : 0,
            pointsReverseInserted ? effects.pointsReversed : 0,
            cashbackRestoreInserted ? effects.cashbackRestoredAmount : 0,
            cashbackReverseInserted ? effects.cashbackReversedAmount : 0,
            transaction.userId
        ]);
    }

    await query(connection, `
        UPDATE payment_refunds
        SET external_gross_refund_amount = ?,
            external_refund_amount = ?,
            wallet_restored_amount = ?,
            points_restored = ?,
            points_reversed = ?,
            cashback_restored_amount = ?,
            cashback_reversed_amount = ?,
            membership_progress_adjustment = ?,
            merchant_processing_fee_loss = COALESCE(merchant_processing_fee_loss, 0),
            reward_adjustment_status = ?
        WHERE refund_id = ?
    `, [
        effects.externalGrossRefundAmount,
        effects.externalRefundAmount,
        walletInserted ? effects.walletRestoredAmount : 0,
        pointsRestoreInserted ? effects.pointsRestored : 0,
        pointsReverseInserted ? effects.pointsReversed : 0,
        cashbackRestoreInserted ? effects.cashbackRestoredAmount : 0,
        cashbackReverseInserted ? effects.cashbackReversedAmount : 0,
        effects.membershipProgressAdjustment,
        effects.rewardAdjustmentStatus,
        refund.refundId
    ]);

    return effects;
}

async function previewRefundRewardEffects({ transaction, calculation }) {
    await ensureRewardAdjustmentSchema();
    const original = await getOriginalRewardEntries(db, transaction);
    const [previousLedger, previousRefunds] = await Promise.all([
        getExistingAdjustmentTotals(db, transaction),
        getPreviousRefundFinancialTotals(db, transaction.transactionId)
    ]);
    const previous = {
        ...previousLedger,
        walletRestored: previousRefunds.walletRestored || previousLedger.walletRestored || 0,
        cashbackRestored: Math.max(previousRefunds.cashbackRestored || 0, previousLedger.cashbackRestored || 0)
    };
    return buildRewardEffects(transaction, {
        amount: calculation.netCustomerRefund,
        netRefundAmount: calculation.netCustomerRefund,
        grossRefundAmount: calculation.approvedGrossRefund,
        totalRefunded: fromCents(toCents(calculation.previousGrossRefunds) + toCents(calculation.approvedGrossRefund)),
        refundStatus: calculation.remainingRefundableAfterRefund <= 0 ? 'refunded' : 'partially_refunded'
    }, original, previous);
}

module.exports = {
    applyRefundRewardAdjustments,
    buildRewardEffects,
    ensureRewardAdjustmentSchema,
    previewRefundRewardEffects
};
