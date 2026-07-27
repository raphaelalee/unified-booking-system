function extractCurrencyClaims(text = '') {
    const claims = [];
    const pattern = /(?:S\$|SGD\s*)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
    let match;

    while ((match = pattern.exec(String(text || ''))) !== null) {
        claims.push(Number(match[1].replace(/,/g, '')));
    }

    return claims.filter((value) => Number.isFinite(value));
}

function answerText(answer = {}) {
    return [
        answer.answer,
        answer.summary,
        answer.executiveSummary,
        ...(answer.supportingEvidence || []),
        ...(answer.suggestedNextSteps || []),
        ...(answer.recommendedAdminActions || []),
        ...(answer.limitations || [])
    ].filter(Boolean).join(' ');
}

function validateAiResponse({ answer = {}, context = {}, role }) {
    const text = answerText(answer);

    if (!text.trim()) {
        return {
            valid: false,
            reason: 'empty_response'
        };
    }

    if (role === 'merchant' && /\bplatform-wide|all merchants|merchant ranking|registered users\b/i.test(text)) {
        return {
            valid: false,
            reason: 'merchant_response_contains_platform_claim'
        };
    }

    const claims = extractCurrencyClaims(text);
    const allowed = Array.isArray(context.allowedNumericValues) ? context.allowedNumericValues : [];
    const invalidClaim = claims.find((claim) => !allowed.some((value) => Math.abs(Number(value) - Number(claim)) <= 0.02));

    if (invalidClaim != null) {
        return {
            valid: false,
            reason: 'unsupported_currency_claim',
            invalidClaim
        };
    }

    return {
        valid: true,
        reason: 'validated'
    };
}

module.exports = {
    answerText,
    extractCurrencyClaims,
    validateAiResponse
};
