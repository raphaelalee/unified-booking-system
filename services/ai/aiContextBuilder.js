function collectVerifiedValues(value, output = []) {
    if (value == null) return output;
    if (typeof value === 'number' && Number.isFinite(value)) {
        output.push(value);
        return output;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectVerifiedValues(item, output));
        return output;
    }
    if (typeof value === 'object') {
        Object.values(value).forEach((item) => collectVerifiedValues(item, output));
    }
    return output;
}

function buildAllowedClaims(summary = {}, intent = '') {
    const metricKeys = Object.keys(summary.metrics || {});
    const intentTopic = String(intent || '').replace(/^(merchant|admin)_/, '');
    return Array.from(new Set([intentTopic, ...metricKeys])).filter(Boolean);
}

function buildAiContext({ role, intent, sessionIdentity, intentResult, summary, comparison }) {
    const verifiedData = comparison || summary || {};
    return {
        role,
        intent,
        userId: sessionIdentity.userId,
        merchantId: sessionIdentity.merchantId || null,
        period: comparison?.periods?.current || summary?.period || null,
        entities: intentResult.entities || {},
        verifiedData,
        dataStatus: 'verified',
        allowedClaims: buildAllowedClaims(summary || comparison?.current || {}, intent),
        allowedNumericValues: collectVerifiedValues(verifiedData).map((number) => Number(number.toFixed(2)))
    };
}

module.exports = {
    buildAiContext,
    collectVerifiedValues
};
