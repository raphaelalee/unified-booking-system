const assert = require('node:assert/strict');
const test = require('node:test');

const { detectAiIntent } = require('../services/ai/aiIntentRouter');
const { validateAiRequestPermissions } = require('../services/ai/aiPermissionService');
const { routeAiData } = require('../services/ai/aiDataRouter');
const { buildAiContext } = require('../services/ai/aiContextBuilder');
const { extractCurrencyClaims, validateAiResponse } = require('../services/ai/aiResponseValidator');
const { orchestrateAiQuestion } = require('../services/ai/aiOrchestrator');
const { ADMIN_DEMO_PROMPTS, MERCHANT_DEMO_PROMPTS } = require('../services/ai/aiDemoPromptLibrary');

function makeReq(user) {
    return {
        session: {
            user
        }
    };
}

function merchantSummary() {
    return {
        scope: 'merchant',
        period: { key: 'thisMonth', label: 'This month', startDate: '2026-07-01', endDate: '2026-08-01' },
        metrics: {
            totalRevenue: 4283.5,
            totalBookings: 94,
            totalOrders: 6,
            refundCount: 1,
            netRefundAmount: 40,
            revenueChange: { label: '+18%', value: 18 }
        },
        topServicesByRevenue: [{ serviceName: 'Hair Spa', revenue: 2200, bookings: 31 }],
        topProductsByRevenue: [{ productName: 'Repair Shampoo', revenue: 500, unitsSold: 10 }],
        stockConcerns: [{ productName: 'Repair Shampoo', stockQuantity: 2 }]
    };
}

function adminSummary() {
    return {
        scope: 'admin',
        period: { key: 'thisMonth', label: 'This month', startDate: '2026-07-01', endDate: '2026-08-01' },
        metrics: {
            totalPlatformRevenue: 900,
            totalBookings: 12,
            totalRefunds: 2,
            activeMerchants: 3,
            pendingMerchantApprovals: 1
        },
        topMerchantsByRevenue: [{ merchantId: 12, merchantName: 'Vaniday Beauty', revenue: 900, bookings: 8 }]
    };
}

test('intent router detects typo merchant revenue without relying on page context', () => {
    const result = detectAiIntent({
        role: 'merchant',
        question: 'revanue this mnth',
        previousContext: {},
        fallbackPeriod: 'last30'
    });

    assert.equal(result.intent, 'merchant_revenue');
    assert.equal(result.entities.analyticsPeriod, 'thisMonth');
    assert.ok(result.confidence >= 0.8);
});

test('intent router keeps follow-up on previous topic', () => {
    const result = detectAiIntent({
        role: 'merchant',
        question: 'what about last month?',
        previousContext: { intent: 'merchant_revenue', period: 'thisMonth' },
        fallbackPeriod: 'last30'
    });

    assert.equal(result.intent, 'merchant_revenue');
    assert.equal(result.followUp, true);
    assert.equal(result.entities.analyticsPeriod, 'previousMonth');
});

test('permission service blocks merchant asking for another merchant', () => {
    assert.throws(() => validateAiRequestPermissions({
        req: makeReq({ id: 8, role: 'merchant' }),
        role: 'merchant',
        intent: 'merchant_revenue',
        entities: { merchantId: 12 }
    }), /own merchant data/);
});

test('response validator rejects unsupported currency claim', () => {
    const context = {
        allowedNumericValues: [4283.5, 94]
    };
    const validation = validateAiResponse({
        role: 'merchant',
        context,
        answer: { answer: 'Your revenue is S$5200.00.' }
    });

    assert.equal(validation.valid, false);
    assert.equal(validation.reason, 'unsupported_currency_claim');
    assert.deepEqual(extractCurrencyClaims('Revenue S$4,283.50 and refunds SGD 40.00'), [4283.5, 40]);
});

test('context builder exposes only verified numeric values', () => {
    const context = buildAiContext({
        role: 'merchant',
        intent: 'merchant_revenue',
        sessionIdentity: { userId: 8, merchantId: 8 },
        intentResult: { entities: { analyticsPeriod: 'thisMonth' } },
        summary: merchantSummary()
    });

    assert.equal(context.role, 'merchant');
    assert.equal(context.merchantId, 8);
    assert.ok(context.allowedNumericValues.includes(4283.5));
    assert.ok(context.allowedClaims.includes('totalRevenue'));
});

test('orchestrator returns deterministic merchant revenue from backend data', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'What is my revenue this month?',
        period: 'last30',
        demoSafe: true,
        dataRouter: async ({ intentResult }) => ({
            type: 'analytics_summary',
            summary: merchantSummary(),
            directAnswer: require('../services/analyticsAiDataService').buildAnalyticsDataAnswer(
                merchantSummary(),
                intentResult.question,
                'merchant'
            ),
            dataSources: ['merchant_analytics_summary']
        })
    });

    assert.equal(result.success, true);
    assert.equal(result.ai.intent, 'merchant_revenue');
    assert.equal(result.ai.groqCalled, false);
    assert.match(result.answer.answer, /S\$4283\.50/);
    assert.match(result.answer.answer, /tracked sales/i);
});

