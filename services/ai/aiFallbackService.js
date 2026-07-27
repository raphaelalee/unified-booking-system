const {
    buildAdminFallbackInsights,
    buildAnalyticsDataAnswer,
    buildComparisonFallbackAnswer,
    buildMerchantFallbackInsights
} = require('../analyticsAiDataService');

function normalizeFallbackForRole(role, fallback) {
    if (role === 'admin' && fallback?.suggestedNextSteps && !fallback.recommendedAdminActions) {
        return {
            ...fallback,
            recommendedAdminActions: fallback.suggestedNextSteps
        };
    }
    return fallback;
}

function buildNoDataResponse({ role, intent, summary }) {
    const period = summary?.period?.label || 'the selected period';
    const topic = String(intent || '').replace(/^(merchant|admin)_/, '').replace(/_/g, ' ');
    const base = {
        fallback: true,
        answer: `No ${topic} data was found for ${period}.`,
        supportingEvidence: [],
        limitations: [`${topic} data is empty for ${period}.`]
    };

    if (role === 'admin') {
        return {
            ...base,
            recommendedAdminActions: ['Try a wider period or check the relevant admin module for source records.']
        };
    }

    return {
        ...base,
        suggestedNextSteps: ['Try a wider period or check the relevant merchant module for source records.']
    };
}

function buildDeterministicAiFallback({ role, intent, summary, question, comparison }) {
    if (comparison) {
        return normalizeFallbackForRole(role, buildComparisonFallbackAnswer(comparison));
    }

    const direct = buildAnalyticsDataAnswer(summary, question, role);
    if (direct) return normalizeFallbackForRole(role, direct);

    const generic = role === 'admin'
        ? buildAdminFallbackInsights(summary)
        : buildMerchantFallbackInsights(summary);

    return normalizeFallbackForRole(role, generic);
}

function buildFailureResponse({ role, message, summary }) {
    const fallback = role === 'admin'
        ? buildAdminFallbackInsights(summary || {})
        : buildMerchantFallbackInsights(summary || {});

    return normalizeFallbackForRole(role, {
        ...fallback,
        fallback: true,
        answer: fallback.answer || fallback.summary || fallback.executiveSummary || message,
        message
    });
}

module.exports = {
    buildDeterministicAiFallback,
    buildFailureResponse,
    buildNoDataResponse
};
