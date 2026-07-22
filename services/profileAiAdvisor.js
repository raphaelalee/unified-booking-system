const OpenAI = require('openai');

const DEFAULT_MODEL = process.env.PROFILE_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_SUMMARY_LENGTH = 420;

function cleanAiText(value) {
    return String(value || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SUMMARY_LENGTH);
}

function formatMoney(value) {
    return `$${Number(value || 0).toFixed(2)}`;
}

function buildWalletFallback(metrics = {}) {
    const pointsValue = formatMoney(metrics.redeemablePointsValue);
    const canConvert = metrics.canConvertPoints
        ? `You have enough points to convert at least ${metrics.minimumPointsToConvert} points.`
        : `You need ${metrics.pointsNeededToConvert} more points before conversion is available.`;
    const giftCardLine = Number(metrics.activeGiftCardBalance || 0) > 0
        ? ` Active gift cards add ${formatMoney(metrics.activeGiftCardBalance)}.`
        : '';

    return cleanAiText(`${metrics.pointsBalance} points are worth about ${pointsValue}. ${canConvert} You also have ${formatMoney(metrics.cashbackBalance)} cashback and ${formatMoney(metrics.eWalletBalance)} in e-wallet balance.${giftCardLine} Use gift cards or cashback first when eligible, and keep wallet balance for checkout or top-ups.`);
}

function buildSpendingFallback(metrics = {}) {
    if (!Number(metrics.completedTransactionCount || 0)) {
        return 'No completed paid purchases are available yet, so spending insights will appear after your first paid booking or order.';
    }

    const category = metrics.mostFrequentCategory && metrics.mostFrequentCategory !== 'none'
        ? ` Most activity is in ${metrics.mostFrequentCategory}.`
        : '';

    return cleanAiText(`This month you spent ${formatMoney(metrics.currentMonthSpending)} across ${metrics.currentMonthTransactionCount} paid transaction${Number(metrics.currentMonthTransactionCount) === 1 ? '' : 's'}. Your average paid transaction is ${formatMoney(metrics.averageTransactionValue)}.${category} You earned ${metrics.pointsEarnedThisMonth} points and ${formatMoney(metrics.cashbackEarnedThisMonth)} cashback from tracked reward activity.`);
}

function buildFallbackAdvisor(metrics = {}) {
    return {
        walletAdvice: buildWalletFallback(metrics.wallet || {}),
        spendingInsight: buildSpendingFallback(metrics.spending || {}),
        generatedByAi: false
    };
}

function getOutputText(response) {
    if (response?.output_text) {
        return response.output_text;
    }

    const output = Array.isArray(response?.output) ? response.output : [];
    return output
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .map((content) => content.text || '')
        .filter(Boolean)
        .join(' ');
}

async function requestAiSummary(metrics) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        return null;
    }

    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
        model: DEFAULT_MODEL,
        temperature: 0.3,
        max_output_tokens: 180,
        input: [
            {
                role: 'system',
                content: 'You write concise customer account suggestions. Use only the supplied aggregate metrics. Do not invent balances, do not suggest actions that spend or mutate balances, and return plain JSON only.'
            },
            {
                role: 'user',
                content: JSON.stringify({
                    task: 'Return {"walletAdvice":"...","spendingInsight":"..."} using at most two short sentences per value.',
                    metrics
                })
            }
        ]
    });

    const text = getOutputText(response);
    const parsed = JSON.parse(text);

    return {
        walletAdvice: cleanAiText(parsed.walletAdvice),
        spendingInsight: cleanAiText(parsed.spendingInsight),
        generatedByAi: true
    };
}

async function buildProfileAiAdvisor(metrics = {}) {
    const fallback = buildFallbackAdvisor(metrics);

    try {
        const aiSummary = await requestAiSummary(metrics);

        if (!aiSummary?.walletAdvice || !aiSummary?.spendingInsight) {
            return fallback;
        }

        return aiSummary;
    } catch (error) {
        console.warn('Profile AI advisor unavailable.');
        return fallback;
    }
}

module.exports = {
    buildProfileAiAdvisor,
    buildFallbackAdvisor
};
