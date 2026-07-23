const { formatPaymentMethod, normalizePaymentMethod, normalizePaymentProvider } = require('../utils/paymentDisplay');
const {
    calculateProcessingFeeForExternalPortion,
    calculateRefundFundingAllocation,
    getEligibleBaseCents,
    getOriginalExternalPaidCents
} = require('./refundAllocation');

const REFUND_TERMS_VERSION = 'refund-policy-2026-07-admin-fee';
const REFUND_ADMINISTRATION_FEE_CENTS = 200;
const REFUND_ADMINISTRATION_FEE_AMOUNT = fromCents(REFUND_ADMINISTRATION_FEE_CENTS);
const CUSTOMER_RESPONSIBILITY_REASONS = new Set(['customer_cancellation']);
const MERCHANT_RESPONSIBILITY_REASONS = new Set(['merchant_cancellation', 'unavailable', 'duplicate_charge', 'incorrect_charge']);
const PLATFORM_RESPONSIBILITY_REASONS = new Set(['platform_error']);
const VALID_REASON_CATEGORIES = new Set([
    'customer_cancellation',
    'merchant_cancellation',
    'unavailable',
    'duplicate_charge',
    'incorrect_charge',
    'platform_error',
    'other'
]);

function toCents(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100);
}

function fromCents(cents) {
    return Math.round(Number(cents || 0)) / 100;
}

