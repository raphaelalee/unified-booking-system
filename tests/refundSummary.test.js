const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeRefundRows } = require('../services/refundSummary');

test('refund summary separates confirmed customer returns from reserved pending refunds', () => {
    const summary = summarizeRefundRows([
        {
            refund_id: 2,
            transaction_id: 77,
            refund_reference: 'RF-77-2',
            refund_status: 'processing',
            gross_refund_amount: 20,
            net_refund_amount: 19,
            external_refund_amount: 19,
            processing_fee_deduction: 1,
            created_at: '2026-07-20 10:00:00'
        },
        {
            refund_id: 1,
            transaction_id: 77,
            refund_reference: 'RF-77-1',
            refund_status: 'succeeded',
            gross_refund_amount: 30,
            net_refund_amount: 28,
            external_refund_amount: 28,
            wallet_restored_amount: 2,
            points_restored: 100,
            cashback_reversed_amount: 1.5,
            completed_at: '2026-07-19 10:00:00'
        }
    ], {
        originalAmountPaid: 100,
        orderReference: 'ORD-77'
    });

    assert.equal(summary.cumulativeGrossRefunded, 30);
    assert.equal(summary.cumulativeNetRefunded, 28);
    assert.equal(summary.cumulativeReservedGrossRefunded, 50);
    assert.equal(summary.remainingRefundableAmount, 50);
    assert.equal(summary.walletRestored, 2);
    assert.equal(summary.pointsRestored, 100);
    assert.equal(summary.cashbackReversed, 1.5);
    assert.equal(summary.refundStatus, 'processing');
    assert.equal(summary.latestRefundReference, 'RF-77-2');
});

test('refund summary provides historical fallbacks when references are missing', () => {
    const summary = summarizeRefundRows([
        {
            refund_id: 8,
            transaction_id: 91,
            refund_status: 'refunded',
            refund_amount: 10,
            created_at: '2026-07-18 10:00:00'
        }
    ], {
        originalAmountPaid: 15
    });

    assert.equal(summary.refundReference, 'RF-8');
    assert.equal(summary.orderReference, '#91');
    assert.equal(summary.cumulativeGrossRefunded, 10);
    assert.equal(summary.remainingRefundableAmount, 5);
});
