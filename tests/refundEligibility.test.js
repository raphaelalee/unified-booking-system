const test = require('node:test');
const assert = require('node:assert/strict');
const {
    evaluateBooking,
    evaluateOrder,
    getFulfilmentType,
    getOrderStatus
} = require('../services/refundEligibility');

function paidOrder(overrides = {}) {
    return {
        paymentStatus: 'paid',
        refundStatus: 'none',
        paidAmount: 100,
        refundedAmount: 0,
        totalAmount: 100,
        ...overrides
    };
}

test('delivered delivery order is eligible for return refund when delivered_at is authoritative', () => {
    const result = evaluateOrder(paidOrder({
        fulfilmentType: 'delivery',
        deliveryStatus: 'delivered',
        deliveredAt: new Date(Date.now() - 2 * 86400000)
    }));

    assert.equal(result.eligible, true);
    assert.equal(result.actionType, 'return_refund');
    assert.equal(result.statusCode, 'ELIGIBLE_DELIVERED_PRODUCT');
});

test('delivered delivery order without delivered_at goes to clear manual-review error', () => {
    const result = evaluateOrder(paidOrder({
        fulfilmentType: 'delivery',
        deliveryStatus: 'delivered'
    }));

    assert.equal(result.eligible, false);
    assert.equal(result.statusCode, 'DELIVERED_AT_REQUIRED');
});

test('explicit pickup is authoritative even when delivery_status says delivered', () => {
    const order = paidOrder({
        fulfilmentType: 'pickup',
        deliveryStatus: 'delivered',
        pickupStatus: 'picked_up',
        pickupVerifiedAt: new Date(Date.now() - 2 * 86400000)
    });

    assert.equal(getFulfilmentType(order), 'pickup');
    assert.equal(getOrderStatus(order), 'picked_up');

    const result = evaluateOrder(order);
    assert.equal(result.eligible, true);
    assert.equal(result.statusCode, 'ELIGIBLE_COLLECTED_PRODUCT');
});

test('pickup return window requires pickup verification or collection timestamp', () => {
    const result = evaluateOrder(paidOrder({
        fulfilmentType: 'pickup',
        pickupStatus: 'picked_up'
    }));

    assert.equal(result.eligible, false);
    assert.equal(result.statusCode, 'PICKUP_VERIFIED_AT_REQUIRED');
});

test('booking cutoff uses booking timeslot rather than date midnight', () => {
    const result = evaluateBooking({
        status: 'confirmed',
        refundStatus: 'none',
        paid_amount: 80,
        refunded_amount: 0,
        booking_date: '2099-01-01',
        booking_time: '23:30'
    });

    assert.equal(result.eligible, true);
    assert.equal(result.actionType, 'cancellation');
});
