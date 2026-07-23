(() => {
    const userRole = document.body?.dataset?.userRole || '';
    const role = userRole === 'admin' ? 'admin' : userRole === 'merchant' ? 'merchant' : '';
    if (!role) return;

    const path = window.location.pathname;
    const isMerchantExecutiveReportPage = role === 'merchant' && path === '/merchant/ai-executive-summary';
    const isAdminExecutiveReportPage = role === 'admin' && path === '/admin/ai-executive-summary';
    const isExecutiveReportPage = isMerchantExecutiveReportPage || isAdminExecutiveReportPage;
    const isMerchantPage = isMerchantExecutiveReportPage;
    const isAdminPage = isAdminExecutiveReportPage;
    if (!isMerchantPage && !isAdminPage) return;

    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const period = 'last30';
    const endpoint = role === 'admin' ? '/api/ai/admin/platform-insights' : '/api/ai/merchant/business-insights';
    const cacheKey = `vaniday:${role}:executive-dashboard:${path}:${period}`;
    const askEndpoint = role === 'admin' ? '/api/ai/admin/ask-analytics' : '/api/ai/merchant/ask-analytics';
    const proposalEndpoint = role === 'admin' ? '/api/ai/admin/action-proposal' : '/api/ai/merchant/action-proposal';
    const AIUI = window.VanidayAIUI || {};

    const fetchAiJson = async (url, body) => {
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({
            success: false,
            message: response.ok
                ? 'AI returned an unreadable response.'
                : `AI request failed with HTTP ${response.status}.`
        }));
        if (!response.ok && !payload.message) {
            payload.message = `AI request failed with HTTP ${response.status}.`;
        }
        return { response, payload };
    };

    const money = (value) => `S$${Number(value || 0).toFixed(2)}`;
    const number = (value) => Number(value || 0).toLocaleString('en-SG');
    const percent = (value) => value === null || value === undefined ? 'Not available' : `${Number(value || 0).toFixed(1)}%`;
    const valueOrMissing = (value, formatter = (item) => item) => value === null || value === undefined || value === '' ? 'Not available' : formatter(value);
    const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(Number(value || 0))));

    const scoreFromGrowth = (change) => {
        const value = change?.value;
        if (value === null || value === undefined) return { score: 70, reason: 'No previous-period comparison is available yet.' };
        if (value >= 20) return { score: 96, reason: `Revenue improved by ${value}%.` };
        if (value >= 5) return { score: 86, reason: `Revenue grew by ${value}%.` };
        if (value >= 0) return { score: 76, reason: `Revenue was stable at ${value}%.` };
        if (value >= -10) return { score: 62, reason: `Revenue softened by ${Math.abs(value)}%.` };
        return { score: 42, reason: `Revenue declined by ${Math.abs(value)}%.` };
    };

    const scoreFromBookings = (metrics = {}) => {
        const change = metrics.bookingChange?.value;
        const total = Number(metrics.totalBookings || 0);
        if (!total) return { score: 58, reason: 'No bookings were recorded in the selected period.' };
        if (change === null || change === undefined) return { score: total > 0 ? 74 : 58, reason: `${total} bookings were recorded; comparison data is limited.` };
        return { score: clamp(72 + Number(change)), reason: `Bookings changed by ${change}% against the comparison period.` };
    };

    const scoreFromRating = (metrics = {}) => {
        const rating = metrics.averageCustomerRating;
        if (rating === null || rating === undefined) return { score: 70, reason: 'No review rating is available in the selected period.' };
        return { score: clamp((Number(rating) / 5) * 100), reason: `Average rating is ${Number(rating).toFixed(1)} out of 5.` };
    };

    const scoreFromRefunds = (metrics = {}) => {
        const orders = Number(metrics.totalOrders || metrics.totalBookings || metrics.paidTransactions || 0);
        const refunds = Number(metrics.refundCount || metrics.totalRefunds || 0);
        if (!orders && !refunds) return { score: 78, reason: 'No refund pressure is visible in the selected period.' };
        const rate = orders ? (refunds / orders) * 100 : refunds * 10;
        return { score: clamp(100 - (rate * 8)), reason: `${refunds} refund case${refunds === 1 ? '' : 's'} against ${orders || 'limited'} activity records.` };
    };

    const weightedScore = (categories) => {
        const totalWeight = categories.reduce((sum, item) => sum + item.weight, 0) || 1;
        return clamp(categories.reduce((sum, item) => sum + (item.score * item.weight), 0) / totalWeight);
    };

    const statusForScore = (score) => {
        if (score >= 90) return { label: 'Excellent', risk: 'Low risk' };
        if (score >= 75) return { label: 'Healthy', risk: 'Moderate risk' };
        if (score >= 60) return { label: 'Watch list', risk: 'Elevated risk' };
        return { label: 'Needs attention', risk: 'High risk' };
    };

    const changeText = (change, noun) => {
        if (!change || change.value === null || change.value === undefined) return `${noun} has no previous-period comparison yet.`;
        if (Math.abs(Number(change.value)) >= 20) return `${noun} ${change.value > 0 ? 'increased significantly' : 'dropped sharply'} by ${Math.abs(Number(change.value))}%.`;
        if (Number(change.value) > 0) return `${noun} increased by ${Number(change.value)}%.`;
        if (Number(change.value) < 0) return `${noun} decreased by ${Math.abs(Number(change.value))}%.`;
        return `${noun} is stable versus the comparison period.`;
    };

    const confidenceFor = (...values) => {
        const useful = values.filter((value) => {
            if (value === null || value === undefined) return false;
            if (Array.isArray(value)) return value.length > 0;
            return Number(value || 0) > 0 || typeof value === 'string';
        }).length;
        if (useful >= 3) return 'High';
        if (useful >= 1) return 'Medium';
        return 'Low';
    };

    const findTopName = (rows = [], nameKeys = [], valueKeys = []) => {
        const row = [...rows].sort((left, right) => {
            const leftValue = valueKeys.reduce((max, key) => Math.max(max, Number(left?.[key] || 0)), 0);
            const rightValue = valueKeys.reduce((max, key) => Math.max(max, Number(right?.[key] || 0)), 0);
            return rightValue - leftValue;
        })[0];
        if (!row) return '';
        return nameKeys.map((key) => row[key]).find(Boolean) || '';
    };

    const buildChangeList = (items = []) => items.filter(Boolean).slice(0, 3);

    const merchantInsightFor = (label, summary = {}, payload = {}) => {
        const metrics = summary.metrics || {};
        const lower = String(label || '').toLowerCase();
        const topService = findTopName(summary.topServicesByRevenue || summary.topServicesByBookingCount || [], ['serviceName'], ['revenue', 'bookings']);
        const topProduct = findTopName(summary.topProductsByRevenue || [], ['productName'], ['revenue', 'unitsSold']);
        const stock = (summary.stockConcerns || [])[0];
        const rating = metrics.averageCustomerRating;
        const refunds = Number(metrics.refundCount || 0);
        const revenueChange = changeText(metrics.revenueChange, 'Revenue');
        const bookingChange = changeText(metrics.bookingChange, 'Bookings');
        const base = {
            title: label || 'Analytics',
            confidence: confidenceFor(metrics.totalRevenue, metrics.totalBookings, metrics.totalOrders),
            summary: 'This widget is interpreted from the current analytics summary.',
            changes: [],
            positives: [],
            warnings: [],
            recommendations: []
        };

        if (lower.includes('revenue') || lower.includes('sales')) {
            return {
                ...base,
                summary: `${revenueChange} Total tracked sales are ${money(metrics.totalRevenue)}.`,
                changes: buildChangeList([Math.abs(Number(metrics.revenueChange?.value || 0)) >= 20 ? revenueChange : '', topService ? `${topService} is the strongest service revenue signal.` : '']),
                positives: buildChangeList([Number(metrics.revenueChange?.value || 0) > 0 ? 'Revenue momentum is positive.' : '', topProduct ? `${topProduct} contributes product revenue.` : '']),
                warnings: buildChangeList([Number(metrics.revenueChange?.value || 0) < -10 ? 'Revenue is below the comparison period.' : '']),
                recommendations: buildChangeList([topService ? `Promote ${topService} while demand is visible.` : '', 'Review weaker weekdays before launching discounts.'])
            };
        }

        if (lower.includes('booking') || lower.includes('completed services')) {
            return {
                ...base,
                confidence: confidenceFor(metrics.totalBookings, metrics.completedBookings, metrics.bookingChange?.value),
                summary: `${bookingChange} ${number(metrics.completedBookings)} completed service booking${Number(metrics.completedBookings) === 1 ? '' : 's'} are recorded.`,
                changes: buildChangeList([Math.abs(Number(metrics.bookingChange?.value || 0)) >= 20 ? bookingChange : '']),
                positives: buildChangeList([topService ? `${topService} is a strong booking signal.` : '']),
                warnings: buildChangeList([Number(metrics.cancelledBookings || 0) > 0 ? `${number(metrics.cancelledBookings)} cancelled booking${Number(metrics.cancelledBookings) === 1 ? '' : 's'} need context.` : '']),
                recommendations: buildChangeList(['Protect high-demand appointment slots.', 'Use quiet-day promotions only where booking demand is weak.'])
            };
        }

        if (lower.includes('product') || lower.includes('inventory')) {
            return {
                ...base,
                confidence: confidenceFor(metrics.totalOrders, summary.topProductsByRevenue, summary.stockConcerns),
                summary: `${number(metrics.totalOrders)} completed product order${Number(metrics.totalOrders) === 1 ? '' : 's'} are visible in analytics.`,
                changes: buildChangeList([topProduct ? `${topProduct} is the top product signal.` : '']),
                positives: buildChangeList([topProduct ? `${topProduct} has current sales traction.` : '']),
                warnings: buildChangeList([stock ? `${stock.productName} has low inventory (${stock.stockQuantity}).` : '']),
                recommendations: buildChangeList([stock ? `Restock ${stock.productName}.` : '', topProduct ? `Promote ${topProduct} if stock is healthy.` : ''])
            };
        }

        if (lower.includes('refund')) {
            return {
                ...base,
                confidence: confidenceFor(refunds, metrics.grossRefundAmount, metrics.netRefundAmount),
                summary: `${number(refunds)} refund case${refunds === 1 ? '' : 's'} are included in the current analytics.`,
                changes: buildChangeList([refunds > 0 ? `Gross refund amount is ${money(metrics.grossRefundAmount)}.` : 'Refund activity is low or absent.']),
                positives: buildChangeList([refunds === 0 ? 'No refund pressure is visible.' : 'Refund values are separated from paid revenue.']),
                warnings: buildChangeList([refunds > 2 ? 'Refund volume may need review.' : '']),
                recommendations: buildChangeList([refunds > 0 ? 'Review refund causes and customer-visible reasons.' : 'Keep monitoring refund requests.'])
            };
        }

        if (lower.includes('rating') || lower.includes('review')) {
            return {
                ...base,
                confidence: confidenceFor(metrics.totalReviews, rating, metrics.lowRatedReviews),
                summary: rating === null || rating === undefined ? 'No rating trend is available in this period.' : `Average customer rating is ${Number(rating).toFixed(1)} / 5.`,
                positives: buildChangeList([Number(rating || 0) >= 4.5 ? 'Customer satisfaction remains strong.' : '']),
                warnings: buildChangeList([Number(metrics.lowRatedReviews || 0) > 0 ? `${number(metrics.lowRatedReviews)} low-rated review${Number(metrics.lowRatedReviews) === 1 ? '' : 's'} need follow-up.` : '']),
                recommendations: buildChangeList([Number(metrics.lowRatedReviews || 0) > 0 ? 'Follow up on poor reviews with a professional response.' : 'Maintain response quality.'])
            };
        }

        if (lower.includes('payment')) {
            const method = summary.paymentMethodDistribution?.[0];
            return {
                ...base,
                confidence: confidenceFor(summary.paymentMethodDistribution),
                summary: method ? `${method.method} is the leading stored payment method by value.` : 'Payment-method data is not available yet.',
                positives: buildChangeList([method ? `${money(method.amount)} is linked to ${method.method}.` : '']),
                recommendations: ['Monitor payment method mix for checkout friction.']
            };
        }

        if (lower.includes('loyalty') || lower.includes('cashback') || lower.includes('spin') || lower.includes('promotion')) {
            return {
                ...base,
                confidence: 'Low',
                summary: `${label} is not fully represented in the current analytics summary payload.`,
                warnings: ['Detailed trend detection is limited for this widget until source metrics are available.'],
                recommendations: ['Use the dedicated rewards, cashback, Spin or promotions page before changing campaigns.']
            };
        }

        return base;
    };

    const adminInsightFor = (label, summary = {}) => {
        const metrics = summary.metrics || {};
        const lower = String(label || '').toLowerCase();
        const topMerchant = summary.topMerchantsByRevenue?.[0];
        const lowMerchant = summary.merchantsWithLowRatings?.[0];
        const category = summary.topServiceCategories?.[0];
        const base = {
            title: label || 'Platform analytics',
            confidence: confidenceFor(metrics.totalPlatformRevenue, metrics.totalBookings, metrics.activeMerchants),
            summary: 'This widget is interpreted from the current platform analytics summary.',
            changes: [],
            positives: [],
            warnings: [],
            recommendations: []
        };

        if (lower.includes('revenue')) {
            return {
                ...base,
                summary: `${changeText(metrics.revenueChange, 'Paid transaction sales')} Current paid transaction sales are ${money(metrics.totalPlatformRevenue)}.`,
                positives: buildChangeList([topMerchant ? `${topMerchant.merchantName} has the strongest paid-sales signal.` : '']),
                warnings: buildChangeList([Number(metrics.revenueChange?.value || 0) < -10 ? 'Paid transaction sales are below the comparison period.' : '']),
                recommendations: buildChangeList([topMerchant ? `Review whether ${topMerchant.merchantName} should be featured.` : ''])
            };
        }

        if (lower.includes('booking')) {
            return {
                ...base,
                summary: `${changeText(metrics.bookingChange, 'Platform bookings')} Total bookings: ${number(metrics.totalBookings)}.`,
                warnings: buildChangeList([Number(metrics.cancelledBookings || 0) > 0 ? `${number(metrics.cancelledBookings)} cancellations are visible.` : '']),
                recommendations: ['Review booking status mix and merchant fulfilment quality.']
            };
        }

        if (lower.includes('merchant')) {
            return {
                ...base,
                summary: `${number(metrics.activeMerchants)} active merchant${Number(metrics.activeMerchants) === 1 ? '' : 's'} appear in platform analytics.`,
                positives: buildChangeList([topMerchant ? `${topMerchant.merchantName} leads paid transaction sales.` : '']),
                warnings: buildChangeList([lowMerchant ? `${lowMerchant.merchantName} has a low rating signal.` : '', Number(metrics.pendingMerchantApprovals || 0) ? `${number(metrics.pendingMerchantApprovals)} merchant approvals pending.` : '']),
                recommendations: ['Prioritise merchant reviews using paid sales, refunds and rating signals.']
            };
        }

        if (lower.includes('refund')) {
            return {
                ...base,
                summary: `${number(metrics.totalRefunds)} platform refund case${Number(metrics.totalRefunds) === 1 ? '' : 's'} are included.`,
                warnings: buildChangeList([Number(metrics.refundRate || 0) > 10 ? `Refund rate is ${percent(metrics.refundRate)}.` : '']),
                recommendations: ['Review merchants with highest refund rates before taking action.']
            };
        }

        if (lower.includes('rating')) {
            return {
                ...base,
                confidence: confidenceFor(summary.merchantsWithLowRatings),
                summary: lowMerchant ? `${lowMerchant.merchantName} is the lowest-rated merchant signal.` : 'No low-rating platform signal is available.',
                warnings: buildChangeList([lowMerchant ? `${lowMerchant.averageRating} / 5 average rating from ${lowMerchant.reviewCount} review records.` : '']),
                recommendations: ['Use reviews and support context before contacting merchants.']
            };
        }

        if (lower.includes('loyalty') || lower.includes('spin')) {
            return {
                ...base,
                confidence: 'Low',
                summary: `${label} is not fully represented in the current platform analytics summary payload.`,
                warnings: ['Detailed trend detection is limited for this widget until source metrics are available.'],
                recommendations: ['Use Reward Management or Spin Management before changing platform campaigns.']
            };
        }

        return {
            ...base,
            summary: category ? `${category.category} is the strongest service category coverage signal.` : base.summary
        };
    };

    const buildMerchantHealth = (summary = {}) => {
        const metrics = summary.metrics || {};
        const stockConcerns = summary.stockConcerns || [];
        const topService = summary.topServicesByRevenue?.[0] || summary.topServicesByBookingCount?.[0];
        const topProduct = summary.topProductsByRevenue?.[0];
        const revenue = scoreFromGrowth(metrics.revenueChange);
        const bookings = scoreFromBookings(metrics);
        const satisfaction = scoreFromRating(metrics);
        const refunds = scoreFromRefunds(metrics);
        const inventory = { score: stockConcerns.length ? clamp(88 - (stockConcerns.length * 14)) : 88, reason: stockConcerns.length ? `${stockConcerns.length} low-stock product${stockConcerns.length === 1 ? '' : 's'} need review.` : 'No low-stock concerns were returned by analytics.' };
        const marketing = { score: topService || topProduct ? 76 : 68, reason: topService || topProduct ? 'Demand signals exist for promotion planning.' : 'Promotion performance is not available in the current analytics summary.' };
        const spin = { score: 70, reason: 'Spin campaign totals are not available in the current analytics summary.' };
        const loyalty = { score: 70, reason: 'Loyalty and cashback totals are not available in the current analytics summary.' };
        const categories = [
            { name: 'Revenue Growth', weight: 18, suggestions: ['Review pricing and demand drivers.'], ...revenue },
            { name: 'Booking Performance', weight: 16, suggestions: ['Protect peak slots and improve quiet days.'], ...bookings },
            { name: 'Customer Satisfaction', weight: 16, suggestions: ['Follow up on low-rated reviews.'], ...satisfaction },
            { name: 'Refund Rate', weight: 14, suggestions: ['Review pending refund causes.'], ...refunds },
            { name: 'Inventory Health', weight: 12, suggestions: ['Restock products before campaign pushes.'], ...inventory },
            { name: 'Marketing Performance', weight: 10, suggestions: ['Use top service and product signals for campaigns.'], ...marketing },
            { name: 'Spin Campaign Performance', weight: 7, suggestions: ['Review Spin & Discover page for wheel-specific performance.'], ...spin },
            { name: 'Loyalty Engagement', weight: 7, suggestions: ['Review wallet, cashback and voucher activity.'], ...loyalty }
        ];
        const score = weightedScore(categories);
        return { score, ...statusForScore(score), categories };
    };

    const buildAdminHealth = (summary = {}) => {
        const metrics = summary.metrics || {};
        const revenue = scoreFromGrowth(metrics.revenueChange);
        const bookings = scoreFromBookings(metrics);
        const refunds = scoreFromRefunds({ totalOrders: metrics.totalBookings, totalRefunds: metrics.totalRefunds });
        const merchants = { score: metrics.pendingMerchantApprovals ? clamp(90 - (Number(metrics.pendingMerchantApprovals) * 6)) : 88, reason: `${number(metrics.pendingMerchantApprovals)} merchant approval${Number(metrics.pendingMerchantApprovals) === 1 ? '' : 's'} pending.` };
        const support = { score: metrics.unresolvedSupportCases ? clamp(88 - (Number(metrics.unresolvedSupportCases) * 5)) : 88, reason: `${number(metrics.unresolvedSupportCases)} unresolved support case${Number(metrics.unresolvedSupportCases) === 1 ? '' : 's'}.` };
        const marketing = { score: summary.topServiceCategories?.length ? 78 : 68, reason: summary.topServiceCategories?.[0]?.category ? `${summary.topServiceCategories[0].category} is the leading service category signal.` : 'Category performance is limited.' };
        const spin = { score: 70, reason: 'Platform Spin performance is not available in the current analytics summary.' };
        const loyalty = { score: 70, reason: 'Platform reward engagement is not available in the current analytics summary.' };
        const categories = [
            { name: 'Platform Growth', weight: 20, suggestions: ['Track growth against the previous period.'], ...revenue },
            { name: 'Booking Performance', weight: 16, suggestions: ['Review booking status distribution.'], ...bookings },
            { name: 'Refund Rate', weight: 14, suggestions: ['Review high-refund merchants.'], ...refunds },
            { name: 'Merchant Health', weight: 14, suggestions: ['Clear pending approvals and incomplete profiles.'], ...merchants },
            { name: 'Support Load', weight: 12, suggestions: ['Prioritise unresolved cases.'], ...support },
            { name: 'Marketing Performance', weight: 10, suggestions: ['Use category demand for campaign planning.'], ...marketing },
            { name: 'Spin Campaign Performance', weight: 7, suggestions: ['Review promotion and Spin Management pages.'], ...spin },
            { name: 'Reward Engagement', weight: 7, suggestions: ['Review Reward Management and cashback activity.'], ...loyalty }
        ];
        const score = weightedScore(categories);
        return { score, ...statusForScore(score), categories };
    };

    const merchantFields = (summary = {}) => {
        const metrics = summary.metrics || {};
        const topService = summary.topServicesByRevenue?.[0] || summary.topServicesByBookingCount?.[0];
        const topProduct = summary.topProductsByRevenue?.[0];
        return [
            ['Total tracked sales', money(metrics.totalRevenue)],
            ['Service bookings', number(metrics.totalBookings)],
            ['Completed Services', number(metrics.completedBookings)],
            ['Completed Product Orders', number(metrics.totalOrders)],
            ['Refund Count', number(metrics.refundCount)],
            ['Average Rating', valueOrMissing(metrics.averageCustomerRating, (rating) => `${Number(rating).toFixed(1)} / 5`)],
            ['Repeat Customers', valueOrMissing(metrics.repeatCustomers, number)],
            ['Loyalty Points Issued', 'Not available in current analytics'],
            ['Cashback Issued', 'Not available in current analytics'],
            ['Spin Campaign Performance', 'Open Spin page for wheel-level analytics'],
            ['Top Service', topService?.serviceName || 'Not available'],
            ['Top Product', topProduct?.productName || 'Not available'],
            ['Inventory Alerts', number((summary.stockConcerns || []).length)],
            ['Pending Refunds', number(metrics.refundCount)],
            ['Low Rated Reviews', number(metrics.lowRatedReviews)],
            ['Promotion Performance', topService || topProduct ? 'Demand signals available' : 'Not available']
        ];
    };

    const adminFields = (summary = {}) => {
        const metrics = summary.metrics || {};
        return [
            ['Paid transaction sales', money(metrics.totalPlatformRevenue)],
            ['Sales trend', metrics.revenueChange?.label || 'Not available'],
            ['New merchant accounts', number(metrics.newMerchants)],
            ['Platform bookings', number(metrics.totalBookings)],
            ['Refunds', number(metrics.totalRefunds)],
            ['Top merchant by paid sales', summary.topMerchantsByRevenue?.[0]?.merchantName || 'Not available'],
            ['Lowest Rated Merchant', summary.merchantsWithLowRatings?.[0]?.merchantName || 'Not available'],
            ['Pending Merchant Approvals', number(metrics.pendingMerchantApprovals)],
            ['Most Popular Service Category', summary.topServiceCategories?.[0]?.category || 'Not available'],
            ['Most Popular Product Category', 'Not available in current analytics'],
            ['Spin Performance Across Platform', 'Not available in current analytics'],
            ['Platform Risk Level', statusForScore(buildAdminHealth(summary).score).risk]
        ];
    };

    const recommendationsFrom = (payload = {}, summary = {}, health = {}) => {
        const insights = payload.insights || payload.fallback || {};
        const rows = role === 'admin'
            ? [
                ...(insights.adminPriorities || []).map((item) => item.priority || item.reason),
                ...(insights.operationalRisks || []).map((item) => item.recommendedAction || item.risk),
                ...(insights.merchantAttention || []).map((item) => item.recommendedAction || item.issue)
            ]
            : [
                ...(insights.recommendedActions || []).map((item) => item.action || item.reason),
                ...(insights.risks || []).map((item) => item.suggestedResponse || item.issue)
            ];
        const stock = summary.stockConcerns?.[0];
        if (stock) rows.push(`Restock ${stock.productName}`);
        const pendingRefunds = role === 'merchant' ? summary.metrics?.refundCount : summary.metrics?.totalRefunds;
        if (Number(pendingRefunds || 0) > 0) rows.push(`Review ${number(pendingRefunds)} refund request${Number(pendingRefunds) === 1 ? '' : 's'}`);
        if (health.score < 75) rows.push('Review the lowest scoring health categories first');
        return [...new Set(rows.filter(Boolean))].slice(0, 5);
    };

    const conciseMerchantOverview = (summary = {}) => {
        const metrics = summary.metrics || {};
        const parts = [];
        const revenue = Number(metrics.totalRevenue || 0);
        const bookings = Number(metrics.totalBookings || 0);
        const orders = Number(metrics.totalOrders || 0);
        const refunds = Number(metrics.refundCount || 0);
        const topService = summary.topServicesByRevenue?.[0] || summary.topServicesByBookingCount?.[0];
        const topProduct = summary.topProductsByRevenue?.[0];
        const stock = summary.stockConcerns?.[0];

        if (revenue > 0 || bookings > 0 || orders > 0) {
            parts.push(`${summary.period?.label || 'Selected period'}: total tracked sales are ${money(revenue)} from ${number(bookings)} service booking${bookings === 1 ? '' : 's'} and ${number(orders)} product order${orders === 1 ? '' : 's'}.`);
        } else {
            parts.push(`${summary.period?.label || 'Selected period'}: not enough completed sales or booking activity for a detailed summary yet.`);
        }

        if (topService?.serviceName) {
            parts.push(`${topService.serviceName} is the clearest service demand signal.`);
        }
        if (topProduct?.productName) {
            parts.push(`${topProduct.productName} is the clearest product demand signal.`);
        }
        if (refunds > 0) {
            parts.push(`${number(refunds)} refund case${refunds === 1 ? '' : 's'} should be reviewed separately from sales.`);
        }
        if (stock?.productName) {
            parts.push(`${stock.productName} needs stock attention before heavier promotion.`);
        }

        return parts.join(' ');
    };

    const conciseAdminOverview = (summary = {}) => {
        const metrics = summary.metrics || {};
        const parts = [];
        const revenue = Number(metrics.totalPlatformRevenue || 0);
        const bookings = Number(metrics.totalBookings || 0);
        const refunds = Number(metrics.totalRefunds || 0);
        const activeMerchants = Number(metrics.activeMerchants || metrics.totalMerchants || 0);
        const pendingApprovals = Number(metrics.pendingMerchantApprovals || 0);
        const topMerchant = summary.topMerchantsByRevenue?.[0];
        const lowRatedMerchant = summary.merchantsWithLowRatings?.[0];

        if (revenue > 0 || bookings > 0 || activeMerchants > 0) {
            parts.push(`${summary.period?.label || 'Selected period'}: paid transaction sales are ${money(revenue)} across ${number(bookings)} platform booking${bookings === 1 ? '' : 's'} and ${number(activeMerchants)} active merchant${activeMerchants === 1 ? '' : 's'}.`);
        } else {
            parts.push(`${summary.period?.label || 'Selected period'}: not enough platform activity for a detailed summary yet.`);
        }

        if (topMerchant?.merchantName) {
            parts.push(`${topMerchant.merchantName} is the clearest merchant paid-sales signal.`);
        }
        if (pendingApprovals > 0) {
            parts.push(`${number(pendingApprovals)} merchant approval case${pendingApprovals === 1 ? '' : 's'} need admin review.`);
        }
        if (refunds > 0) {
            parts.push(`${number(refunds)} refund case${refunds === 1 ? '' : 's'} should be reviewed separately from paid sales.`);
        }
        if (lowRatedMerchant?.merchantName) {
            parts.push(`${lowRatedMerchant.merchantName} needs rating attention.`);
        }

        return parts.join(' ');
    };

    const executiveOverview = (summary = {}, insights = {}) => {
        if (role === 'merchant') return conciseMerchantOverview(summary);
        if (role === 'admin') return conciseAdminOverview(summary);
        return insights.executiveSummary || insights.summary || 'Generated from the current analytics summary.';
    };

    const createEl = (tag, className = '', text = '') => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    const insightForLabel = (label, summary, payload) => role === 'admin'
        ? adminInsightFor(label, summary, payload)
        : merchantInsightFor(label, summary, payload);

    const explanationWhyFor = (insight = {}) => {
        const text = [
            insight.summary,
            ...(insight.changes || []),
            ...(insight.positives || []),
            ...(insight.warnings || [])
        ].filter(Boolean).join(' ').toLowerCase();
        if (/refund/.test(text)) return 'Refund movement is linked to the current refund count, approved values and status mix in analytics.';
        if (/booking|appointment|service/.test(text)) return 'The signal is mainly driven by booking volume, completion status, cancellations and top service demand.';
        if (/inventory|stock|product/.test(text)) return 'The signal is driven by product sales and current low-stock records returned by analytics.';
        if (/rating|review/.test(text)) return 'The signal is based on customer review volume, average rating and low-rating records.';
        if (/payment/.test(text)) return 'The signal comes from stored successful transaction payment-method distribution.';
        if (/revenue|sales/.test(text)) return 'The signal is linked to paid revenue, booking or order volume, and refunds shown separately.';
        return 'The explanation is based on the related metrics returned by the current analytics summary.';
    };

    const explanationImpactFor = (insight = {}) => {
        const warningCount = (insight.warnings || []).filter(Boolean).length;
        const positiveCount = (insight.positives || []).filter(Boolean).length;
        if (warningCount > positiveCount) return 'This may affect revenue quality, workload, customer satisfaction or operational planning if left unchecked.';
        if (positiveCount) return 'This is a positive signal that can guide staffing, promotion and inventory decisions.';
        return 'Impact is limited until more period data is available, so treat this as a monitoring signal.';
    };

    const relatedMetricsFor = (label = '') => {
        const lower = String(label || '').toLowerCase();
        const merchantRelated = {
            revenue: ['Bookings', 'Refunds', 'Top Services', 'Top Products', 'Payment Methods'],
            booking: ['Revenue', 'Cancellations', 'Top Services', 'Capacity', 'Refunds'],
            service: ['Bookings', 'Revenue', 'Customer Ratings', 'Schedule', 'Promotions'],
            product: ['Inventory', 'Revenue', 'Top Products', 'Spin', 'Promotions'],
            inventory: ['Top Products', 'Revenue', 'Spin', 'Promotions'],
            refund: ['Revenue', 'Bookings', 'Payment Methods', 'Customer Ratings'],
            rating: ['Refunds', 'Bookings', 'Customer Retention'],
            payment: ['Revenue', 'Refunds', 'Orders'],
            loyalty: ['Revenue', 'Repeat Customers', 'Cashback', 'Promotions'],
            cashback: ['Loyalty', 'Repeat Customers', 'Revenue'],
            spin: ['Promotions', 'Inventory', 'Voucher Redemptions', 'Revenue'],
            promotion: ['Revenue', 'Bookings', 'Spin', 'Top Products']
        };
        const adminRelated = {
            revenue: ['Merchant Performance', 'Refunds', 'Platform Growth', 'Bookings'],
            merchant: ['Paid Transaction Sales', 'Merchant Approvals', 'Ratings', 'Refunds'],
            booking: ['Paid Transaction Sales', 'Cancellations', 'Merchant Performance'],
            refund: ['Paid Transaction Sales', 'Merchant Review', 'Support Load'],
            growth: ['Paid Transaction Sales', 'Active Customers', 'Active Merchants'],
            spin: ['Reward Management', 'Promotions', 'Merchant Performance'],
            reward: ['Spin Management', 'Platform Loyalty', 'Cashback'],
            rating: ['Merchant Review', 'Refunds', 'Support Load']
        };
        const source = role === 'admin' ? adminRelated : merchantRelated;
        const key = Object.keys(source).find((item) => lower.includes(item));
        return (key ? source[key] : role === 'admin'
            ? ['Paid Transaction Sales', 'Merchant Performance', 'Refunds']
            : ['Revenue', 'Bookings', 'Refunds']).slice(0, 6);
    };

    const followupsFor = (label = '') => relatedMetricsFor(label).slice(0, 4).map((item) => `Explain ${item.toLowerCase()}`);

    const getCardLabel = (card) => {
        const heading = card.querySelector('h1, h2, h3, .merchant-kpi-card > span, .merchant-analytics-kpi-card > span, .analytics-kpi-card > span, .admin-stat-card > span');
        return String(heading?.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const getInsightTargets = () => {
        const selectors = role === 'admin'
            ? ['.analytics-kpi-card', '.admin-stat-card', '.analytics-chart-panel', '.admin-panel', '.admin-responsive-table', '.analytics-mini-table', '.analytics-ranking-list']
            : ['.merchant-analytics-kpi-card', '.merchant-kpi-card', '.merchant-payout-summary-card', '.merchant-analytics-card', '.merchant-chart-card', '.merchant-product-orders-panel', '.merchant-orders-card', '.merchant-alert-card'];
        const seen = new Set();
        return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))
            .filter((card) => {
                if (seen.has(card) || card.closest('[data-ai-executive-dashboard]') || card.querySelector('.analytics-ai-chart-explanation')) return false;
                seen.add(card);
                const label = getCardLabel(card);
                if (!label) return false;
                const supported = role === 'admin'
                    ? /(revenue|merchant|booking|refund|rating|performance|spin|loyalty|reward|growth|status|category)/i
                    : /(revenue|booking|completed|product|service|refund|customer|rating|payment|inventory|loyalty|cashback|spin|promotion|order)/i;
                return supported.test(label);
            })
            .slice(0, role === 'admin' ? 12 : 16);
    };

    const renderInsightPanel = (card, insight, payload, comparison = '') => {
        let panel = card.querySelector(':scope > .analytics-ai-chart-explanation');
        if (!panel) {
            panel = createEl('details', 'analytics-ai-chart-explanation ai-widget-insight');
            panel.open = true;
            card.appendChild(panel);
        }

        while (panel.firstChild) panel.removeChild(panel.firstChild);
        const summary = createEl('summary');
        const confidenceBadge = AIUI.confidenceBadge
            ? AIUI.confidenceBadge(insight.confidence)
            : createEl('span', 'ai-confidence-pill', `Confidence: ${insight.confidence}`);
        if (confidenceBadge.classList.contains('ai-standard-confidence-badge')) {
            confidenceBadge.textContent = `Confidence: ${confidenceBadge.textContent}`;
        }
        summary.append(createEl('strong', '', 'AI Insights'), confidenceBadge);

        const body = createEl('div', 'ai-widget-insight-body');
        [
            ['Summary', [insight.summary]],
            ['What changed?', insight.changes],
            ['Why it happened', [explanationWhyFor(insight)]],
            ['Business impact', [explanationImpactFor(insight)]],
            ['Recommended actions', insight.recommendations]
        ].forEach(([label, rows]) => {
            const listRows = (rows || []).filter(Boolean);
            if (!listRows.length) return;
            const section = createEl('div', 'ai-widget-insight-section');
            section.appendChild(createEl('b', '', label));
            const list = createEl('ul');
            listRows.forEach((row) => list.appendChild(createEl('li', '', row)));
            section.appendChild(list);
            body.appendChild(section);
        });
        [
            ['Positive Insights', insight.positives],
            ['Warnings', insight.warnings],
            ['Related context', relatedMetricsFor(insight.title)]
        ].forEach(([label, rows]) => {
            const listRows = (rows || []).filter(Boolean);
            if (!listRows.length) return;
            const section = createEl('div', 'ai-widget-insight-section');
            section.appendChild(createEl('b', '', label));
            const list = createEl('ul');
            listRows.forEach((row) => list.appendChild(createEl('li', '', row)));
            section.appendChild(list);
            body.appendChild(section);
        });

        const controls = createEl('div', 'ai-widget-insight-controls');
        const explain = createEl('button', 'button secondary compact', 'Explain');
        explain.type = 'button';
        const detail = document.createElement('select');
        detail.setAttribute('aria-label', `Explanation detail for ${insight.title}`);
        [
            ['simple', 'Level 1: Simple'],
            ['business', 'Level 2: Business'],
            ['technical', 'Level 3: Technical']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            detail.appendChild(option);
        });
        detail.value = 'business';
        explain.addEventListener('click', () => explainWidget(panel, insight, comparison, detail.value));
        const propose = createEl('button', 'button secondary compact', role === 'admin' ? 'Prepare Review' : 'Prepare Proposal');
        propose.type = 'button';
        propose.addEventListener('click', () => prepareWidgetProposal(panel, insight));
        const compare = document.createElement('select');
        compare.setAttribute('aria-label', `Compare ${insight.title}`);
        [
            ['last7', 'Current week vs previous week'],
            ['thisMonth', 'Current month vs previous month'],
            ['currentYear', 'Current year vs previous year']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            compare.appendChild(option);
        });
        compare.value = comparison || period;
        compare.addEventListener('change', () => compareWidget(card, insight, compare.value, payload));
        controls.append(explain, detail, propose, compare);
        body.appendChild(controls);

        const related = createEl('div', 'ai-widget-related-actions');
        related.appendChild(createEl('b', '', 'Ask AI next'));
        followupsFor(insight.title).forEach((question) => {
            const button = createEl('button', 'button ghost compact', question);
            button.type = 'button';
            button.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('vaniday:ai-followup-question', { detail: { question } }));
            });
            related.appendChild(button);
        });
        body.appendChild(related);

        const reasoning = AIUI.reasoningPanel ? AIUI.reasoningPanel({
            dataSources: role === 'admin' ? ['Admin analytics', 'Platform metrics'] : ['Merchant analytics', 'Dashboard metrics'],
            metrics: [insight.title, ...relatedMetricsFor(insight.title).slice(0, 3)],
            timePeriod: comparison || period,
            confidence: insight.confidence,
            reason: explanationWhyFor(insight)
        }) : null;
        if (reasoning) body.appendChild(reasoning);

        panel.append(summary, body);
    };

    const renderWidgetInsights = (payload = {}) => {
        const summary = payload.summary || {};
        getInsightTargets().forEach((card) => {
            const label = getCardLabel(card);
            renderInsightPanel(card, insightForLabel(label, summary, payload), payload);
        });
    };

    const explainWidget = async (panel, insight, comparison = '', detailLevel = 'business') => {
        const cache = `vaniday:${role}:widget-explain:${path}:${period}:${comparison}:${detailLevel}:${insight.title}`;
        const existing = sessionStorage.getItem(cache);
        let box = panel.querySelector('.ai-widget-detailed-answer');
        if (!box) {
            box = createEl('div', 'ai-widget-detailed-answer');
            panel.querySelector('.ai-widget-insight-body')?.appendChild(box);
        }
        if (existing) {
            box.textContent = existing;
            return;
        }
        box.textContent = 'Preparing a detailed explanation...';
        const levelText = detailLevel === 'technical'
            ? 'Level 3 technical breakdown with calculation logic and metric caveats'
            : detailLevel === 'simple'
                ? 'Level 1 simple summary'
                : 'Level 2 business explanation';
        const question = `Explain this ${role} analytics widget. Detail: ${levelText}. Include summary, what changed, why it happened, business impact, confidence and recommended actions. Widget: ${insight.title}. Current insight: ${insight.summary} Key changes: ${(insight.changes || []).join('; ') || 'none'}. Related metrics: ${relatedMetricsFor(insight.title).join(', ')}. Comparison mode: ${comparison || period}.`.slice(0, 500);
        const { response, payload } = await fetchAiJson(askEndpoint, { period: comparison || period, question });
        const answer = payload.answer || payload.fallback || {};
        const text = response.ok || payload.fallback ? (answer.answer || insight.summary) : (payload.message || 'Detailed explanation could not be generated.');
        sessionStorage.setItem(cache, text);
        box.textContent = text;
    };

    const prepareWidgetProposal = async (panel, insight) => {
        let box = panel.querySelector('.ai-widget-detailed-answer');
        if (!box) {
            box = createEl('div', 'ai-widget-detailed-answer');
            panel.querySelector('.ai-widget-insight-body')?.appendChild(box);
        }
        box.textContent = role === 'admin' ? 'Preparing admin review recommendation...' : 'Preparing proposal for confirmation...';
        const prompt = `Prepare a safe ${role} recommendation for ${insight.title}. ${insight.summary} Recommendations: ${(insight.recommendations || []).join('; ')}. Do not apply changes automatically.`.slice(0, 500);
        const { response, payload } = await fetchAiJson(proposalEndpoint, { period, prompt });
        if (!response.ok || !payload.success) {
            box.textContent = payload.message || 'Recommendation could not be prepared.';
            return;
        }
        const proposal = payload.proposal || {};
        box.textContent = `${proposal.title || 'Recommendation prepared'}: ${proposal.reason || 'Review this recommendation before taking action.'}`;
    };

    const priorityFor = (level = 'medium') => {
        const normalized = String(level || '').toLowerCase();
        if (normalized === 'critical' || normalized === 'high') return 'High';
        if (normalized === 'low') return 'Low';
        return 'Medium';
    };

    const operationalCard = ({ type, title, priority = 'medium', confidence = 'Medium', reason, impact, action, alert = false, prediction = '' }) => ({
        type,
        title,
        priority: priorityFor(priority),
        confidence,
        reason,
        impact,
        action,
        alert,
        prediction
    });

    const buildMerchantOperations = (summary = {}) => {
        const metrics = summary.metrics || {};
        const cards = [];
        const busiestDay = summary.busiestBookingDays?.[0];
        const quietDay = summary.leastBusyBookingDays?.[0];
        const busiestHour = summary.busiestBookingHours?.[0];
        const stock = summary.stockConcerns?.[0];
        const topProduct = summary.topProductsByRevenue?.[0];
        const topService = summary.topServicesByBookingCount?.[0] || summary.topServicesByRevenue?.[0];
        const weakService = summary.lowestPerformingServices?.[0];
        const refunds = Number(metrics.refundCount || 0);
        const cancellationRate = Number(metrics.cancellationRate || 0);
        const bookingChange = Number(metrics.bookingChange?.value || 0);
        const revenueChange = Number(metrics.revenueChange?.value || 0);

        cards.push(operationalCard({
            type: 'Booking Optimiser',
            title: busiestDay ? `${busiestDay.day} is your strongest booking day` : 'Booking demand needs more history',
            priority: bookingChange < -10 || cancellationRate > 15 ? 'high' : 'medium',
            confidence: confidenceFor(summary.busiestBookingDays, summary.busiestBookingHours, metrics.totalBookings),
            reason: busiestDay ? `${number(busiestDay.bookings)} booking${Number(busiestDay.bookings) === 1 ? '' : 's'} were recorded on ${busiestDay.day}.` : 'The current period has limited booking pattern data.',
            impact: busiestHour ? `Peak demand is around ${busiestHour.hour}; staffing and slots should protect that window.` : 'More bookings will improve scheduling confidence.',
            action: quietDay ? `Use quieter ${quietDay.day} slots for targeted offers before changing core hours.` : 'Keep collecting booking history before changing availability.',
            prediction: bookingChange < -10 ? 'Booking demand may remain soft unless quiet periods are addressed.' : ''
        }));

        cards.push(operationalCard({
            type: 'Capacity Planning',
            title: cancellationRate > 10 ? 'Cancellation pressure needs review' : 'Capacity appears manageable',
            priority: cancellationRate > 15 ? 'high' : 'medium',
            confidence: confidenceFor(metrics.totalBookings, metrics.cancelledBookings, summary.busiestBookingHours),
            reason: `${percent(cancellationRate)} of bookings were cancelled in the selected period.`,
            impact: busiestHour ? `High-demand periods around ${busiestHour.hour} may need careful slot control.` : 'No clear overbooked period is visible yet.',
            action: cancellationRate > 10 ? 'Review reminders, confirmation timing and cancellation reasons before changing schedules.' : 'Keep current schedule controls and monitor peak utilisation.',
            prediction: cancellationRate > 15 ? 'Cancellations may continue to affect workload planning if reminders are not improved.' : ''
        }));

        cards.push(operationalCard({
            type: 'Inventory Intelligence',
            title: stock ? `${stock.productName} is low on stock` : 'No low-stock alert in current analytics',
            priority: stock ? 'high' : 'low',
            confidence: confidenceFor(summary.stockConcerns, summary.topProductsByRevenue),
            reason: stock ? `${stock.productName} has ${number(stock.stockQuantity)} unit${Number(stock.stockQuantity) === 1 ? '' : 's'} remaining.` : 'No products were returned by the low-stock analytics check.',
            impact: topProduct ? `${topProduct.productName} is a current product demand signal.` : 'Inventory impact is limited until more product sales are recorded.',
            action: stock ? `Restock ${stock.productName} before running product or Spin promotions.` : 'Use product demand data before increasing stock.',
            prediction: stock ? `${stock.productName} may run out soon if sales continue at the current pace.` : ''
        }));

        cards.push(operationalCard({
            type: 'Refund Intelligence',
            title: refunds ? `${number(refunds)} refund case${refunds === 1 ? '' : 's'} need monitoring` : 'Refund pressure is low',
            priority: refunds > 2 ? 'high' : refunds ? 'medium' : 'low',
            confidence: confidenceFor(refunds, metrics.grossRefundAmount, metrics.netRefundAmount),
            reason: refunds ? `Gross refunds total ${money(metrics.grossRefundAmount)} and final customer returns total ${money(metrics.netRefundAmount)}.` : 'No refund cases are visible in this period.',
            impact: refunds ? 'Refund activity can affect customer trust, retained revenue and support workload.' : 'Low refunds support a healthier customer experience.',
            action: refunds ? 'Review customer-visible refund reasons and merchant response time before approving changes.' : 'Keep refund monitoring active.',
            prediction: refunds > 2 ? 'Refund volume may increase support workload if causes are not addressed.' : ''
        }));

        cards.push(operationalCard({
            type: 'Demand Opportunity',
            title: topService ? `${topService.serviceName} is a strong demand signal` : 'Service demand is still forming',
            priority: revenueChange < -10 ? 'high' : 'medium',
            confidence: confidenceFor(topService, weakService, metrics.totalRevenue),
            reason: topService ? `${topService.serviceName} recorded ${number(topService.bookings)} booking${Number(topService.bookings) === 1 ? '' : 's'}.` : 'The analytics payload does not yet show a clear top service.',
            impact: weakService ? `${weakService.serviceName} appears weaker and may need promotion or schedule review.` : 'A clear top service can guide promotion planning.',
            action: topService ? `Promote ${topService.serviceName} while demand is visible.` : 'Wait for more booking data before changing service strategy.',
            prediction: revenueChange < -10 ? 'Revenue may remain weaker unless demand is redirected toward reliable services.' : ''
        }));

        return cards;
    };

    const buildAdminOperations = (summary = {}) => {
        const metrics = summary.metrics || {};
        const cards = [];
        const highRefundMerchant = summary.merchantsWithHighestRefundRates?.[0];
        const highCancelMerchant = summary.merchantsWithHighestCancellationRates?.[0];
        const lowRatedMerchant = summary.merchantsWithLowRatings?.[0];
        const topMerchant = summary.topMerchantsByRevenue?.[0];
        const revenueChange = Number(metrics.revenueChange?.value || 0);

        cards.push(operationalCard({
            type: 'Platform Operations',
            title: revenueChange < -10 ? 'Paid transaction sales need attention' : 'Paid transaction sales are being monitored',
            priority: revenueChange < -10 ? 'high' : 'medium',
            confidence: confidenceFor(metrics.totalPlatformRevenue, metrics.revenueChange?.value, topMerchant),
            reason: changeText(metrics.revenueChange, 'Paid transaction sales'),
            impact: topMerchant ? `${topMerchant.merchantName} is the strongest paid-sales contributor.` : 'Merchant-level contribution is limited in the current payload.',
            action: revenueChange < -10 ? 'Review top merchants, refunds and cancellations before platform campaigns.' : 'Continue comparing merchant performance across periods.',
            prediction: revenueChange < -10 ? 'Paid-sales softness may continue if merchant demand signals do not recover.' : ''
        }));

        cards.push(operationalCard({
            type: 'Refund Intelligence',
            title: highRefundMerchant ? `${highRefundMerchant.merchantName} has the highest refund count` : 'No merchant refund concentration visible',
            priority: Number(metrics.refundRate || 0) > 10 ? 'high' : 'medium',
            confidence: confidenceFor(metrics.totalRefunds, metrics.refundRate, highRefundMerchant),
            reason: `${number(metrics.totalRefunds)} refund case${Number(metrics.totalRefunds) === 1 ? '' : 's'} are visible; refund rate is ${percent(metrics.refundRate)}.`,
            impact: highRefundMerchant ? `${highRefundMerchant.merchantName} has ${number(highRefundMerchant.refundCount)} refund case${Number(highRefundMerchant.refundCount) === 1 ? '' : 's'}.` : 'No high-refund merchant stands out yet.',
            action: highRefundMerchant ? `Review ${highRefundMerchant.merchantName}'s refund reasons before taking admin action.` : 'Continue monitoring refund distribution.',
            prediction: Number(metrics.refundRate || 0) > 10 ? 'Refund workload may rise if high-refund merchants are not reviewed.' : ''
        }));

        cards.push(operationalCard({
            type: 'Booking Optimiser',
            title: highCancelMerchant ? `${highCancelMerchant.merchantName} has high cancellations` : 'Booking cancellations are being monitored',
            priority: highCancelMerchant && Number(highCancelMerchant.cancellationRate || 0) > 20 ? 'high' : 'medium',
            confidence: confidenceFor(metrics.totalBookings, metrics.cancellationRate, highCancelMerchant),
            reason: `Platform cancellation rate is ${percent(metrics.cancellationRate)}.`,
            impact: highCancelMerchant ? `${highCancelMerchant.merchantName} has a ${percent(highCancelMerchant.cancellationRate)} cancellation rate.` : 'No merchant cancellation concentration is visible.',
            action: highCancelMerchant ? 'Review merchant booking reminders and cancellation handling.' : 'Monitor booking status distribution.',
            prediction: highCancelMerchant && Number(highCancelMerchant.cancellationRate || 0) > 20 ? 'Cancellation pressure may affect customer satisfaction if unresolved.' : ''
        }));

        cards.push(operationalCard({
            type: 'Merchant Review',
            title: lowRatedMerchant ? `${lowRatedMerchant.merchantName} may need quality review` : 'No low-rating merchant signal visible',
            priority: lowRatedMerchant ? 'high' : 'low',
            confidence: confidenceFor(summary.merchantsWithLowRatings),
            reason: lowRatedMerchant ? `${lowRatedMerchant.merchantName} has an average rating of ${Number(lowRatedMerchant.averageRating || 0).toFixed(1)} / 5.` : 'No low-rating merchant row was returned by analytics.',
            impact: lowRatedMerchant ? 'Low ratings can affect booking conversion and support load.' : 'Merchant review risk appears limited from available data.',
            action: lowRatedMerchant ? `Open ${lowRatedMerchant.merchantName}'s profile and review customer feedback.` : 'Keep monitoring reviews.',
            prediction: lowRatedMerchant ? 'Support cases may increase if quality issues are not followed up.' : ''
        }));

        return cards;
    };

    const buildOperationsIntelligence = (summary = {}) => {
        const cards = role === 'admin' ? buildAdminOperations(summary) : buildMerchantOperations(summary);
        const alerts = cards.filter((card) => card.priority === 'High' || card.alert).slice(0, 4);
        const predictions = cards.map((card) => card.prediction).filter(Boolean).slice(0, 4);
        return {
            cards,
            alerts,
            predictions,
            overview: alerts.length
                ? `${alerts.length} operational alert${alerts.length === 1 ? '' : 's'} need review.`
                : 'No high-priority operational alert is visible from the current analytics.'
        };
    };

    const createOperationsCard = (card) => {
        const node = createEl('article', 'ai-operations-card');
        node.dataset.operationsType = card.type;
        node.innerHTML = `
            <div class="ai-operations-card-heading">
                <span>${escapeHtml(card.type)}</span>
                <b data-priority="${escapeHtml(card.priority.toLowerCase())}">${escapeHtml(card.priority)}</b>
            </div>
            <h4>${escapeHtml(card.title)}</h4>
            <dl>
                <div><dt>Confidence</dt><dd>${escapeHtml(card.confidence)}</dd></div>
                <div><dt>Reason</dt><dd>${escapeHtml(card.reason)}</dd></div>
                <div><dt>Expected impact</dt><dd>${escapeHtml(card.impact)}</dd></div>
                <div><dt>Suggested action</dt><dd>${escapeHtml(card.action)}</dd></div>
            </dl>
            ${card.prediction ? `<p class="ai-operations-prediction">${escapeHtml(card.prediction)}</p>` : ''}
        `;
        const actions = createEl('div', 'ai-operations-actions');
        const explain = createEl('button', 'button secondary compact', 'Explain');
        explain.type = 'button';
        explain.addEventListener('click', () => explainOperationCard(node, card));
        const propose = createEl('button', 'button secondary compact', 'Create Proposal');
        propose.type = 'button';
        propose.addEventListener('click', () => prepareOperationProposal(node, card));
        const dismiss = createEl('button', 'button ghost compact', 'Dismiss');
        dismiss.type = 'button';
        dismiss.addEventListener('click', () => node.remove());
        actions.append(dismiss, explain, propose);
        node.appendChild(actions);
        return node;
    };

    const renderOperationsIntelligence = (root, payload = {}) => {
        const intelligence = buildOperationsIntelligence(payload.summary || {});
        let panel = root.querySelector('[data-ai-operations-panel]');
        if (!panel) {
            panel = createEl('section', 'ai-operations-panel');
            panel.dataset.aiOperationsPanel = 'ready';
            root.appendChild(panel);
        }
        panel.innerHTML = `
            <div class="ai-operations-heading">
                <div>
                    <p class="eyebrow">AI Operations Intelligence</p>
                    <h3>${role === 'admin' ? 'Platform operations watchlist' : 'Business operations watchlist'}</h3>
                    <span>${escapeHtml(intelligence.overview)}</span>
                </div>
            </div>
        `;
        if (intelligence.alerts.length || intelligence.predictions.length) {
            const alertBox = createEl('div', 'ai-operations-alerts');
            intelligence.alerts.forEach((card) => alertBox.appendChild(createEl('span', '', card.title)));
            intelligence.predictions.forEach((prediction) => alertBox.appendChild(createEl('span', '', prediction)));
            panel.appendChild(alertBox);
        }
        const grid = createEl('div', 'ai-operations-grid');
        intelligence.cards.forEach((card) => grid.appendChild(createOperationsCard(card)));
        panel.appendChild(grid);
        dispatchOperationsAlerts(intelligence);
    };

    const explainOperationCard = async (cardNode, card) => {
        const cache = `vaniday:${role}:operations-explain:${path}:${period}:${card.type}:${card.title}`;
        let answer = cardNode.querySelector('.ai-operations-answer');
        if (!answer) {
            answer = createEl('div', 'ai-operations-answer');
            cardNode.appendChild(answer);
        }
        const cached = sessionStorage.getItem(cache);
        if (cached) {
            answer.textContent = cached;
            return;
        }
        answer.textContent = 'Analysing likely causes...';
        try {
            const question = `Explain this operations intelligence card using current analytics only. Type: ${card.type}. Title: ${card.title}. Reason: ${card.reason}. Impact: ${card.impact}. Suggested action: ${card.action}. Prediction: ${card.prediction || 'none'}.`;
            const { response, payload } = await fetchAiJson(askEndpoint, { period, question: question.slice(0, 500) });
            const text = (payload.answer || payload.fallback || {}).answer || payload.message || card.reason;
            if (!response.ok && !payload.fallback) throw new Error(text);
            sessionStorage.setItem(cache, text);
            answer.textContent = text;
        } catch (error) {
            answer.textContent = error.message || 'Explanation could not be generated.';
        }
    };

    const prepareOperationProposal = async (cardNode, card) => {
        let answer = cardNode.querySelector('.ai-operations-answer');
        if (!answer) {
            answer = createEl('div', 'ai-operations-answer');
            cardNode.appendChild(answer);
        }
        answer.textContent = role === 'admin' ? 'Preparing admin review recommendation...' : 'Preparing proposal for confirmation...';
        try {
            const prompt = `Create a safe review-only operations proposal. Type: ${card.type}. Title: ${card.title}. Reason: ${card.reason}. Expected impact: ${card.impact}. Suggested action: ${card.action}. Do not apply automatically.`;
            const { response, payload } = await fetchAiJson(proposalEndpoint, { period, prompt: prompt.slice(0, 500) });
            if (!response.ok || !payload.success) throw new Error(payload.message || 'Proposal could not be prepared.');
            const proposal = payload.proposal || {};
            answer.textContent = `${proposal.title || 'Proposal prepared'}: ${proposal.reason || 'Review this recommendation in the AI assistant before confirming any action.'}`;
        } catch (error) {
            answer.textContent = error.message || 'Proposal could not be prepared.';
        }
    };

    const dispatchOperationsAlerts = (intelligence = {}) => {
        const alertText = (intelligence.alerts || []).map((card) => `${card.type}: ${card.title}`).join(' ');
        const predictionText = (intelligence.predictions || []).join(' ');
        const text = [alertText, predictionText].filter(Boolean).join(' ');
        const key = `vaniday:${role}:operations-alerts:${path}:${todayKey()}`;
        if (!text || sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, 'shown');
        window.dispatchEvent(new CustomEvent('vaniday:ai-operations-alerts', {
            detail: { text: `Operations intelligence: ${text}`.slice(0, 700) }
        }));
    };

    const compareWidget = async (card, originalInsight, comparisonPeriod, existingPayload) => {
        const cache = `vaniday:${role}:widget-compare:${path}:${comparisonPeriod}`;
        let payload = null;
        const cached = sessionStorage.getItem(cache);
        if (cached) {
            try {
                payload = JSON.parse(cached);
            } catch (error) {
                sessionStorage.removeItem(cache);
            }
        }
        if (!payload) {
            const result = await fetchAiJson(endpoint, { period: comparisonPeriod });
            const response = result.response;
            payload = result.payload;
            if (!response.ok && !payload.fallback) {
                renderInsightPanel(card, { ...originalInsight, warnings: [payload.message || 'Comparison could not be generated.'] }, existingPayload, comparisonPeriod);
                return;
            }
            sessionStorage.setItem(cache, JSON.stringify(payload));
        }
        renderInsightPanel(card, insightForLabel(originalInsight.title, payload.summary || {}, payload), payload, comparisonPeriod);
    };

    const todayKey = () => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const reportStorageKey = `vaniday:${role}:ai-report-history`;
    const dailyBriefKey = `vaniday:${role}:daily-brief:${todayKey()}`;

    const fetchReportPayload = async (reportPeriod) => {
        const key = `vaniday:${role}:executive-report:${path}:${reportPeriod}`;
        const cached = sessionStorage.getItem(key);
        if (cached) {
            try {
                return JSON.parse(cached);
            } catch (error) {
                sessionStorage.removeItem(key);
            }
        }

        const { response, payload } = await fetchAiJson(endpoint, { period: reportPeriod });
        if (!response.ok && !payload.fallback) throw new Error(payload.message || 'Report could not be generated.');
        sessionStorage.setItem(key, JSON.stringify(payload));
        return payload;
    };

    const achievementsFor = (summary = {}, health = {}) => {
        const metrics = summary.metrics || {};
        const achievements = [];
        if (Number(metrics.revenueChange?.value || 0) > 0) achievements.push(`Revenue improved by ${metrics.revenueChange.value}%.`);
        if (Number(metrics.bookingChange?.value || 0) > 0) achievements.push(`Bookings improved by ${metrics.bookingChange.value}%.`);
        if (Number(metrics.refundCount || metrics.totalRefunds || 0) === 0) achievements.push('No refunds are visible for this period.');
        if (Number(metrics.averageCustomerRating || 0) >= 4.5) achievements.push('Customer ratings remain excellent.');
        if (health.score >= 85) achievements.push(`${role === 'admin' ? 'Platform' : 'Business'} health is strong.`);
        return achievements.slice(0, 4);
    };

    const concernsFor = (summary = {}, health = {}) => {
        const metrics = summary.metrics || {};
        const concerns = [];
        if (Number(metrics.revenueChange?.value || 0) < -10) concerns.push(`Revenue declined by ${Math.abs(metrics.revenueChange.value)}%.`);
        if (Number(metrics.bookingChange?.value || 0) < -10) concerns.push(`Bookings declined by ${Math.abs(metrics.bookingChange.value)}%.`);
        if (Number(metrics.refundCount || metrics.totalRefunds || 0) > 0) concerns.push(`${number(metrics.refundCount || metrics.totalRefunds)} refund case${Number(metrics.refundCount || metrics.totalRefunds) === 1 ? '' : 's'} need review.`);
        if ((summary.stockConcerns || []).length) concerns.push(`${summary.stockConcerns.length} inventory alert${summary.stockConcerns.length === 1 ? '' : 's'} detected.`);
        if ((summary.merchantsWithLowRatings || []).length) concerns.push(`${summary.merchantsWithLowRatings.length} low-rated merchant signal${summary.merchantsWithLowRatings.length === 1 ? '' : 's'} detected.`);
        if (health.score < 70) concerns.push(`${role === 'admin' ? 'Platform' : 'Business'} health needs attention.`);
        return concerns.slice(0, 5);
    };

    const buildReport = (reportType, payload = {}) => {
        const summary = payload.summary || {};
        const insights = payload.insights || payload.fallback || {};
        const health = role === 'admin' ? buildAdminHealth(summary) : buildMerchantHealth(summary);
        const fields = role === 'admin' ? adminFields(summary) : merchantFields(summary);
        const recommendations = recommendationsFrom(payload, summary, health);
        const reportTitles = {
            daily: role === 'admin' ? 'Daily Platform Brief' : 'Daily Business Brief',
            weekly: role === 'admin' ? 'Weekly Platform Report' : 'Weekly Business Report',
            monthly: role === 'admin' ? 'Monthly Platform Report' : 'Monthly Business Report'
        };
        return {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            role,
            type: reportType,
            title: reportTitles[reportType] || 'AI Business Report',
            generatedAt: new Date().toISOString(),
            periodLabel: summary.period?.label || period,
            overview: executiveOverview(summary, insights),
            fields,
            health,
            achievements: achievementsFor(summary, health),
            concerns: concernsFor(summary, health),
            recommendations,
            unavailable: fields.filter(([, value]) => /not available/i.test(String(value))).map(([label]) => label)
        };
    };

    const storeReportHistory = (report) => {
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem(reportStorageKey) || '[]');
        } catch (error) {
            history = [];
        }
        const next = [report, ...history.filter((item) => item.id !== report.id)].slice(0, 8);
        localStorage.setItem(reportStorageKey, JSON.stringify(next));
    };

    const getReportHistory = () => {
        try {
            const rows = JSON.parse(localStorage.getItem(reportStorageKey) || '[]');
            return Array.isArray(rows) ? rows.slice(0, 8) : [];
        } catch (error) {
            return [];
        }
    };

    const renderReportCard = (report) => {
        const card = createEl('article', 'ai-report-card');
        const meta = new Date(report.generatedAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
        card.innerHTML = `
            <div class="ai-report-card-heading">
                <div>
                    <p class="eyebrow">${escapeHtml(report.periodLabel)}</p>
                    <h3>${escapeHtml(report.title)}</h3>
                    <span>${escapeHtml(meta)}</span>
                </div>
                <strong>${report.health.score} / 100</strong>
            </div>
            <p>${escapeHtml(report.overview)}</p>
        `;
        const blocks = createEl('div', 'ai-report-blocks');
        [
            ['Summary', report.fields.slice(0, 8).map(([label, value]) => `${label}: ${value}`)],
            ['Highlights', report.achievements],
            ['Concerns', report.concerns],
            ['Recommendations', report.recommendations],
            ['Unavailable Metrics', report.unavailable]
        ].forEach(([label, rows]) => {
            if (!rows.length) return;
            const section = createEl('section');
            section.appendChild(createEl('h4', '', label));
            const list = createEl('ul');
            rows.forEach((row) => list.appendChild(createEl('li', '', row)));
            section.appendChild(list);
            blocks.appendChild(section);
        });
        card.appendChild(blocks);

        const actions = createEl('div', 'ai-report-actions');
        const print = createEl('button', 'button secondary compact', 'Print / Save PDF');
        print.type = 'button';
        print.addEventListener('click', () => openPrintableReport(report, true));
        const html = createEl('button', 'button secondary compact', 'Open HTML');
        html.type = 'button';
        html.addEventListener('click', () => openPrintableReport(report, false));
        actions.append(print, html);
        card.appendChild(actions);
        return card;
    };

    const renderReportPanel = (root, initialReport = null) => {
        let panel = root.querySelector('[data-ai-report-panel]');
        if (!panel) {
            panel = createEl('section', 'ai-report-panel');
            panel.dataset.aiReportPanel = 'ready';
            root.appendChild(panel);
        }
        while (panel.firstChild) panel.removeChild(panel.firstChild);

        const header = createEl('div', 'ai-report-panel-heading');
        header.innerHTML = `<div><p class="eyebrow">AI Reports</p><h3>${role === 'admin' ? 'Platform report generator' : 'Business report generator'}</h3></div>`;
        const controls = createEl('div', 'ai-report-controls');
        [
            ['daily', role === 'admin' ? 'Generate Daily Platform Brief' : 'Generate Daily Brief'],
            ['weekly', role === 'admin' ? 'Generate Weekly Platform Report' : 'Generate Weekly Report'],
            ['monthly', role === 'admin' ? 'Generate Monthly Platform Report' : 'Generate Monthly Report']
        ].forEach(([type, label]) => {
            const button = createEl('button', 'button secondary compact', label);
            button.type = 'button';
            button.addEventListener('click', () => generateReport(root, type));
            controls.appendChild(button);
        });
        header.appendChild(controls);
        panel.appendChild(header);

        const reportWrap = createEl('div', 'ai-report-current');
        if (initialReport) reportWrap.appendChild(renderReportCard(initialReport));
        panel.appendChild(reportWrap);

        const history = getReportHistory();
        if (history.length) {
            const historyBlock = createEl('details', 'ai-report-history');
            historyBlock.innerHTML = '<summary>Report history from this browser</summary>';
            history.forEach((report) => historyBlock.appendChild(renderReportCard(report)));
            panel.appendChild(historyBlock);
        }
    };

    const generateReport = async (root, reportType) => {
        const panel = root.querySelector('[data-ai-report-panel]');
        const target = panel?.querySelector('.ai-report-current');
        if (target) target.textContent = 'Generating report from existing analytics...';
        const periodMap = { daily: 'last7', weekly: 'last7', monthly: 'thisMonth' };
        try {
            const payload = await fetchReportPayload(periodMap[reportType] || period);
            const report = buildReport(reportType, payload);
            storeReportHistory(report);
            if (reportType === 'daily') localStorage.setItem(dailyBriefKey, JSON.stringify(report));
            if (target) {
                while (target.firstChild) target.removeChild(target.firstChild);
                target.appendChild(renderReportCard(report));
            }
            dispatchDailyBrief(reportType, report);
        } catch (error) {
            if (target) target.textContent = error.message || 'Report could not be generated.';
        }
    };

    const maybeGenerateDailyBrief = async (root, payload) => {
        if (localStorage.getItem(dailyBriefKey)) {
            try {
                const report = JSON.parse(localStorage.getItem(dailyBriefKey));
                dispatchDailyBrief('daily', report);
                return report;
            } catch (error) {
                localStorage.removeItem(dailyBriefKey);
            }
        }
        const report = buildReport('daily', payload);
        localStorage.setItem(dailyBriefKey, JSON.stringify(report));
        storeReportHistory(report);
        dispatchDailyBrief('daily', report);
        return report;
    };

    const dispatchDailyBrief = (reportType, report) => {
        if (reportType !== 'daily') return;
        window.dispatchEvent(new CustomEvent('vaniday:ai-daily-brief', {
            detail: {
                text: `${report.title}: ${report.overview} Business health ${report.health.score}/100. Today's priorities: ${(report.recommendations || []).slice(0, 3).join('; ') || 'Monitor current analytics.'}`
            }
        }));
    };

    const openPrintableReport = (report, autoPrint = false) => {
        const win = window.open('', '_blank');
        if (!win) return;
        const rows = (title, values) => values && values.length
            ? `<section><h2>${escapeHtml(title)}</h2><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`
            : '';
        win.document.write(`<!doctype html><html><head><title>${escapeHtml(report.title)}</title><style>
            body{font-family:Arial,sans-serif;color:#243225;margin:32px;line-height:1.5}
            header,section{border:1px solid #d9e2d4;border-radius:10px;padding:18px;margin-bottom:16px}
            h1,h2{margin:0 0 10px;color:#31452c}.score{font-size:34px;font-weight:800}
            @media print{button{display:none}body{margin:16mm}}
        </style></head><body>
            <button onclick="window.print()">Print / Save PDF</button>
            <header><p>${escapeHtml(report.periodLabel)}</p><h1>${escapeHtml(report.title)}</h1><div class="score">${report.health.score} / 100</div><p>${escapeHtml(report.overview)}</p></header>
            ${rows('Summary', report.fields.map(([label, value]) => `${label}: ${value}`))}
            ${rows('Highlights', report.achievements)}
            ${rows('Concerns', report.concerns)}
            ${rows('Recommendations', report.recommendations)}
            ${rows('Unavailable Metrics', report.unavailable)}
        </body></html>`);
        win.document.close();
        if (autoPrint) win.addEventListener('load', () => win.print(), { once: true });
    };

    const toDateKey = (date = new Date()) => {
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
    };

    const addDateDays = (dateKey, days) => {
        const [year, month, day] = String(dateKey || toDateKey()).split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
        return date.toISOString().slice(0, 10);
    };

    const formatTimelineDate = (dateKey) => {
        const date = new Date(`${dateKey}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return dateKey || 'Current period';
        return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' });
    };

    const businessTimelineEvents = (payload = {}, health = {}, recommendations = []) => {
        const summary = payload.summary || {};
        const metrics = summary.metrics || {};
        const insights = payload.insights || payload.fallback || {};
        const periodEnd = addDateDays(summary.period?.endDate || toDateKey(), -1);
        const periodStart = summary.period?.startDate || addDateDays(periodEnd, -30);
        const spanDays = Math.max(1, Math.floor((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / (24 * 60 * 60 * 1000)));
        const middle = addDateDays(periodStart, Math.max(1, Math.floor(spanDays / 2)));
        const events = [];
        const addEvent = (event) => {
            if (!event?.title || !event?.what) return;
            events.push({
                date: event.date || periodEnd,
                category: event.category || 'Insight',
                tone: event.tone || 'information',
                title: event.title,
                what: event.what,
                why: event.why || 'This event was detected from the existing analytics summary.',
                impact: event.impact || 'Review the related dashboard section before changing business actions.',
                recommendation: event.recommendation || recommendations[0] || 'Monitor this signal as more data becomes available.',
                confidence: event.confidence || 'Medium'
            });
        };

        const revenue = Number(role === 'admin' ? metrics.totalPlatformRevenue : metrics.totalRevenue || 0);
        const revenueChange = metrics.revenueChange?.value;
        if (revenue > 0) addEvent({
            date: periodEnd,
            category: 'Revenue',
            tone: Number(revenueChange || 0) >= 0 ? 'positive' : 'warning',
            title: 'Revenue milestone',
            what: `${role === 'admin' ? 'Platform' : 'Business'} revenue reached ${money(revenue)} in the selected period.`,
            why: changeText(metrics.revenueChange, 'Revenue'),
            impact: 'Revenue movement affects payout planning, campaign timing and operating focus.',
            recommendation: recommendations.find((item) => /revenue|promot|merchant|service/i.test(item)) || 'Review the highest revenue contributor before launching promotions.',
            confidence: confidenceFor(revenue, revenueChange)
        });

        const bookings = Number(metrics.totalBookings || 0);
        if (bookings > 0) addEvent({
            date: middle,
            category: 'Bookings',
            tone: Number(metrics.bookingChange?.value || 0) >= 0 ? 'positive' : 'warning',
            title: 'Booking milestone',
            what: `${number(bookings)} booking${bookings === 1 ? '' : 's'} were recorded.`,
            why: changeText(metrics.bookingChange, 'Bookings'),
            impact: 'Booking volume affects staff planning, customer wait time and fulfilment quality.',
            recommendation: recommendations.find((item) => /booking|schedule|slot/i.test(item)) || 'Protect high-demand slots and review quiet periods.',
            confidence: confidenceFor(bookings, metrics.bookingChange?.value)
        });

        const refunds = Number(metrics.refundCount || metrics.totalRefunds || 0);
        if (refunds > 0) addEvent({
            date: periodEnd,
            category: 'Refunds',
            tone: refunds > 2 ? 'warning' : 'information',
            title: refunds > 2 ? 'Refund spike detected' : 'Refund activity detected',
            what: `${number(refunds)} refund case${refunds === 1 ? '' : 's'} appeared in the selected period.`,
            why: `Gross refunds total ${money(metrics.grossRefundAmount)} and net customer refunds total ${money(metrics.netRefundAmount)}.`,
            impact: 'Refund pressure can reduce customer trust and distort gross revenue if not reviewed separately.',
            recommendation: recommendations.find((item) => /refund|return|cancel/i.test(item)) || 'Review refund reasons and pending cases.',
            confidence: confidenceFor(refunds, metrics.grossRefundAmount, metrics.netRefundAmount)
        });

        (summary.stockConcerns || []).slice(0, 3).forEach((stock, index) => addEvent({
            date: addDateDays(periodEnd, -index),
            category: 'Inventory',
            tone: 'warning',
            title: 'Inventory shortage',
            what: `${stock.productName} has low stock (${number(stock.stockQuantity)} remaining).`,
            why: 'The product appears in the analytics low-stock list.',
            impact: 'Low stock can cause missed product sales or poor reward fulfilment.',
            recommendation: `Restock ${stock.productName} before promoting it.`,
            confidence: 'High'
        }));

        const topService = (summary.topServicesByRevenue || summary.topServicesByBookingCount || [])[0];
        if (topService) addEvent({
            date: middle,
            category: 'Services',
            tone: 'positive',
            title: 'Top service performance',
            what: `${topService.serviceName} is a leading service signal.`,
            why: `${number(topService.bookings)} booking${Number(topService.bookings) === 1 ? '' : 's'} and ${money(topService.revenue)} revenue are linked to this service.`,
            impact: 'Strong service demand can guide pricing, scheduling and promotion decisions.',
            recommendation: `Feature ${topService.serviceName} while demand is visible.`,
            confidence: confidenceFor(topService.bookings, topService.revenue)
        });

        const topProduct = (summary.topProductsByRevenue || [])[0];
        if (topProduct) addEvent({
            date: addDateDays(middle, 1),
            category: 'Products',
            tone: 'positive',
            title: 'Top product performance',
            what: `${topProduct.productName} is the strongest product signal.`,
            why: `${number(topProduct.unitsSold)} unit${Number(topProduct.unitsSold) === 1 ? '' : 's'} sold with ${money(topProduct.revenue)} revenue.`,
            impact: 'Product demand can inform stock planning and reward eligibility.',
            recommendation: `Keep ${topProduct.productName} stocked before campaign activity.`,
            confidence: confidenceFor(topProduct.unitsSold, topProduct.revenue)
        });

        if (metrics.averageCustomerRating !== null && metrics.averageCustomerRating !== undefined) {
            const rating = Number(metrics.averageCustomerRating);
            addEvent({
                date: periodEnd,
                category: 'Ratings',
                tone: rating >= 4.5 ? 'positive' : 'warning',
                title: rating >= 4.5 ? 'Rating improvement signal' : 'Rating decline risk',
                what: `Average customer rating is ${rating.toFixed(1)} / 5.`,
                why: Number(metrics.lowRatedReviews || 0) ? `${number(metrics.lowRatedReviews)} low-rated review${Number(metrics.lowRatedReviews) === 1 ? '' : 's'} need follow-up.` : 'Customer satisfaction appears stable in the current analytics summary.',
                impact: 'Ratings influence trust, conversion and repeat bookings.',
                recommendation: rating >= 4.5 ? 'Use strong customer satisfaction in service positioning.' : 'Follow up on low-rated reviews before running campaigns.',
                confidence: confidenceFor(metrics.totalReviews, rating)
            });
        }

        if (health?.score !== undefined) addEvent({
            date: periodEnd,
            category: 'Business Health',
            tone: health.score >= 75 ? 'positive' : 'recommendation',
            title: `${role === 'admin' ? 'Platform' : 'Business'} health ${health.label || 'updated'}`,
            what: `Health score is ${health.score} / 100.`,
            why: (health.categories || []).slice(0, 2).map((item) => `${item.name}: ${item.reason}`).join(' '),
            impact: 'Health changes highlight where leadership attention should go next.',
            recommendation: recommendations[0] || 'Review the lowest health category first.',
            confidence: 'Medium'
        });

        [
            ...(insights.recommendedActions || []).map((row) => row.action || row.reason),
            ...(insights.growthOpportunities || []).map((row) => row.opportunity || row.recommendedAction),
            ...(insights.platformTrends || []).map((row) => row.trend)
        ].filter(Boolean).slice(0, 2).forEach((item, index) => addEvent({
            date: addDateDays(periodEnd, -index - 1),
            category: /spin|wheel/i.test(item) ? 'Spin' : /loyal|cashback|reward/i.test(item) ? 'Loyalty' : 'Promotions',
            tone: 'recommendation',
            title: /spin|wheel/i.test(item) ? 'Spin engagement signal' : 'Promotion recommendation',
            what: item,
            why: 'The signal came from existing AI analytics recommendations.',
            impact: 'Campaign and loyalty signals can influence repeat visits and redemption quality.',
            recommendation: 'Use existing proposal confirmation before applying any campaign change.',
            confidence: 'Medium'
        }));

        return events.sort((left, right) => String(right.date).localeCompare(String(left.date))).slice(0, 18);
    };

    const renderBusinessTimeline = (root, payload = {}, health = {}, recommendations = []) => {
        const allEvents = businessTimelineEvents(payload, health, recommendations);
        const panel = createEl('section', 'ai-timeline-panel');
        panel.dataset.aiBusinessTimeline = 'ready';
        const heading = createEl('div', 'ai-timeline-heading');
        heading.innerHTML = `<div><p class="eyebrow">AI Business Timeline</p><h3>Important events</h3><span>Chronological business events generated from existing analytics. Expand each event for AI explanation.</span></div>`;
        const controls = createEl('div', 'ai-timeline-controls');
        [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom Range']].forEach(([value, label]) => {
            const button = createEl('button', '', label);
            button.type = 'button';
            button.dataset.timelineRange = value;
            if (value === 'month') button.classList.add('active');
            controls.appendChild(button);
        });
        const custom = createEl('div', 'ai-timeline-custom');
        custom.hidden = true;
        custom.innerHTML = '<label><span>Start</span><input type="date" data-timeline-start></label><label><span>End</span><input type="date" data-timeline-end></label>';
        controls.appendChild(custom);
        heading.appendChild(controls);
        panel.appendChild(heading);
        const list = createEl('div', 'ai-timeline-list');
        panel.appendChild(list);

        const filterEvents = (mode) => {
            const today = toDateKey();
            const startInput = custom.querySelector('[data-timeline-start]');
            const endInput = custom.querySelector('[data-timeline-end]');
            let start = '0000-01-01';
            let end = '9999-12-31';
            if (mode === 'today') {
                start = today;
                end = addDateDays(today, 1);
            } else if (mode === 'week') {
                start = addDateDays(today, -6);
                end = addDateDays(today, 1);
            } else if (mode === 'month') {
                start = `${today.slice(0, 7)}-01`;
                end = addDateDays(today, 1);
            } else if (mode === 'custom') {
                start = startInput?.value || '0000-01-01';
                end = endInput?.value ? addDateDays(endInput.value, 1) : '9999-12-31';
            }
            return allEvents.filter((event) => event.date >= start && event.date < end);
        };

        const renderRows = (mode = 'month') => {
            while (list.firstChild) list.removeChild(list.firstChild);
            const rows = filterEvents(mode);
            if (!rows.length) {
                list.appendChild(AIUI.emptyState ? AIUI.emptyState('No timeline events for this range.', 'Try This Month or choose a wider custom range.') : createEl('p', '', 'No timeline events for this range.'));
                return;
            }
            rows.forEach((event, index) => {
                const item = createEl('details', 'ai-timeline-event');
                item.dataset.tone = event.tone;
                if (index === 0) item.open = true;
                const summaryNode = createEl('summary');
                const marker = createEl('span', 'ai-timeline-marker');
                const copy = createEl('div');
                copy.append(createEl('b', '', event.title), createEl('small', '', `${formatTimelineDate(event.date)} - ${event.category}`));
                const confidence = AIUI.confidenceBadge ? AIUI.confidenceBadge(event.confidence) : createEl('em', '', event.confidence);
                summaryNode.append(marker, copy, confidence);
                const body = createEl('div', 'ai-timeline-event-body');
                [['What happened', event.what], ['Why it happened', event.why], ['Business impact', event.impact], ['Recommendation', event.recommendation]].forEach(([label, value]) => {
                    const row = createEl('p');
                    row.append(createEl('strong', '', label), createEl('span', '', value));
                    body.appendChild(row);
                });
                item.append(summaryNode, body);
                list.appendChild(item);
            });
        };

        controls.querySelectorAll('[data-timeline-range]').forEach((button) => {
            button.addEventListener('click', () => {
                controls.querySelectorAll('[data-timeline-range]').forEach((item) => item.classList.remove('active'));
                button.classList.add('active');
                custom.hidden = button.dataset.timelineRange !== 'custom';
                renderRows(button.dataset.timelineRange);
            });
        });
        custom.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => renderRows('custom')));
        renderRows('month');
        root.appendChild(panel);
    };

    const render = (payload = {}) => {
        const summary = payload.summary || {};
        const insights = payload.insights || payload.fallback || {};
        const health = role === 'admin' ? buildAdminHealth(summary) : buildMerchantHealth(summary);
        const fields = role === 'admin' ? adminFields(summary) : merchantFields(summary);
        const recommendations = recommendationsFrom(payload, summary, health);
        const overview = executiveOverview(summary, insights);

        const root = createEl('section', 'ai-executive-dashboard', '');
        root.dataset.aiExecutiveDashboard = 'ready';
        root.innerHTML = `
            <div class="ai-executive-header">
                <div>
                    <p class="eyebrow">${role === 'admin' ? 'AI Platform Executive Summary' : 'AI Business Executive Summary'}</p>
                    <h2>${role === 'admin' ? 'Platform Executive View' : 'Business Executive View'}</h2>
                    <span>${escapeHtml(overview)}</span>
                </div>
                <article class="ai-health-score-card">
                    <span>${role === 'admin' ? 'Platform Health' : 'Business Health'}</span>
                    <strong>${health.score} / 100</strong>
                    <small>${health.label} - ${health.risk}</small>
                    <button type="button" data-ai-score-explain>Why is my score ${health.score}?</button>
                </article>
            </div>
        `;

        if (isExecutiveReportPage) {
            const actions = createEl('div', 'ai-executive-report-actions');
            const back = createEl('a', 'button secondary', 'Back to dashboard');
            back.href = role === 'admin' ? '/admin/overview' : '/merchant/dashboard';
            const download = createEl('button', 'button primary', 'Download / Print');
            download.type = 'button';
            download.addEventListener('click', () => {
                const report = buildReport('monthly', payload);
                openPrintableReport({
                    ...report,
                    title: role === 'admin' ? 'Admin AI Platform Executive Summary' : 'Merchant AI Executive Summary',
                    overview
                }, false);
            });
            actions.append(back, download);
            root.appendChild(actions);
        }

        const grid = createEl('div', 'ai-executive-grid');
        fields.forEach(([label, value]) => {
            const card = createEl('article', 'ai-executive-metric');
            card.append(createEl('span', '', label), createEl('strong', '', value));
            grid.appendChild(card);
        });
        root.appendChild(grid);

        const lower = createEl('div', 'ai-executive-lower');
        const categoryCard = createEl('article', 'ai-executive-panel');
        categoryCard.innerHTML = '<h3>Health score breakdown</h3>';
        health.categories.forEach((category) => {
            const item = createEl('div', 'ai-health-category');
            item.innerHTML = `<div><strong>${category.name}</strong><span>${category.reason}</span></div><b>${category.score}</b><small>${category.weight}% weight</small>`;
            categoryCard.appendChild(item);
        });
        const recCard = createEl('article', 'ai-executive-panel');
        recCard.innerHTML = '<h3>Recommended focus</h3>';
        const list = createEl('ul');
        (recommendations.length ? recommendations : ['Keep monitoring this page as more data becomes available.']).forEach((item) => {
            const li = createEl('li', '', item);
            list.appendChild(li);
        });
        recCard.appendChild(list);
        lower.append(categoryCard, recCard);
        root.appendChild(lower);
        renderBusinessTimeline(root, payload, health, recommendations);
        renderOperationsIntelligence(root, payload);

        root.querySelector('[data-ai-score-explain]')?.addEventListener('click', () => explainScore(root, health));
        mount(root);
        renderWidgetInsights(payload);
        maybeGenerateDailyBrief(root, payload).then((dailyReport) => {
            renderReportPanel(root, dailyReport);
        }).catch(() => {
            renderReportPanel(root, null);
        });
    };

    const mount = (node) => {
        document.querySelector('[data-ai-executive-dashboard]')?.remove();
        const reportTarget = document.querySelector('[data-ai-executive-report-target]');
        const emptyState = document.querySelector('[data-ai-report-empty]');
        if (reportTarget) {
            if (emptyState) emptyState.hidden = true;
            reportTarget.replaceChildren(node);
            return;
        }
        const hero = document.querySelector('.merchant-dashboard-hero, .merchant-command-hero, .admin-dashboard-header, .admin-command-hero');
        if (hero) {
            hero.insertAdjacentElement('afterend', node);
            return;
        }
        const container = document.querySelector('main .page-container') || document.querySelector('main') || document.body;
        container.prepend(node);
    };

    const renderLoading = () => {
        const node = createEl('section', 'ai-executive-dashboard is-loading');
        node.dataset.aiExecutiveDashboard = 'loading';
        node.innerHTML = '<div class="ai-executive-header"><div><p class="eyebrow">AI Executive Summary</p><h2>Preparing executive view</h2></div></div>';
        node.appendChild(AIUI.loadingState
            ? AIUI.loadingState('Analysing current business signals from existing analytics.')
            : createEl('span', '', 'Analysing current business signals from existing analytics.'));
        mount(node);
    };

    const renderError = (message) => {
        const node = createEl('section', 'ai-executive-dashboard is-error');
        node.dataset.aiExecutiveDashboard = 'error';
        node.innerHTML = '<div class="ai-executive-header"><div><p class="eyebrow">AI Executive Summary</p><h2>Executive view unavailable</h2></div></div>';
        node.appendChild(AIUI.emptyState
            ? AIUI.emptyState('AI unavailable.', message || 'The executive summary could not be generated right now.')
            : createEl('span', '', message || 'The executive summary could not be generated right now.'));
        mount(node);
    };

    const fetchExecutive = async () => {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try {
                render(JSON.parse(cached));
                return;
            } catch (error) {
                sessionStorage.removeItem(cacheKey);
            }
        }

        renderLoading();
        const { response, payload } = await fetchAiJson(endpoint, { period });
        if (!response.ok && !payload.fallback) throw new Error(payload.message || 'Executive summary could not be generated.');
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));
        render(payload);
    };

    const explainScore = async (root, health) => {
        const button = root.querySelector('[data-ai-score-explain]');
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = 'Explaining...';
        try {
            const question = `Why is the ${role === 'admin' ? 'platform' : 'business'} health score ${health.score}? Explain positive factors, negative factors, and improvement suggestions. Category reasons: ${health.categories.map((item) => `${item.name} ${item.score}: ${item.reason}`).join('; ')}`;
            const { response, payload } = await fetchAiJson(role === 'admin' ? '/api/ai/admin/ask-analytics' : '/api/ai/merchant/ask-analytics', { period, question: question.slice(0, 500) });
            if (!response.ok && !payload.fallback) throw new Error(payload.message || 'Score explanation could not be generated.');
            const answer = payload.answer || payload.fallback || {};
            let box = root.querySelector('.ai-score-explanation');
            if (!box) {
                box = createEl('article', 'ai-score-explanation');
                root.appendChild(box);
            }
            box.innerHTML = `<h3>Score explanation</h3><p>${answer.answer || 'The score was calculated from the weighted category breakdown above.'}</p>`;
        } catch (error) {
            renderError(error.message);
        } finally {
            button.disabled = false;
            button.textContent = `Why is my score ${health.score}?`;
        }
    };

    const generateReportButton = document.querySelector('[data-ai-report-generate]');
    if (isExecutiveReportPage) {
        generateReportButton?.addEventListener('click', async () => {
            if (generateReportButton.disabled) return;
            generateReportButton.disabled = true;
            generateReportButton.textContent = 'Generating...';
            try {
                await fetchExecutive();
            } catch (error) {
                renderError(error.message);
            } finally {
                generateReportButton.disabled = false;
                generateReportButton.textContent = 'Regenerate report';
            }
        });
        return;
    }

    fetchExecutive().catch((error) => renderError(error.message));
})();