test('merchant revenue questions always beat business health context', async () => {
    const phrases = [
        'How is my revenue this month?',
        'Show my revenue.',
        'Revenue today.',
        'Sales this month.',
        'Earnings this month.',
        'Turnover this month.'
    ];

    for (const phrase of phrases) {
        const req = makeReq({ id: 8, role: 'merchant' });
        req.session.merchantAiContext = {
            intent: 'merchant_business_health',
            period: 'thisMonth',
            verifiedResultSummary: 'Business health needs attention.'
        };

        const result = await orchestrateAiQuestion(req, {
            role: 'merchant',
            question: phrase,
            period: 'last30',
            demoSafe: true,
            dataRouter: async ({ intentResult }) => {
                assert.equal(intentResult.intent, 'merchant_revenue', phrase);
                return {
                    type: 'analytics_summary',
                    summary: merchantSummary(),
                    directAnswer: require('../services/analyticsAiDataService').buildAnalyticsDataAnswer(
                        merchantSummary(),
                        intentResult.question,
                        'merchant'
                    ),
                    dataSources: ['merchant_analytics_summary', 'verified_direct_metric_answer']
                };
            }
        });

        assert.equal(result.ai.intent, 'merchant_revenue', phrase);
        assert.deepEqual(result.ai.dataSources, ['merchant_analytics_summary', 'verified_direct_metric_answer']);
        assert.equal(result.ai.groqCalled, false);
        assert.match(result.answer.answer, /S\$4283\.50/, phrase);
        assert.match(result.answer.answer, /Compared with the previous period, this is \+18%/, phrase);
        assert.doesNotMatch(result.answer.answer, /business health|attention should go to/i, phrase);
        assert.equal(result.answer.metadata.verifiedStatus, 'verified');
        assert.equal(result.answer.metadata.dataSource, 'merchant_analytics_summary');
        assert.equal(result.answer.metadata.confidenceLevel, 'High');
    }
});

test('orchestrator returns admin top merchant answer from admin summary', async () => {
    const req = makeReq({ id: 2, role: 'admin' });
    const result = await orchestrateAiQuestion(req, {
        role: 'admin',
        question: 'Which merchant has the highest revenue?',
        period: 'thisMonth',
        demoSafe: true,
        dataRouter: async ({ intentResult }) => ({
            type: 'analytics_summary',
            summary: adminSummary(),
            directAnswer: require('../services/analyticsAiDataService').buildAnalyticsDataAnswer(
                adminSummary(),
                intentResult.question,
                'admin'
            ),
            dataSources: ['admin_analytics_summary']
        })
    });

    assert.equal(result.success, true);
    assert.equal(result.ai.intent, 'admin_merchants');
    assert.match(result.answer.answer, /Vaniday Beauty/);
    assert.match(result.answer.answer, /S\$900\.00/);
});

test('orchestrator keeps navigation separate from data answers', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'Open analytics',
        period: 'thisMonth',
        demoSafe: false,
        dataRouter: async () => {
            throw new Error('data router should not run for navigation-only request');
        },
        answerers: {
            merchant: async () => ({ answer: 'should not run' })
        }
    });

    assert.equal(result.success, true);
    assert.equal(result.ai.groqCalled, false);
    assert.equal(result.ai.fallbackUsed, true);
    assert.equal(result.ai.navigation.href, '/merchant/analytics');
});

test('data router exposes real implementation function', async () => {
    assert.equal(typeof routeAiData, 'function');
});

test('intent router recognises expanded synonyms and spelling errors', () => {
    const merchant = detectAiIntent({
        role: 'merchant',
        question: 'how much money made from appts and refnd this mnth',
        previousContext: {},
        fallbackPeriod: 'last30'
    });
    const admin = detectAiIntent({
        role: 'admin',
        question: 'which salons have highest turnover',
        previousContext: {},
        fallbackPeriod: 'last30'
    });

    assert.equal(merchant.intent, 'merchant_revenue');
    assert.ok(merchant.entities.multiIntents.includes('merchant_bookings'));
    assert.ok(merchant.entities.multiIntents.includes('merchant_refunds'));
    assert.equal(admin.intent, 'admin_merchants');
});

