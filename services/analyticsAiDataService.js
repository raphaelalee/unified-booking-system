const db = require('../db');

const SUPPORTED_PERIODS = new Set(['last7', 'last30', 'last90', 'thisMonth', 'previousMonth', 'currentYear']);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, rows = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows);
        });
    });
}

function toSingaporeDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date).reduce((map, part) => {
        map[part.type] = part.value;
        return map;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
    return date.toISOString().slice(0, 10);
}

function monthStart(dateKey) {
    return `${String(dateKey).slice(0, 7)}-01`;
}

function yearStart(dateKey) {
    return `${String(dateKey).slice(0, 4)}-01-01`;
}

function buildDateKey(year, month, day = 1) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addMonths(dateKey, months) {
    const [year, month] = String(dateKey).slice(0, 7).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + Number(months || 0), 1));
    return date.toISOString().slice(0, 10);
}

function addYears(dateKey, years) {
    const year = Number(String(dateKey).slice(0, 4));
    return `${year + Number(years || 0)}-01-01`;
}

function dateDiffDays(startDate, endDate) {
    return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY);
}

function buildPeriodFromRange(key, label, startDate, endDate) {
    const days = Math.max(1, dateDiffDays(startDate, endDate));
    return {
        key,
        label,
        startDate,
        endDate,
        previousStartDate: addDays(startDate, -days),
        previousEndDate: startDate,
        timezone: 'Asia/Singapore'
    };
}

function startOfSingaporeWeek(dateKey) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    const day = date.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    return addDays(dateKey, mondayOffset);
}

function resolveAnalyticsPeriod(periodKey = 'last30', now = new Date()) {
    const safePeriodKey = SUPPORTED_PERIODS.has(periodKey) ? periodKey : 'last30';
    const today = toSingaporeDateKey(now);
    const tomorrow = addDays(today, 1);

    if (safePeriodKey === 'last7') {
        return buildRollingPeriod('Last 7 days', addDays(tomorrow, -7), tomorrow);
    }

    if (safePeriodKey === 'last90') {
        return buildRollingPeriod('Last 90 days', addDays(tomorrow, -90), tomorrow);
    }

    if (safePeriodKey === 'thisMonth') {
        const start = monthStart(today);
        const previousStart = addMonths(start, -1);
        return {
            key: safePeriodKey,
            label: 'This month',
            startDate: start,
            endDate: tomorrow,
            previousStartDate: previousStart,
            previousEndDate: start,
            timezone: 'Asia/Singapore'
        };
    }

    if (safePeriodKey === 'previousMonth') {
        const currentMonthStart = monthStart(today);
        const previousStart = addMonths(currentMonthStart, -1);
        const previousPreviousStart = addMonths(currentMonthStart, -2);
        return {
            key: safePeriodKey,
            label: 'Previous month',
            startDate: previousStart,
            endDate: currentMonthStart,
            previousStartDate: previousPreviousStart,
            previousEndDate: previousStart,
            timezone: 'Asia/Singapore'
        };
    }

    if (safePeriodKey === 'currentYear') {
        const start = yearStart(today);
        const previousStart = addYears(start, -1);
        return {
            key: safePeriodKey,
            label: 'Current year',
            startDate: start,
            endDate: tomorrow,
            previousStartDate: previousStart,
            previousEndDate: start,
            timezone: 'Asia/Singapore'
        };
    }

    return buildRollingPeriod('Last 30 days', addDays(tomorrow, -30), tomorrow);
}

function buildRollingPeriod(label, startDate, endDate) {
    const days = dateDiffDays(startDate, endDate);

    return {
        key: label === 'Last 7 days' ? 'last7' : label === 'Last 90 days' ? 'last90' : 'last30',
        label,
        startDate,
        endDate,
        previousStartDate: addDays(startDate, -days),
        previousEndDate: startDate,
        timezone: 'Asia/Singapore'
    };
}

function quarterRange(year, quarter) {
    const startMonth = ((Number(quarter) - 1) * 3) + 1;
    const start = buildDateKey(year, startMonth);
    return {
        startDate: start,
        endDate: addMonths(start, 3)
    };
}

function yearRange(year) {
    return {
        startDate: buildDateKey(year, 1),
        endDate: buildDateKey(Number(year) + 1, 1)
    };
}

