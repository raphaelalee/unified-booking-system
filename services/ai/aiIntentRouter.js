const {
    normalizeAnalyticsQuestionIntent,
    parseAnalyticsComparisonQuestion,
    sanitizeAnalyticsQuestion
} = require('../analyticsAiDataService');

const MERCHANT_INTENTS = new Set([
    'merchant_revenue',
    'merchant_bookings',
    'merchant_booking_details',
    'merchant_refunds',
    'merchant_inventory',
    'merchant_products',
    'merchant_services',
    'merchant_customers',
    'merchant_ratings',
    'merchant_reviews',
    'merchant_wallet',
    'merchant_loyalty',
    'merchant_spin',
    'merchant_promotions',
    'merchant_vouchers',
    'merchant_analytics',
    'merchant_business_health',
    'merchant_daily_brief',
    'merchant_weekly_report',
    'merchant_monthly_report',
    'merchant_compare_periods',
    'merchant_business_timeline',
    'merchant_navigation',
    'merchant_help',
    'merchant_general_business_summary'
]);

const ADMIN_INTENTS = new Set([
    'admin_platform_revenue',
    'admin_merchants',
    'admin_merchant_details',
    'admin_customers',
    'admin_users',
    'admin_bookings',
    'admin_refunds',
    'admin_reviews',
    'admin_inventory',
    'admin_products',
    'admin_services',
    'admin_payments',
    'admin_spin',
    'admin_promotions',
    'admin_vouchers',
    'admin_platform_analytics',
    'admin_business_health',
    'admin_daily_brief',
    'admin_weekly_report',
    'admin_monthly_report',
    'admin_compare_periods',
    'admin_business_timeline',
    'admin_navigation',
    'admin_help',
    'admin_general_platform_summary'
]);

function normalizeAiInput(question = '') {
    const originalQuestion = String(question || '');
    const sanitized = sanitizeAnalyticsQuestion(originalQuestion, 500);
    const normalized = normalizeAnalyticsQuestionIntent(sanitized)
        .replace(/\bmnth\b/g, 'month')
        .replace(/\btdy\b/g, 'today')
        .replace(/\bytd\b/g, 'yesterday')
        .replace(/\bsvc\b/g, 'service')
        .replace(/\bprod\b/g, 'product')
        .replace(/\binv\b/g, 'inventory')
        .replace(/\brefund req\b/g, 'refund request')
        .replace(/\bspin wheel\b/g, 'spin')
        .replace(/\brevanue\b/g, 'revenue')
        .replace(/\bthis mth\b/g, 'this month')
        .replace(/\blast mth\b/g, 'last month')
        .replace(/\bappt\b/g, 'booking')
        .replace(/\bappts\b/g, 'bookings')
        .replace(/\bapptments\b/g, 'bookings')
        .replace(/\breserv\b/g, 'booking')
        .replace(/\bstok\b/g, 'stock')
        .replace(/\bstcok\b/g, 'stock')
        .replace(/\brefundd\b/g, 'refund')
        .replace(/\brefnd\b/g, 'refund')
        .replace(/\bprofit\b/g, 'revenue');

    return {
        originalQuestion,
        question: sanitized,
        normalized
    };
}

