const assert = require('node:assert/strict');
const test = require('node:test');

const {
    normalizeActionProposal
} = require('../services/aiActionProposalService');
const db = require('../db');

test.after(async () => {
    await new Promise((resolve) => {
        setTimeout(resolve, 200);
    });
    db.end?.();
});

const context = {
    recordAllowlist: {
        services: [{ serviceId: 10, name: 'Facial', price: 88 }],
        products: [{ productId: 20, name: 'Serum', stockQuantity: 3 }]
    }
};

test('AI action normalizer rejects unknown action types', () => {
    assert.throws(() => normalizeActionProposal({ actionType: 'delete_everything' }, context), /Unknown AI action type/);
});

test('AI action normalizer strips unexpected fields and unsafe text', () => {
    const proposal = normalizeActionProposal({
        actionType: 'create_promotion',
        riskLevel: 'prepare_for_confirmation',
        title: '<b>DROP promotion</b>',
        reason: 'Use this http://example.com INSERT idea',
        proposedState: {
            promotionName: '<script>alert(1)</script> Tuesday special',
            discountType: 'percentage',
            discountValue: 10,
            startDate: '2026-08-01',
            endDate: '2026-08-08',
            serviceIds: [10],
            evilSql: 'DROP TABLE users'
        },
        rootOnly: true
    }, context);

    assert.equal(proposal.actionType, 'create_promotion');
    assert.equal(proposal.title, 'promotion');
    assert.equal(proposal.reason, 'Use this idea');
    assert.equal(proposal.proposedState.promotionName, 'alert(1) Tuesday special');
    assert.equal(proposal.proposedState.evilSql, undefined);
    assert.equal(proposal.rootOnly, undefined);
});

test('AI proposal service validates merchant-owned service and product allowlists', () => {
    assert.throws(() => normalizeActionProposal({
        actionType: 'change_service_price',
        riskLevel: 'prepare_for_confirmation',
        currentState: { serviceId: 999, serviceName: 'Other service', price: 20 },
        proposedState: { price: 22 }
    }, context), /service was not in the supplied merchant allowlist/);

    assert.throws(() => normalizeActionProposal({
        actionType: 'adjust_inventory',
        riskLevel: 'prepare_for_confirmation',
        currentState: { productId: 999, productName: 'Other product', stock: 0 },
        proposedState: { stockAdjustment: 5 }
    }, context), /product was not in the supplied merchant allowlist/);
});

test('recommendation-only AI actions cannot become executable', () => {
    const proposal = normalizeActionProposal({
        actionType: 'recommend_refund_decision',
        riskLevel: 'execute_after_confirmation',
        proposedState: {
            recommendation: 'partial_refund',
            suggestedPercentage: 50
        }
    }, context);

    assert.equal(proposal.riskLevel, 'recommend_only');
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(proposal.proposedState.suggestedPercentage, 50);
});

test('partial refund recommendation presets are limited to 25, 50 or 75 percent', () => {
    const proposal = normalizeActionProposal({
        actionType: 'recommend_refund_decision',
        riskLevel: 'recommend_only',
        proposedState: {
            recommendation: 'partial_refund',
            suggestedPercentage: 100
        }
    }, context);

    assert.equal(proposal.proposedState.suggestedPercentage, null);
});

test('Spin and Discover recommendations remain review-only', () => {
    const proposal = normalizeActionProposal({
        actionType: 'recommend_promotion',
        riskLevel: 'execute_after_confirmation',
        title: 'Review Spin & Discover Rewards',
        reason: 'AI reviewed wheel wins, redemptions and conversion.',
        evidence: [
            'Spin data: 12 wins, 3 active rewards.',
            'Weak redemption: $10 voucher at 5% conversion.'
        ],
        proposedState: {
            recommendation: 'review_spin_rewards'
        }
    }, context);

    assert.equal(proposal.actionType, 'recommend_promotion');
    assert.equal(proposal.riskLevel, 'recommend_only');
    assert.equal(proposal.requiresConfirmation, false);
    assert.deepEqual(proposal.proposedState, {});
    assert.equal(proposal.evidence.length, 2);
});
