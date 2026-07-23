const CASH_REFUNDABLE_SOURCES = ['external', 'wallet', 'cashback', 'loyalty_points'];

function toCents(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100);
}

function fromCents(cents) {
    return Math.round(Number(cents || 0)) / 100;
}

function normalizeSourceType(value) {
    const source = String(value || '').trim().toLowerCase();
    if (source === 'cashback_wallet') return 'cashback';
    if (source === 'points') return 'loyalty_points';
    return source || 'external';
}

function getFundingSources(transaction = {}) {
    const fromAllocations = Array.isArray(transaction.paymentAllocations)
        ? transaction.paymentAllocations
            .map((allocation) => ({
                allocationId: allocation.allocationId || allocation.allocation_id || null,
                sourceType: normalizeSourceType(allocation.sourceType || allocation.source_type),
                sourceReferenceId: allocation.sourceReferenceId || allocation.source_reference_id || '',
                amountCents: Math.max(toCents(allocation.allocatedAmount || allocation.allocated_amount), 0),
                refundedCents: Math.max(toCents(allocation.refundedAmount || allocation.refunded_amount), 0)
            }))
            .filter((allocation) => allocation.amountCents > 0)
        : [];

    if (fromAllocations.length) {
        return fromAllocations;
    }

    const method = String(transaction.paymentMethod || transaction.payment_method || '').trim().toLowerCase();
    const walletCents = Math.max(toCents(transaction.walletAmountUsed || transaction.wallet_amount_used), 0);
    const cashbackCents = Math.max(toCents(transaction.cashbackAmountUsed || transaction.cashback_amount_used), 0);
    const pointsValueCents = Math.max(toCents(transaction.loyaltyPointsValue || transaction.loyalty_points_value), 0);
    const voucherCents = Math.max(toCents(transaction.voucherDiscountAmount || transaction.voucher_discount_amount), 0);
    const paidCents = Math.max(toCents(transaction.paidAmount || transaction.paid_amount || transaction.totalAmount || transaction.total_amount), 0);
    const externalCents = method === 'wallet'
        ? 0
        : Math.max(toCents(transaction.externalPaymentAmount || transaction.external_payment_amount || paidCents), 0);
    const sources = [];
    const transactionId = transaction.transactionId || transaction.transaction_id || 'pending';

    if (externalCents > 0) {
        sources.push({ allocationId: null, sourceType: 'external', sourceReferenceId: `external-${transactionId}`, amountCents: externalCents, refundedCents: 0 });
    }
    if (walletCents > 0 || method === 'wallet') {
        const amountCents = method === 'wallet' && walletCents <= 0 ? paidCents : walletCents;
        if (amountCents > 0) {
            sources.push({ allocationId: null, sourceType: 'wallet', sourceReferenceId: `wallet-${transactionId}`, amountCents, refundedCents: 0 });
        }
    }
    if (cashbackCents > 0) {
        sources.push({ allocationId: null, sourceType: 'cashback', sourceReferenceId: `cashback-${transactionId}`, amountCents: cashbackCents, refundedCents: 0 });
    }
    if (pointsValueCents > 0) {
        sources.push({ allocationId: null, sourceType: 'loyalty_points', sourceReferenceId: `points-${transactionId}`, amountCents: pointsValueCents, refundedCents: 0 });
    }
    if (voucherCents > 0) {
        sources.push({ allocationId: null, sourceType: 'voucher', sourceReferenceId: `voucher-${transactionId}`, amountCents: voucherCents, refundedCents: 0 });
    }

    return sources;
}

function sumSourceCents(sources, sourceTypes, field = 'amountCents') {
    const allowed = new Set(Array.isArray(sourceTypes) ? sourceTypes : [sourceTypes]);
    return sources
        .filter((source) => allowed.has(source.sourceType))
        .reduce((sum, source) => sum + Math.max(Number(source[field] || 0), 0), 0);
}

function getEligibleBaseCents(transaction = {}) {
    const sources = getFundingSources(transaction);
    const sourceBase = sumSourceCents(sources, CASH_REFUNDABLE_SOURCES);
    if (sourceBase > 0) return sourceBase;
    return Math.max(toCents(transaction.paidAmount || transaction.paid_amount || transaction.totalAmount || transaction.total_amount), 0);
}

