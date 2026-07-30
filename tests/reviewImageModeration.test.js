const assert = require('node:assert/strict');
const test = require('node:test');

const {
    normalizeImageModerationResult
} = require('../services/groqService');
const {
    moderateUploadedReviewImage
} = require('../services/reviewImageModerationService');

function safeResult(overrides = {}) {
    return {
        safe: true,
        relatedToReview: true,
        requiresAdminReview: false,
        detectedContent: 'A shampoo bottle on a bathroom shelf.',
        categories: {
            sexualContent: false,
            graphicViolence: false,
            offensiveContent: false,
            unrelatedContent: false,
            visibleBlood: false,
            visibleInjury: false,
            sharpObject: false,
            dangerousWeapon: false,
            benignProfessionalTool: false,
            gore: false,
            threateningWeapon: false,
            illegalActivity: false,
            hateSymbol: false
        },
        confidence: 0.98,
        reason: 'Normal product review image.',
        recommendedAction: 'approve',
        ...overrides
    };
}

test('safe product photo remains approved', () => {
    const result = normalizeImageModerationResult(safeResult());

    assert.equal(result.safe, true);
    assert.equal(result.recommendedAction, 'approve');
});

test('visible blood is rejected even when the model recommends approval', () => {
    const result = normalizeImageModerationResult(safeResult({
        categories: {
            ...safeResult().categories,
            visibleBlood: true
        },
        recommendedAction: 'approve'
    }));

    assert.equal(result.safe, false);
    assert.equal(result.categories.visibleBlood, true);
    assert.equal(result.recommendedAction, 'reject');
});

test('a knife or dangerous weapon is always rejected', () => {
    const result = normalizeImageModerationResult(safeResult({
        detectedContent: 'A knife is visible.',
        categories: {
            ...safeResult().categories,
            sharpObject: true,
            dangerousWeapon: true
        }
    }));

    assert.equal(result.safe, false);
    assert.equal(result.categories.dangerousWeapon, true);
    assert.equal(result.recommendedAction, 'reject');
});

test('sharp object with red substance is rejected despite false model flags', () => {
    const result = normalizeImageModerationResult(safeResult({
        detectedContent: 'A sharp object is covered with a red substance.',
        categories: safeResult().categories
    }));

    assert.equal(result.safe, false);
    assert.equal(result.categories.sharpObject, true);
    assert.equal(result.categories.visibleBlood, true);
    assert.equal(result.recommendedAction, 'reject');
});

test('ordinary salon scissors can be approved only as a benign professional tool', () => {
    const result = normalizeImageModerationResult(safeResult({
        detectedContent: 'Hair scissors used during a normal haircut.',
        categories: {
            ...safeResult().categories,
            sharpObject: true,
            benignProfessionalTool: true
        }
    }));

    assert.equal(result.safe, true);
    assert.equal(result.recommendedAction, 'approve');
});

test('negated hazard descriptions do not create false positives', () => {
    const result = normalizeImageModerationResult(safeResult({
        detectedContent: 'No sharp object, blood, injury, or weapon is visible.',
        reason: 'The image does not show blood or a knife.'
    }));

    assert.equal(result.categories.visibleBlood, false);
    assert.equal(result.categories.sharpObject, false);
    assert.equal(result.categories.dangerousWeapon, false);
    assert.equal(result.safe, true);
});

test('string false category values are not treated as true', () => {
    const result = normalizeImageModerationResult(safeResult({
        categories: Object.fromEntries(
            Object.keys(safeResult().categories).map((key) => [key, 'false'])
        )
    }));

    assert.equal(result.safe, true);
    assert.equal(result.categories.visibleBlood, false);
    assert.equal(result.categories.dangerousWeapon, false);
});

test('explicit model rejection cannot be normalized into approval', () => {
    const result = normalizeImageModerationResult(safeResult({
        safe: false,
        recommendedAction: 'reject',
        reason: 'Unsafe image.'
    }));

    assert.equal(result.safe, false);
    assert.equal(result.recommendedAction, 'reject');
});

test('low-confidence safety decisions are blocked for manual review', () => {
    const result = normalizeImageModerationResult(safeResult({
        confidence: 0.2
    }));

    assert.equal(result.safe, false);
    assert.equal(result.requiresAdminReview, true);
    assert.equal(result.recommendedAction, 'send_for_admin_review');
});

test('vision provider errors fail closed instead of allowing the upload', async () => {
    const logger = { warn() {} };
    const result = await moderateUploadedReviewImage(
        { imageBase64: 'data:image/jpeg;base64,AA==' },
        {
            logger,
            moderateImage: async () => {
                const error = new Error('model not found');
                error.code = 'model_not_found';
                throw error;
            }
        }
    );

    assert.equal(result.allowed, false);
    assert.equal(result.result.safe, false);
    assert.equal(result.result.recommendedAction, 'reject');
    assert.match(result.result.reason, /could not be verified/i);
});

test('moderation rejection is preserved by the upload guard', async () => {
    const result = await moderateUploadedReviewImage(
        { imageBase64: 'data:image/jpeg;base64,AA==' },
        {
            moderateImage: async () => normalizeImageModerationResult(safeResult({
                categories: {
                    ...safeResult().categories,
                    dangerousWeapon: true
                }
            }))
        }
    );

    assert.equal(result.allowed, false);
    assert.equal(result.result.recommendedAction, 'reject');
});
