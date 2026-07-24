const DEFAULT_MODEL = process.env.PROFILE_AI_MODEL || process.env.GROQ_PROFILE_MODEL || 'llama-3.1-8b-instant';
const MAX_SUMMARY_LENGTH = 420;
let GroqClient;

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
    if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
    }

    return '{}';
}

function getGroqClient() {
    if (GroqClient !== undefined) {
        return GroqClient;
    }

    try {
        GroqClient = require('groq-sdk');
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') {
            throw error;
        }

        GroqClient = null;
    }

    return GroqClient;
}

async function requestAiSummary(metrics) {
    const apiKey = process.env.GROQ_API_KEY;
    const Groq = getGroqClient();

    if (!apiKey || !Groq) {
        return null;
    }

    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
        model: DEFAULT_MODEL,
        temperature: 0.3,
        max_completion_tokens: 180,
        response_format: { type: 'json_object' },
        messages: [
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
