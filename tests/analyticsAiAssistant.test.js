const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildAdminFallbackInsights,
    buildAnalyticsDataAnswer,
    buildComparisonFallbackAnswer,
    buildMerchantFallbackInsights,
    normalizeAnalyticsQuestionIntent,
    parseAnalyticsComparisonQuestion,
    resolveAnalyticsPeriod,
    safePercentChange,
    sanitizeAnalyticsQuestion
} = require('../services/analyticsAiDataService');
const {
    normalizeAdminInsights,
    normalizeMerchantAnalyticsAnswer,
    normalizeMerchantInsights
} = require('../services/groqService');

test('analytics rolling periods compare equivalent ranges in Singapore time', () => {
    const period = resolveAnalyticsPeriod('last30', new Date('2026-07-23T04:00:00Z'));

    assert.equal(period.key, 'last30');
    assert.equal(period.startDate, '2026-06-24');
    assert.equal(period.endDate, '2026-07-24');
    assert.equal(period.previousStartDate, '2026-05-25');
    assert.equal(period.previousEndDate, '2026-06-24');
    assert.equal(period.timezone, 'Asia/Singapore');
});

test('month analytics periods use calendar month boundaries', () => {
    const period = resolveAnalyticsPeriod('previousMonth', new Date('2026-07-23T04:00:00Z'));

    assert.equal(period.startDate, '2026-06-01');
    assert.equal(period.endDate, '2026-07-01');
    assert.equal(period.previousStartDate, '2026-05-01');
    assert.equal(period.previousEndDate, '2026-06-01');
});

test('year analytics period compares current year to previous year', () => {
    const period = resolveAnalyticsPeriod('currentYear', new Date('2026-07-23T04:00:00Z'));

    assert.equal(period.key, 'currentYear');
    assert.equal(period.label, 'Current year');
    assert.equal(period.startDate, '2026-01-01');
    assert.equal(period.endDate, '2026-07-24');
    assert.equal(period.previousStartDate, '2025-01-01');
    assert.equal(period.previousEndDate, '2026-01-01');
    assert.equal(period.timezone, 'Asia/Singapore');
});

test('analytics comparison parser supports month week quarter and year requests', () => {
    const now = new Date('2026-07-23T04:00:00Z');
    const month = parseAnalyticsComparisonQuestion('Compare this month with last month.', now);
    const week = parseAnalyticsComparisonQuestion('Compare this week with last week.', now);
    const quarter = parseAnalyticsComparisonQuestion('Compare Q1 with Q2.', now);
    const years = parseAnalyticsComparisonQuestion('Compare 2025 with 2026.', now);

    assert.equal(month.label, 'This month vs last month');
    assert.equal(month.left.startDate, '2026-07-01');
    assert.equal(month.right.startDate, '2026-06-01');
    assert.equal(week.label, 'This week vs last week');
    assert.equal(week.left.startDate, '2026-07-20');
    assert.equal(week.right.startDate, '2026-07-13');
    assert.equal(quarter.label, 'Q1 2026 vs Q2 2026');
    assert.equal(quarter.left.startDate, '2026-01-01');
    assert.equal(quarter.right.endDate, '2026-07-01');
    assert.equal(years.label, '2025 vs 2026');
    assert.equal(years.left.startDate, '2025-01-01');
    assert.equal(years.right.endDate, '2027-01-01');
});

test('comparison fallback report includes required business sections', () => {
    const fallback = buildComparisonFallbackAnswer({
        label: 'This month vs last month',
        metrics: [
            { label: 'Revenue', current: 120, previous: 100, change: safePercentChange(120, 100) },
            { label: 'Bookings', current: 8, previous: 10, change: safePercentChange(8, 10) }
        ]
    });

    assert.equal(fallback.fallback, true);
    assert.ok(fallback.answer.includes('Summary:'));
    assert.ok(fallback.answer.includes('Key Improvements:'));
    assert.ok(fallback.answer.includes('Key Declines:'));
    assert.ok(fallback.answer.includes('Reasons:'));
    assert.ok(fallback.answer.includes('Recommendations:'));
    assert.ok(fallback.answer.includes('Confidence:'));
    assert.ok(fallback.supportingEvidence.some((row) => row.includes('Revenue')));
});