test('orchestrator supports multi-intent merchant questions with verified metadata', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const { buildMultiIntentAnalyticsAnswer } = require('../services/analyticsAiDataService');
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'Show revenue and refunds this month',
        period: 'thisMonth',
        demoSafe: true,
        dataRouter: async ({ intentResult }) => ({
            type: 'analytics_summary',
            summary: merchantSummary(),
            directAnswer: buildMultiIntentAnalyticsAnswer(
                merchantSummary(),
                intentResult.question,
                'merchant',
                ['revenue', 'refunds']
            ),
            dataSources: ['merchant_analytics_summary', 'verified_direct_metric_answer']
        })
    });

    assert.equal(result.success, true);
    assert.equal(result.ai.groqCalled, false);
    assert.equal(result.ai.verifiedStatus, 'verified');
    assert.equal(result.ai.dataSource, 'merchant_analytics_summary');
    assert.equal(result.ai.confidenceLevel, 'High');
    assert.match(result.answer.answer, /tracked sales/i);
    assert.match(result.answer.answer, /refund case/i);
    assert.ok(result.answer.metadata.lastUpdatedAt);
});

test('navigation plus data question returns navigation and verified data', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'Open bookings and tell me how many are pending',
        period: 'thisMonth',
        demoSafe: true,
        dataRouter: async ({ intentResult }) => ({
            type: 'analytics_summary',
            summary: merchantSummary(),
            directAnswer: require('../services/analyticsAiDataService').buildAnalyticsDataAnswer(
                merchantSummary(),
                intentResult.question,
                'merchant'
            ),
            dataSources: ['merchant_analytics_summary', 'verified_direct_metric_answer']
        })
    });

    assert.equal(result.success, true);
    assert.equal(result.ai.intent, 'merchant_bookings');
    assert.equal(result.ai.navigation.href, '/merchant/bookings');
    assert.match(result.answer.answer, /service bookings/i);
});

test('follow-up memory stores previous entity period navigation and summary', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'Open products and show low stock',
        period: 'thisMonth',
        demoSafe: true,
        dataRouter: async ({ intentResult }) => ({
            type: 'analytics_summary',
            summary: merchantSummary(),
            directAnswer: require('../services/analyticsAiDataService').buildAnalyticsDataAnswer(
                merchantSummary(),
                intentResult.question,
                'merchant'
            ),
            dataSources: ['merchant_analytics_summary']
        })
    });

    assert.equal(req.session.merchantAiContext.intent, 'merchant_inventory');
    assert.equal(req.session.merchantAiContext.period, 'thisMonth');
    assert.equal(req.session.merchantAiContext.navigationTarget, '/merchant/products');
    assert.match(req.session.merchantAiContext.verifiedResultSummary, /low-stock/i);

    const followUp = detectAiIntent({
        role: 'merchant',
        question: 'why?',
        previousContext: req.session.merchantAiContext,
        fallbackPeriod: 'last30'
    });
    assert.equal(followUp.intent, 'merchant_inventory');
    assert.equal(followUp.followUp, true);
});

test('permission service blocks cross role and cross merchant access', () => {
    assert.throws(() => validateAiRequestPermissions({
        req: makeReq({ id: 8, role: 'merchant' }),
        role: 'merchant',
        intent: 'admin_platform_revenue',
        entities: {}
    }), /Platform-level information/);

    assert.throws(() => validateAiRequestPermissions({
        req: makeReq({ id: 8, role: 'merchant' }),
        role: 'merchant',
        intent: 'merchant_revenue',
        entities: { merchantId: 9 }
    }), /own merchant data/);
});

test('orchestrator falls back deterministically when Groq fails', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'What can you do?',
        period: 'thisMonth',
        demoSafe: false,
        dataRouter: async () => ({
            type: 'none',
            summary: merchantSummary(),
            directAnswer: null,
            dataSources: ['merchant_analytics_summary']
        }),
        answerers: {
            merchant: async () => {
                const error = new Error('Groq down');
                error.status = 503;
                throw error;
            }
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.ai.fallbackUsed, true);
    assert.equal(result.ai.confidenceLevel, 'Low');
});

test('database failure is surfaced as limited fallback', async () => {
    const req = makeReq({ id: 8, role: 'merchant' });
    const result = await orchestrateAiQuestion(req, {
        role: 'merchant',
        question: 'How is revenue?',
        period: 'thisMonth',
        demoSafe: true,
        dataRouter: async () => {
            throw new Error('Database unavailable');
        }
    });

    assert.equal(result.success, false);
    assert.equal(result.ai.dataStatus, 'failed');
    assert.equal(result.ai.verifiedStatus, 'limited');
});

test('demo prompt library contains 25 prompts for each role and routes safely', () => {
    assert.equal(MERCHANT_DEMO_PROMPTS.length, 25);
    assert.equal(ADMIN_DEMO_PROMPTS.length, 25);

    for (const prompt of MERCHANT_DEMO_PROMPTS) {
        const result = detectAiIntent({ role: 'merchant', question: prompt, previousContext: {}, fallbackPeriod: 'last30' });
        assert.match(result.intent, /^merchant_/);
    }

    for (const prompt of ADMIN_DEMO_PROMPTS) {
        const result = detectAiIntent({ role: 'admin', question: prompt, previousContext: {}, fallbackPeriod: 'last30' });
        assert.match(result.intent, /^admin_/);
    }
});
