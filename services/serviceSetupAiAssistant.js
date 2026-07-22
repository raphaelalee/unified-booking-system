const { OpenAI } = require('openai');
const { routineTagOptions } = require('../utils/routineTags');

const DEFAULT_MODEL = process.env.SERVICE_SETUP_AI_MODEL || 'llama-3.1-8b-instant';
const MAX_NAME_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 280;
const MAX_DESCRIPTION_LENGTH = 420;
const MAX_NOTE_LENGTH = 255;
const MAX_PRICE = 99999;
const MAX_DURATION_MINUTES = 480;
const MAX_PACKAGE_SESSIONS = 24;

const goalTagOptions = routineTagOptions.slice(0, 8);
const concernTagOptions = routineTagOptions.slice(6);

function cleanText(value, maxLength) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const number = Number(value);

    if (!Number.isFinite(number) || !Number.isInteger(number)) {
        return null;
    }

    if (number < min || number > max) {
        return null;
    }

    return number;
}

function normalizeMoney(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0 || number > MAX_PRICE) {
        return null;
    }

    return Number(number.toFixed(2));
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (['true', 'yes', '1'].includes(String(value || '').trim().toLowerCase())) return true;
    if (['false', 'no', '0'].includes(String(value || '').trim().toLowerCase())) return false;
    return false;
}

function buildTagLookup(options) {
    return options.reduce((map, option) => {
        map.set(option.value.toLowerCase(), option.value);
        map.set(option.label.toLowerCase(), option.value);
        return map;
    }, new Map());
}

function normalizeTags(values, options) {
    const lookup = buildTagLookup(options);
    const source = Array.isArray(values) ? values : [];

    return Array.from(new Set(source
        .map((value) => lookup.get(cleanText(value, 80).toLowerCase()))
        .filter(Boolean)))
        .slice(0, 6);
}

function normalizeLinkedProductName(value, products = []) {
    const normalized = cleanText(value, 120).toLowerCase();

    if (!normalized) {
        return null;
    }

    const match = products.find((product) => cleanText(product.name, 120).toLowerCase() === normalized);
    return match ? cleanText(match.name, 120) : null;
}

function normalizeSuggestions(raw = {}, context = {}) {
    const suggestedPrice = normalizeMoney(raw.suggestedPrice || raw.recommendedPrice);
    const budgetMinimum = normalizeMoney(raw.budgetMinimum);
    const budgetMaximum = normalizeMoney(raw.budgetMaximum);
    const packageRecommended = normalizeBoolean(raw.packageRecommended);
    const packageSessions = normalizeInteger(raw.packageSessions, { min: 2, max: MAX_PACKAGE_SESSIONS });
    const packagePrice = normalizeMoney(raw.packagePrice);
    const hasValidPackage = packageRecommended && packageSessions !== null && packagePrice !== null && packagePrice > 0;

    return {
        description: cleanText(raw.description, MAX_DESCRIPTION_LENGTH),
        durationMinutes: normalizeInteger(raw.durationMinutes || raw.durationMins, { min: 1, max: MAX_DURATION_MINUTES }),
        suggestedPrice,
        priceExplanation: cleanText(raw.priceExplanation, 180),
        recommendationNote: cleanText(raw.recommendationNote, MAX_NOTE_LENGTH),
        budgetMinimum: budgetMinimum !== null && budgetMaximum !== null && budgetMinimum > budgetMaximum ? null : budgetMinimum,
        budgetMaximum: budgetMinimum !== null && budgetMaximum !== null && budgetMinimum > budgetMaximum ? null : budgetMaximum,
        goalTags: normalizeTags(raw.goalTags, goalTagOptions),
        concernTags: normalizeTags(raw.concernTags, concernTagOptions),
        packageRecommended: hasValidPackage,
        packageSessions: hasValidPackage ? packageSessions : null,
        packagePrice: hasValidPackage ? packagePrice : null,
        linkedProductName: normalizeLinkedProductName(raw.linkedProductName, context.products)
    };
}

function getOutputText(response) {
    if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
    }

    if (response?.output_text) {
        return response.output_text;
    }

    return '{}';
}

function parseJsonObject(value) {
    const text = String(value || '').trim();

    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return {};

        try {
            const parsed = JSON.parse(match[0]);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (nestedError) {
            return {};
        }
    }
}

function buildPrompt(context) {
    const serviceName = cleanText(context.serviceName, MAX_NAME_LENGTH);
    const categoryName = cleanText(context.categoryName, MAX_CATEGORY_LENGTH);
    const instructions = cleanText(context.instructions, MAX_INSTRUCTION_LENGTH);
    const products = (context.products || [])
        .map((product) => ({
            name: cleanText(product.name, 120),
            category: cleanText(product.category, 80)
        }))
        .filter((product) => product.name)
        .slice(0, 30);

    return {
        system: [
            'You assist Vaniday merchants with drafting service form suggestions only.',
            'Return only valid JSON using these keys: description, durationMinutes, suggestedPrice, priceExplanation, recommendationNote, budgetMinimum, budgetMaximum, goalTags, concernTags, packageRecommended, packageSessions, packagePrice, linkedProductName.',
            'Do not create, update, save, publish, book, diagnose, guarantee results, make medical claims, or use exaggerated wording.',
            'Use goalTags only from the supplied goal tag values or labels.',
            'Use concernTags only from the supplied concern tag values or labels.',
            'For linkedProductName, return exactly one supplied product name or null. Do not invent products.',
            'Do not suggest booking slots.'
        ].join(' '),
        user: JSON.stringify({
            task: 'Generate concise editable suggestions for an existing merchant service form.',
            serviceName,
            categoryName,
            merchantInstructions: instructions,
            allowedGoalTags: goalTagOptions,
            allowedConcernTags: concernTagOptions,
            merchantProducts: products
        })
    };
}

async function generateServiceSetupSuggestions(context = {}) {
    if (!process.env.GROQ_API_KEY) {
        const error = new Error('AI service is not configured.');
        error.code = 'AI_NOT_CONFIGURED';
        throw error;
    }

    const prompt = buildPrompt(context);
    const client = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1'
    });

    const response = await client.chat.completions.create({
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ],
        model: DEFAULT_MODEL,
        temperature: 0.4,
        max_completion_tokens: 450,
        response_format: { type: 'json_object' }
    });

    return normalizeSuggestions(parseJsonObject(getOutputText(response)), context);
}

module.exports = {
    cleanText,
    generateServiceSetupSuggestions,
    normalizeSuggestions
};
