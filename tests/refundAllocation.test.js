const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculatePointsRestored,
    calculateProcessingFeeForExternalPortion,
    calculateRefundFundingAllocation
} = require('../services/refundAllocation');

function transaction(overrides = {}) {
    return {
        transactionId: 101,
        paymentMethod: 'card',
        paymentProvider: 'stripe',
        externalPaymentAmount: 80,
        walletAmountUsed: 20,
        cashbackAmountUsed: 0,
        loyaltyPointsUsed: 0,
        loyaltyPointsValue: 0,
        voucherDiscountAmount: 0,
        paidAmount: 80,
        totalAmount: 100,
        ...overrides
    };
}

test('wallet one 50% refund restores proportional wallet amount', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction(),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50
    });
    assert.equal(result.walletRestoredAmount, 10);
    assert.equal(result.externalRefundAmount, 40);
});

test('wallet two partial refunds reaching 100% do not exceed original wallet contribution', () => {
    const second = calculateRefundFundingAllocation({
        transaction: transaction(),
        cumulativeGrossRefund: 100,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { wallet: 10 },
        previousRefundedByAllocationId: {}
    });
    assert.equal(second.walletRestoredAmount, 10);
    assert.equal(second.externalRefundAmount, 40);
});

test('wallet three partial refunds handles rounding and caps at original contribution', () => {
    const first = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 66.67, walletAmountUsed: 33.33, paidAmount: 66.67 }),
        cumulativeGrossRefund: 33.33,
        currentGrossRefund: 33.33,
        netCustomerRefund: 33.33
    });
    const second = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 66.67, walletAmountUsed: 33.33, paidAmount: 66.67 }),
        cumulativeGrossRefund: 66.66,
        currentGrossRefund: 33.33,
        netCustomerRefund: 33.33,
        previousSourceRefunds: { wallet: first.walletRestoredAmount }
    });
    const third = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 66.67, walletAmountUsed: 33.33, paidAmount: 66.67 }),
        cumulativeGrossRefund: 100,
        currentGrossRefund: 33.34,
        netCustomerRefund: 33.34,
        previousSourceRefunds: { wallet: first.walletRestoredAmount + second.walletRestoredAmount }
    });

    assert.equal(Number((first.walletRestoredAmount + second.walletRestoredAmount + third.walletRestoredAmount).toFixed(2)), 33.33);
});

test('full refund with points used restores points value and reduces external refund', () => {
    const trx = transaction({ externalPaymentAmount: 90, walletAmountUsed: 0, loyaltyPointsUsed: 1000, loyaltyPointsValue: 10, paidAmount: 90 });
    const result = calculateRefundFundingAllocation({
        transaction: trx,
        cumulativeGrossRefund: 100,
        currentGrossRefund: 100,
        netCustomerRefund: 100
    });
    const points = calculatePointsRestored({
        pointsUsed: trx.loyaltyPointsUsed,
        pointsValue: trx.loyaltyPointsValue,
        pointsValueRestored: result.pointsRestoredValue
    });
    assert.equal(result.pointsRestoredValue, 10);
    assert.equal(points, 1000);
    assert.equal(result.externalRefundAmount, 90);
});

test('partial refund with points used restores proportional points and reduces external refund', () => {
    const trx = transaction({ externalPaymentAmount: 90, walletAmountUsed: 0, loyaltyPointsUsed: 1000, loyaltyPointsValue: 10, paidAmount: 90 });
    const result = calculateRefundFundingAllocation({
        transaction: trx,
        cumulativeGrossRefund: 40,
        currentGrossRefund: 40,
        netCustomerRefund: 40
    });
    const points = calculatePointsRestored({
        pointsUsed: trx.loyaltyPointsUsed,
        pointsValue: trx.loyaltyPointsValue,
        pointsValueRestored: result.pointsRestoredValue
    });
    assert.equal(result.pointsRestoredValue, 4);
    assert.equal(points, 400);
    assert.equal(result.externalRefundAmount, 36);
});

