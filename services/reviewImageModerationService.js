const { moderateReviewImage } = require('./groqService');

const IMAGE_MODERATION_FAILURE_REASON = 'Review image could not be verified. Please upload a different image. Images showing explicit nudity, blood, gore, knives, unsafe sharp objects, threatening weapons, hate symbols, illegal activity, or extremely offensive content are not allowed.';

async function moderateUploadedReviewImage(
    imageData,
    {
        moderateImage = moderateReviewImage,
        logger = console
    } = {}
) {
    try {
        const result = await moderateImage(imageData);

        if (result.recommendedAction !== 'approve') {
            return {
                allowed: false,
                result
            };
        }

        return {
            allowed: true,
            result
        };
    } catch (error) {
        logger?.warn?.('Review image moderation blocked upload:', error.code || error.message);

        return {
            allowed: false,
            result: {
                safe: false,
                requiresAdminReview: false,
                recommendedAction: 'reject',
                reason: IMAGE_MODERATION_FAILURE_REASON
            }
        };
    }
}

module.exports = {
    IMAGE_MODERATION_FAILURE_REASON,
    moderateUploadedReviewImage
};
