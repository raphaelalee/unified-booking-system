const { promisify } = require('util');
const db = require('../db');
const Loyalty = require('../models/Loyalty');
const PaymentRefund = require('../models/PaymentRefund');
const Transaction = require('../models/Transaction');
const stripe = require('./stripe');
const paypal = require('./paypal');

const getTransactionById = promisify(Transaction.getById);
const recordTransactionRefund = promisify(Transaction.recordRefund);
const createRefundRecord = promisify(PaymentRefund.create);
const countCompletedRefunds = promisify(PaymentRefund.countCompletedForTransaction);
const reverseCampaignCashback = promisify(Loyalty.reverseCampaignCashbackForReceipt);

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
    console.log('[refund:start]', {
        transactionId,
        amount,
        reason,
        refundedBy,
        merchantId,
        bookingId,
        orderId
    });

    const transaction = await getTransactionById(transactionId);

    if (!transaction) {
        throw new Error('The original payment transaction could not be found.');
    }

    if (String(transaction.paymentStatus || '').toLowerCase() !== 'paid') {
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

    const refundAmount = Math.round(Number(amount || 0) * 100) / 100;
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
        throw new Error('Refund amount must be greater than zero.');
    }

    const alreadyRefunded = await countCompletedRefunds(transaction.transactionId);
    const refundableAmount = Math.round((Number(transaction.totalAmount || 0) - alreadyRefunded) * 100) / 100;

    console.log('[refund:amounts]', {
        transactionId: transaction.transactionId,
        requestedRefundAmount: refundAmount,
        alreadyRefunded,
        refundableAmount
    });

    if (refundAmount > refundableAmount) {
        throw new Error(`Refund amount exceeds the remaining refundable amount of $${refundableAmount.toFixed(2)}.`);
    }

    if (String(transaction.refundStatus || '').toLowerCase() === 'refunded' && refundableAmount <= 0) {
        throw new Error('This transaction has already been fully refunded.');
    }

    const providerResult = await callProviderRefund(transaction, refundAmount, reason);
    console.log('[refund:provider:response]', {
        transactionId: transaction.transactionId,
        provider: providerResult.provider,
        manualRequired: providerResult.manualRequired,
        status: providerResult.status,
        response: providerResult.response
    });

    const providerRefundId = getProviderRefundId(providerResult.provider, providerResult.response);
    const nextRefundedAmount = Math.round((alreadyRefunded + refundAmount) * 100) / 100;
    const refundStatus = nextRefundedAmount >= Number(transaction.totalAmount || 0)
        ? 'refunded'
        : 'partially_refunded';

    const connection = await getConnection();
    const finalRefundStatus = providerResult.manualRequired ? 'manual_required' : refundStatus;

    try {
        await beginTransaction(connection);

        console.log('[refund:sql:payment_refunds:insert:start]', {
            transactionId: transaction.transactionId,
            refundAmount,
            finalRefundStatus,
            providerRefundId: providerRefundId || null
        });

        const refundInsertResult = await createRefundRecord({
            connection,
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

        console.log('[refund:sql:payment_refunds:insert:result]', {
            transactionId: transaction.transactionId,
            insertId: refundInsertResult?.insertId,
            affectedRows: refundInsertResult?.affectedRows
        });

        await recordTransactionRefund(transaction.transactionId, nextRefundedAmount, {
            connection,
            skipLoyaltyReverse: true,
            refundStatus: finalRefundStatus,
            providerRefundId: providerRefundId || null,
            refundReason: reason,
            refundedBy
        });

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
        throw error;
    } finally {
        connection.release();
    }

    try {
        await reverseCampaignCashback(`order-${transaction.transactionId}`);
        console.log('[refund:loyalty:reverse:ok]', {
            receiptId: `order-${transaction.transactionId}`
        });
    } catch (cashbackError) {
        console.error('[refund:loyalty:reverse:error]', cashbackError);
    }

    return {
        transaction,
        amount: refundAmount,
        totalRefunded: nextRefundedAmount,
        refundStatus: finalRefundStatus,
        provider: providerResult.provider,
        providerRefundId,
        manualRequired: providerResult.manualRequired
    };
}

module.exports = {
    refundTransaction
};