function getOriginalExternalPaidCents(transaction = {}) {
    return sumSourceCents(getFundingSources(transaction), 'external');
}

function calculateRefundFundingAllocation({
    transaction,
    cumulativeGrossRefund,
    currentGrossRefund,
    netCustomerRefund,
    previousSourceRefunds = {},
    previousRefundedByAllocationId = {}
}) {
    const sources = getFundingSources(transaction);
    const eligibleBaseCents = getEligibleBaseCents(transaction);
    const cumulativeGrossCents = Math.min(Math.max(toCents(cumulativeGrossRefund), 0), eligibleBaseCents);
    const currentGrossCents = Math.max(toCents(currentGrossRefund), 0);
    const netCustomerCents = Math.max(toCents(netCustomerRefund), 0);
    const allocations = [];
    const totals = {
        externalGrossCents: 0,
        walletCents: 0,
        cashbackCents: 0,
        pointsValueCents: 0,
        voucherNonRefundableCents: 0,
        discountNonRefundableCents: 0
    };

    sources.forEach((source) => {
        const previousCents = source.allocationId && previousRefundedByAllocationId[source.allocationId] !== undefined
            ? Math.max(toCents(previousRefundedByAllocationId[source.allocationId]), 0)
            : Math.max(toCents(previousSourceRefunds[source.sourceType]), source.refundedCents || 0);
        const requiredCumulativeCents = CASH_REFUNDABLE_SOURCES.includes(source.sourceType) && eligibleBaseCents > 0
            ? Math.min(source.amountCents, Math.round((source.amountCents * cumulativeGrossCents) / eligibleBaseCents))
            : 0;
        const amountCents = Math.max(Math.min(requiredCumulativeCents - previousCents, source.amountCents - previousCents, currentGrossCents), 0);

        allocations.push({
            allocationId: source.allocationId,
            sourceType: source.sourceType,
            sourceReferenceId: source.sourceReferenceId,
            originalAmount: fromCents(source.amountCents),
            previousRefundedAmount: fromCents(previousCents),
            refundAmount: fromCents(amountCents)
        });

        if (source.sourceType === 'external') totals.externalGrossCents += amountCents;
        if (source.sourceType === 'wallet') totals.walletCents += amountCents;
        if (source.sourceType === 'cashback') totals.cashbackCents += amountCents;
        if (source.sourceType === 'loyalty_points') totals.pointsValueCents += amountCents;
        if (source.sourceType === 'voucher') totals.voucherNonRefundableCents += source.amountCents;
        if (source.sourceType === 'discount') totals.discountNonRefundableCents += source.amountCents;
    });

    let internalReturnedCents = totals.walletCents + totals.cashbackCents + totals.pointsValueCents;
    if (internalReturnedCents > netCustomerCents) {
        let overageCents = internalReturnedCents - netCustomerCents;
        ['loyalty_points', 'cashback', 'wallet'].forEach((sourceType) => {
            if (overageCents <= 0) return;
            allocations
                .filter((allocation) => allocation.sourceType === sourceType && toCents(allocation.refundAmount) > 0)
                .reverse()
                .forEach((allocation) => {
                    if (overageCents <= 0) return;
                    const currentCents = toCents(allocation.refundAmount);
                    const reductionCents = Math.min(currentCents, overageCents);
                    allocation.refundAmount = fromCents(currentCents - reductionCents);
                    overageCents -= reductionCents;
                    if (sourceType === 'wallet') totals.walletCents -= reductionCents;
                    if (sourceType === 'cashback') totals.cashbackCents -= reductionCents;
                    if (sourceType === 'loyalty_points') totals.pointsValueCents -= reductionCents;
                });
        });
        internalReturnedCents = totals.walletCents + totals.cashbackCents + totals.pointsValueCents;
    }
    const externalNetCents = Math.max(Math.min(netCustomerCents - internalReturnedCents, totals.externalGrossCents), 0);
    const totalReturnedCents = externalNetCents + internalReturnedCents;
    const roundingToleranceCents = 1;

    if (totalReturnedCents > netCustomerCents + roundingToleranceCents) {
        throw new Error('Refund allocation exceeds approved net refund.');
    }

    return {
        eligibleBaseAmount: fromCents(eligibleBaseCents),
        allocations,
        externalGrossRefundAmount: fromCents(totals.externalGrossCents),
        externalRefundAmount: fromCents(externalNetCents),
        walletRestoredAmount: fromCents(totals.walletCents),
        cashbackRestoredAmount: fromCents(totals.cashbackCents),
        pointsRestoredValue: fromCents(totals.pointsValueCents),
        voucherNonRefundableAmount: fromCents(totals.voucherNonRefundableCents),
        discountNonRefundableAmount: fromCents(totals.discountNonRefundableCents),
        totalCustomerValueReturned: fromCents(totalReturnedCents)
    };
}