function parseAnalyticsComparisonQuestion(question = '', now = new Date()) {
    const text = sanitizeAnalyticsQuestion(question, 500);
    const normalized = text.toLowerCase();
    if (!/\b(compare|comparison|versus| vs | with |against)\b/.test(` ${normalized} `)) return null;

    const today = toSingaporeDateKey(now);
    const tomorrow = addDays(today, 1);
    const currentYear = Number(String(today).slice(0, 4));

    if (/\b(this|current)\s+month\b/.test(normalized) && /\b(last|previous)\s+month\b/.test(normalized)) {
        const currentStart = monthStart(today);
        const previousStart = addMonths(currentStart, -1);
        return {
            type: 'month',
            label: 'This month vs last month',
            left: buildPeriodFromRange('compare_this_month', 'This month', currentStart, tomorrow),
            right: buildPeriodFromRange('compare_last_month', 'Last month', previousStart, currentStart)
        };
    }

    if (/\b(this|current)\s+week\b/.test(normalized) && /\b(last|previous)\s+week\b/.test(normalized)) {
        const currentStart = startOfSingaporeWeek(today);
        const previousStart = addDays(currentStart, -7);
        return {
            type: 'week',
            label: 'This week vs last week',
            left: buildPeriodFromRange('compare_this_week', 'This week', currentStart, tomorrow),
            right: buildPeriodFromRange('compare_last_week', 'Last week', previousStart, currentStart)
        };
    }

    const quarterMatches = [...normalized.matchAll(/\bq([1-4])(?:\s*(20\d{2}))?\b/g)].map((match) => ({
        quarter: Number(match[1]),
        year: Number(match[2] || currentYear)
    }));
    if (quarterMatches.length >= 2) {
        const [leftQuarter, rightQuarter] = quarterMatches;
        const left = quarterRange(leftQuarter.year, leftQuarter.quarter);
        const right = quarterRange(rightQuarter.year, rightQuarter.quarter);
        return {
            type: 'quarter',
            label: `Q${leftQuarter.quarter} ${leftQuarter.year} vs Q${rightQuarter.quarter} ${rightQuarter.year}`,
            left: buildPeriodFromRange(`compare_q${leftQuarter.quarter}_${leftQuarter.year}`, `Q${leftQuarter.quarter} ${leftQuarter.year}`, left.startDate, left.endDate),
            right: buildPeriodFromRange(`compare_q${rightQuarter.quarter}_${rightQuarter.year}`, `Q${rightQuarter.quarter} ${rightQuarter.year}`, right.startDate, right.endDate)
        };
    }

    const yearMatches = [...normalized.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
    const uniqueYears = [...new Set(yearMatches)];
    if (uniqueYears.length >= 2) {
        const [leftYear, rightYear] = uniqueYears;
        const left = yearRange(leftYear);
        const right = yearRange(rightYear);
        return {
            type: 'year',
            label: `${leftYear} vs ${rightYear}`,
            left: buildPeriodFromRange(`compare_${leftYear}`, String(leftYear), left.startDate, left.endDate),
            right: buildPeriodFromRange(`compare_${rightYear}`, String(rightYear), right.startDate, right.endDate)
        };
    }

    return null;
}

function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
    return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundPercent(value) {
    return Math.round((safeNumber(value) + Number.EPSILON) * 10) / 10;
}

function safePercentChange(current, previous) {
    const currentValue = safeNumber(current);
    const previousValue = safeNumber(previous);

    if (previousValue === 0) {
        return {
            value: null,
            label: currentValue > 0 ? 'New activity' : 'No previous activity',
            current: currentValue,
            previous: previousValue
        };
    }

    const value = roundPercent(((currentValue - previousValue) / previousValue) * 100);
    return {
        value,
        label: `${value >= 0 ? '+' : ''}${value}%`,
        current: currentValue,
        previous: previousValue
    };
}

function sanitizeAnalyticsQuestion(value, maxLength = 500) {
    return String(value || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function normalizeAnalyticsQuestionIntent(value = '') {
    return sanitizeAnalyticsQuestion(value)
        .toLowerCase()
        .replace(/\bmerchnat\b/g, 'merchant')
        .replace(/\bmerhcant\b/g, 'merchant')
        .replace(/\bmerchat\b/g, 'merchant')
        .replace(/\bmerchnt\b/g, 'merchant')
        .replace(/\bmercahnt\b/g, 'merchant')
        .replace(/\bhughest\b/g, 'highest')
        .replace(/\bhigest\b/g, 'highest')
        .replace(/\bhighst\b/g, 'highest')
        .replace(/\banayltics\b/g, 'analytics')
        .replace(/\banalytcis\b/g, 'analytics')
        .replace(/\brefnud\b/g, 'refund')
        .replace(/\brefnuds\b/g, 'refunds')
        .replace(/\bbokking\b/g, 'booking')
        .replace(/\bbokkings\b/g, 'bookings')
        .replace(/\bpaymnet\b/g, 'payment')
        .replace(/\brevnuce\b/g, 'revenue')
        .replace(/\brevnue\b/g, 'revenue')
        .replace(/\brevenu\b/g, 'revenue');
}

function formatSgd(value) {
    return `S$${roundMoney(value).toFixed(2)}`;
}

function firstUsefulRow(rows = [], valueKeys = []) {
    return [...(Array.isArray(rows) ? rows : [])]
        .sort((left, right) => {
            const leftValue = valueKeys.reduce((max, key) => Math.max(max, safeNumber(left?.[key])), 0);
            const rightValue = valueKeys.reduce((max, key) => Math.max(max, safeNumber(right?.[key])), 0);
            return rightValue - leftValue;
        })[0] || null;
}

function classifyAnalyticsDataQuestion(question = '', scope = 'merchant') {
    const normalized = normalizeAnalyticsQuestionIntent(question);
    if (!normalized) return '';

    const isDataQuestion = /\b(explain|show|summari[sz]e|tell|what|which|who|how|total|highest|top|best|lowest|trend|breakdown|data|metric|kpi|performance)\b/.test(normalized);
    const isOperationalQuestion = /\b(today|attention|need attention|problem|issue|risk|priority|should i do|what should|action|actions|need action|pending|overdue|poor|weak|worst|underperform|low performing)\b/.test(normalized);
    if (!isDataQuestion && !isOperationalQuestion) return '';

    if (/\b(today|attention|need attention|problem|biggest problem|priority|should i do|what should|action|actions|need action|risk|risks)\b/.test(normalized)) return 'attention';
    if (scope === 'merchant' && /\b(payout|retained|net sales|net revenue|take home|earnings after refund)\b/.test(normalized)) return 'payout';
    if (/\b(revenue|sales|earning|earnings|income|paid transaction|transaction sales)\b/.test(normalized)) return 'revenue';
    if (scope === 'merchant' && /\b(service|services)\b/.test(normalized)) return 'services';
    if (/\b(booking|bookings|appointment|appointments|schedule demand|completed service|service booking)\b/.test(normalized)) return 'bookings';
    if (/\b(product|products|order|orders|units sold|item|items)\b/.test(normalized)) return 'products';
    if (/\b(refund|refunds|return|returns|cancellation|cancelled|canceled)\b/.test(normalized)) return 'refunds';
    if (/\b(rating|ratings|review|reviews|satisfaction|low rated)\b/.test(normalized)) return 'ratings';
    if (/\b(inventory|stock|restock|low stock|quantity)\b/.test(normalized)) return 'inventory';
    if (/\b(payment|payments|method|provider|transaction)\b/.test(normalized)) return 'payments';
    if (/\b(customer|customers|repeat customer|active customer|new customer)\b/.test(normalized)) return 'customers';
    if (scope === 'admin' && /\b(merchant|merchants|salon|salons|approval|approvals)\b/.test(normalized)) return 'merchants';
    if (scope === 'admin' && /\b(support|ticket|tickets|case|cases|dispute|disputes)\b/.test(normalized)) return 'support';
    if (/\b(loyalty|points|reward points)\b/.test(normalized)) return 'loyalty';
    if (/\b(cashback)\b/.test(normalized)) return 'cashback';
    if (/\b(spin|wheel|spin discover|redemption|reward popular)\b/.test(normalized)) return 'spin';
    if (/\b(promotion|promotions|campaign|voucher|vouchers)\b/.test(normalized)) return 'promotions';

    return '';
}

function buildAnalyticsDataAnswer(summary = {}, question = '', scope = 'merchant') {
    const intent = classifyAnalyticsDataQuestion(question, scope);
    if (!intent) return null;

    const metrics = summary.metrics || {};
    const period = summary.period?.label || 'the selected period';
    const evidence = [];
    const nextSteps = [];
    const limitations = [];
    let answer = '';

    const addEvidence = (label, value) => {
        evidence.push(`${label}: ${value}`);
    };
    const addEmptyDataGuidance = (topic) => {
        limitations.push(`${topic} data is empty or not exposed for ${period}.`);
        nextSteps.push('Try Last 90 days or create/complete source records first.');
    };

    if (intent === 'revenue') {
        if (scope === 'admin') {
            const total = roundMoney(metrics.totalPlatformRevenue);
            const topMerchant = firstUsefulRow(summary.topMerchantsByRevenue, ['revenue']);
            answer = total > 0
                ? `For ${period}, paid transaction sales are ${formatSgd(total)}. This is platform sales volume from paid transaction rows, not admin earnings.`
                : topMerchant?.merchantName
                    ? `For ${period}, the platform paid transaction sales total is not available in the current admin analytics summary.`
                    : `For ${period}, no paid transaction sales are available in the current admin analytics summary.`;
            if (total <= 0) addEmptyDataGuidance('Revenue');
            addEvidence('Paid transaction sales', formatSgd(total));
            addEvidence('Sales trend', metrics.revenueChange?.label || 'No previous-period comparison');
            if (topMerchant?.merchantName) {
                answer += ` The strongest paid-sales merchant signal is ${topMerchant.merchantName} at ${formatSgd(topMerchant.revenue)}.`;
                addEvidence('Top merchant by paid sales', `${topMerchant.merchantName} (${formatSgd(topMerchant.revenue)})`);
            }
            nextSteps.push('Use merchant performance and refund data before making admin decisions.');
        } else {
            const total = roundMoney(metrics.totalRevenue);
            const serviceRows = Array.isArray(summary.topServicesByRevenue) && summary.topServicesByRevenue.length
                ? summary.topServicesByRevenue
                : summary.topServicesByBookingCount;
            const topService = firstUsefulRow(serviceRows, ['revenue', 'bookings']);
            const topProduct = firstUsefulRow(summary.topProductsByRevenue, ['revenue', 'unitsSold']);
            answer = total > 0
                ? `For ${period}, total tracked sales are ${formatSgd(total)} from service bookings and product orders. Refund amounts are tracked separately, so this is not a net-after-refund figure.`
                : `For ${period}, no total tracked sales are available in the current merchant analytics summary.`;
            if (total <= 0) addEmptyDataGuidance('Revenue');
            addEvidence('Total tracked sales', formatSgd(total));
            addEvidence('Service bookings', safeNumber(metrics.totalBookings));
            addEvidence('Product orders', safeNumber(metrics.totalOrders));
            if (topService?.serviceName) addEvidence('Top service signal', `${topService.serviceName} (${formatSgd(topService.revenue)})`);
            if (topProduct?.productName) addEvidence('Top product signal', `${topProduct.productName} (${formatSgd(topProduct.revenue)})`);
            nextSteps.push('Compare sales with refunds and booking/order counts before changing promotions.');
        }
    } else if (intent === 'attention') {
        if (scope === 'admin') {
            const issues = [];
            if (safeNumber(metrics.pendingMerchantApprovals) > 0) issues.push(`${safeNumber(metrics.pendingMerchantApprovals)} merchant approval${safeNumber(metrics.pendingMerchantApprovals) === 1 ? '' : 's'} waiting`);
            if (safeNumber(metrics.unresolvedSupportCases) > 0) issues.push(`${safeNumber(metrics.unresolvedSupportCases)} unresolved support case${safeNumber(metrics.unresolvedSupportCases) === 1 ? '' : 's'}`);
            const highRefundMerchant = firstUsefulRow(summary.merchantsWithHighestRefundRates, ['refundCount']);
            const highCancelMerchant = firstUsefulRow(summary.merchantsWithHighestCancellationRates, ['cancellationRate']);
            if (highRefundMerchant?.merchantName && safeNumber(highRefundMerchant.refundCount) > 0) issues.push(`${highRefundMerchant.merchantName} has the highest refund count`);
            if (highCancelMerchant?.merchantName && safeNumber(highCancelMerchant.cancellationRate) > 0) issues.push(`${highCancelMerchant.merchantName} has the highest cancellation rate`);
            answer = issues.length
                ? `For ${period}, admin attention should go to: ${issues.slice(0, 3).join('; ')}.`
                : `For ${period}, the admin analytics summary does not show urgent platform attention items.`;
            addEvidence('Pending merchant approvals', safeNumber(metrics.pendingMerchantApprovals));
            addEvidence('Unresolved support cases', safeNumber(metrics.unresolvedSupportCases));
            if (highRefundMerchant?.merchantName) addEvidence('Highest refund merchant', `${highRefundMerchant.merchantName} (${safeNumber(highRefundMerchant.refundCount)} cases)`);
            if (highCancelMerchant?.merchantName) addEvidence('Highest cancellation merchant', `${highCancelMerchant.merchantName} (${roundPercent(highCancelMerchant.cancellationRate)}%)`);
            nextSteps.push('Review pending approvals, unresolved support cases and high-refund merchants first.');
        } else {
            const issues = [];
            const lowStock = Array.isArray(summary.stockConcerns) ? summary.stockConcerns[0] : null;
            const weakService = Array.isArray(summary.lowestPerformingServices) ? summary.lowestPerformingServices[0] : null;
            const weakProduct = Array.isArray(summary.lowestPerformingProducts) ? summary.lowestPerformingProducts[0] : null;
            if (lowStock?.productName) issues.push(`${lowStock.productName} is low on stock (${safeNumber(lowStock.stockQuantity)} left)`);
            if (safeNumber(metrics.refundCount) > 0) issues.push(`${safeNumber(metrics.refundCount)} refund case${safeNumber(metrics.refundCount) === 1 ? '' : 's'} in the period`);
            if (safeNumber(metrics.cancelledBookings) > 0) issues.push(`${safeNumber(metrics.cancelledBookings)} cancelled booking${safeNumber(metrics.cancelledBookings) === 1 ? '' : 's'}`);
            if (safeNumber(metrics.lowRatedReviews) > 0) issues.push(`${safeNumber(metrics.lowRatedReviews)} low-rated review${safeNumber(metrics.lowRatedReviews) === 1 ? '' : 's'}`);
            answer = issues.length
                ? `For ${period}, your main attention items are: ${issues.slice(0, 3).join('; ')}.`
                : `For ${period}, the merchant analytics summary does not show urgent action items.`;
            if (lowStock?.productName) addEvidence('Lowest stock item', `${lowStock.productName}: ${safeNumber(lowStock.stockQuantity)} left`);
            addEvidence('Refund cases', safeNumber(metrics.refundCount));
            addEvidence('Cancelled bookings', safeNumber(metrics.cancelledBookings));
            addEvidence('Low-rated reviews', safeNumber(metrics.lowRatedReviews));
            if (weakService?.serviceName) addEvidence('Quietest service signal', `${weakService.serviceName}: ${safeNumber(weakService.bookings)} bookings`);
            if (weakProduct?.productName) addEvidence('Weakest product signal', `${weakProduct.productName}: ${safeNumber(weakProduct.unitsSold)} units`);
            nextSteps.push('Check refunds, low stock and weak performers before creating new promotions.');
        }
    } else if (intent === 'bookings') {
        answer = `For ${period}, ${scope === 'admin' ? 'platform bookings' : 'service bookings'} total ${safeNumber(metrics.totalBookings)}. Completed bookings are ${safeNumber(metrics.completedBookings)}, cancelled bookings are ${safeNumber(metrics.cancelledBookings)}, and the cancellation rate is ${roundPercent(metrics.cancellationRate)}%.`;
        if (safeNumber(metrics.totalBookings) <= 0) addEmptyDataGuidance('Booking');
        addEvidence('Total bookings', safeNumber(metrics.totalBookings));
        addEvidence('Completed bookings', safeNumber(metrics.completedBookings));
        addEvidence('Cancelled bookings', safeNumber(metrics.cancelledBookings));
        if ((summary.busiestBookingDays || [])[0]?.day) addEvidence('Busiest day', `${summary.busiestBookingDays[0].day} (${safeNumber(summary.busiestBookingDays[0].bookings)} bookings)`);
        nextSteps.push('Review cancelled and pending bookings before changing schedule or staffing.');
    } else if (intent === 'services') {
        const asksWeak = /\b(poor|weak|worst|lowest|underperform|low performing|poorly|quiet)\b/.test(normalizeAnalyticsQuestionIntent(question));
        const serviceRows = Array.isArray(summary.topServicesByRevenue) && summary.topServicesByRevenue.length
            ? summary.topServicesByRevenue
            : summary.topServicesByBookingCount;
        const service = asksWeak
            ? (Array.isArray(summary.lowestPerformingServices) ? summary.lowestPerformingServices[0] : null)
            : firstUsefulRow(serviceRows, ['revenue', 'bookings']);
        answer = service
            ? asksWeak
                ? `For ${period}, the weakest service signal is ${service.serviceName}, with ${safeNumber(service.bookings)} bookings and ${formatSgd(service.revenue)} in service-booking sales.`
                : `For ${period}, the strongest service signal is ${service.serviceName}, with ${safeNumber(service.bookings)} bookings and ${formatSgd(service.revenue)} in service-booking sales.`
            : `For ${period}, service performance is not available in the current merchant analytics summary.`;
        if (!service) addEmptyDataGuidance('Service');
        if (service) addEvidence(asksWeak ? 'Weakest service' : 'Best service', `${service.serviceName}: ${safeNumber(service.bookings)} bookings, ${formatSgd(service.revenue)}`);
        nextSteps.push(asksWeak ? 'Review pricing, timing and visibility before changing the service.' : 'Promote high-performing services only after checking capacity.');
    } else if (intent === 'products') {
        const asksWeak = /\b(poor|weak|worst|lowest|underperform|low performing|poorly)\b/.test(normalizeAnalyticsQuestionIntent(question));
        const topProduct = asksWeak
            ? (Array.isArray(summary.lowestPerformingProducts) ? summary.lowestPerformingProducts[0] : null)
            : firstUsefulRow(summary.topProductsByRevenue, ['revenue', 'unitsSold']);
        answer = topProduct
            ? asksWeak
                ? `For ${period}, the weakest product signal is ${topProduct.productName}, with ${safeNumber(topProduct.unitsSold)} units sold and ${formatSgd(topProduct.revenue)} in product-order sales.`
                : `For ${period}, the strongest product signal is ${topProduct.productName}, with ${safeNumber(topProduct.unitsSold)} units sold and ${formatSgd(topProduct.revenue)} in product-order sales.`
            : `For ${period}, product/order performance is not available in the current analytics summary.`;
        if (!topProduct) addEmptyDataGuidance('Product/order');
        addEvidence('Completed product orders', safeNumber(metrics.totalOrders));
        if (topProduct) addEvidence(asksWeak ? 'Weakest product' : 'Top product', `${topProduct.productName} (${safeNumber(topProduct.unitsSold)} units, ${formatSgd(topProduct.revenue)})`);
        nextSteps.push('Check inventory before promoting top products.');
    } else if (intent === 'refunds') {
        const count = safeNumber(scope === 'admin' ? metrics.totalRefunds : metrics.refundCount);
        answer = `For ${period}, there are ${count} refund case${count === 1 ? '' : 's'}. Gross refunds are ${formatSgd(metrics.grossRefundAmount)} and net customer refunds are ${formatSgd(metrics.netRefundAmount)}.`;
        if (count <= 0) nextSteps.push('No refund activity is a positive signal, but confirm with the refund history page.');
        addEvidence('Refund cases', count);
        addEvidence('Gross refunds', formatSgd(metrics.grossRefundAmount));
        addEvidence('Net customer refunds', formatSgd(metrics.netRefundAmount));
        nextSteps.push('Review refund reasons and statuses before treating sales as retained value.');
    } else if (intent === 'ratings') {
        answer = metrics.averageCustomerRating == null
            ? `For ${period}, rating data is not available in the current analytics summary.`
            : `For ${period}, the average customer rating is ${Number(metrics.averageCustomerRating).toFixed(1)} out of 5 from ${safeNumber(metrics.totalReviews)} review${safeNumber(metrics.totalReviews) === 1 ? '' : 's'}.`;
        if (metrics.averageCustomerRating == null) addEmptyDataGuidance('Rating');
        addEvidence('Average rating', metrics.averageCustomerRating == null ? 'Not available' : `${Number(metrics.averageCustomerRating).toFixed(1)} / 5`);
        addEvidence('Low-rated reviews', safeNumber(metrics.lowRatedReviews));
        nextSteps.push('Follow up on low-rated reviews before making broad conclusions.');
    } else if (intent === 'inventory') {
        const concerns = Array.isArray(summary.stockConcerns) ? summary.stockConcerns : [];
        answer = concerns.length
            ? `${concerns.length} low-stock item${concerns.length === 1 ? '' : 's'} are visible in the current analytics summary. The lowest item is ${concerns[0].productName} with ${safeNumber(concerns[0].stockQuantity)} left.`
            : `No low-stock inventory concerns are available in the current analytics summary.`;
        if (!concerns.length) nextSteps.push('No low-stock items are flagged in the analytics summary.');
        concerns.slice(0, 5).forEach((row) => addEvidence(row.productName || 'Product', `${safeNumber(row.stockQuantity)} left`));
        nextSteps.push('Restock before running product or Spin rewards campaigns.');
    } else if (intent === 'payments') {
        const rows = Array.isArray(summary.paymentMethodDistribution) ? summary.paymentMethodDistribution : [];
        const top = firstUsefulRow(rows, ['amount', 'count']);
        answer = top
            ? `For ${period}, the leading payment method is ${top.method}, with ${formatSgd(top.amount)} across ${safeNumber(top.count)} transaction${safeNumber(top.count) === 1 ? '' : 's'}.`
            : `For ${period}, payment method data is not available in the current analytics summary.`;
        if (!top) addEmptyDataGuidance('Payment method');
        rows.slice(0, 5).forEach((row) => addEvidence(row.method || 'Payment method', `${formatSgd(row.amount)} from ${safeNumber(row.count)} transaction(s)`));
        nextSteps.push('Use payment mix together with refund and sales data.');
    } else if (intent === 'customers') {
        answer = scope === 'admin'
            ? `For ${period}, active customers are ${safeNumber(metrics.activeCustomers)} and new customers are ${safeNumber(metrics.newCustomers)}.`
            : `For ${period}, new customer signals are ${safeNumber(metrics.newCustomers)}. Repeat customer data is ${metrics.repeatCustomers == null ? 'not available' : safeNumber(metrics.repeatCustomers)} in the current analytics summary.`;
        if (scope === 'admin' && safeNumber(metrics.activeCustomers) <= 0 && safeNumber(metrics.newCustomers) <= 0) addEmptyDataGuidance('Customer');
        addEvidence('New customers', safeNumber(metrics.newCustomers));
        if (scope === 'admin') addEvidence('Active customers', safeNumber(metrics.activeCustomers));
        if (scope !== 'admin') addEvidence('Repeat customers', metrics.repeatCustomers == null ? 'Not available' : safeNumber(metrics.repeatCustomers));
        nextSteps.push('Compare customer activity with bookings, orders and ratings.');
    } else if (intent === 'merchants') {
        const topMerchant = firstUsefulRow(summary.topMerchantsByRevenue, ['revenue']);
        answer = `For ${period}, active merchants are ${safeNumber(metrics.activeMerchants)}, new merchant accounts are ${safeNumber(metrics.newMerchants)}, and pending merchant approvals are ${safeNumber(metrics.pendingMerchantApprovals)}.`;
        if (topMerchant?.merchantName) answer += ` The strongest paid-sales merchant signal is ${topMerchant.merchantName} at ${formatSgd(topMerchant.revenue)}.`;
        addEvidence('Active merchants', safeNumber(metrics.activeMerchants));
        addEvidence('New merchant accounts', safeNumber(metrics.newMerchants));
        addEvidence('Pending approvals', safeNumber(metrics.pendingMerchantApprovals));
        if (topMerchant?.merchantName) addEvidence('Top merchant by paid sales', `${topMerchant.merchantName} (${formatSgd(topMerchant.revenue)})`);
        nextSteps.push('Use approval, rating, refund and paid-sales signals together for admin review.');
    } else if (intent === 'support') {
        answer = `For ${period}, support tickets total ${safeNumber(metrics.supportTicketCount)} and unresolved support cases are ${safeNumber(metrics.unresolvedSupportCases)}.`;
        addEvidence('Support tickets', safeNumber(metrics.supportTicketCount));
        addEvidence('Unresolved cases', safeNumber(metrics.unresolvedSupportCases));
        nextSteps.push('Review unresolved cases before making platform-level decisions.');
    } else if (intent === 'payout') {
        const retainedBeforeFees = roundMoney(safeNumber(metrics.totalRevenue) - safeNumber(metrics.netRefundAmount));
        answer = `For ${period}, estimated retained sales after net customer refunds are ${formatSgd(retainedBeforeFees)}. This is not final payout because commission, settlement timing and provider fees may still apply.`;
        addEvidence('Total tracked sales', formatSgd(metrics.totalRevenue));
        addEvidence('Net customer refunds', formatSgd(metrics.netRefundAmount));
        addEvidence('Estimated retained sales', formatSgd(retainedBeforeFees));
        nextSteps.push('Use wallet/payout records for final settlement confirmation.');
    } else {
        const labels = {
            loyalty: 'loyalty',
            cashback: 'cashback',
            spin: 'Spin & Discover',
            promotions: 'promotion'
        };
        answer = `${labels[intent] || intent} performance is not available in the current analytics summary payload. Use the dedicated ${labels[intent] || intent} page for source records before making decisions.`;
        limitations.push(`${labels[intent] || intent} metrics are not exposed in this analytics summary.`);
        nextSteps.push(`Open the dedicated ${labels[intent] || intent} page and use its existing records.`);
    }

    return {
        fallback: true,
        answer,
        supportingEvidence: evidence.slice(0, 3),
        suggestedNextSteps: nextSteps.slice(0, 2),
        recommendedAdminActions: scope === 'admin' ? nextSteps.slice(0, 2) : undefined,
        limitations: limitations.slice(0, 2)
    };
}

function hasUsefulData(summary = {}) {
    const metrics = summary.metrics || {};
    return safeNumber(metrics.totalRevenue)
        + safeNumber(metrics.totalBookings)
        + safeNumber(metrics.totalOrders)
        + safeNumber(metrics.refundCount)
        + safeNumber(metrics.totalReviews) > 0;
}

function buildMerchantFallbackInsights(summary = {}) {
    const metrics = summary.metrics || {};
    const topService = summary.topServicesByRevenue?.[0] || summary.topServicesByBookingCount?.[0];
    const topProduct = summary.topProductsByRevenue?.[0];

    return {
        fallback: true,
        summary: hasUsefulData(summary)
            ? `For ${summary.period?.label || 'the selected period'}, total tracked sales were S$${roundMoney(metrics.totalRevenue).toFixed(2)} from ${safeNumber(metrics.totalBookings)} service bookings and ${safeNumber(metrics.totalOrders)} product orders.`
            : 'There is not enough merchant activity in the selected period for detailed AI recommendations yet.',
        keyFindings: [
            topService ? {
                title: 'Top service signal',
                detail: `${topService.serviceName} is the strongest service signal in the selected period.`,
                evidence: `${safeNumber(topService.bookings)} bookings and S$${roundMoney(topService.revenue).toFixed(2)} service-booking sales`
            } : null,
            topProduct ? {
                title: 'Top product signal',
                detail: `${topProduct.productName} is the strongest product signal in the selected period.`,
                evidence: `${safeNumber(topProduct.unitsSold)} units and S$${roundMoney(topProduct.revenue).toFixed(2)} product-order sales`
            } : null
        ].filter(Boolean),
        recommendedActions: hasUsefulData(summary) ? [{
            action: 'Review the strongest and weakest demand signals before changing promotions.',
            reason: 'The deterministic fallback can identify totals, but Groq is unavailable for deeper interpretation.',
            priority: 'medium',
            expectedImpact: 'Keeps decisions grounded in the dashboard data until AI insights are available.'
        }] : [],
        risks: [],
        positiveSignals: metrics.revenueChange?.value > 0 ? [{
            signal: 'Revenue improved versus the comparison period.',
            evidence: metrics.revenueChange.label
        }] : []
    };
}

function buildAdminFallbackInsights(summary = {}) {
    const metrics = summary.metrics || {};
    const topMerchant = summary.topMerchantsByRevenue?.[0];

    return {
        fallback: true,
        executiveSummary: hasUsefulData(summary)
            ? `For ${summary.period?.label || 'the selected period'}, paid transaction sales were S$${roundMoney(metrics.totalPlatformRevenue).toFixed(2)} across ${safeNumber(metrics.totalBookings)} platform bookings and ${safeNumber(metrics.activeMerchants)} active merchants.`
            : 'There is not enough platform activity in the selected period for detailed AI recommendations yet.',
        platformTrends: [
            topMerchant ? {
                trend: 'Merchant concentration signal',
                evidence: `${topMerchant.merchantName} has S$${roundMoney(topMerchant.revenue).toFixed(2)} in paid transaction sales from ${safeNumber(topMerchant.bookings)} booking/order records.`,
                impact: 'Review whether growth is concentrated in a small number of merchants.'
            } : null
        ].filter(Boolean),
        merchantAttention: [],
        operationalRisks: [],
        growthOpportunities: [],
        adminPriorities: [{
            priority: 'Review platform analytics manually while AI is unavailable.',
            reason: 'Deterministic metrics are available, but AI interpretation could not be generated.',
            urgency: 'medium'
        }]
    };
}

function dateFilter(columnAlias = 'created_at') {
    return `${columnAlias} >= ? AND ${columnAlias} < ?`;
}

function topRows(rows = [], labelKey, valueKey, limit = 5, ascending = false) {
    return rows
        .sort((left, right) => ascending
            ? safeNumber(left[valueKey]) - safeNumber(right[valueKey])
            : safeNumber(right[valueKey]) - safeNumber(left[valueKey]))
        .slice(0, limit)
        .map((row) => ({ ...row }));
}

async function getMerchantProfile(userId) {
    const rows = await query(
        'SELECT salon_id, merchant_id, salon_name, business_category, approval_status FROM salons WHERE merchant_id = ? LIMIT 1',
        [userId]
    );
    return rows[0] || null;
}

async function getMerchantTransactionSummary(userId, salonId, startDate, endDate) {
    const scopeSql = `
        (t.merchant_id = ?
            OR EXISTS (
                SELECT 1
                FROM order_items oi
                JOIN products p ON p.product_id = oi.product_id
                WHERE oi.transaction_id = t.transaction_id AND p.salon_id = ?
            )
            OR EXISTS (
                SELECT 1
                FROM bookings b
                WHERE b.transaction_id = t.transaction_id AND b.merchant_id = ?
            )
        )`;
    const rows = await query(`
        SELECT
            COUNT(DISTINCT t.transaction_id) AS transactionCount,
            COUNT(DISTINCT CASE WHEN t.order_id IS NOT NULL THEN t.order_id END) AS totalOrders,
            SUM(CASE WHEN t.payment_status IN ('paid','partially_refunded','refunded') THEN t.paid_amount ELSE 0 END) AS revenue,
            SUM(CASE WHEN t.payment_status IN ('paid','partially_refunded','refunded') THEN t.gross_amount ELSE 0 END) AS grossRevenue,
            SUM(CASE WHEN t.payment_status IN ('paid','partially_refunded','refunded') THEN t.discount_amount + t.voucher_discount_amount ELSE 0 END) AS discounts,
            SUM(CASE WHEN t.payment_status IN ('paid','partially_refunded','refunded') THEN t.refunded_amount ELSE 0 END) AS refundedAmount,
            COUNT(DISTINCT t.user_id) AS customers
        FROM transactions t
        WHERE ${scopeSql} AND ${dateFilter('t.created_at')}
    `, [userId, salonId, salonId, startDate, endDate]);

    const row = rows[0] || {};
    return {
        transactionCount: safeNumber(row.transactionCount),
        totalOrders: safeNumber(row.totalOrders),
        revenue: roundMoney(row.revenue),
        grossRevenue: roundMoney(row.grossRevenue),
        discounts: roundMoney(row.discounts),
        refundedAmount: roundMoney(row.refundedAmount),
        customers: safeNumber(row.customers)
    };
}

async function getMerchantBookingSummary(salonId, startDate, endDate) {
    const rows = await query(`
        SELECT
            COUNT(*) AS totalBookings,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedBookings,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledBookings,
            COUNT(DISTINCT user_id) AS bookingCustomers,
            SUM(CASE WHEN transaction_id IS NULL AND payment_status IN ('paid','partially_refunded','refunded') THEN paid_amount ELSE 0 END) AS paidBookingRevenue
        FROM bookings
        WHERE merchant_id = ? AND booking_date >= ? AND booking_date < ?
    `, [salonId, startDate, endDate]);

    const row = rows[0] || {};
    return {
        totalBookings: safeNumber(row.totalBookings),
        completedBookings: safeNumber(row.completedBookings),
        cancelledBookings: safeNumber(row.cancelledBookings),
        bookingCustomers: safeNumber(row.bookingCustomers),
        paidBookingRevenue: roundMoney(row.paidBookingRevenue)
    };
}

async function getMerchantRefundSummary(userId, startDate, endDate) {
    const rows = await query(`
        SELECT
            COUNT(*) AS refundCount,
            SUM(gross_refund_amount) AS grossRefundAmount,
            SUM(net_refund_amount) AS netRefundAmount,
            SUM(processing_fee_deduction) AS customerDeductions
        FROM support_requests
        WHERE merchant_user_id = ?
          AND request_type IN ('order_refund','booking_refund')
          AND status IN ('approved','refund_processing','refund_completed','resolved','succeeded')
          AND created_at >= ? AND created_at < ?
    `, [userId, startDate, endDate]);

    const row = rows[0] || {};
    return {
        refundCount: safeNumber(row.refundCount),
        grossRefundAmount: roundMoney(row.grossRefundAmount),
        netRefundAmount: roundMoney(row.netRefundAmount),
        customerDeductions: roundMoney(row.customerDeductions)
    };
}

async function getMerchantBreakdowns(salonId, startDate, endDate) {
    const [
        services,
        products,
        paymentMethods,
        bookingDays,
        bookingHours,
        reviews,
        stockConcerns
    ] = await Promise.all([
        query(`
            SELECT s.service_name AS serviceName, COUNT(*) AS bookings, SUM(CASE WHEN b.payment_status IN ('paid','partially_refunded','refunded') THEN b.paid_amount ELSE 0 END) AS revenue
            FROM bookings b
            JOIN services s ON s.service_id = b.service_id
            WHERE b.merchant_id = ? AND b.booking_date >= ? AND b.booking_date < ?
            GROUP BY s.service_id, s.service_name
        `, [salonId, startDate, endDate]),
        query(`
            SELECT p.name AS productName, SUM(oi.quantity) AS unitsSold, COUNT(DISTINCT t.transaction_id) AS orders, SUM(oi.quantity * oi.price_at_purchase) AS revenue
            FROM order_items oi
            JOIN products p ON p.product_id = oi.product_id
            JOIN transactions t ON t.transaction_id = oi.transaction_id
            WHERE p.salon_id = ? AND t.payment_status IN ('paid','partially_refunded','refunded') AND ${dateFilter('t.created_at')}
            GROUP BY p.product_id, p.name
        `, [salonId, startDate, endDate]),
        query(`
            SELECT COALESCE(NULLIF(t.payment_method, ''), 'Not set') AS method, COUNT(DISTINCT t.transaction_id) AS count, SUM(t.paid_amount) AS amount
            FROM transactions t
            WHERE t.payment_status IN ('paid','partially_refunded','refunded')
              AND ${dateFilter('t.created_at')}
              AND (
                EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.product_id = oi.product_id WHERE oi.transaction_id = t.transaction_id AND p.salon_id = ?)
                OR EXISTS (SELECT 1 FROM bookings b WHERE b.transaction_id = t.transaction_id AND b.merchant_id = ?)
              )
            GROUP BY method
        `, [startDate, endDate, salonId, salonId]),
        query(`
            SELECT DAYNAME(booking_date) AS dayName, COUNT(*) AS bookings
            FROM bookings
            WHERE merchant_id = ? AND booking_date >= ? AND booking_date < ?
            GROUP BY dayName
        `, [salonId, startDate, endDate]),
        query(`
            SELECT HOUR(timeslot) AS hourOfDay, COUNT(*) AS bookings
            FROM bookings
            WHERE merchant_id = ? AND booking_date >= ? AND booking_date < ?
            GROUP BY hourOfDay
        `, [salonId, startDate, endDate]),
        query(`
            SELECT COUNT(*) AS totalReviews, AVG(rating) AS averageRating, SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS lowRatedReviews
            FROM reviews
            WHERE merchant_id = ? AND created_at >= ? AND created_at < ?
        `, [salonId, startDate, endDate]),
        query(`
            SELECT name AS productName, stock_quantity AS stockQuantity
            FROM products
            WHERE salon_id = ? AND stock_quantity <= 5
            ORDER BY stock_quantity ASC, name ASC
            LIMIT 5
        `, [salonId])
    ]);

    const reviewRow = reviews[0] || {};
    return {
        topServicesByRevenue: topRows(services.map((row) => ({
            serviceName: row.serviceName,
            bookings: safeNumber(row.bookings),
            revenue: roundMoney(row.revenue)
        })), 'serviceName', 'revenue'),
        topServicesByBookingCount: topRows(services.map((row) => ({
            serviceName: row.serviceName,
            bookings: safeNumber(row.bookings),
            revenue: roundMoney(row.revenue)
        })), 'serviceName', 'bookings'),
        lowestPerformingServices: topRows(services.map((row) => ({
            serviceName: row.serviceName,
            bookings: safeNumber(row.bookings),
            revenue: roundMoney(row.revenue)
        })), 'serviceName', 'bookings', 5, true),
        topProductsByRevenue: topRows(products.map((row) => ({
            productName: row.productName,
            unitsSold: safeNumber(row.unitsSold),
            orders: safeNumber(row.orders),
            revenue: roundMoney(row.revenue)
        })), 'productName', 'revenue'),
        lowestPerformingProducts: topRows(products.map((row) => ({
            productName: row.productName,
            unitsSold: safeNumber(row.unitsSold),
            orders: safeNumber(row.orders),
            revenue: roundMoney(row.revenue)
        })), 'productName', 'unitsSold', 5, true),
        paymentMethodDistribution: paymentMethods.map((row) => ({
            method: row.method,
            count: safeNumber(row.count),
            amount: roundMoney(row.amount)
        })),
        busiestBookingDays: topRows(bookingDays.map((row) => ({ day: row.dayName, bookings: safeNumber(row.bookings) })), 'day', 'bookings', 3),
        leastBusyBookingDays: topRows(bookingDays.map((row) => ({ day: row.dayName, bookings: safeNumber(row.bookings) })), 'day', 'bookings', 3, true),
        busiestBookingHours: topRows(bookingHours.map((row) => ({ hour: `${String(row.hourOfDay).padStart(2, '0')}:00`, bookings: safeNumber(row.bookings) })), 'hour', 'bookings', 3),
        averageCustomerRating: reviewRow.averageRating === null ? null : roundPercent(reviewRow.averageRating),
        totalReviews: safeNumber(reviewRow.totalReviews),
        lowRatedReviews: safeNumber(reviewRow.lowRatedReviews),
        stockConcerns: stockConcerns.map((row) => ({
            productName: row.productName,
            stockQuantity: safeNumber(row.stockQuantity)
        }))
    };
}

async function buildMerchantAnalyticsSummaryForPeriod(userId, merchant, period) {
    const [currentTransactions, previousTransactions, currentBookings, previousBookings, refunds, breakdowns] = await Promise.all([
        getMerchantTransactionSummary(userId, merchant.salon_id, period.startDate, period.endDate),
        getMerchantTransactionSummary(userId, merchant.salon_id, period.previousStartDate, period.previousEndDate),
        getMerchantBookingSummary(merchant.salon_id, period.startDate, period.endDate),
        getMerchantBookingSummary(merchant.salon_id, period.previousStartDate, period.previousEndDate),
        getMerchantRefundSummary(userId, period.startDate, period.endDate),
        getMerchantBreakdowns(merchant.salon_id, period.startDate, period.endDate)
    ]);

    const totalRevenue = roundMoney(currentTransactions.revenue + currentBookings.paidBookingRevenue);
    const previousRevenue = roundMoney(previousTransactions.revenue + previousBookings.paidBookingRevenue);
    const totalActivity = currentTransactions.transactionCount + currentBookings.totalBookings;
    const cancellationRate = currentBookings.totalBookings ? roundPercent((currentBookings.cancelledBookings / currentBookings.totalBookings) * 100) : 0;

    return {
        scope: 'merchant',
        merchant: {
            merchantId: userId,
            salonId: merchant.salon_id,
            merchantName: merchant.salon_name,
            businessCategory: merchant.business_category || 'Not set',
            approvalStatus: merchant.approval_status
        },
        period,
        currency: 'SGD',
        statusFilters: {
            revenue: ['paid', 'partially_refunded', 'refunded'],
            refunds: ['approved', 'refund_processing', 'refund_completed', 'resolved', 'succeeded']
        },
        metricDefinitions: {
            totalRevenue: 'Total tracked merchant sales from paid, partially refunded and refunded transactions plus paid bookings that do not have a transaction row. Refund amounts are supplied separately.',
            grossRefundAmount: 'Approved or processing gross customer refund amount from support refund requests.',
            netRefundAmount: 'Approved or processing final amount returned to customers after deductions.'
        },
        metrics: {
            totalRevenue,
            previousPeriodRevenue: previousRevenue,
            revenueChange: safePercentChange(totalRevenue, previousRevenue),
            totalBookings: currentBookings.totalBookings,
            previousPeriodBookings: previousBookings.totalBookings,
            bookingChange: safePercentChange(currentBookings.totalBookings, previousBookings.totalBookings),
            completedBookings: currentBookings.completedBookings,
            cancelledBookings: currentBookings.cancelledBookings,
            cancellationRate,
            totalOrders: currentTransactions.totalOrders,
            refundCount: refunds.refundCount,
            grossRefundAmount: refunds.grossRefundAmount,
            netRefundAmount: refunds.netRefundAmount,
            averageOrderOrBookingValue: totalActivity ? roundMoney(totalRevenue / totalActivity) : 0,
            newCustomers: currentTransactions.customers + currentBookings.bookingCustomers,
            repeatCustomers: null,
            totalReviews: breakdowns.totalReviews,
            averageCustomerRating: breakdowns.averageCustomerRating,
            lowRatedReviews: breakdowns.lowRatedReviews
        },
        ...breakdowns,
        insufficientData: !hasUsefulData({ metrics: { ...breakdowns, totalRevenue, totalBookings: currentBookings.totalBookings, totalOrders: currentTransactions.totalOrders, refundCount: refunds.refundCount, totalReviews: breakdowns.totalReviews } })
    };
}

async function buildMerchantAnalyticsSummary(userId, periodKey = 'last30') {
    const merchant = await getMerchantProfile(userId);

    if (!merchant) {
        const error = new Error('Merchant profile could not be confirmed.');
        error.status = 403;
        error.code = 'MERCHANT_NOT_FOUND';
        throw error;
    }

    const period = resolveAnalyticsPeriod(periodKey);
    return buildMerchantAnalyticsSummaryForPeriod(userId, merchant, period);
}

async function getAdminSummaryRows(startDate, endDate) {
    const [transactions, bookings, refunds, users, merchants, support] = await Promise.all([
        query(`
            SELECT
                COUNT(DISTINCT CASE WHEN payment_status IN ('paid','partially_refunded','refunded') THEN transaction_id END) AS paidTransactions,
                SUM(CASE WHEN payment_status IN ('paid','partially_refunded','refunded') THEN paid_amount ELSE 0 END) AS revenue,
                SUM(refunded_amount) AS refundedAmount,
                COUNT(DISTINCT CASE WHEN payment_status IN ('paid','partially_refunded','refunded') THEN user_id END) AS activeCustomers
            FROM transactions
            WHERE ${dateFilter('created_at')}
        `, [startDate, endDate]),
        query(`
            SELECT
                COUNT(*) AS totalBookings,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedBookings,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledBookings
            FROM bookings
            WHERE booking_date >= ? AND booking_date < ?
        `, [startDate, endDate]),
        query(`
            SELECT
                COUNT(*) AS refundCount,
                SUM(gross_refund_amount) AS grossRefundAmount,
                SUM(net_refund_amount) AS netRefundAmount
            FROM support_requests
            WHERE request_type IN ('order_refund','booking_refund')
              AND status IN ('approved','refund_processing','refund_completed','resolved','succeeded')
              AND created_at >= ? AND created_at < ?
        `, [startDate, endDate]),
        query(`
            SELECT
                SUM(CASE WHEN role = 'customer' AND created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS newCustomers,
                SUM(CASE WHEN role = 'merchant' AND created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS newMerchants
            FROM users
        `, [startDate, endDate, startDate, endDate]),
        query(`
            SELECT
                COUNT(*) AS totalMerchants,
                SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS activeMerchants,
                SUM(CASE WHEN approval_status = 'pending_review' THEN 1 ELSE 0 END) AS pendingMerchantApprovals
            FROM salons
        `),
        query(`
            SELECT
                COUNT(*) AS supportTicketCount,
                SUM(CASE WHEN status NOT IN ('resolved','closed','refund_completed') THEN 1 ELSE 0 END) AS unresolvedSupportCases
            FROM support_requests
            WHERE created_at >= ? AND created_at < ?
        `, [startDate, endDate])
    ]);

    return {
        transactions: transactions[0] || {},
        bookings: bookings[0] || {},
        refunds: refunds[0] || {},
        users: users[0] || {},
        merchants: merchants[0] || {},
        support: support[0] || {}
    };
}

async function getAdminBreakdowns(startDate, endDate) {
    const [merchantPerformance, cancellationRates, refundRates, ratings, categories, paymentMethods, bookingStatus] = await Promise.all([
        query(`
            SELECT s.salon_id AS merchantId, s.salon_name AS merchantName, COUNT(DISTINCT t.transaction_id) AS transactions, COUNT(DISTINCT b.booking_id) AS bookings,
                   SUM(CASE WHEN t.payment_status IN ('paid','partially_refunded','refunded') THEN t.paid_amount ELSE 0 END) AS revenue
            FROM salons s
            LEFT JOIN bookings b ON b.merchant_id = s.salon_id AND b.booking_date >= ? AND b.booking_date < ?
            LEFT JOIN transactions t ON (t.merchant_id = s.merchant_id OR t.booking_id = b.booking_id) AND t.created_at >= ? AND t.created_at < ?
            GROUP BY s.salon_id, s.salon_name
        `, [startDate, endDate, startDate, endDate]),
        query(`
            SELECT s.salon_id AS merchantId, s.salon_name AS merchantName, COUNT(b.booking_id) AS bookings,
                   SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancellations
            FROM salons s
            LEFT JOIN bookings b ON b.merchant_id = s.salon_id AND b.booking_date >= ? AND b.booking_date < ?
            GROUP BY s.salon_id, s.salon_name
        `, [startDate, endDate]),
        query(`
            SELECT s.salon_id AS merchantId, s.salon_name AS merchantName, COUNT(sr.request_id) AS refundCount, SUM(sr.gross_refund_amount) AS grossRefundAmount
            FROM salons s
            LEFT JOIN support_requests sr ON sr.merchant_user_id = s.merchant_id
                AND sr.request_type IN ('order_refund','booking_refund')
                AND sr.created_at >= ? AND sr.created_at < ?
            GROUP BY s.salon_id, s.salon_name
        `, [startDate, endDate]),
        query(`
            SELECT s.salon_id AS merchantId, s.salon_name AS merchantName, AVG(r.rating) AS averageRating, COUNT(r.review_id) AS reviewCount
            FROM salons s
            LEFT JOIN reviews r ON r.merchant_id = s.salon_id AND r.created_at >= ? AND r.created_at < ?
            GROUP BY s.salon_id, s.salon_name
        `, [startDate, endDate]),
        query(`
            SELECT COALESCE(NULLIF(s.business_category, ''), 'Not set') AS category, COUNT(*) AS merchants
            FROM salons s
            GROUP BY category
        `),
        query(`
            SELECT COALESCE(NULLIF(payment_method, ''), 'Not set') AS method, COUNT(*) AS count, SUM(paid_amount) AS amount
            FROM transactions
            WHERE payment_status IN ('paid','partially_refunded','refunded') AND ${dateFilter('created_at')}
            GROUP BY method
        `, [startDate, endDate]),
        query(`
            SELECT status, COUNT(*) AS count
            FROM bookings
            WHERE booking_date >= ? AND booking_date < ?
            GROUP BY status
        `, [startDate, endDate])
    ]);

    const merchantRows = merchantPerformance.map((row) => ({
        merchantId: row.merchantId,
        merchantName: row.merchantName,
        revenue: roundMoney(row.revenue),
        bookings: safeNumber(row.bookings),
        transactions: safeNumber(row.transactions)
    }));

    return {
        topMerchantsByRevenue: topRows(merchantRows, 'merchantName', 'revenue'),
        topMerchantsByBookings: topRows(merchantRows, 'merchantName', 'bookings'),
        merchantsWithHighestCancellationRates: topRows(cancellationRates.map((row) => ({
            merchantId: row.merchantId,
            merchantName: row.merchantName,
            bookings: safeNumber(row.bookings),
            cancellationRate: safeNumber(row.bookings) ? roundPercent((safeNumber(row.cancellations) / safeNumber(row.bookings)) * 100) : 0
        })), 'merchantName', 'cancellationRate'),
        merchantsWithHighestRefundRates: topRows(refundRates.map((row) => ({
            merchantId: row.merchantId,
            merchantName: row.merchantName,
            refundCount: safeNumber(row.refundCount),
            grossRefundAmount: roundMoney(row.grossRefundAmount)
        })), 'merchantName', 'refundCount'),
        merchantsWithLowRatings: ratings
            .map((row) => ({
                merchantId: row.merchantId,
                merchantName: row.merchantName,
                averageRating: row.averageRating === null ? null : roundPercent(row.averageRating),
                reviewCount: safeNumber(row.reviewCount)
            }))
            .filter((row) => row.reviewCount > 0 && row.averageRating <= 3)
            .slice(0, 5),
        topServiceCategories: categories.map((row) => ({
            category: row.category,
            merchants: safeNumber(row.merchants)
        })).slice(0, 5),
        paymentMethodDistribution: paymentMethods.map((row) => ({
            method: row.method,
            count: safeNumber(row.count),
            amount: roundMoney(row.amount)
        })),
        bookingStatusDistribution: bookingStatus.map((row) => ({
            status: row.status,
            count: safeNumber(row.count)
        }))
    };
}

async function buildAdminAnalyticsSummaryForPeriod(period) {
    const [current, previous, breakdowns] = await Promise.all([
        getAdminSummaryRows(period.startDate, period.endDate),
        getAdminSummaryRows(period.previousStartDate, period.previousEndDate),
        getAdminBreakdowns(period.startDate, period.endDate)
    ]);

    const totalRevenue = roundMoney(current.transactions.revenue);
    const previousRevenue = roundMoney(previous.transactions.revenue);
    const totalBookings = safeNumber(current.bookings.totalBookings);
    const cancelledBookings = safeNumber(current.bookings.cancelledBookings);
    const refundCount = safeNumber(current.refunds.refundCount);
    const paidTransactions = safeNumber(current.transactions.paidTransactions);

    return {
        scope: 'admin',
        period,
        currency: 'SGD',
        statusFilters: {
            revenue: ['paid', 'partially_refunded', 'refunded'],
            refunds: ['approved', 'refund_processing', 'refund_completed', 'resolved', 'succeeded']
        },
        metricDefinitions: {
            totalPlatformRevenue: 'Paid transaction sales from paid, partially refunded and refunded transaction rows. This is platform sales volume, not admin earnings, and refund amounts are supplied separately.',
            grossRefundAmount: 'Approved or processing gross customer refund amount from support refund requests.',
            netRefundAmount: 'Approved or processing final amount returned to customers after deductions.',
            activeCustomers: 'Distinct customers with paid, partially refunded or refunded transaction activity in the period.'
        },
        metrics: {
            totalPlatformRevenue: totalRevenue,
            previousPeriodPlatformRevenue: previousRevenue,
            revenueChange: safePercentChange(totalRevenue, previousRevenue),
            totalBookings,
            previousPeriodBookings: safeNumber(previous.bookings.totalBookings),
            bookingChange: safePercentChange(totalBookings, safeNumber(previous.bookings.totalBookings)),
            completedBookings: safeNumber(current.bookings.completedBookings),
            cancelledBookings,
            cancellationRate: totalBookings ? roundPercent((cancelledBookings / totalBookings) * 100) : 0,
            totalRefunds: refundCount,
            grossRefundAmount: roundMoney(current.refunds.grossRefundAmount),
            netRefundAmount: roundMoney(current.refunds.netRefundAmount),
            refundRate: paidTransactions ? roundPercent((refundCount / paidTransactions) * 100) : 0,
            newCustomers: safeNumber(current.users.newCustomers),
            activeCustomers: safeNumber(current.transactions.activeCustomers),
            newMerchants: safeNumber(current.users.newMerchants),
            activeMerchants: safeNumber(current.merchants.activeMerchants),
            pendingMerchantApprovals: safeNumber(current.merchants.pendingMerchantApprovals),
            supportTicketCount: safeNumber(current.support.supportTicketCount),
            unresolvedSupportCases: safeNumber(current.support.unresolvedSupportCases)
        },
        ...breakdowns,
        insufficientData: !hasUsefulData({ metrics: { totalRevenue, totalBookings, refundCount, totalReviews: 0 } })
    };
}

async function buildAdminAnalyticsSummary(periodKey = 'last30') {
    return buildAdminAnalyticsSummaryForPeriod(resolveAnalyticsPeriod(periodKey));
}

function compareMetric(label, currentValue, previousValue, formatter = (value) => safeNumber(value)) {
    const current = formatter(currentValue);
    const previous = formatter(previousValue);
    return {
        label,
        current,
        previous,
        change: safePercentChange(current, previous),
        absoluteChange: roundMoney(safeNumber(current) - safeNumber(previous))
    };
}

function topName(rows = [], keys = []) {
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return 'Not available';
    for (const key of keys) {
        if (row[key]) return row[key];
    }
    return 'Not available';
}

function buildComparisonRows(scope, current = {}, previous = {}) {
    const currentMetrics = current.metrics || {};
    const previousMetrics = previous.metrics || {};
    const revenueKey = scope === 'admin' ? 'totalPlatformRevenue' : 'totalRevenue';
    const refundKey = scope === 'admin' ? 'totalRefunds' : 'refundCount';

    return [
        compareMetric(scope === 'admin' ? 'Paid transaction sales' : 'Total tracked sales', currentMetrics[revenueKey], previousMetrics[revenueKey], roundMoney),
        compareMetric('Bookings', currentMetrics.totalBookings, previousMetrics.totalBookings),
        compareMetric('Completed bookings/services', currentMetrics.completedBookings, previousMetrics.completedBookings),
        compareMetric('Refund cases', currentMetrics[refundKey], previousMetrics[refundKey]),
        compareMetric('Gross refunds', currentMetrics.grossRefundAmount, previousMetrics.grossRefundAmount, roundMoney),
        compareMetric('Net refunds', currentMetrics.netRefundAmount, previousMetrics.netRefundAmount, roundMoney),
        compareMetric('Product orders', currentMetrics.totalOrders, previousMetrics.totalOrders),
        compareMetric('Customer rating', currentMetrics.averageCustomerRating, previousMetrics.averageCustomerRating),
        compareMetric('Low-rated reviews', currentMetrics.lowRatedReviews, previousMetrics.lowRatedReviews),
        compareMetric('Inventory low-stock items', current.stockConcerns?.length || 0, previous.stockConcerns?.length || 0),
        compareMetric('New customers', currentMetrics.newCustomers, previousMetrics.newCustomers),
        compareMetric('New merchants', currentMetrics.newMerchants, previousMetrics.newMerchants),
        compareMetric('Active merchants', currentMetrics.activeMerchants, previousMetrics.activeMerchants),
        compareMetric('Promotion performance', currentMetrics.promotionPerformance || 0, previousMetrics.promotionPerformance || 0),
        compareMetric('Spin performance', currentMetrics.spinPerformance || 0, previousMetrics.spinPerformance || 0),
        compareMetric('Loyalty activity', currentMetrics.loyaltyActivity || 0, previousMetrics.loyaltyActivity || 0),
        compareMetric('Cashback activity', currentMetrics.cashbackActivity || 0, previousMetrics.cashbackActivity || 0)
    ].filter((row) => row.current !== undefined && row.previous !== undefined);
}

function buildComparisonInsightRows(rows = []) {
    const meaningful = rows.filter((row) => row.change.value !== null && Math.abs(Number(row.change.value || 0)) >= 0.1);
    const improvements = meaningful
        .filter((row) => Number(row.change.value) > 0)
        .sort((left, right) => Number(right.change.value) - Number(left.change.value))
        .slice(0, 5);
    const declines = meaningful
        .filter((row) => Number(row.change.value) < 0)
        .sort((left, right) => Number(left.change.value) - Number(right.change.value))
        .slice(0, 5);

    return {
        improvements,
        declines,
        confidence: rows.some((row) => safeNumber(row.current) || safeNumber(row.previous)) ? 'Medium' : 'Low'
    };
}

function buildComparisonFallbackAnswer(comparison = {}) {
    const rows = comparison.metrics || [];
    const insights = buildComparisonInsightRows(rows);
    const revenue = rows.find((row) => row.label === 'Revenue' || row.label === 'Paid transaction sales' || row.label === 'Total tracked sales');
    const bookings = rows.find((row) => row.label === 'Bookings');
    const summaryParts = [
        `Comparison report: ${comparison.label}.`,
        revenue ? `${revenue.label} moved from S$${roundMoney(revenue.previous).toFixed(2)} to S$${roundMoney(revenue.current).toFixed(2)} (${revenue.change.label}).` : '',
        bookings ? `Bookings moved from ${safeNumber(bookings.previous)} to ${safeNumber(bookings.current)} (${bookings.change.label}).` : ''
    ].filter(Boolean);

    return {
        fallback: true,
        answer: [
            `Summary: ${summaryParts.join(' ')}`,
            `Key Improvements: ${insights.improvements.length ? insights.improvements.map((row) => `${row.label} ${row.change.label}`).join('; ') : 'No clear improvement was detected from the available metrics.'}`,
            `Key Declines: ${insights.declines.length ? insights.declines.map((row) => `${row.label} ${row.change.label}`).join('; ') : 'No clear decline was detected from the available metrics.'}`,
            'Reasons: Use the detailed dashboard charts and source records to confirm operational causes; this comparison only uses existing analytics totals.',
            'Recommendations: Review the largest movement first, then check bookings, refunds, services/products, inventory and campaign activity before making changes.',
            `Confidence: ${insights.confidence}`
        ].join('\n'),
        supportingEvidence: rows.slice(0, 8).map((row) => `${row.label}: ${row.previous} -> ${row.current} (${row.change.label})`),
        suggestedNextSteps: [
            'Export this comparison report from the AI response actions if needed.',
            'Review unchanged dashboard charts for the detailed source context.',
            'Generate a proposal only after confirming the comparison with current business data.'
        ],
        recommendedAdminActions: [
            'Review unchanged dashboard charts for the detailed source context.',
            'Prioritise the largest platform movement before taking admin action.'
        ],
        limitations: [
            'Spin, loyalty, cashback and promotion performance are included only where the current analytics summary exposes reliable metrics.',
            'Charts are unchanged; this is an AI comparison report using existing analytics.'
        ]
    };
}

async function buildMerchantComparisonSummary(userId, comparison) {
    const merchant = await getMerchantProfile(userId);

    if (!merchant) {
        const error = new Error('Merchant profile could not be confirmed.');
        error.status = 403;
        error.code = 'MERCHANT_NOT_FOUND';
        throw error;
    }

    const [current, previous] = await Promise.all([
        buildMerchantAnalyticsSummaryForPeriod(userId, merchant, comparison.left),
        buildMerchantAnalyticsSummaryForPeriod(userId, merchant, comparison.right)
    ]);

    const metrics = buildComparisonRows('merchant', current, previous);
    const insights = buildComparisonInsightRows(metrics);

    return {
        scope: 'merchant',
        label: comparison.label,
        type: comparison.type,
        currency: 'SGD',
        periods: {
            current: current.period,
            previous: previous.period
        },
        metrics,
        keyImprovements: insights.improvements,
        keyDeclines: insights.declines,
        reasons: [
            `Top service changed from ${topName(previous.topServicesByRevenue, ['serviceName'])} to ${topName(current.topServicesByRevenue, ['serviceName'])}.`,
            `Top product changed from ${topName(previous.topProductsByRevenue, ['productName'])} to ${topName(current.topProductsByRevenue, ['productName'])}.`,
            'Refunds, ratings, inventory and campaign metrics are included where the current analytics summary exposes reliable data.'
        ],
        recommendations: [
            'Review the biggest improvement and decline before changing promotions or stock.',
            'Use existing proposal actions only after confirming the comparison in the dashboard.',
            'Export the AI response if this comparison is needed for a demo or report.'
        ],
        confidence: insights.confidence,
        current,
        previous
    };
}

async function buildAdminComparisonSummary(comparison) {
    const [current, previous] = await Promise.all([
        buildAdminAnalyticsSummaryForPeriod(comparison.left),
        buildAdminAnalyticsSummaryForPeriod(comparison.right)
    ]);

    const metrics = buildComparisonRows('admin', current, previous);
    const insights = buildComparisonInsightRows(metrics);

    return {
        scope: 'admin',
        label: comparison.label,
        type: comparison.type,
        currency: 'SGD',
        periods: {
            current: current.period,
            previous: previous.period
        },
        metrics,
        keyImprovements: insights.improvements,
        keyDeclines: insights.declines,
        reasons: [
            `Top merchant changed from ${topName(previous.topMerchantsByRevenue, ['merchantName'])} to ${topName(current.topMerchantsByRevenue, ['merchantName'])}.`,
            'Bookings, refunds, active merchants, ratings and payment mix are compared from existing platform analytics.',
            'Spin, loyalty, cashback and promotion performance are included only when available in the analytics payload.'
        ],
        recommendations: [
            'Review the largest platform movement before approving operational changes.',
            'Use existing admin reports and proposal confirmation for any follow-up action.',
            'Export the AI response if this comparison is needed for a demo or report.'
        ],
        confidence: insights.confidence,
        current,
        previous
    };
}

module.exports = {
    SUPPORTED_PERIODS,
    buildAdminAnalyticsSummary,
    buildAdminComparisonSummary,
    buildAnalyticsDataAnswer,
    buildAdminFallbackInsights,
    buildMerchantAnalyticsSummary,
    buildMerchantComparisonSummary,
    buildMerchantFallbackInsights,
    buildComparisonFallbackAnswer,
    parseAnalyticsComparisonQuestion,
    resolveAnalyticsPeriod,
    roundMoney,
    roundPercent,
    safePercentChange,
    normalizeAnalyticsQuestionIntent,
    sanitizeAnalyticsQuestion
};
