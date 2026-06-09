const { promisify } = require('util');
const PaymentRefund = require('../models/PaymentRefund');
const Transaction = require('../models/Transaction');
const stripe = require('./stripe');
const paypal = require('./paypal');

const getTransactionById = promisify(Transaction.getById);
const recordTransactionRefund = promisify(Transaction.recordRefund);
const createRefundRecord = promisify(PaymentRefund.create);
const countCompletedRefunds = promisify(PaymentRefund.countCompletedForTransaction);

function normalizeProvider(value) {
    return String(value || '').trim().toLowerCase();
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

async function callProviderRefund(transaction, amount, reason) {
    const provider = normalizeProvider(transaction.paymentProvider);

    if (provider === 'stripe') {
        const paymentIntentId = transaction.providerPaymentId;
        if (!paymentIntentId) {
            throw new Error('Stripe payment intent is missing, so this refund cannot be issued automatically.');
        }

        return {
            status: 'succeeded',
            provider,
            response: await stripe.refundPaymentIntent({ paymentIntentId, amount }),
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
                reason
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

async function refundTransaction(transactionId, {
    amount,
    reason,
    refundedBy,
    merchantId = null,
    bookingId = null,
    orderId = null
} = {}) {
    const transaction = await getTransactionById(transactionId);

    if (!transaction) {
        throw new Error('The original payment transaction could not be found.');
    }

    if (String(transaction.paymentStatus || '').toLowerCase() !== 'paid') {
        throw new Error('Only paid transactions can be refunded.');
    }

    const refundAmount = Math.round(Number(amount || 0) * 100) / 100;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new Error('Refund amount must be greater than zero.');
    }

    const alreadyRefunded = await countCompletedRefunds(transaction.transactionId);
    const refundableAmount = Math.round((Number(transaction.totalAmount || 0) - alreadyRefunded) * 100) / 100;

    if (refundAmount > refundableAmount) {
        throw new Error(`Refund amount exceeds the remaining refundable amount of $${refundableAmount.toFixed(2)}.`);
    }

    if (String(transaction.refundStatus || '').toLowerCase() === 'refunded' && refundableAmount <= 0) {
        throw new Error('This transaction has already been fully refunded.');
    }

    const providerResult = await callProviderRefund(transaction, refundAmount, reason);
    const providerRefundId = getProviderRefundId(providerResult.provider, providerResult.response);
    const nextRefundedAmount = Math.round((alreadyRefunded + refundAmount) * 100) / 100;
    const refundStatus = nextRefundedAmount >= Number(transaction.totalAmount || 0)
        ? 'refunded'
        : 'partially_refunded';

    await createRefundRecord({
        transactionId: transaction.transactionId,
        bookingId: bookingId || transaction.bookingId || null,
        orderId: orderId || transaction.orderId || null,
        userId: transaction.userId,
        merchantId,
        refundedBy,
        amount: refundAmount,
        currency: transaction.currency || 'SGD',
        status: providerResult.manualRequired ? 'manual_required' : 'succeeded',
        reason,
        paymentProvider: providerResult.provider,
        providerPaymentId: transaction.providerPaymentId,
        providerSessionId: transaction.providerSessionId,
        providerCaptureId: transaction.providerCaptureId,
        providerRefundId: providerRefundId || null,
        providerResponse: providerResult.response
    });

    await recordTransactionRefund(transaction.transactionId, nextRefundedAmount, {
        refundStatus: providerResult.manualRequired ? 'manual_required' : refundStatus,
        providerRefundId: providerRefundId || null,
        refundReason: reason,
        refundedBy
    });

    return {
        transaction,
        amount: refundAmount,
        totalRefunded: nextRefundedAmount,
        refundStatus: providerResult.manualRequired ? 'manual_required' : refundStatus,
        provider: providerResult.provider,
        providerRefundId,
        manualRequired: providerResult.manualRequired
    };
}

module.exports = {
    refundTransaction
};
