function createAiPermissionError(message, code = 'AI_PERMISSION_DENIED', status = 403) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function validateAiRequestPermissions({ req, role, intent, entities = {} }) {
    const user = req.session?.user;

    if (!user) {
        throw createAiPermissionError('Please log in before using the AI assistant.', 'UNAUTHENTICATED', 401);
    }

    if (user.role !== role) {
        throw createAiPermissionError('This AI assistant is not available for your account role.', 'ROLE_MISMATCH', 403);
    }

    if (role === 'merchant') {
        if (intent.startsWith('admin_')) {
            throw createAiPermissionError('Platform-level information is available only to administrators.', 'ADMIN_DATA_RESTRICTED', 403);
        }

        if (entities.merchantId && Number(entities.merchantId) !== Number(user.id)) {
            throw createAiPermissionError('I can only analyse your own merchant data from this account.', 'CROSS_MERCHANT_RESTRICTED', 403);
        }
    }

    if (role === 'admin' && intent.startsWith('merchant_')) {
        throw createAiPermissionError('Use the admin assistant for platform-level information.', 'MERCHANT_INTENT_ON_ADMIN_ASSISTANT', 403);
    }

    return {
        userId: user.id,
        role: user.role,
        merchantId: role === 'merchant' ? user.id : entities.merchantId || null
    };
}

function buildPermissionFallback({ role, intent, entities = {} }) {
    if (role === 'merchant' && entities.merchantId) {
        return {
            fallback: true,
            answer: 'I can only analyse the merchant data connected to your logged-in account. Platform-wide merchant rankings are available only to administrators.',
            supportingEvidence: [],
            suggestedNextSteps: ['Ask about your own revenue, bookings, refunds, products or services.'],
            limitations: ['Cross-merchant data is restricted.']
        };
    }

    if (role === 'merchant' && /^admin_/.test(intent)) {
        return {
            fallback: true,
            answer: 'That is platform-level information available only to administrators. I can analyse your own merchant performance instead.',
            supportingEvidence: [],
            suggestedNextSteps: ['Ask about your own merchant revenue, bookings, refunds, inventory or Spin performance.'],
            limitations: ['Admin-only platform data is restricted.']
        };
    }

    return null;
}

module.exports = {
    buildPermissionFallback,
    createAiPermissionError,
    validateAiRequestPermissions
};
