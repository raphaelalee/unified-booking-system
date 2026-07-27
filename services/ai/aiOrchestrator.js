const crypto = require('crypto');
const {
    buildAdminFallbackInsights,
    buildMerchantFallbackInsights
} = require('../analyticsAiDataService');
const {
    answerAdminAnalyticsQuestion: answerAdminAnalyticsQuestionWithGroq,
    answerMerchantAnalyticsQuestion: answerMerchantAnalyticsQuestionWithGroq,
    classifyGroqError
} = require('../groqService');
const { buildAiContext } = require('./aiContextBuilder');
const { routeAiData } = require('./aiDataRouter');
const { buildDeterministicAiFallback, buildFailureResponse } = require('./aiFallbackService');
const { detectAiIntent } = require('./aiIntentRouter');
const { validateAiRequestPermissions } = require('./aiPermissionService');
const { resolveAiNavigation } = require('./aiNavigationResolver');
const { validateAiResponse } = require('./aiResponseValidator');

function nowMs() {
    return Date.now();
}

function createRequestId() {
    return crypto.randomBytes(6).toString('hex');
}

function isDemoSafeAiEnabled() {
    return String(process.env.DEMO_SAFE_AI || '').trim().toLowerCase() === 'true';
}

function getPreviousAiContext(req, role) {
    const key = role === 'admin' ? 'adminAiContext' : 'merchantAiContext';
    return req.session?.[key] || {};
}

function storeAiContext(req, role, payload) {
    const key = role === 'admin' ? 'adminAiContext' : 'merchantAiContext';
    const previous = req.session?.[key] || {};
    const entities = payload.entities || {};
    req.session[key] = {
        intent: payload.intent,
        previousIntent: previous.intent || null,
        entities,
        previousEntity: previous.entities || null,
        merchantId: entities.merchantId || previous.merchantId || null,
        productName: entities.productName || previous.productName || null,
        serviceName: entities.serviceName || previous.serviceName || null,
        period: payload.period || previous.period || null,
        previousPeriod: previous.period || null,
        comparison: payload.comparison || previous.comparison || null,
        module: String(payload.intent || '').replace(/^(merchant|admin)_/, ''),
        verifiedResultSummary: payload.verifiedResultSummary,
        previousNavigation: previous.navigation || null,
        navigation: payload.navigation || null,
        navigationTarget: payload.navigation?.href || previous.navigationTarget || null,
        updatedAt: new Date().toISOString()
    };
}

function confidenceLevel(intentConfidence = 0, dataStatus = 'verified', answer = {}) {
    if (dataStatus === 'failed') return 'Low';
    if ((answer.limitations || []).length >= 2) return 'Medium';
    if (Number(intentConfidence) >= 0.9 && dataStatus === 'verified') return 'High';
    if (Number(intentConfidence) >= 0.7) return 'Medium';
    return 'Low';
}

function buildResponseMetadata({ role, intentResult, dataSources = [], context, answer, dataStatus = 'verified' }) {
    return {
        verifiedStatus: dataStatus === 'verified' || dataStatus === 'not_required' ? 'verified' : 'limited',
        dataSource: dataSources[0] || 'none',
        dataSources,
        analysedPeriod: context?.period || null,
        confidenceLevel: confidenceLevel(intentResult?.confidence, dataStatus, answer),
        lastUpdatedAt: new Date().toISOString(),
        role
    };
}

function buildGroqQuestion(intentResult, context) {
    return [
        intentResult.originalQuestion || intentResult.question,
        '',
        'Use the verified data context only. Start with a concise factual sentence when possible.',
        'Do not invent missing numbers, merchant names, dates, refunds, bookings or revenue.',
        'If the verified data does not contain the requested field, say it is unavailable.',
        '',
        JSON.stringify({
            intent: context.intent,
            role: context.role,
            period: context.period,
            entities: context.entities,
            allowedClaims: context.allowedClaims,
            verifiedData: context.verifiedData
        })
    ].join('\n').slice(0, 4000);
}

function normalizeProviderError(error) {
    const groqError = classifyGroqError(error);
    return {
        status: groqError.status === 429 ? 429 : 503,
        code: groqError.code || 'AI_PROVIDER_UNAVAILABLE',
        message: 'AI language generation is temporarily unavailable, so a verified fallback answer was used.'
    };
}

