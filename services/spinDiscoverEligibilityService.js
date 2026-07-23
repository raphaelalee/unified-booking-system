const CashbackCampaign = require('../models/CashbackCampaign');
const Promotion = require('../models/Promotion');
const RewardVoucher = require('../models/RewardVoucher');

function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isActiveDateWindow(startValue, endValue, now = new Date()) {
    const start = startValue ? new Date(startValue) : null;
    const end = endValue ? new Date(endValue) : null;

    if (start && !Number.isNaN(start.getTime()) && start > now) {
        return { ok: false, reason: 'Starts in the future' };
    }

    if (end && !Number.isNaN(end.getTime()) && end < now) {
        return { ok: false, reason: 'Expired' };
    }

    return { ok: true, reason: 'Active on wheel' };
}

function limitReason(record) {
    const claimLimit = record.spinClaimLimit === null || record.spinClaimLimit === undefined ? null : asNumber(record.spinClaimLimit);
    const claimCount = asNumber(record.spinClaimCount);
    const remaining = record.spinInventoryRemaining === null || record.spinInventoryRemaining === undefined ? null : asNumber(record.spinInventoryRemaining);

    if (claimLimit !== null && claimCount >= claimLimit) {
        return 'Claim limit reached';
    }

    if (remaining !== null && remaining <= 0) {
        return 'No inventory remaining';
    }

    return '';
}

function validateRewardValue(record) {
    const discountValue = record.discountValue === null || record.discountValue === undefined ? null : asNumber(record.discountValue);
    if (record.discountType && !['percentage', 'fixed', 'fixed_amount', 'fixed_price', 'tag_only'].includes(record.discountType)) {
        return 'Invalid reward configuration';
    }

    if (record.discountType !== 'tag_only' && (discountValue === null || discountValue <= 0) && record.rewardKind !== 'cashback_campaign') {
        return 'Invalid reward configuration';
    }

    if (record.discountType === 'percentage' && discountValue > 100) {
        return 'Invalid reward configuration';
    }

    return '';
}

function getPromotionEligibility(promotion, options = {}) {
    if (!promotion) return { eligible: false, reason: 'Missing reward' };
    if (options.requireSelected !== false && !promotion.spinEligible) return { eligible: false, reason: 'Not selected for wheel' };
    if (String(promotion.status || '').toLowerCase() !== 'active') return { eligible: false, reason: 'Inactive' };

    const rewardType = promotion.spinRewardType || (promotion.productId ? 'product_discount' : (promotion.serviceId ? 'service_discount' : 'promotion'));
    if (!['service_discount', 'product_discount', 'promotion', 'cashback'].includes(rewardType)) {
        return { eligible: false, reason: 'Invalid reward configuration' };
    }
    if (rewardType === 'service_discount' && !promotion.serviceId) return { eligible: false, reason: 'Linked service unavailable' };
    if (rewardType === 'product_discount' && !promotion.productId) return { eligible: false, reason: 'Linked product unavailable' };

    const valueProblem = validateRewardValue(promotion);
    if (valueProblem) return { eligible: false, reason: valueProblem };

    const dateStatus = isActiveDateWindow(promotion.startDate, promotion.endDate);
    if (!dateStatus.ok) return { eligible: false, reason: dateStatus.reason };

    const limited = limitReason(promotion);
    if (limited) return { eligible: false, reason: limited };

    return { eligible: true, reason: 'Active on wheel' };
}

function getVoucherEligibility(voucher, options = {}) {
    if (!voucher) return { eligible: false, reason: 'Missing reward' };
    if (voucher.voucherSource !== 'merchant') return { eligible: false, reason: 'Platform managed' };
    if (options.requireSelected !== false && !voucher.spinEnabled) return { eligible: false, reason: 'Not selected for wheel' };
    if (String(voucher.status || '').toLowerCase() !== 'active') return { eligible: false, reason: 'Inactive' };

    if (voucher.linkedItemType === 'service' && !voucher.linkedServiceId && !voucher.linkedItemId) return { eligible: false, reason: 'Linked service unavailable' };
    if (voucher.linkedItemType === 'product' && !voucher.linkedProductId && !voucher.linkedItemId) return { eligible: false, reason: 'Linked product unavailable' };

    const valueProblem = validateRewardValue(voucher);
    if (valueProblem) return { eligible: false, reason: valueProblem };

    const dateStatus = isActiveDateWindow(voucher.startDate, voucher.expiryDate);
    if (!dateStatus.ok) return { eligible: false, reason: dateStatus.reason };

    const limited = limitReason(voucher);
    if (limited) return { eligible: false, reason: limited };

    return { eligible: true, reason: 'Active on wheel' };
}

