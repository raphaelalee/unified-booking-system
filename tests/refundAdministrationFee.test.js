const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    REFUND_ADMINISTRATION_FEE_AMOUNT,
    calculateRefund
} = require('../services/refundCalculation');

function transaction(overrides = {}) {
    return {
        transactionId: 5001,
        paymentMethod: 'card',
        paymentProvider: 'stripe',
        externalPaymentAmount: 100,
        walletAmountUsed: 0,
        cashbackAmountUsed: 0,
        loyaltyPointsUsed: 0,
        loyaltyPointsValue: 0,
        voucherDiscountAmount: 0,
        paidAmount: 100,
        totalAmount: 100,
        currency: 'SGD',
        processingFeeAmount: 4,
        processingFeeSource: 'provider_reported',
        ...overrides
    };
}

test('fixed administration fee is centrally configured as S$2.00', () => {
    assert.equal(REFUND_ADMINISTRATION_FEE_AMOUNT, 2);
});

test('full S$50 refund returns S$48 after one administration fee', () => {
    const result = calculateRefund({
        transaction: transaction({ externalPaymentAmount: 50, paidAmount: 50, totalAmount: 50 }),
        requestedGrossRefund: 50,
        approvedPercentage: 100,
        acknowledgementAccepted: true
    });

    assert.equal(result.approvedGrossRefund, 50);
    assert.equal(result.processingFeeDeduction, 2);
    assert.equal(result.refundAdministrationFee, 2);
    assert.equal(result.netCustomerRefund, 48);
    assert.equal(result.externalRefundAmount, 48);
});

test('S$100 order with 25%, 50% and 75% partial refunds deducts one fixed fee', () => {
    [
        [25, 25, 23],
        [50, 50, 48],
        [75, 75, 73]
    ].forEach(([percentage, approved, returned]) => {
        const result = calculateRefund({
            transaction: transaction(),
            requestedGrossRefund: 100,
            approvedPercentage: percentage,
            acknowledgementAccepted: true
        });

        assert.equal(result.approvedGrossRefund, approved);
        assert.equal(result.processingFeeDeduction, 2);
        assert.equal(result.netCustomerRefund, returned);
        assert.equal(result.externalRefundAmount, returned);
    });
});

test('administration fee is identical regardless of payment method', () => {
    ['card', 'paypal', 'paynow_online', 'wallet'].forEach((method) => {
        const result = calculateRefund({
            transaction: transaction({
                paymentMethod: method,
                paymentProvider: method === 'wallet' ? 'internal_wallet' : method,
                externalPaymentAmount: method === 'wallet' ? 0 : 50,
                walletAmountUsed: method === 'wallet' ? 50 : 0,
                paidAmount: 50,
                totalAmount: 50,
                processingFeeAmount: method === 'wallet' ? 0 : 4,
                processingFeeSource: method === 'wallet' ? 'none' : 'provider_reported'
            }),
            requestedGrossRefund: 50,
            approvedPercentage: 100,
            acknowledgementAccepted: true
        });

        assert.equal(result.processingFeeDeduction, 2);
        assert.equal(result.netCustomerRefund, 48);
    });
});

test('administration fee is applied once for a mixed-payment refund', () => {
    const result = calculateRefund({
        transaction: transaction({
            externalPaymentAmount: 80,
            walletAmountUsed: 20,
            paidAmount: 80,
            totalAmount: 100
        }),
        requestedGrossRefund: 50,
        approvedPercentage: 100,
        acknowledgementAccepted: true
    });

    assert.equal(result.processingFeeDeduction, 2);
    assert.equal(result.netCustomerRefund, 48);
    assert.equal(result.walletRestoredAmount, 10);
    assert.equal(result.externalRefundAmount, 38);
});

test('wallet-only refund is capped to the final returned amount after the fee', () => {
    const result = calculateRefund({
        transaction: transaction({
            paymentMethod: 'wallet',
            paymentProvider: 'internal_wallet',
            externalPaymentAmount: 0,
            walletAmountUsed: 50,
            paidAmount: 50,
            totalAmount: 50,
            processingFeeAmount: 0,
            processingFeeSource: 'none'
        }),
        requestedGrossRefund: 50,
        approvedPercentage: 100,
        acknowledgementAccepted: true
    });

    assert.equal(result.processingFeeDeduction, 2);
    assert.equal(result.netCustomerRefund, 48);
    assert.equal(result.walletRestoredAmount, 48);
    assert.equal(result.externalRefundAmount, 0);
});

test('final refund cannot become zero or negative after the fee', () => {
    assert.throws(() => calculateRefund({
        transaction: transaction({ externalPaymentAmount: 2, paidAmount: 2, totalAmount: 2 }),
        requestedGrossRefund: 2,
        approvedPercentage: 100,
        acknowledgementAccepted: true
    }), /must be more than the S\$2\.00 Refund Administration Fee/);
});

test('merchant partial-refund UI exposes only 25, 50 and 75 percent presets', () => {
    const template = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'support-ticket-card.ejs'), 'utf8');
    const presetArray = template.match(/\[\s*25,\s*50,\s*75\s*\]\.forEach/);
    assert.ok(presetArray);
    assert.equal(/\[25,\s*50,\s*75,\s*100\]/.test(template), false);
    assert.equal(template.includes('data-refund-preset="100"'), false);
});

test('merchant backend rejects unsupported partial refund percentages including 100', () => {
    const controller = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'helpCenterController.js'), 'utf8');
    assert.match(controller, /MERCHANT_PARTIAL_REFUND_PERCENTAGES\s*=\s*new Set\(\[25,\s*50,\s*75\]\)/);
    assert.match(controller, /Please select a valid partial refund percentage: 25%, 50% or 75%/);
    assert.match(controller, /parseMerchantPartialRefundPercentage\(body\.approvedPercentage\)/);
});