function logAiRequest(event) {
    console.info('AI_ORCHESTRATOR', JSON.stringify(event));
}

function answererForRole(role, answerers = {}) {
    if (role === 'admin') return answerers.admin || answerAdminAnalyticsQuestionWithGroq;
    return answerers.merchant || answerMerchantAnalyticsQuestionWithGroq;
}

async function orchestrateAiQuestion(req, {
    role,
    question,
    period = 'last30',
    answerers = {},
    dataRouter = routeAiData,
    demoSafe = isDemoSafeAiEnabled()
}) {
    const startedAt = nowMs();
    const requestId = createRequestId();
    let intentResult;
    let summary;
    let context;
    let navigation;
    let groqCalled = false;
    let fallbackUsed = false;
    let validation = { valid: true, reason: 'not_needed' };

    try {
        const previousContext = getPreviousAiContext(req, role);
        intentResult = detectAiIntent({
            role,
            question,
            previousContext,
            fallbackPeriod: period
        });
        const sessionIdentity = validateAiRequestPermissions({
            req,
            role,
            intent: intentResult.intent,
            entities: intentResult.entities
        });
        navigation = resolveAiNavigation({
            role,
            question: intentResult.question,
            intent: intentResult.intent
        });

        if (navigation && !intentResult.requiresData) {
            const answer = {
                answer: `I can open ${navigation.label.replace(/^Open\s+/i, '')} for you. Use the navigation action to continue.`,
                supportingEvidence: [],
                suggestedNextSteps: [navigation.label],
                recommendedAdminActions: role === 'admin' ? [navigation.label] : undefined,
                limitations: ['Navigation is separate from analytics answers and does not change business data.']
            };
            storeAiContext(req, role, {
                intent: intentResult.intent,
                entities: intentResult.entities,
                period,
                verifiedResultSummary: answer.answer,
                navigation
            });
            const metadata = buildResponseMetadata({
                role,
                intentResult,
                dataSources: ['navigation_resolver'],
                context: { period: null },
                answer,
                dataStatus: 'not_required'
            });

            const response = {
                success: true,
                requestId,
                answer: {
                    ...answer,
                    metadata
                },
                ai: {
                    orchestrated: true,
                    intent: intentResult.intent,
                    intentConfidence: intentResult.confidence,
                    entities: intentResult.entities,
                    dataSources: ['navigation_resolver'],
                    dataStatus: 'not_required',
                    groqCalled: false,
                    validation: { valid: true, reason: 'navigation_only' },
                    fallbackUsed: true,
                    demoSafe,
                    navigation,
                    ...metadata
                }
            };

            logAiRequest({
                requestId,
                userId: req.session.user?.id,
                role,
                originalQuestion: intentResult.originalQuestion,
                detectedIntent: intentResult.intent,
                intentConfidence: intentResult.confidence,
                entities: intentResult.entities,
                dataSources: ['navigation_resolver'],
                dataStatus: 'not_required',
                groqCalled: false,
                validation: response.ai.validation,
                fallbackUsed: true,
                responseTimeMs: nowMs() - startedAt
            });

            return response;
        }

        const routed = await dataRouter({
            role,
            userId: sessionIdentity.userId,
            intentResult,
            period: intentResult.entities.analyticsPeriod || period
        });
        summary = routed.summary || (role === 'admin' ? buildAdminFallbackInsights({}) : buildMerchantFallbackInsights({}));
        context = buildAiContext({
            role,
            intent: intentResult.intent,
            sessionIdentity,
            intentResult,
            summary: routed.summary,
            comparison: routed.comparison
        });

        let answer = routed.directAnswer || null;
        const shouldUseDeterministic = demoSafe
            || routed.type === 'comparison'
            || routed.directAnswer
            || /_(revenue|bookings|refunds|inventory|products|services|customers|ratings|reviews|payments|merchants|merchant_details|business_health|daily_brief|weekly_report|monthly_report|spin|promotions|vouchers|loyalty|wallet|analytics|platform_analytics|general_business_summary|general_platform_summary)$/.test(intentResult.intent);

        if (!answer && shouldUseDeterministic) {
            answer = buildDeterministicAiFallback({
                role,
                intent: intentResult.intent,
                summary: routed.summary,
                question: intentResult.question,
                comparison: routed.comparison
            });
            fallbackUsed = true;
        }

        if (!answer) {
            groqCalled = true;
            const questionForGroq = buildGroqQuestion(intentResult, context);
            answer = await answererForRole(role, answerers)({
                summary: context.verifiedData,
                question: questionForGroq
            });
            validation = validateAiResponse({ answer, context, role });

            if (!validation.valid) {
                const retryQuestion = `${questionForGroq}\n\nYour previous answer failed validation: ${validation.reason}. Return only values present in verifiedData.`;
                const retryAnswer = await answererForRole(role, answerers)({
                    summary: context.verifiedData,
                    question: retryQuestion
                });
                const retryValidation = validateAiResponse({ answer: retryAnswer, context, role });
                validation = retryValidation;

                if (retryValidation.valid) {
                    answer = retryAnswer;
                } else {
                    answer = buildDeterministicAiFallback({
                        role,
                        intent: intentResult.intent,
                        summary: routed.summary,
                        question: intentResult.question,
                        comparison: routed.comparison
                    });
                    fallbackUsed = true;
                }
            }
        }

        storeAiContext(req, role, {
            intent: intentResult.intent,
            entities: intentResult.entities,
            period: context.period?.key || period,
            verifiedResultSummary: answer.answer || answer.summary || answer.executiveSummary || '',
            navigation,
            comparison: routed.comparison || null
        });
        const metadata = buildResponseMetadata({
            role,
            intentResult,
            dataSources: routed.dataSources || [],
            context,
            answer,
            dataStatus: context.dataStatus
        });

        const response = {
            success: true,
            requestId,
            period: context.period || summary?.period,
            summary: routed.comparison ? routed.comparison.current : routed.summary,
            comparison: routed.comparison || undefined,
            answer: {
                ...answer,
                metadata
            },
            ai: {
                orchestrated: true,
                intent: intentResult.intent,
                intentConfidence: intentResult.confidence,
                entities: intentResult.entities,
                dataSources: routed.dataSources || [],
                dataStatus: context.dataStatus,
                groqCalled,
                validation,
                fallbackUsed,
                demoSafe,
                navigation,
                ...metadata
            }
        };

        logAiRequest({
            requestId,
            userId: req.session.user?.id,
            role,
            originalQuestion: intentResult.originalQuestion,
            detectedIntent: intentResult.intent,
            intentConfidence: intentResult.confidence,
            entities: intentResult.entities,
            dataSources: routed.dataSources,
            dataStatus: context.dataStatus,
            groqCalled,
            validation,
            fallbackUsed,
            responseTimeMs: nowMs() - startedAt
        });

        return response;
    } catch (error) {
        fallbackUsed = true;
        const providerError = error?.status === 429 || error?.statusCode || error?.code === 'AI_PROVIDER_UNAVAILABLE'
            ? normalizeProviderError(error)
            : null;
        const status = error.status || providerError?.status || 200;
        const message = error.message || providerError?.message || 'The AI request could not be completed.';
        const fallback = buildFailureResponse({ role, message, summary });

        logAiRequest({
            requestId,
            userId: req.session.user?.id,
            role,
            originalQuestion: question,
            detectedIntent: intentResult?.intent || null,
            intentConfidence: intentResult?.confidence || 0,
            entities: intentResult?.entities || {},
            dataSources: [],
            dataStatus: 'failed',
            groqCalled,
            validation,
            fallbackUsed,
            errorCategory: error.code || providerError?.code || 'AI_ORCHESTRATION_FAILED',
            responseTimeMs: nowMs() - startedAt
        });

        if (status >= 400 && status !== 503 && status !== 429) {
            throw error;
        }

        return {
            success: false,
            requestId,
            error: error.code || providerError?.code || 'AI_ORCHESTRATION_FAILED',
            message,
            fallback,
            summary,
            ai: {
                orchestrated: true,
                intent: intentResult?.intent || null,
                dataStatus: 'failed',
                groqCalled,
                validation,
                fallbackUsed,
                demoSafe,
                verifiedStatus: 'limited',
                dataSource: 'none',
                dataSources: [],
                analysedPeriod: null,
                confidenceLevel: 'Low',
                lastUpdatedAt: new Date().toISOString(),
                role
            }
        };
    }
}

module.exports = {
    buildGroqQuestion,
    getPreviousAiContext,
    buildResponseMetadata,
    isDemoSafeAiEnabled,
    orchestrateAiQuestion,
    storeAiContext
};