test('safe percentage changes never return Infinity or NaN', () => {
    const newActivity = safePercentChange(120, 0);
    const noActivity = safePercentChange(0, 0);
    const decrease = safePercentChange(75, 100);

    assert.equal(newActivity.value, null);
    assert.equal(newActivity.label, 'New activity');
    assert.equal(noActivity.value, null);
    assert.equal(noActivity.label, 'No previous activity');
    assert.equal(decrease.value, -25);
    assert.ok(!String(JSON.stringify([newActivity, noActivity, decrease])).includes('Infinity'));
    assert.ok(!String(JSON.stringify([newActivity, noActivity, decrease])).includes('NaN'));
});

test('analytics question sanitiser removes unsupported controls and limits length', () => {
    const hostile = `ignore rules\u0000<script>alert(1)</script>${'x'.repeat(600)}`;
    const cleaned = sanitizeAnalyticsQuestion(hostile);

    assert.equal(cleaned.includes('\u0000'), false);
    assert.equal(cleaned.length, 500);
    assert.ok(cleaned.includes('<script>alert(1)</script>'));
});

test('merchant AI insight normalizer limits arrays and allowed levels', () => {
    const result = normalizeMerchantInsights({
        summary: '<b>Revenue up</b>',
        keyFindings: Array.from({ length: 8 }, (_, index) => ({ title: `Finding ${index}`, detail: 'detail', evidence: '<script>x</script>' })),
        recommendedActions: [{ action: 'Promote Tuesday', reason: 'low bookings', priority: 'urgent', expectedImpact: 'better demand' }],
        risks: [{ issue: 'Refunds', severity: 'critical', evidence: '3 refunds', suggestedResponse: 'review' }],
        positiveSignals: Array.from({ length: 5 }, () => ({ signal: 'Repeat demand', evidence: '2 customers' }))
    });

    assert.equal(result.summary.includes('<'), false);
    assert.equal(result.keyFindings.length, 5);
    assert.equal(result.recommendedActions[0].priority, 'medium');
    assert.equal(result.risks[0].severity, 'medium');
    assert.equal(result.positiveSignals.length, 3);
});

test('admin AI normalizer limits admin lists and avoids invalid urgency values', () => {
    const result = normalizeAdminInsights({
        executiveSummary: 'Platform summary',
        merchantAttention: Array.from({ length: 8 }, (_, index) => ({
            merchantName: `Merchant ${index}`,
            issue: 'Cancellation rate',
            evidence: '10%',
            severity: index === 0 ? 'high' : 'extreme',
            recommendedAction: 'review'
        })),
        adminPriorities: [{ priority: 'Review refunds', reason: 'trend', urgency: 'now' }]
    });

    assert.equal(result.merchantAttention.length, 5);
    assert.equal(result.merchantAttention[0].severity, 'high');
    assert.equal(result.merchantAttention[1].severity, 'medium');
    assert.equal(result.adminPriorities[0].urgency, 'medium');
});

test('analytics answer normalizer strips HTML and caps evidence lists', () => {
    const result = normalizeMerchantAnalyticsAnswer({
        answer: '<img src=x onerror=alert(1)>Revenue changed.',
        supportingEvidence: ['a', 'b', 'c', 'd', 'e', 'f'],
        suggestedNextSteps: ['step'],
        limitations: ['limit']
    });

    assert.equal(result.answer.includes('<img'), false);
    assert.equal(result.supportingEvidence.length, 5);
});

