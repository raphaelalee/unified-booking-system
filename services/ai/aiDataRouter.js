const {
    buildAdminAnalyticsSummary,
    buildAdminComparisonSummary,
    buildAnalyticsDataAnswer,
    buildMultiIntentAnalyticsAnswer,
    buildMerchantAnalyticsSummary,
    buildMerchantComparisonSummary,
    parseAnalyticsComparisonQuestion
} = require('../analyticsAiDataService');

function usesAnalyticsSummary(intent = '') {
    return /_(revenue|bookings|booking_details|refunds|inventory|products|services|customers|ratings|reviews|wallet|loyalty|spin|promotions|vouchers|analytics|business_health|daily_brief|weekly_report|monthly_report|business_timeline|general_business_summary|general_platform_summary|merchants|merchant_details|users|payments|platform_analytics)$/.test(intent);
}

async function routeAiData({ role, userId, intentResult, period }) {
    const intent = intentResult.intent;
    const comparisonRequest = parseAnalyticsComparisonQuestion(intentResult.question);

    if (/compare_periods$/.test(intent) && comparisonRequest) {
        const comparison = role === 'admin'
            ? await buildAdminComparisonSummary(comparisonRequest)
            : await buildMerchantComparisonSummary(userId, comparisonRequest);
        return {
            type: 'comparison',
            comparison,
            summary: comparison.current,
            dataSources: ['analytics_comparison_summary']
        };
    }

    if (!usesAnalyticsSummary(intent)) {
        return {
            type: 'none',
            summary: null,
            dataSources: []
        };
    }

    const analyticsPeriod = intentResult.entities?.analyticsPeriod || period || 'last30';
    const summary = role === 'admin'
        ? await buildAdminAnalyticsSummary(analyticsPeriod)
        : await buildMerchantAnalyticsSummary(userId, analyticsPeriod);
    const multiIntentTopics = (intentResult.entities?.multiIntents || [])
        .map((intentName) => String(intentName || '').replace(/^(merchant|admin)_/, ''))
        .map((topic) => topic === 'platform_revenue' ? 'revenue' : topic === 'business_health' ? 'attention' : topic)
        .filter(Boolean);
    const directAnswer = multiIntentTopics.length > 1
        ? buildMultiIntentAnalyticsAnswer(summary, intentResult.question, role, multiIntentTopics)
        : buildAnalyticsDataAnswer(summary, intentResult.question, role);

    return {
        type: 'analytics_summary',
        summary,
        directAnswer,
        dataSources: [
            role === 'admin' ? 'admin_analytics_summary' : 'merchant_analytics_summary',
            directAnswer ? 'verified_direct_metric_answer' : null
        ].filter(Boolean)
    };
}

module.exports = {
    routeAiData,
    usesAnalyticsSummary
};