function getCashbackEligibility(campaign, options = {}) {
    if (!campaign) return { eligible: false, reason: 'Missing reward' };
    if (options.requireSelected !== false && !campaign.spinEnabled) return { eligible: false, reason: 'Not selected for wheel' };
    if (String(campaign.status || '').toLowerCase() !== 'active') return { eligible: false, reason: 'Inactive' };
    if (asNumber(campaign.cashbackPercent) <= 0 || asNumber(campaign.cashbackPercent) > 100) return { eligible: false, reason: 'Invalid reward configuration' };

    const dateStatus = isActiveDateWindow(campaign.startAt, campaign.endAt);
    if (!dateStatus.ok) return { eligible: false, reason: dateStatus.reason };

    const limited = limitReason(campaign);
    if (limited) return { eligible: false, reason: limited };

    return { eligible: true, reason: 'Active on wheel' };
}

function decoratePromotion(promotion) {
    const eligibility = getPromotionEligibility(promotion);
    return {
        ...promotion,
        rewardKind: 'promotion',
        rewardCategory: promotion.spinRewardType || (promotion.productId ? 'product_discount' : (promotion.serviceId ? 'service_discount' : 'promotion')),
        rewardName: promotion.title,
        linkedName: promotion.serviceName || promotion.productName || 'All merchant listings',
        availabilityReason: eligibility.reason,
        wheelEligibleNow: eligibility.eligible,
        wheelSelected: promotion.spinEligible,
        issuedCount: asNumber(promotion.spinClaimCount),
        redeemedCount: asNumber(promotion.redemptionCount),
        conversionRate: asNumber(promotion.spinClaimCount) > 0 ? Math.round((asNumber(promotion.redemptionCount) / asNumber(promotion.spinClaimCount)) * 100) : 0
    };
}

function decorateVoucher(voucher) {
    const eligibility = getVoucherEligibility(voucher);
    return {
        ...voucher,
        rewardKind: 'voucher',
        rewardCategory: voucher.linkedItemType === 'product' ? 'product_discount' : (voucher.linkedItemType === 'service' ? 'service_discount' : 'voucher'),
        rewardName: voucher.title,
        linkedName: voucher.linkedItemName || voucher.linkedServiceName || voucher.linkedProductName || 'Merchant reward',
        availabilityReason: eligibility.reason,
        wheelEligibleNow: eligibility.eligible,
        wheelSelected: voucher.spinEnabled,
        issuedCount: asNumber(voucher.spinClaimCount),
        redeemedCount: asNumber(voucher.redemptionCount),
        conversionRate: asNumber(voucher.spinClaimCount) > 0 ? Math.round((asNumber(voucher.redemptionCount) / asNumber(voucher.spinClaimCount)) * 100) : 0
    };
}

function decorateCashback(campaign) {
    const eligibility = getCashbackEligibility(campaign);
    return {
        ...campaign,
        rewardKind: 'cashback_campaign',
        rewardCategory: 'cashback',
        rewardName: campaign.title,
        linkedName: campaign.applicableType,
        availabilityReason: eligibility.reason,
        wheelEligibleNow: eligibility.eligible,
        wheelSelected: campaign.spinEnabled,
        issuedCount: asNumber(campaign.spinClaimCount),
        redeemedCount: 0,
        conversionRate: 0
    };
}

function buildMerchantSpinDashboard(userId, callback) {
    Promotion.getByMerchantUserId(userId, (promotionError, promotions = []) => {
        if (promotionError) return callback(promotionError);

        RewardVoucher.getByMerchantUserId(userId, (voucherError, vouchers = []) => {
            if (voucherError) return callback(voucherError);

            CashbackCampaign.getByMerchantUserId(userId, (campaignError, campaigns = []) => {
                if (campaignError) return callback(campaignError);

                const rewards = [
                    ...promotions.map(decoratePromotion),
                    ...vouchers.map(decorateVoucher),
                    ...campaigns.map(decorateCashback)
                ];
                const active = rewards.filter((reward) => reward.wheelEligibleNow);
                const selected = rewards.filter((reward) => reward.wheelSelected);
                const expired = rewards.filter((reward) => reward.availabilityReason === 'Expired');
                const depleted = rewards.filter((reward) => ['Claim limit reached', 'No inventory remaining'].includes(reward.availabilityReason));
                const remainingInventory = selected.reduce((total, reward) => (
                    reward.spinInventoryRemaining === null || reward.spinInventoryRemaining === undefined
                        ? total
                        : total + asNumber(reward.spinInventoryRemaining)
                ), 0);

                callback(null, {
                    rewards,
                    active,
                    unavailable: rewards.filter((reward) => !reward.wheelEligibleNow),
                    stats: {
                        activeCount: active.length,
                        inactiveCount: Math.max(0, rewards.length - active.length),
                        expiredCount: expired.length,
                        depletedCount: depleted.length,
                        totalWins: rewards.reduce((total, reward) => total + asNumber(reward.spinClaimCount), 0),
                        remainingInventory
                    }
                });
            });
        });
    });
}

module.exports = {
    buildMerchantSpinDashboard,
    decorateCashback,
    decoratePromotion,
    decorateVoucher,
    getCashbackEligibility,
    getPromotionEligibility,
    getVoucherEligibility
};