test('multiple partial refunds with points used subtract previous points restored', () => {
    const trx = transaction({ externalPaymentAmount: 90, walletAmountUsed: 0, loyaltyPointsUsed: 1000, loyaltyPointsValue: 10, paidAmount: 90 });
    const points = calculatePointsRestored({
        pointsUsed: trx.loyaltyPointsUsed,
        pointsValue: trx.loyaltyPointsValue,
        pointsValueRestored: 10,
        previousPointsRestored: 400
    });
    assert.equal(points, 600);
});

test('full cashback restoration reduces external refund', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 85, walletAmountUsed: 0, cashbackAmountUsed: 15, paidAmount: 85 }),
        cumulativeGrossRefund: 100,
        currentGrossRefund: 100,
        netCustomerRefund: 100
    });
    assert.equal(result.cashbackRestoredAmount, 15);
    assert.equal(result.externalRefundAmount, 85);
});

test('partial and multiple cashback restoration uses cumulative previous amount', () => {
    const trx = transaction({ externalPaymentAmount: 85, walletAmountUsed: 0, cashbackAmountUsed: 15, paidAmount: 85 });
    const first = calculateRefundFundingAllocation({
        transaction: trx,
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50
    });
    const second = calculateRefundFundingAllocation({
        transaction: trx,
        cumulativeGrossRefund: 100,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { cashback: first.cashbackRestoredAmount }
    });
    assert.equal(first.cashbackRestoredAmount, 7.5);
    assert.equal(second.cashbackRestoredAmount, 7.5);
});

test('mixed external plus wallet allocation', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 70, walletAmountUsed: 30, paidAmount: 70 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50
    });
    assert.equal(result.walletRestoredAmount, 15);
    assert.equal(result.externalRefundAmount, 35);
});

test('mixed external plus points allocation', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 75, walletAmountUsed: 0, loyaltyPointsValue: 25, loyaltyPointsUsed: 2500, paidAmount: 75 }),
        cumulativeGrossRefund: 40,
        currentGrossRefund: 40,
        netCustomerRefund: 40
    });
    assert.equal(result.pointsRestoredValue, 10);
    assert.equal(result.externalRefundAmount, 30);
});

test('mixed external plus cashback allocation', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 60, walletAmountUsed: 0, cashbackAmountUsed: 40, paidAmount: 60 }),
        cumulativeGrossRefund: 25,
        currentGrossRefund: 25,
        netCustomerRefund: 25
    });
    assert.equal(result.cashbackRestoredAmount, 10);
    assert.equal(result.externalRefundAmount, 15);
});

test('mixed external plus wallet plus points plus cashback allocation', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 50, walletAmountUsed: 20, cashbackAmountUsed: 10, loyaltyPointsValue: 20, loyaltyPointsUsed: 2000, paidAmount: 50 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50
    });
    assert.equal(result.walletRestoredAmount, 10);
    assert.equal(result.cashbackRestoredAmount, 5);
    assert.equal(result.pointsRestoredValue, 10);
    assert.equal(result.externalRefundAmount, 25);
});

test('voucher plus external payment does not refund voucher as cash', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 0, voucherDiscountAmount: 20, paidAmount: 80, totalAmount: 100 }),
        cumulativeGrossRefund: 80,
        currentGrossRefund: 80,
        netCustomerRefund: 80
    });
    assert.equal(result.voucherNonRefundableAmount, 20);
    assert.equal(result.externalRefundAmount, 80);
});

test('processing fee applies only to external portion', () => {
    const fee = calculateProcessingFeeForExternalPortion({
        originalProcessingFee: 1,
        originalExternalPaid: 50,
        cumulativeExternalGrossRefunded: 25,
        responsibility: 'customer',
        acknowledgementAccepted: true
    });
    assert.equal(fee.processingFeeDeduction, 0.5);
});

test('multiple partial processing fees do not exceed original fee', () => {
    const fee = calculateProcessingFeeForExternalPortion({
        originalProcessingFee: 0.95,
        originalExternalPaid: 100,
        cumulativeExternalGrossRefunded: 100,
        previousFeeDeductions: 0.38,
        responsibility: 'customer',
        acknowledgementAccepted: true
    });
    assert.equal(fee.processingFeeDeduction, 0.57);
});

