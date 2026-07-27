const express = require('express');
const aiController = require('../controllers/aiController');
const db = require('../db');

const router = express.Router();

function requireJsonRole(...roles) {
    return (req, res, next) => {
        const user = req.session.user;

        if (!user) {
            return res.status(401).json({
                error: 'UNAUTHENTICATED',
                message: 'Please log in before using this AI endpoint.'
            });
        }

        if (!roles.includes(user.role)) {
            return res.status(403).json({
                error: 'FORBIDDEN',
                message: 'You do not have permission to use this AI endpoint.'
            });
        }

        return next();
    };
}

function requireJsonApprovedMerchant(req, res, next) {
    const user = req.session.user;

    if (!user) {
        return res.status(401).json({
            error: 'UNAUTHENTICATED',
            message: 'Please log in before using this AI endpoint.'
        });
    }

    if (user.role !== 'merchant') {
        return res.status(403).json({
            error: 'FORBIDDEN',
            message: 'You do not have permission to use this AI endpoint.'
        });
    }

    db.query(
        'SELECT approval_status FROM salons WHERE merchant_id = ? LIMIT 1',
        [user.id],
        (error, rows = []) => {
            if (error) {
                console.error('AI merchant approval check failed:', {
                    message: error.message
                });
                return res.status(500).json({
                    error: 'MERCHANT_STATUS_CHECK_FAILED',
                    message: 'Merchant approval status could not be checked.'
                });
            }

            const status = rows[0]?.approval_status || 'pending_review';
            req.session.user.merchantApprovalStatus = status;

            if (status !== 'approved') {
                return res.status(403).json({
                    error: 'MERCHANT_NOT_APPROVED',
                    message: 'Your merchant account must be approved before using analytics AI.'
                });
            }

            return next();
        }
    );
}

// Customer review moderation endpoints. They return decisions only; they do not save or reject reviews.
router.post('/moderate-review-text', requireJsonRole('customer'), aiController.moderateReviewText);
router.post('/moderate-review-image', requireJsonRole('customer'), aiController.moderateReviewImage);

// Merchant recommendation endpoints. Recommendations are returned for merchant approval only.
router.post('/merchant/business-insights', requireJsonApprovedMerchant, aiController.generateMerchantBusinessInsights);
router.post('/merchant/ask-analytics', requireJsonApprovedMerchant, aiController.answerMerchantAnalyticsQuestion);
router.post('/merchant/action-proposal', requireJsonApprovedMerchant, aiController.createMerchantActionProposal);
router.post('/merchant/schedule-recommendations', requireJsonApprovedMerchant, aiController.getMerchantScheduleRecommendations);
router.post('/merchant/smart-reminders', requireJsonApprovedMerchant, aiController.getMerchantSmartReminders);
router.post('/merchant/reminders/dismiss', requireJsonApprovedMerchant, aiController.dismissMerchantAiReminder);
router.post('/merchant/reminders/mark-done', requireJsonApprovedMerchant, aiController.markMerchantAiReminderDone);
router.post('/merchant/reminder-proposal', requireJsonApprovedMerchant, aiController.createMerchantReminderProposal);
router.post('/merchant/actions/confirm-promotion', requireJsonApprovedMerchant, aiController.confirmAiPromotion);
router.post('/merchant/actions/confirm-price-change', requireJsonApprovedMerchant, aiController.confirmAiPriceChange);
router.post('/merchant/actions/confirm-inventory-change', requireJsonApprovedMerchant, aiController.confirmAiInventoryChange);
router.post('/merchant/actions/confirm-reminder', requireJsonApprovedMerchant, aiController.confirmAiReminder);
router.post('/merchant/actions/confirm-schedule-change', requireJsonApprovedMerchant, aiController.confirmAiScheduleChange);
router.post('/promotions', requireJsonRole('merchant'), aiController.generatePromotionRecommendations);
router.post('/vouchers', requireJsonRole('merchant'), aiController.generateVoucherRecommendations);
router.post('/review-reply', requireJsonRole('merchant'), aiController.generateReviewReply);

// Admin featured listing recommendation endpoints. They do not change featured status.
router.post('/admin/platform-insights', requireJsonRole('admin'), aiController.generateAdminPlatformInsights);
router.post('/admin/ask-analytics', requireJsonRole('admin'), aiController.answerAdminAnalyticsQuestion);
router.post('/admin/action-proposal', requireJsonRole('admin'), aiController.createAdminActionProposal);
router.get('/admin/health-check', requireJsonRole('admin'), aiController.runDevelopmentAiHealthCheck);
router.post('/admin/platform-vouchers', requireJsonRole('admin'), aiController.generatePlatformVoucherRecommendations);
router.post('/featured-merchants', requireJsonRole('admin'), aiController.recommendFeaturedMerchants);
router.post('/featured-services', requireJsonRole('admin'), aiController.recommendFeaturedServices);
router.post('/featured-products', requireJsonRole('admin'), aiController.recommendFeaturedProducts);

module.exports = router;
