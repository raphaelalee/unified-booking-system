function normalizePaymentMethod(value = '') {
    const text = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

    if (['stripe', 'card', 'card_payment', 'credit_card', 'debit_card', 'apple_pay', 'google_pay'].includes(text)) return 'card';
    if (['paypal', 'pay_pal'].includes(text)) return 'paypal';
    if (['paynow', 'paynow_online', 'hitpay_paynow'].includes(text)) return 'paynow';
    if (['nets', 'nets_qr', 'net_qr'].includes(text)) return 'nets_qr';
    if (['e_wallet', 'ewallet', 'wallet', 'internal_wallet'].includes(text)) return 'wallet';
    if (['cashback', 'cashback_wallet'].includes(text)) return 'cashback_wallet';
    if (['rewards', 'points', 'loyalty_points'].includes(text)) return 'loyalty_points';
    if (['voucher', 'discount'].includes(text)) return text;

    return text || 'unknown';
}

function normalizePaymentProvider(value = '', method = '') {
    const provider = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const normalizedMethod = normalizePaymentMethod(method);

    if (['stripe'].includes(provider)) return 'stripe';
    if (['paypal', 'pay_pal'].includes(provider)) return 'paypal';
    if (['hitpay'].includes(provider)) return 'hitpay';
    if (['nets'].includes(provider)) return 'nets';
    if (['internal_wallet', 'wallet', 'ewallet'].includes(provider)) return 'internal_wallet';
    if (['cashback_wallet'].includes(provider)) return 'internal_wallet';
    if (['direct', 'manual', ''].includes(provider)) {
        if (normalizedMethod === 'wallet' || normalizedMethod === 'cashback_wallet' || normalizedMethod === 'loyalty_points') return 'internal_wallet';
        if (normalizedMethod === 'paynow') return 'hitpay';
        if (normalizedMethod === 'nets_qr') return 'nets';
        if (normalizedMethod === 'paypal') return 'paypal';
        if (normalizedMethod === 'card') return 'stripe';
    }

    return provider || '';
}

function formatPaymentMethod(method = '', provider = '', details = {}) {
    const normalizedMethod = normalizePaymentMethod(method);
    const normalizedProvider = normalizePaymentProvider(provider, normalizedMethod);
    const brand = details.cardBrand ? String(details.cardBrand).trim() : '';
    const last4 = details.cardLast4 ? String(details.cardLast4).replace(/[^\d]/g, '').slice(-4) : '';

    if (normalizedMethod === 'card') {
        if (brand && last4) return `${brand} ending in ${last4} via Stripe`;
        if (last4) return `Card ending in ${last4} via Stripe`;
        return 'Credit / Debit Card (Stripe)';
    }
    if (normalizedMethod === 'paypal') return 'PayPal';
    if (normalizedMethod === 'paynow') return 'PayNow (HitPay)';
    if (normalizedMethod === 'nets_qr') return 'NETS QR';
    if (normalizedMethod === 'wallet') return 'E-Wallet';
    if (normalizedMethod === 'cashback_wallet') return 'Cashback Wallet';
    if (normalizedMethod === 'loyalty_points') return 'Loyalty Points';
    if (normalizedMethod === 'voucher') return 'Voucher';
    if (normalizedMethod === 'discount') return 'Discount';

    if (normalizedProvider) {
        return `${String(method || 'Payment').replace(/_/g, ' ')} (${normalizedProvider})`;
    }

    return String(method || 'Payment').replace(/_/g, ' ');
}

function formatPaymentBreakdown(allocations = [], fallback = {}) {
    const rows = (Array.isArray(allocations) ? allocations : [])
        .filter((allocation) => Number(allocation.allocatedAmount || allocation.allocated_amount || 0) > 0)
        .map((allocation) => {
            const method = allocation.paymentMethod || allocation.payment_method || allocation.sourceType || allocation.source_type;
            const provider = allocation.paymentProvider || allocation.payment_provider || '';
            const amount = Number(allocation.allocatedAmount || allocation.allocated_amount || 0);
            const refundedAmount = Number(allocation.refundedAmount || allocation.refunded_amount || 0);
            const remainingValue = allocation.remainingRefundableAmount ?? allocation.remaining_refundable_amount;
            return {
                sourceType: allocation.sourceType || allocation.source_type || '',
                label: formatPaymentMethod(method, provider, allocation),
                amount,
                refundedAmount,
                remainingRefundableAmount: remainingValue == null ? Math.max(amount - refundedAmount, 0) : Number(remainingValue || 0)
            };
        });

    if (rows.length) return rows;

    const amount = Number(fallback.paidAmount || fallback.totalAmount || fallback.amount || 0);
    if (amount <= 0) return [];

    return [{
        sourceType: 'external',
        label: formatPaymentMethod(fallback.paymentMethod, fallback.paymentProvider, fallback),
        amount,
        refundedAmount: Number(fallback.refundedAmount || 0),
        remainingRefundableAmount: Math.max(0, amount - Number(fallback.refundedAmount || 0))
    }];
}

module.exports = {
    formatPaymentBreakdown,
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
};
