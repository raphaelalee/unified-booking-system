const express = require('express');
const aiController = require('../controllers/aiController');

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

// Customer review moderation endpoints. They return decisions only; they do not save or reject reviews.
router.post('/moderate-review-text', requireJsonRole('customer'), aiController.moderateReviewText);
router.post('/moderate-review-image', requireJsonRole('customer'), aiController.moderateReviewImage);

// Merchant recommendation endpoints. Recommendations are returned for merchant approval only.
router.post('/promotions', requireJsonRole('merchant'), aiController.generatePromotionRecommendations);
router.post('/vouchers', requireJsonRole('merchant'), aiController.generateVoucherRecommendations);
router.post('/review-reply', requireJsonRole('merchant'), aiController.generateReviewReply);

// Admin featured listing recommendation endpoints. They do not change featured status.
router.post('/featured-merchants', requireJsonRole('admin'), aiController.recommendFeaturedMerchants);
router.post('/featured-services', requireJsonRole('admin'), aiController.recommendFeaturedServices);
router.post('/featured-products', requireJsonRole('admin'), aiController.recommendFeaturedProducts);

module.exports = router;