function normalizePercentage(value, fallback = 100) {
    const numeric = Number(value == null || value === '' ? fallback : value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.round(numeric * 100) / 100;
}

function minCents(...values) {
    return Math.min(...values.map(toCents));
}

function normalizeReasonCategory(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return VALID_REASON_CATEGORIES.has(normalized) ? normalized : 'other';
}

function getResponsibility(reasonCategory) {
    const reason = normalizeReasonCategory(reasonCategory);
    if (CUSTOMER_RESPONSIBILITY_REASONS.has(reason)) return 'customer';
    if (MERCHANT_RESPONSIBILITY_REASONS.has(reason)) return 'merchant';
    if (PLATFORM_RESPONSIBILITY_REASONS.has(reason)) return 'platform';
    return 'merchant';
}

function canDeductProcessingFee(transaction, responsibility) {
    const source = String(transaction.processingFeeSource || '').trim().toLowerCase();
    const provider = normalizePaymentProvider(transaction.paymentProvider, transaction.paymentMethod);
    const method = normalizePaymentMethod(transaction.paymentMethod);

    if (responsibility !== 'customer') return false;
    if (['wallet', 'cashback_wallet', 'loyalty_points', 'voucher'].includes(method)) return false;
    if (provider === 'internal_wallet') return false;
    if (!['provider_reported', 'calculated_snapshot', 'merchant_contract'].includes(source)) return false;
    return toCents(transaction.processingFeeAmount) > 0;
}

function getRefundAdministrationFeeCents(approvedRefundCents) {
    return approvedRefundCents > 0 ? REFUND_ADMINISTRATION_FEE_CENTS : 0;
}

function calculateProcessingFeeDeduction({
    transaction,
    requestedGrossRefund,
    previousFeeDeductions = 0,
    previousMerchantFeeLoss = 0,
    previousExternalGrossRefunds = 0,
    responsibility,
    acknowledgementAccepted = false
}) {
    if (!canDeductProcessingFee(transaction, responsibility)) return 0;

    const externalPaid = fromCents(getOriginalExternalPaidCents(transaction));
    const cumulativeExternalGross = fromCents(toCents(previousExternalGrossRefunds) + toCents(requestedGrossRefund));
    if (!acknowledgementAccepted || toCents(externalPaid) <= 0 || toCents(requestedGrossRefund) <= 0) {
        return 0;
    }

    return calculateProcessingFeeForExternalPortion({
        originalProcessingFee: transaction.processingFeeAmount,
        originalExternalPaid: externalPaid,
        cumulativeExternalGrossRefunded: cumulativeExternalGross,
        previousFeeDeductions,
        previousMerchantFeeLoss,
        responsibility,
        acknowledgementAccepted
    }).processingFeeDeduction;
}

function calculateRefund({
    transaction,
    requestedGrossRefund,
    previousGrossRefunds = 0,
    previousFeeDeductions = 0,
    previousMerchantFeeLoss = 0,
    previousExternalGrossRefunds = 0,
    previousSourceRefunds = {},
    previousRefundedByAllocationId = {},
    approvedPercentage = 100,
    reasonCategory = 'other',
    acknowledgementAccepted = false,
    lateFeeAmount = 0
}) {
    const responsibility = getResponsibility(reasonCategory);
    const originalPaidCents = Math.max(getEligibleBaseCents(transaction), 0);
    const previousGrossCents = Math.max(toCents(previousGrossRefunds || transaction.refundedAmount), 0);
    const remainingRefundableCents = Math.max(originalPaidCents - previousGrossCents, 0);
    const customerRequestedGrossCents = Math.max(toCents(requestedGrossRefund || fromCents(remainingRefundableCents)), 0);
    const refundBaseCents = Math.min(customerRequestedGrossCents, remainingRefundableCents);
    const normalizedPercentage = normalizePercentage(approvedPercentage, 100);
    const percentageCents = Math.max(0, Math.min(Math.round(normalizedPercentage * 100), 10000));
    const cappedGrossCents = Math.round((refundBaseCents * percentageCents) / 10000);
    const lateFeeCents = Math.min(Math.max(toCents(lateFeeAmount), 0), cappedGrossCents);
    const grossAllocationBeforeFee = calculateRefundFundingAllocation({
        transaction,
        cumulativeGrossRefund: fromCents(previousGrossCents + cappedGrossCents),
        currentGrossRefund: fromCents(cappedGrossCents),
        netCustomerRefund: fromCents(cappedGrossCents - lateFeeCents),
        previousSourceRefunds,
        previousRefundedByAllocationId
    });
    const providerFeeAllocation = calculateProcessingFeeForExternalPortion({
        originalProcessingFee: transaction.processingFeeAmount,
        originalExternalPaid: fromCents(getOriginalExternalPaidCents(transaction)),
        cumulativeExternalGrossRefunded: fromCents(toCents(previousExternalGrossRefunds) + toCents(grossAllocationBeforeFee.externalGrossRefundAmount)),
        previousFeeDeductions: 0,
        previousMerchantFeeLoss,
        responsibility,
        acknowledgementAccepted: false
    });
    const feeDeductionCents = Math.min(getRefundAdministrationFeeCents(cappedGrossCents), cappedGrossCents);
    if (cappedGrossCents > 0 && cappedGrossCents <= REFUND_ADMINISTRATION_FEE_CENTS) {
        throw new Error(`The approved refund amount must be more than the ${formatMoney(REFUND_ADMINISTRATION_FEE_AMOUNT)} Refund Administration Fee.`);
    }
    const netRefundCents = Math.max(cappedGrossCents - lateFeeCents - feeDeductionCents, 0);
    const originalFeeCents = Math.max(toCents(transaction.processingFeeAmount), 0);
    const merchantFeeLossCents = toCents(providerFeeAllocation.merchantProcessingFeeLoss);
    const fundingAllocation = calculateRefundFundingAllocation({
        transaction,
        cumulativeGrossRefund: fromCents(previousGrossCents + cappedGrossCents),
        currentGrossRefund: fromCents(cappedGrossCents),
        netCustomerRefund: fromCents(netRefundCents),
        previousSourceRefunds,
        previousRefundedByAllocationId
    });
    const paymentMethodLabel = formatPaymentMethod(transaction.paymentMethod, transaction.paymentProvider);
    const deductionApplies = feeDeductionCents > 0;
    const acknowledgementRequired = canDeductProcessingFee(transaction, responsibility) && !acknowledgementAccepted;

    return {
        originalAmountPaid: fromCents(originalPaidCents),
        previousGrossRefunds: fromCents(previousGrossCents),
        remainingRefundableAmount: fromCents(remainingRefundableCents),
        customerRequestedGrossRefund: fromCents(customerRequestedGrossCents),
        refundBaseAmount: fromCents(refundBaseCents),
        approvedRefundPercentage: fromCents(percentageCents),
        approvedGrossRefund: fromCents(cappedGrossCents),
        requestedGrossRefund: fromCents(cappedGrossCents),
        externalGrossRefundAmount: fundingAllocation.externalGrossRefundAmount,
        externalRefundAmount: fundingAllocation.externalRefundAmount,
        walletRestoredAmount: fundingAllocation.walletRestoredAmount,
        cashbackRestoredAmount: fundingAllocation.cashbackRestoredAmount,
        pointsRestoredValue: fundingAllocation.pointsRestoredValue,
        fundingAllocations: fundingAllocation.allocations,
        originalProcessingFee: fromCents(originalFeeCents),
        processingFeeDeduction: fromCents(feeDeductionCents),
        refundAdministrationFee: fromCents(feeDeductionCents),
        processingFeeAllocation: providerFeeAllocation.processingFeeAllocation,
        otherDeductions: fromCents(lateFeeCents),
        netCustomerRefund: fromCents(netRefundCents),
        remainingRefundableAfterRefund: fromCents(Math.max(remainingRefundableCents - cappedGrossCents, 0)),
        merchantProcessingFeeLoss: fromCents(merchantFeeLossCents),
        currency: transaction.currency || 'SGD',
        refundResponsibility: responsibility,
        refundReasonCategory: normalizeReasonCategory(reasonCategory),
        feeDeductionApplies: deductionApplies,
        processingFeeSource: transaction.processingFeeSource || 'unknown',
        acknowledgementRequired: deductionApplies && !acknowledgementAccepted,
        paymentMethodLabel,
        paymentProvider: normalizePaymentProvider(transaction.paymentProvider, transaction.paymentMethod),
        explanation: deductionApplies
            ? `A fixed ${formatMoney(fromCents(feeDeductionCents))} Refund Administration Fee will be deducted from the approved refund amount, regardless of the original payment method. Your estimated refund is ${formatMoney(fromCents(netRefundCents))}.`
            : `Estimated refund: ${formatMoney(fromCents(netRefundCents))}.`
    };
}

function formatMoney(value, currency = 'S$') {
    return `${currency}${fromCents(toCents(value)).toFixed(2)}`;
}

function extractProviderFeeSnapshot({ provider, method, amount, providerResponse = {}, paymentChannel = '' }) {
    const normalizedProvider = normalizePaymentProvider(provider, method);
    const normalizedMethod = normalizePaymentMethod(method);
    const gross = Number(amount || 0);

    if (normalizedMethod === 'wallet' || normalizedProvider === 'internal_wallet') {
        return { amount: 0, currency: 'SGD', source: 'none', percentage: null, fixedAmount: null };
    }

    const candidateFee = providerResponse?.fee
        || providerResponse?.processing_fee
        || providerResponse?.fees
        || providerResponse?.seller_receivable_breakdown?.paypal_fee?.value
        || providerResponse?.paypalFee;

    if (candidateFee != null && Number.isFinite(Number(candidateFee))) {
        return { amount: fromCents(toCents(candidateFee)), currency: 'SGD', source: 'provider_reported', percentage: null, fixedAmount: null };
    }

    if (normalizedProvider === 'hitpay') {
        const channel = String(paymentChannel || providerResponse?.payment_method || providerResponse?.payment_methods?.[0] || '').trim().toLowerCase();
        const percentKey = `HITPAY_${channel.toUpperCase()}_FEE_PERCENT`;
        const fixedKey = `HITPAY_${channel.toUpperCase()}_FEE_FIXED`;
        const minimumKey = `HITPAY_${channel.toUpperCase()}_FEE_MIN`;
        const percentage = Number(process.env[percentKey] || process.env.HITPAY_DEFAULT_FEE_PERCENT || '');
        const fixed = Number(process.env[fixedKey] || process.env.HITPAY_DEFAULT_FEE_FIXED || 0);
        const minimum = Number(process.env[minimumKey] || process.env.HITPAY_DEFAULT_FEE_MIN || 0);

        if (Number.isFinite(percentage) && percentage >= 0 && Number.isFinite(gross) && gross > 0) {
            const calculated = Math.max((gross * percentage / 100) + fixed, minimum);
            return {
                amount: fromCents(toCents(calculated)),
                currency: 'SGD',
                source: 'calculated_snapshot',
                percentage,
                fixedAmount: Number.isFinite(fixed) ? fixed : 0
            };
        }
    }

    return { amount: 0, currency: 'SGD', source: 'unknown', percentage: null, fixedAmount: null };
}

module.exports = {
    REFUND_ADMINISTRATION_FEE_AMOUNT,
    REFUND_ADMINISTRATION_FEE_CENTS,
    REFUND_TERMS_VERSION,
    VALID_REASON_CATEGORIES,
    calculateRefund,
    extractProviderFeeSnapshot,
    formatMoney,
    fromCents,
    getResponsibility,
    normalizeReasonCategory,
    normalizePercentage,
    toCents
};