function extractEntities(normalized = '', previousContext = {}) {
    const entities = {};
    const periodAlias = [
        ['today', /\btoday\b/],
        ['yesterday', /\byesterday\b/],
        ['thisWeek', /\b(this|current)\s+week\b/],
        ['previousWeek', /\b(last|previous)\s+week\b/],
        ['thisMonth', /\b(this|current)\s+month\b/],
        ['previousMonth', /\b(last|previous)\s+month\b/],
        ['currentYear', /\b(this|current)\s+year\b/]
    ].find(([, pattern]) => pattern.test(normalized));

    if (periodAlias) entities.period = periodAlias[0];

    const explicitPeriod = String(previousContext.period || '');
    if (!entities.period && /\b(what about|compare it|same|that|those|it|previous one|last one)\b/.test(normalized) && explicitPeriod) {
        entities.period = explicitPeriod;
    }

    const merchantMatch = normalized.match(/\bmerchant\s*(?:id|#)?\s*(\d+)\b/);
    if (merchantMatch) entities.merchantId = Number(merchantMatch[1]);

    const bookingMatch = normalized.match(/\bbooking\s*(?:id|#)?\s*(\d+)\b/);
    if (bookingMatch) entities.bookingId = Number(bookingMatch[1]);

    const orderMatch = normalized.match(/\b(?:order|transaction)\s*(?:id|#)?\s*([a-z0-9-]+)\b/i);
    if (orderMatch) entities.orderReference = orderMatch[1];

    const refundMatch = normalized.match(/\brefund\s*(?:id|#)?\s*(\d+)\b/);
    if (refundMatch) entities.refundId = Number(refundMatch[1]);

    const statusMatch = normalized.match(/\b(pending|completed|cancelled|canceled|approved|rejected|processing|refunded|failed)\b/);
    if (statusMatch) entities.status = statusMatch[1] === 'canceled' ? 'cancelled' : statusMatch[1];

    const serviceMatch = normalized.match(/\b(?:service|services)\s+(?:called|named)?\s*([a-z0-9][a-z0-9 &'/-]{1,50})\b/i);
    if (serviceMatch) entities.serviceName = serviceMatch[1].trim();

    const productMatch = normalized.match(/\b(?:product|products|stock|inventory)\s+(?:called|named)?\s*([a-z0-9][a-z0-9 &'/-]{1,50})\b/i);
    if (productMatch) entities.productName = productMatch[1].trim();

    return entities;
}

function detectTopicIntents(role, normalized = '') {
    const prefix = role === 'admin' ? 'admin' : 'merchant';
    const topics = [];
    const add = (topic, pattern) => {
        if (pattern.test(normalized) && !topics.includes(topic)) topics.push(topic);
    };

    add('revenue', /\b(revenue|sales|earning|earnings|income|paid transaction|transaction sales|turnover|money made|profit)\b/);
    add('bookings', /\b(booking|bookings|appointment|appointments|reservation|reservations|schedule demand|pending booking|completed booking)\b/);
    add('refunds', /\b(refund|refunds|return|returns|repayment|repayments|cancellation|cancelled|canceled)\b/);
    add('inventory', /\b(inventory|stock|restock|low stock|quantity)\b/);
    add('products', /\b(product|products|order|orders|units sold|item|items|top product|best product|weak product|worst product)\b/);
    add('services', /\b(service|services|top service|best service|weak service|worst service)\b/);
    add('customers', /\b(customer|customers|user|users|repeat customer|active customer|new customer)\b/);
    add('ratings', /\b(rating|ratings|review|reviews|satisfaction)\b/);
    add('payments', /\b(payment|payments|method|provider|transaction)\b/);
    add('spin', /\b(spin|wheel|spin discover|redemption|reward popular)\b/);
    add('promotions', /\b(promotion|promotions|campaign|voucher|vouchers)\b/);
    add('business_health', /\b(health|biggest problem|attention|focus|what should|priority)\b/);
    if (role === 'admin') add('merchants', /\b(merchant|merchants|salon|salons|business|businesses|approval|approvals)\b/);

    return topics.map((topic) => {
        if (role === 'admin') {
            if (topic === 'revenue') return 'admin_platform_revenue';
            if (topic === 'ratings') return 'admin_reviews';
            if (topic === 'business_health') return 'admin_business_health';
            return `admin_${topic}`;
        }
        if (topic === 'ratings') return 'merchant_ratings';
        if (topic === 'business_health') return 'merchant_business_health';
        return `merchant_${topic}`;
    });
}

function isFollowUpQuestion(normalized = '') {
    return /^(why|how|what about|which one|tell me more|explain|so what|and then|what should i do|why is that|why\?)\??$/.test(normalized)
        || normalized.length <= 22 && /\b(why|how|more|explain|what about|same|that|it|those)\b/.test(normalized);
}

function periodForAnalytics(entities = {}, fallback = 'last30') {
    if (entities.period === 'thisMonth') return 'thisMonth';
    if (entities.period === 'previousMonth') return 'previousMonth';
    if (entities.period === 'currentYear') return 'currentYear';
    if (entities.period === 'thisWeek' || entities.period === 'previousWeek') return 'last7';
    if (entities.period === 'today' || entities.period === 'yesterday') return 'last7';
    return fallback || 'last30';
}

function detectIntentForRole(role, normalized, entities, previousContext = {}) {
    const prefix = role === 'admin' ? 'admin' : 'merchant';
    const comparison = parseAnalyticsComparisonQuestion(normalized);
    const topicIntents = detectTopicIntents(role, normalized);
    const hasNavigationVerb = /\b(open|go to|navigate|take me to|show page|manage)\b/.test(normalized);

    if (/^\/?help\b|\bwhat can you do\b/.test(normalized)) {
        return { intent: `${prefix}_help`, confidence: 0.98, requiresData: false };
    }

    if (hasNavigationVerb && topicIntents.length <= 1 && !/\b(and|with|plus|tell me|how many|summari[sz]e|explain)\b/.test(normalized)) {
        return { intent: `${prefix}_navigation`, confidence: 0.92, requiresData: false, requiresNavigation: true };
    }

    if (role === 'admin'
        && /\b(merchant|merchants|salon|salons)\b/.test(normalized)
        && /\b(revenue|sales|earning|earnings|highest|top|most|largest|best|approval|approvals)\b/.test(normalized)) {
        return {
            intent: entities.merchantId ? 'admin_merchant_details' : 'admin_merchants',
            confidence: 0.94,
            requiresData: true
        };
    }

    if (comparison || /\b(compare|vs|versus|against)\b/.test(normalized)) {
        return {
            intent: `${prefix}_compare_periods`,
            confidence: comparison ? 0.96 : 0.75,
            requiresData: true,
            multiIntents: topicIntents
        };
    }

    const continued = isFollowUpQuestion(normalized) && previousContext.intent;
    if (continued) {
        return {
            intent: previousContext.intent,
            confidence: 0.76,
            requiresData: true,
            followUp: true
        };
    }

    const checks = [
        [/(\brevenue\b|\bsales\b|\bearnings?\b|\bincome\b|\bpaid transaction\b)/, role === 'admin' ? 'admin_platform_revenue' : 'merchant_revenue'],
        [/(\bbooking\b|\bbookings\b|\bappointment\b|\bappointments\b|\bschedule demand\b)/, role === 'admin' ? 'admin_bookings' : 'merchant_bookings'],
        [/(\brefund\b|\brefunds\b|\breturn\b|\breturns\b|\bcancellation\b|\bcancelled\b)/, role === 'admin' ? 'admin_refunds' : 'merchant_refunds'],
        [/(\binventory\b|\bstock\b|\brestock\b|\blow stock\b|\bquantity\b)/, role === 'admin' ? 'admin_inventory' : 'merchant_inventory'],
        [/(\bproduct\b|\bproducts\b|\border\b|\borders\b|\bunits sold\b)/, role === 'admin' ? 'admin_products' : 'merchant_products'],
        [/(\bservice\b|\bservices\b|\bcompleted service\b)/, role === 'admin' ? 'admin_services' : 'merchant_services'],
        [/(\bcustomer\b|\bcustomers\b|\brepeat customer\b|\bactive customer\b|\bnew customer\b)/, role === 'admin' ? 'admin_customers' : 'merchant_customers'],
        [/(\brating\b|\bratings\b|\breview\b|\breviews\b|\bsatisfaction\b)/, role === 'admin' ? 'admin_reviews' : 'merchant_ratings'],
        [/(\bpayment\b|\bpayments\b|\bmethod\b|\bprovider\b|\btransaction\b)/, role === 'admin' ? 'admin_payments' : 'merchant_analytics'],
        [/(\bspin\b|\bwheel\b|\bspin discover\b|\bredemption\b|\breward popular\b)/, role === 'admin' ? 'admin_spin' : 'merchant_spin'],
        [/(\bloyalty\b|\bpoints\b|\breward points\b)/, role === 'admin' ? 'admin_platform_analytics' : 'merchant_loyalty'],
        [/(\bcashback\b)/, role === 'admin' ? 'admin_platform_analytics' : 'merchant_loyalty'],
        [/(\bpromotion\b|\bpromotions\b|\bcampaign\b)/, role === 'admin' ? 'admin_promotions' : 'merchant_promotions'],
        [/(\bvoucher\b|\bvouchers\b)/, role === 'admin' ? 'admin_vouchers' : 'merchant_vouchers'],
        [/(\bwallet\b|\bpayout\b|\btake home\b|\bnet revenue\b|\bretained\b)/, role === 'admin' ? 'admin_platform_analytics' : 'merchant_wallet'],
        [/(\bmerchant\b|\bmerchants\b|\bsalon\b|\bsalons\b|\bapproval\b)/, role === 'admin' ? (entities.merchantId ? 'admin_merchant_details' : 'admin_merchants') : 'merchant_analytics'],
        [/(\bhealth\b|\bbiggest problem\b|\battention\b|\bfocus\b|\bwhat should\b|\bpriority\b)/, role === 'admin' ? 'admin_business_health' : 'merchant_business_health'],
        [/(\bdaily brief\b|\bsummarise today\b|\bsummarize today\b|\btoday summary\b)/, role === 'admin' ? 'admin_daily_brief' : 'merchant_daily_brief'],
        [/(\bweekly report\b|\bthis week report\b)/, role === 'admin' ? 'admin_weekly_report' : 'merchant_weekly_report'],
        [/(\bmonthly report\b|\bthis month report\b)/, role === 'admin' ? 'admin_monthly_report' : 'merchant_monthly_report'],
        [/(\btimeline\b|\bwhat happened\b|\bbusiness events\b)/, role === 'admin' ? 'admin_business_timeline' : 'merchant_business_timeline']
    ];

    const match = checks.find(([pattern]) => pattern.test(normalized));
    if (match) {
        return {
            intent: match[1],
            confidence: 0.9,
            requiresData: true,
            multiIntents: topicIntents
        };
    }

    return {
        intent: role === 'admin' ? 'admin_general_platform_summary' : 'merchant_general_business_summary',
        confidence: 0.58,
        requiresData: true
    };
}

function detectAiIntent({ role, question, previousContext = {}, fallbackPeriod = 'last30' }) {
    const input = normalizeAiInput(question);
    const entities = {
        ...extractEntities(input.normalized, previousContext)
    };
    const detected = detectIntentForRole(role, input.normalized, entities, previousContext);
    const supported = role === 'admin' ? ADMIN_INTENTS : MERCHANT_INTENTS;
    const intent = supported.has(detected.intent)
        ? detected.intent
        : role === 'admin' ? 'admin_general_platform_summary' : 'merchant_general_business_summary';

    return {
        ...input,
        intent,
        confidence: detected.confidence,
        entities: {
            ...entities,
            multiIntents: (detected.multiIntents || []).filter((candidate) => supported.has(candidate)),
            analyticsPeriod: periodForAnalytics(entities, fallbackPeriod)
        },
        requiresData: detected.requiresData !== false,
        requiresNavigation: Boolean(detected.requiresNavigation),
        followUp: Boolean(detected.followUp)
    };
}

module.exports = {
    ADMIN_INTENTS,
    MERCHANT_INTENTS,
    detectAiIntent,
    extractEntities,
    isFollowUpQuestion,
    normalizeAiInput,
    periodForAnalytics
};