test('merchant fee loss is not duplicated across partial refunds', () => {
    const fee = calculateProcessingFeeForExternalPortion({
        originalProcessingFee: 0.95,
        originalExternalPaid: 100,
        cumulativeExternalGrossRefunded: 100,
        previousMerchantFeeLoss: 0.38,
        responsibility: 'merchant',
        acknowledgementAccepted: false
    });
    assert.equal(fee.merchantProcessingFeeLoss, 0.57);
});

test('duplicate calculation with previous restored amounts has no duplicate side effect amount', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 20, paidAmount: 80 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { wallet: 10 }
    });
    assert.equal(result.walletRestoredAmount, 0);
});

test('provider timeout safe retry uses same allocation totals', () => {
    const first = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 20, paidAmount: 80 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50
    });
    const retry = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 20, paidAmount: 80 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { wallet: first.walletRestoredAmount }
    });
    assert.equal(retry.walletRestoredAmount, 0);
    assert.equal(retry.externalRefundAmount, 40);
});

test('two simultaneous refund calculations are bounded by locked previous source totals', () => {
    const first = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 20, paidAmount: 80 }),
        cumulativeGrossRefund: 60,
        currentGrossRefund: 60,
        netCustomerRefund: 60
    });
    const secondAfterLock = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 80, walletAmountUsed: 20, paidAmount: 80 }),
        cumulativeGrossRefund: 100,
        currentGrossRefund: 40,
        netCustomerRefund: 40,
        previousSourceRefunds: { wallet: first.walletRestoredAmount }
    });
    assert.equal(first.walletRestoredAmount + secondAfterLock.walletRestoredAmount, 20);
    assert.equal(first.externalRefundAmount + secondAfterLock.externalRefundAmount, 80);
});

test('duplicate merchant confirmation does not create another internal restoration amount', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 70, walletAmountUsed: 30, paidAmount: 70 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { wallet: 15 }
    });
    assert.equal(result.walletRestoredAmount, 0);
    assert.equal(result.totalCustomerValueReturned, 35);
});

test('duplicate provider webhook does not allocate another processing fee', () => {
    const fee = calculateProcessingFeeForExternalPortion({
        originalProcessingFee: 1,
        originalExternalPaid: 100,
        cumulativeExternalGrossRefunded: 50,
        previousFeeDeductions: 0.5,
        responsibility: 'customer',
        acknowledgementAccepted: true
    });
    assert.equal(fee.processingFeeDeduction, 0);
    assert.equal(fee.merchantProcessingFeeLoss, 0);
});

test('duplicate reward adjustment execution has no additional wallet or cashback value', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 60, walletAmountUsed: 20, cashbackAmountUsed: 20, paidAmount: 60 }),
        cumulativeGrossRefund: 50,
        currentGrossRefund: 50,
        netCustomerRefund: 50,
        previousSourceRefunds: { wallet: 10, cashback: 10 }
    });
    assert.equal(result.walletRestoredAmount, 0);
    assert.equal(result.cashbackRestoredAmount, 0);
});

test('customer value returned never exceeds approved net refund', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 50, walletAmountUsed: 20, cashbackAmountUsed: 10, loyaltyPointsValue: 20, loyaltyPointsUsed: 2000, paidAmount: 50 }),
        cumulativeGrossRefund: 80,
        currentGrossRefund: 80,
        netCustomerRefund: 77
    });
    assert.ok(result.totalCustomerValueReturned <= 77);
});

test('final partial refund clears remaining internal balances exactly', () => {
    const result = calculateRefundFundingAllocation({
        transaction: transaction({ externalPaymentAmount: 33.33, walletAmountUsed: 33.33, cashbackAmountUsed: 33.34, paidAmount: 33.33 }),
        cumulativeGrossRefund: 100,
        currentGrossRefund: 33.34,
        netCustomerRefund: 33.34,
        previousSourceRefunds: { wallet: 22.22, cashback: 22.22 }
    });
    assert.equal(Number((22.22 + result.walletRestoredAmount).toFixed(2)), 33.33);
    assert.equal(Number((22.22 + result.cashbackRestoredAmount).toFixed(2)), 33.34);
});