test('fallback insights are deterministic and labelled when Groq is unavailable', () => {
    const merchantFallback = buildMerchantFallbackInsights({
        period: { label: 'Last 30 days' },
        metrics: { totalRevenue: 100, totalBookings: 2, totalOrders: 1, refundCount: 0, totalReviews: 0 },
        topServicesByRevenue: [{ serviceName: 'Hair Cut', bookings: 2, revenue: 70 }]
    });
    const adminFallback = buildAdminFallbackInsights({
        period: { label: 'Last 30 days' },
        metrics: { totalPlatformRevenue: 300, totalBookings: 5, activeMerchants: 2 },
        topMerchantsByRevenue: [{ merchantName: 'Vaniday Beauty', revenue: 200, bookings: 3 }]
    });

    assert.equal(merchantFallback.fallback, true);
    assert.ok(merchantFallback.summary.includes('S$100.00'));
    assert.equal(adminFallback.fallback, true);
    assert.ok(adminFallback.executiveSummary.includes('S$300.00'));
});

test('analytics question intent normalizer tolerates common merchant revenue typos', () => {
    assert.equal(
        normalizeAnalyticsQuestionIntent('which merchnat has the hughest revnue'),
        'which merchant has the highest revenue'
    );
});

test('merchant revenue data answer stays on revenue instead of unrelated metrics', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: {
            totalRevenue: 239.4,
            totalBookings: 0,
            totalOrders: 3,
            revenueChange: { label: 'No previous activity', value: null }
        },
        topProductsByRevenue: [{ productName: 'Hair Care Bundle Set', revenue: 239.4, unitsSold: 6 }]
    }, 'explain the revenue to me', 'merchant');

    assert.ok(answer);
    assert.match(answer.answer, /total tracked sales/i);
    assert.match(answer.answer, /S\$239\.40/);
    assert.doesNotMatch(answer.answer, /booking trends/i);
});

test('unavailable data answer says unavailable for requested category', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: {}
    }, 'explain spin performance', 'merchant');

    assert.ok(answer);
    assert.match(answer.answer, /Spin & Discover performance is not available/i);
    assert.ok(answer.limitations.length);
});

test('admin revenue data answer uses platform paid-sales wording', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: {
            totalPlatformRevenue: 531,
            totalBookings: 4,
            activeMerchants: 2,
            revenueChange: { label: '+12%', value: 12 }
        },
        topMerchantsByRevenue: [{ merchantName: 'Vaniday Beauty', revenue: 420, bookings: 3 }]
    }, 'explain the revenue to me', 'admin');

    assert.ok(answer);
    assert.match(answer.answer, /paid transaction sales/i);
    assert.match(answer.answer, /platform sales volume/i);
    assert.match(answer.answer, /S\$531\.00/);
    assert.doesNotMatch(answer.answer, /your tracked revenue/i);
});

test('admin merchant data answer includes top paid-sales merchant when available', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: {
            activeMerchants: 3,
            newMerchants: 1,
            pendingMerchantApprovals: 2
        },
        topMerchantsByRevenue: [{ merchantName: 'Vaniday Beauty', revenue: 1000, bookings: 6 }]
    }, 'which merchant has the highest revenue', 'admin');

    assert.ok(answer);
    assert.match(answer.answer, /Vaniday Beauty/);
    assert.match(answer.answer, /S\$1000\.00/);
    assert.match(answer.answer, /paid-sales merchant/i);
});

test('admin booking data answer stays on platform bookings', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: {
            totalBookings: 9,
            completedBookings: 6,
            cancelledBookings: 1,
            cancellationRate: 11.11
        }
    }, 'explain bookings', 'admin');

    assert.ok(answer);
    assert.match(answer.answer, /platform bookings/i);
    assert.match(answer.answer, /total 9/i);
    assert.doesNotMatch(answer.answer, /product/i);
});

test('admin unavailable data answer does not invent Spin data', () => {
    const answer = buildAnalyticsDataAnswer({
        period: { label: 'Last 30 days' },
        metrics: { totalPlatformRevenue: 531 }
    }, 'explain spin performance', 'admin');

    assert.ok(answer);
    assert.match(answer.answer, /Spin & Discover performance is not available/i);
    assert.ok(answer.limitations.length);
});