function calculatePointsRestored({ pointsUsed = 0, pointsValue = 0, pointsValueRestored = 0, previousPointsRestored = 0 }) {
    const totalPoints = Math.max(Math.floor(Number(pointsUsed || 0)), 0);
    const pointsValueCents = Math.max(toCents(pointsValue), 0);
    const restoredValueCents = Math.max(toCents(pointsValueRestored), 0);
    const previousPoints = Math.max(Math.floor(Number(previousPointsRestored || 0)), 0);
    if (totalPoints <= 0 || pointsValueCents <= 0 || restoredValueCents <= 0) return 0;
    const requiredCumulativePoints = Math.min(totalPoints, Math.round((totalPoints * restoredValueCents) / pointsValueCents));
    return Math.max(requiredCumulativePoints - previousPoints, 0);
}

function calculateProcessingFeeForExternalPortion({
    originalProcessingFee,
    originalExternalPaid,
    cumulativeExternalGrossRefunded,
    previousFeeDeductions = 0,
    previousMerchantFeeLoss = 0,
    responsibility = 'merchant',
    acknowledgementAccepted = false
}) {
    const originalFeeCents = Math.max(toCents(originalProcessingFee), 0);
    const externalPaidCents = Math.max(toCents(originalExternalPaid), 0);
    const cumulativeExternalCents = Math.max(toCents(cumulativeExternalGrossRefunded), 0);
    const previousDeductionCents = Math.max(toCents(previousFeeDeductions), 0);
    const previousLossCents = Math.max(toCents(previousMerchantFeeLoss), 0);

    if (originalFeeCents <= 0 || externalPaidCents <= 0 || cumulativeExternalCents <= 0) {
        return {
            processingFeeAllocation: 0,
            processingFeeDeduction: 0,
            merchantProcessingFeeLoss: 0,
            cumulativeProcessingFeeAllocation: 0
        };
    }

    const requiredCumulativeFeeCents = Math.min(originalFeeCents, Math.round((originalFeeCents * cumulativeExternalCents) / externalPaidCents));
    const previouslyAllocatedCents = Math.min(originalFeeCents, previousDeductionCents + previousLossCents);
    const feeAllocatedNowCents = Math.max(requiredCumulativeFeeCents - previouslyAllocatedCents, 0);
    const deductionNowCents = responsibility === 'customer' && acknowledgementAccepted
        ? Math.min(feeAllocatedNowCents, Math.max(originalFeeCents - previousDeductionCents, 0))
        : 0;
    const merchantLossNowCents = Math.max(feeAllocatedNowCents - deductionNowCents, 0);

    return {
        processingFeeAllocation: fromCents(feeAllocatedNowCents),
        processingFeeDeduction: fromCents(deductionNowCents),
        merchantProcessingFeeLoss: fromCents(merchantLossNowCents),
        cumulativeProcessingFeeAllocation: fromCents(requiredCumulativeFeeCents)
    };
}

module.exports = {
    CASH_REFUNDABLE_SOURCES,
    calculatePointsRestored,
    calculateProcessingFeeForExternalPortion,
    calculateRefundFundingAllocation,
    getEligibleBaseCents,
    getFundingSources,
    getOriginalExternalPaidCents,
    normalizeSourceType
};
