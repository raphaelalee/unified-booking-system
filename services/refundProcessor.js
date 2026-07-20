const { promisify } = require('util');
const db = require('../db');
const PaymentRefund = require('../models/PaymentRefund');
const Transaction = require('../models/Transaction');
const stripe = require('./stripe');
const paypal = require('./paypal');
const { calculateRefund } = require('./refundCalculation');
const { getEligibleBaseCents } = require('./refundAllocation');
const {
    applyRefundRewardAdjustments,
    ensureRewardAdjustmentSchema,
    previewRefundRewardEffects
} = require('./refundRewardAdjustments');

const getTransactionById = promisify(Transaction.getById);
const recordTransactionRefund = promisify(Transaction.recordRefund);
const createRefundRecord = promisify(PaymentRefund.create);
const findRefundByIdempotencyKey = promisify(PaymentRefund.findByIdempotencyKey);
const updateRefundProviderResult = promisify(PaymentRefund.updateProviderResult);
const countCompletedRefunds = promisify(PaymentRefund.countCompletedForTransaction);
const getCompletedRefundTotals = promisify(PaymentRefund.getCompletedTotalsForTransaction);

function query(executor, sql, params = []) {
    return new Promise((resolve, reject) => {
        executor.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

function getConnection() {
    return new Promise((resolve, reject) => {
        db.getConnection((error, connection) => {
            if (error) reject(error);
            else resolve(connection);
        });
    });
}

function beginTransaction(connection) {
    return new Promise((resolve, reject) => {
        connection.beginTransaction((error) => error ? reject(error) : resolve());
    });
}

function commit(connection) {
    return new Promise((resolve, reject) => {
        connection.commit((error) => error ? reject(error) : resolve());
    });
}

function rollback(connection) {
    return new Promise((resolve) => {
        connection.rollback(() => resolve());
    });
}

function normalizeProvider(value) {
    return String(value || '').trim().toLowerCase();
}

function mapLockedTransaction(row = {}, allocationRows = []) {
    const paymentAllocations = allocationRows.map((allocation) => ({
        allocationId: allocation.allocation_id,
        sourceType: allocation.source_type,
        paymentMethod: allocation.payment_method,
        paymentProvider: allocation.payment_provider,
        sourceReferenceId: allocation.source_reference_id || '',
        allocatedAmount: Number(allocation.allocated_amount || 0),
        refundedAmount: Number(allocation.refunded_amount || 0),
        remainingRefundableAmount: Number(allocation.remaining_refundable_amount || 0)
    }));

    return {
        transactionId: row.transaction_id,
        userId: row.user_id,
        bookingId: row.booking_id,
        orderId: row.order_id,
        totalAmount: Number(row.total_amount || 0),
        originalAmount: Number(row.original_amount || row.gross_amount || row.total_amount || 0),
        grossAmount: Number(row.gross_amount || row.original_amount || row.total_amount || 0),
        discountAmount: Number(row.discount_amount || 0),
        voucherDiscountAmount: Number(row.voucher_discount_amount || 0),
        walletAmountUsed: Number(row.wallet_amount_used || 0),
        cashbackAmountUsed: Number(row.cashback_amount_used || 0),
        loyaltyPointsUsed: Number(row.loyalty_points_used || 0),
        loyaltyPointsValue: Number(row.loyalty_points_value || 0),
        externalPaymentAmount: Number(row.external_payment_amount || 0),
        paidAmount: Number(row.paid_amount || row.total_amount || 0),
        refundedAmount: Number(row.refunded_amount || 0),
        currency: row.currency || 'SGD',
        paymentStatus: row.payment_status,
        refundStatus: row.refund_status,
        paymentMethod: row.payment_method,
        paymentProvider: row.payment_provider,
        providerPaymentId: row.provider_payment_id,
        providerSessionId: row.provider_session_id,
        providerCaptureId: row.provider_capture_id,
        providerTransactionId: row.provider_transaction_id,
        providerOrderId: row.provider_order_id,
        providerChargeId: row.provider_charge_id,
        processingFeeAmount: Number(row.processing_fee_amount || 0),
        processingFeeSource: row.processing_fee_source || 'unknown',
        paymentAllocations
    };
}

async function lockTransactionForRefund(connection, transactionId) {
    const rows = await query(connection, 'SELECT * FROM transactions WHERE transaction_id = ? FOR UPDATE', [transactionId]);
    if (!rows.length) return null;

    const allocations = await query(connection, `
        SELECT *
        FROM payment_allocations
        WHERE transaction_id = ?
        ORDER BY FIELD(source_type, 'external', 'wallet', 'cashback', 'loyalty_points', 'voucher', 'discount'), allocation_id ASC
        FOR UPDATE
    `, [transactionId]);

    return mapLockedTransaction(rows[0], allocations);
}

async function lockRefundTotals(connection, transactionId) {
    const rows = await query(connection, `
        SELECT *
        FROM payment_refunds
        WHERE transaction_id = ?
            AND refund_status IN ('processing', 'succeeded', 'refunded', 'manual_required', 'refund_reconciliation_required')
        FOR UPDATE
    `, [transactionId]);

    return rows.reduce((totals, row) => ({
        grossRefundedTotal: totals.grossRefundedTotal + Number(row.gross_refund_amount || 0),
        externalGrossRefundedTotal: totals.externalGrossRefundedTotal + Number(row.external_gross_refund_amount || 0),
        feeDeductionTotal: totals.feeDeductionTotal + Number(row.processing_fee_deduction || 0),
        netRefundedTotal: totals.netRefundedTotal + Number(row.net_refund_amount || 0),
        walletRestoredTotal: totals.walletRestoredTotal + Number(row.wallet_restored_amount || 0),
        cashbackRestoredTotal: totals.cashbackRestoredTotal + Number(row.cashback_restored_amount || 0),
        merchantFeeLossTotal: totals.merchantFeeLossTotal + Number(row.merchant_processing_fee_loss || 0)
    }), {
        grossRefundedTotal: 0,
        externalGrossRefundedTotal: 0,
        feeDeductionTotal: 0,
        netRefundedTotal: 0,
        walletRestoredTotal: 0,
        cashbackRestoredTotal: 0,
        merchantFeeLossTotal: 0
    });
}

function getProviderRefundId(provider, response = {}) {
    if (provider === 'stripe') {
        return response.id || '';
    }

    if (provider === 'paypal') {
        return response.id || '';
    }

    return '';
}

async function callProviderRefund(transaction, amount, reason, idempotencyKey) {
    const provider = normalizeProvider(transaction.paymentProvider);

    if (provider === 'stripe') {
        const paymentIntentId = transaction.providerPaymentId;
        if (!paymentIntentId) {
            throw new Error('Stripe payment intent is missing, so this refund cannot be issued automatically.');
        }

        return {
            status: 'succeeded',
            provider,
            response: await stripe.refundPaymentIntent({ paymentIntentId, amount, idempotencyKey }),
            manualRequired: false
        };
    }

    if (provider === 'paypal') {
        const captureId = transaction.providerCaptureId || transaction.providerPaymentId;
        if (!captureId) {
            throw new Error('PayPal capture ID is missing, so this refund cannot be issued automatically.');
        }

        return {
            status: 'succeeded',
            provider,
            response: await paypal.refundCapture(captureId, {
                amount,
                currencyCode: transaction.currency || 'SGD',
                reason,
                idempotencyKey
            }),
            manualRequired: false
        };
    }

    return {
        status: 'manual_required',
        provider,
        response: {
            message: `Automatic refunds are not implemented for ${provider || 'this payment method'}. Process the refund in the provider/admin portal, then reconcile this record.`
        },
        manualRequired: true
    };
}

function isUncertainProviderError(error = {}) {
    const code = String(error.code || error.type || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();

    return [
        'timeout',
        'timedout',
        'etimedout',
        'econnreset',
        'econnaborted',
        'enotfound',
        'socket hang up',
        'network',
        'temporarily unavailable'
    ].some((token) => code.includes(token) || message.includes(token));
}

async function refundTransaction(transactionId, {
    amount,
    reason,
    reasonCategory = 'other',
    approvedPercentage = 100,
    refundRequestId = null,
    merchantDecision = 'approved',
    merchantDecisionReason = '',
    acknowledgementAccepted = false,
    feeAcknowledgedAt = null,
    feeAcknowledgementVersion = null,
    lateFeeAmount = 0,
    refundedBy,
    merchantId = null,
    bookingId = null,
    orderId = null
} = {}) {
    console.log('[refund:start]', {
        transactionId,
        amount,
        reason,
        refundedBy,
        merchantId,
        bookingId,
        orderId
    });

    await ensureRewardAdjustmentSchema();
    await promisify(PaymentRefund.ensureSchema)();

    let transaction;
    let calculation;
    let refundAmount;
    let refundReference;
    let idempotencyKey;
    let refundId;

    const reservationConnection = await getConnection();

    try {
        await beginTransaction(reservationConnection);
        transaction = await lockTransactionForRefund(reservationConnection, transactionId);

        if (!transaction) {
            throw new Error('The original payment transaction could not be found.');
        }

        if (!['paid', 'partially_refunded'].includes(String(transaction.paymentStatus || '').toLowerCase())) {
            throw new Error('Only paid transactions can be refunded.');
        }

        console.log('[refund:transaction]', {
            transactionId: transaction.transactionId,
            userId: transaction.userId,
            totalAmount: transaction.totalAmount,
            paymentMethod: transaction.paymentMethod,
            paymentProvider: transaction.paymentProvider,
            providerPaymentId: transaction.providerPaymentId,
            providerSessionId: transaction.providerSessionId,
            providerCaptureId: transaction.providerCaptureId,
            refundStatus: transaction.refundStatus,
            refundedAmount: transaction.refundedAmount
        });

        const requestedGrossAmount = Math.round(Number(amount || 0) * 100) / 100;
        if (!Number.isFinite(requestedGrossAmount) || requestedGrossAmount <= 0) {
            throw new Error('Refund amount must be greater than zero.');
        }

        const refundTotals = await lockRefundTotals(reservationConnection, transaction.transactionId);
        const eligiblePaidAmount = Math.round(getEligibleBaseCents(transaction) / 100 * 100) / 100;
        const refundableAmount = Math.round((Number(eligiblePaidAmount || transaction.paidAmount || transaction.totalAmount || 0) - Number(refundTotals.grossRefundedTotal || 0)) * 100) / 100;
        const previousRefundedByAllocationId = Object.fromEntries((transaction.paymentAllocations || []).map((allocation) => [
            allocation.allocationId,
            allocation.refundedAmount
        ]));
        calculation = calculateRefund({
            transaction,
            requestedGrossRefund: requestedGrossAmount,
            previousGrossRefunds: refundTotals.grossRefundedTotal || 0,
            previousFeeDeductions: refundTotals.feeDeductionTotal || 0,
            previousMerchantFeeLoss: refundTotals.merchantFeeLossTotal || 0,
            previousExternalGrossRefunds: refundTotals.externalGrossRefundedTotal || 0,
            previousSourceRefunds: {
                wallet: refundTotals.walletRestoredTotal || 0,
                cashback: refundTotals.cashbackRestoredTotal || 0
            },
            previousRefundedByAllocationId,
            approvedPercentage,
            reasonCategory,
            acknowledgementAccepted,
            lateFeeAmount
        });
        refundAmount = calculation.externalRefundAmount;

        console.log('[refund:amounts]', {
            transactionId: transaction.transactionId,
            requestedGrossAmount,
            externalRefundAmount: refundAmount,
            netCustomerRefund: calculation.netCustomerRefund,
            walletRestoredAmount: calculation.walletRestoredAmount,
            pointsRestoredValue: calculation.pointsRestoredValue,
            cashbackRestoredAmount: calculation.cashbackRestoredAmount,
            processingFeeDeduction: calculation.processingFeeDeduction,
            refundableAmount
        });

        if (calculation.approvedGrossRefund > refundableAmount) {
            throw new Error(`Refund amount exceeds the remaining refundable amount of $${refundableAmount.toFixed(2)}.`);
        }

        if (String(transaction.refundStatus || '').toLowerCase() === 'refunded' && refundableAmount <= 0) {
            throw new Error('This transaction has already been fully refunded.');
        }

        if (refundAmount <= 0
            && Number(calculation.walletRestoredAmount || 0) <= 0
            && Number(calculation.cashbackRestoredAmount || 0) <= 0
            && Number(calculation.pointsRestoredValue || 0) <= 0) {
            throw new Error('Calculated customer refund and internal restorations are zero.');
        }

        refundReference = `RF-${transaction.transactionId}-${Date.now()}`;
        idempotencyKey = `refund:${refundRequestId || 'direct'}:${transaction.transactionId}:${calculation.approvedGrossRefund.toFixed(2)}`;
        const now = new Date();
        const existingRows = await query(reservationConnection, 'SELECT refund_id, refund_status FROM payment_refunds WHERE idempotency_key = ? LIMIT 1 FOR UPDATE', [idempotencyKey]);

        if (existingRows[0]) {
            throw new Error(`A refund with the same idempotency key is already ${existingRows[0].refund_status || 'recorded'}. Reload before retrying.`);
        }

        const reservedRefund = await createRefundRecord({
            connection: reservationConnection,
            transactionId: transaction.transactionId,
            bookingId: bookingId || transaction.bookingId || null,
            orderId: orderId || transaction.orderId || null,
            userId: transaction.userId,
            merchantId,
            refundedBy,
            amount: refundAmount,
            refundRequestId,
            refundReference,
            customerRequestedAmount: requestedGrossAmount,
            approvedRefundPercentage: calculation.approvedRefundPercentage,
            refundBaseAmount: calculation.refundBaseAmount,
            grossRefundAmount: calculation.approvedGrossRefund,
            externalGrossRefundAmount: calculation.externalGrossRefundAmount,
            externalRefundAmount: calculation.externalRefundAmount,
            walletRestoredAmount: calculation.walletRestoredAmount,
            cashbackRestoredAmount: calculation.cashbackRestoredAmount,
            processingFeeDeduction: calculation.processingFeeDeduction,
            otherDeductionAmount: calculation.otherDeductions,
            netRefundAmount: calculation.netCustomerRefund,
            originalProcessingFeeAmount: calculation.originalProcessingFee,
            merchantProcessingFeeLoss: calculation.merchantProcessingFeeLoss,
            processingFeeSource: calculation.processingFeeSource,
            refundReasonCategory: calculation.refundReasonCategory,
            refundResponsibility: calculation.refundResponsibility,
            merchantDecision,
            merchantDecisionReason,
            feeDeductionApplies: calculation.feeDeductionApplies,
            feeAcknowledgedAt,
            feeAcknowledgementVersion,
            paymentMethod: transaction.paymentMethod,
            providerTransactionId: transaction.providerTransactionId || transaction.providerCaptureId || transaction.providerPaymentId || transaction.providerSessionId,
            idempotencyKey,
            decisionAt: now,
            processingAt: now,
            currency: transaction.currency || 'SGD',
            status: 'processing',
            reason,
            paymentProvider: normalizeProvider(transaction.paymentProvider),
            providerPaymentId: transaction.providerPaymentId,
            providerSessionId: transaction.providerSessionId,
            providerCaptureId: transaction.providerCaptureId
        });
        refundId = reservedRefund?.insertId;
        await commit(reservationConnection);
    } catch (error) {
        await rollback(reservationConnection);
        throw error;
    } finally {
        reservationConnection.release();
    }

    let providerResult;
    try {
        providerResult = refundAmount > 0
            ? await callProviderRefund(transaction, refundAmount, reason, idempotencyKey)
            : {
                status: 'succeeded',
                provider: 'internal_adjustment',
                response: { message: 'Refund restored through internal wallet, cashback or loyalty ledgers only.' },
                manualRequired: false
            };
    } catch (providerError) {
        const uncertain = isUncertainProviderError(providerError);
        await updateRefundProviderResult(refundId, {
            status: uncertain ? 'refund_reconciliation_required' : 'failed',
            failureReason: providerError.message || (uncertain ? 'Provider refund result is uncertain.' : 'Provider refund failed.'),
            providerResponse: {
                error: providerError.message || (uncertain ? 'Provider refund result is uncertain.' : 'Provider refund failed.'),
                idempotencyKey
            }
        }).catch((updateError) => {
            console.error('[refund:reconciliation:update:error]', updateError.message || updateError);
        });

        if (uncertain) {
            const uncertainError = new Error('Refund provider result is uncertain. This request now requires manual reconciliation before retrying.');
            uncertainError.code = 'REFUND_RECONCILIATION_REQUIRED';
            throw uncertainError;
        }

        const failedError = new Error(providerError.message || 'Refund provider rejected the refund request.');
        failedError.code = 'REFUND_PROVIDER_FAILED';
        throw failedError;
    }
    console.log('[refund:provider:response]', {
        transactionId: transaction.transactionId,
        provider: providerResult.provider,
        manualRequired: providerResult.manualRequired,
        status: providerResult.status,
        response: providerResult.response
    });

    const connection = await getConnection();
    const providerRefundId = getProviderRefundId(providerResult.provider, providerResult.response);
    let nextRefundedAmount = calculation.approvedGrossRefund;
    let refundStatus = 'partially_refunded';
    let finalRefundStatus = providerResult.manualRequired ? 'manual_required' : refundStatus;
    let rewardEffects = {
        externalRefundAmount: refundAmount,
        externalGrossRefundAmount: calculation.externalGrossRefundAmount,
        walletRestoredAmount: 0,
        pointsRestored: 0,
        pointsReversed: 0,
        cashbackRestoredAmount: 0,
        cashbackReversedAmount: 0,
        membershipProgressAdjustment: 0,
        rewardAdjustmentStatus: providerResult.manualRequired ? 'not_applied_manual_refund' : 'not_applied'
    };

    try {
        await beginTransaction(connection);
        await query(connection, 'SELECT refund_id FROM payment_refunds WHERE refund_id = ? FOR UPDATE', [refundId]);
        transaction = await lockTransactionForRefund(connection, transaction.transactionId);
        const finalTotalsBeforeUpdate = await lockRefundTotals(connection, transaction.transactionId);
        const eligiblePaidAmount = Math.round(getEligibleBaseCents(transaction) / 100 * 100) / 100;
        nextRefundedAmount = Math.round(Number(finalTotalsBeforeUpdate.grossRefundedTotal || 0) * 100) / 100;
        refundStatus = nextRefundedAmount >= eligiblePaidAmount ? 'refunded' : 'partially_refunded';
        finalRefundStatus = providerResult.manualRequired ? 'manual_required' : refundStatus;

        console.log('[refund:sql:payment_refunds:update:start]', {
            transactionId: transaction.transactionId,
            refundId,
            refundAmount,
            finalRefundStatus,
            providerRefundId: providerRefundId || null
        });

        const refundUpdateResult = await updateRefundProviderResult(refundId, {
            connection,
            status: providerResult.manualRequired ? 'manual_required' : 'succeeded',
            providerRefundId: providerRefundId || null,
            providerResponse: providerResult.response
        });

        console.log('[refund:sql:payment_refunds:update:result]', {
            transactionId: transaction.transactionId,
            refundId,
            affectedRows: refundUpdateResult?.affectedRows
        });

        await recordTransactionRefund(transaction.transactionId, calculation.approvedGrossRefund, {
            connection,
            skipLoyaltyReverse: true,
            refundStatus: finalRefundStatus,
            providerRefundId: providerRefundId || null,
            refundReason: reason,
            refundedBy,
            cancelFulfilment: false,
            fundingAllocations: calculation.fundingAllocations
        });

        if (!providerResult.manualRequired) {
            rewardEffects = await applyRefundRewardAdjustments({
                connection,
                transaction,
                refund: {
                    refundId,
                    refundRequestId,
                    refundReference,
                    amount: refundAmount,
                    netRefundAmount: calculation.netCustomerRefund,
                    grossRefundAmount: calculation.approvedGrossRefund,
                    externalGrossRefundAmount: calculation.externalGrossRefundAmount,
                    totalRefunded: nextRefundedAmount,
                    refundStatus
                }
            });
        }

        await commit(connection);
        console.log('[refund:sql:commit]', {
            transactionId: transaction.transactionId,
            finalRefundStatus,
            nextRefundedAmount
        });
    } catch (error) {
        await rollback(connection);
        console.error('[refund:sql:rollback]', {
            transactionId: transaction.transactionId,
            error: error.message
        });

        if (!providerResult.manualRequired) {
            await updateRefundProviderResult(refundId, {
                status: 'refund_reconciliation_required',
                providerRefundId: providerRefundId || null,
                providerResponse: providerResult.response || { idempotencyKey },
                failureReason: `Provider refund may have succeeded, but local reconciliation failed: ${error.message || error}`
            }).catch((updateError) => {
                console.error('[refund:reconciliation:update:error]', updateError.message || updateError);
            });
        }

        throw error;
    } finally {
        connection.release();
    }

    return {
        transaction,
        amount: refundAmount,
        externalRefundAmount: rewardEffects.externalRefundAmount,
        walletRestoredAmount: rewardEffects.walletRestoredAmount,
        pointsRestored: rewardEffects.pointsRestored,
        pointsReversed: rewardEffects.pointsReversed,
        cashbackRestoredAmount: rewardEffects.cashbackRestoredAmount,
        cashbackReversedAmount: rewardEffects.cashbackReversedAmount,
        membershipProgressAdjustment: rewardEffects.membershipProgressAdjustment,
        rewardAdjustmentStatus: rewardEffects.rewardAdjustmentStatus,
        customerRequestedAmount: calculation.customerRequestedGrossRefund,
        approvedRefundPercentage: calculation.approvedRefundPercentage,
        refundBaseAmount: calculation.refundBaseAmount,
        grossRefundAmount: calculation.approvedGrossRefund,
        processingFeeDeduction: calculation.processingFeeDeduction,
        otherDeductionAmount: calculation.otherDeductions,
        netRefundAmount: calculation.netCustomerRefund,
        originalProcessingFee: calculation.originalProcessingFee,
        merchantProcessingFeeLoss: calculation.merchantProcessingFeeLoss,
        refundResponsibility: calculation.refundResponsibility,
        refundReasonCategory: calculation.refundReasonCategory,
        totalRefunded: nextRefundedAmount,
        remainingRefundableAfterRefund: calculation.remainingRefundableAfterRefund,
        refundStatus: finalRefundStatus,
        provider: providerResult.provider,
        providerRefundId,
        manualRequired: providerResult.manualRequired
    };
}

module.exports = {
    refundTransaction
};
