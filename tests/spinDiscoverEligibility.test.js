const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
    getCashbackEligibility,
    getPromotionEligibility,
    getVoucherEligibility
} = require('../services/spinDiscoverEligibilityService');
const db = require('../db');

test.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    db.end?.();
});

test('promotion eligibility accepts active selected service rewards', () => {
    const result = getPromotionEligibility({
        spinEligible: true,
        spinRewardType: 'service_discount',
        status: 'active',
        serviceId: 4,
        discountType: 'percentage',
        discountValue: 10,
        startDate: '2026-07-01',
        endDate: '2026-12-31',
        spinClaimLimit: 10,
        spinClaimCount: 2,
        spinInventoryRemaining: 8
    });

    assert.deepEqual(result, { eligible: true, reason: 'Active on wheel' });
});

test('promotion eligibility rejects unsupported legacy wheel reward types', () => {
    const result = getPromotionEligibility({
        spinEligible: true,
        spinRewardType: 'free_add_on',
        status: 'active',
        serviceId: 4,
        discountType: 'percentage',
        discountValue: 10,
        startDate: '2026-07-01',
        endDate: '2026-12-31'
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'Invalid reward configuration');
});

test('voucher eligibility requires explicit wheel selection and remaining inventory', () => {
    const baseVoucher = {
        voucherSource: 'merchant',
        spinEnabled: true,
        status: 'active',
        linkedItemType: 'product',
        linkedProductId: 7,
        discountType: 'fixed',
        discountValue: 5,
        startDate: '2026-07-01',
        expiryDate: '2026-12-31',
        spinClaimLimit: 2,
        spinClaimCount: 1,
        spinInventoryRemaining: 1
    };

    assert.equal(getVoucherEligibility(baseVoucher).eligible, true);
    assert.equal(getVoucherEligibility({ ...baseVoucher, spinEnabled: false }).reason, 'Not selected for wheel');
    assert.equal(getVoucherEligibility({ ...baseVoucher, spinInventoryRemaining: 0 }).reason, 'No inventory remaining');
});

test('cashback campaign eligibility is explicit and does not accept invalid percentages', () => {
    const result = getCashbackEligibility({
        spinEnabled: true,
        status: 'active',
        cashbackPercent: 8,
        startAt: '2026-07-01',
        endAt: '2026-12-31',
        spinClaimLimit: null,
        spinInventoryRemaining: null,
        spinClaimCount: 0
    });

    assert.equal(result.eligible, true);
    assert.equal(getCashbackEligibility({
        spinEnabled: false,
        status: 'active',
        cashbackPercent: 8,
        startAt: '2026-07-01',
        endAt: '2026-12-31'
    }).eligible, false);
    assert.equal(getCashbackEligibility({ spinEnabled: true, status: 'active', cashbackPercent: 101 }).reason, 'Invalid reward configuration');
});

test('customer spin page no longer exposes internal technical copy', () => {
    const view = fs.readFileSync('views/spin-discover.ejs', 'utf8');

    assert.equal(view.includes('MySQL'), false);
    assert.equal(view.includes('Backend verified rewards'), false);
    assert.equal(view.includes('backend chooses'), false);
    assert.equal(view.includes('reward payload'), false);
});
