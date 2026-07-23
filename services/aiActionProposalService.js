const crypto = require('crypto');
const db = require('../db');
const AuditLog = require('../models/AuditLog');
const MerchantService = require('../models/MerchantService');
const Product = require('../models/Product');
const Promotion = require('../models/Promotion');
const { buildMerchantAnalyticsSummary, roundMoney, sanitizeAnalyticsQuestion } = require('./analyticsAiDataService');

const ACTION_RISK_LEVELS = new Set([
    'recommend_only',
    'prepare_for_confirmation',
    'execute_after_confirmation',
    'restricted_admin_confirmation'
]);

const MERCHANT_CONFIRM_ACTIONS = new Set([
    'create_promotion',
    'change_service_price',
    'adjust_inventory',
    'create_reminder'
]);

const MERCHANT_RECOMMEND_ONLY_ACTIONS = new Set([
    'recommend_refund_decision',
    'recommend_schedule_change',
    'recommend_price_change',
    'recommend_inventory_change',
    'recommend_promotion'
]);

const ADMIN_RECOMMENDATION_ACTIONS = new Set([
    'recommend_merchant_review',
    'recommend_merchant_suspension_review',
    'recommend_platform_action'
]);

const ALL_ACTION_TYPES = new Set([
    ...MERCHANT_CONFIRM_ACTIONS,
    ...MERCHANT_RECOMMEND_ONLY_ACTIONS,
    ...ADMIN_RECOMMENDATION_ACTIONS,
    'update_schedule'
]);

const REMINDER_CATEGORIES = new Set(['schedule', 'booking', 'refund', 'inventory', 'review', 'revenue', 'promotion', 'support']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const REFUND_RECOMMENDATIONS = new Set(['approve', 'partial_refund', 'request_more_information', 'reject', 'manual_review', 'full_refund']);
const PARTIAL_REFUND_PRESETS = new Set([25, 50, 75]);
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const MAX_PRICE_CHANGE_PERCENT = 20;

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

function callbackToPromise(fn) {
    return new Promise((resolve, reject) => {
        fn((error, result) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        });
    });
}

function cleanText(value, maxLength = 300) {
    return String(value || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\x00-\x1F\x7F]/g, ' ')
        .replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/gi, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function cleanList(value, limit = 5, maxLength = 180) {
    return (Array.isArray(value) ? value : [])
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean)
        .slice(0, limit);
}

function cleanPlainObject(value = {}, allowedKeys = []) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const output = {};

    allowedKeys.forEach((key) => {
        if (source[key] !== undefined) {
            output[key] = source[key];
        }
    });

    return output;
}

function normalizeMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) ? roundMoney(number) : null;
}

function normalizeInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
}

function normalizeDateKey(value) {
    const raw = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function normalizeActionProposal(input = {}, context = {}) {
    const actionType = cleanText(input.actionType, 80);

    if (!ALL_ACTION_TYPES.has(actionType)) {
        const error = new Error('Unknown AI action type.');
        error.status = 400;
        error.code = 'UNKNOWN_ACTION_TYPE';
        throw error;
    }

    let riskLevel = cleanText(input.riskLevel, 80);
    if (!ACTION_RISK_LEVELS.has(riskLevel)) {
        riskLevel = MERCHANT_CONFIRM_ACTIONS.has(actionType) || actionType === 'update_schedule'
            ? 'prepare_for_confirmation'
            : 'recommend_only';
    }

    if (MERCHANT_RECOMMEND_ONLY_ACTIONS.has(actionType) && riskLevel !== 'recommend_only') {
        riskLevel = 'recommend_only';
    }

    if (ADMIN_RECOMMENDATION_ACTIONS.has(actionType) && riskLevel !== 'restricted_admin_confirmation') {
        riskLevel = 'restricted_admin_confirmation';
    }

    const proposal = {
        actionType,
        riskLevel,
        title: cleanText(input.title, 140) || 'AI action proposal',
        reason: cleanText(input.reason, 500),
        evidence: cleanList(input.evidence, 5, 220),
        currentState: {},
        proposedState: {},
        warnings: cleanList(input.warnings, 5, 220),
        requiresConfirmation: riskLevel !== 'recommend_only'
    };

    if (actionType === 'change_service_price') {
        const current = cleanPlainObject(input.currentState, ['serviceId', 'serviceName', 'price']);
        const proposed = cleanPlainObject(input.proposedState, ['price']);
        proposal.currentState = {
            serviceId: normalizeInteger(current.serviceId),
            serviceName: cleanText(current.serviceName, 120),
            price: normalizeMoney(current.price)
        };
        proposal.proposedState = {
            price: normalizeMoney(proposed.price)
        };
    } else if (actionType === 'create_promotion') {
        const proposed = cleanPlainObject(input.proposedState, [
            'promotionName',
            'discountType',
            'discountValue',
            'startDate',
            'endDate',
            'serviceIds',
            'productIds'
        ]);
        proposal.proposedState = {
            promotionName: cleanText(proposed.promotionName, 120),
            discountType: ['percentage', 'fixed_amount', 'fixed_price', 'tag_only'].includes(proposed.discountType) ? proposed.discountType : 'percentage',
            discountValue: normalizeMoney(proposed.discountValue) || 10,
            startDate: normalizeDateKey(proposed.startDate),
            endDate: normalizeDateKey(proposed.endDate),
            serviceIds: (Array.isArray(proposed.serviceIds) ? proposed.serviceIds : []).map(normalizeInteger).filter(Boolean).slice(0, 5),
            productIds: (Array.isArray(proposed.productIds) ? proposed.productIds : []).map(normalizeInteger).filter(Boolean).slice(0, 5)
        };
        proposal.currentState = cleanPlainObject(input.currentState, ['quietestDay', 'averageBookings']);
    } else if (actionType === 'adjust_inventory') {
        const current = cleanPlainObject(input.currentState, ['productId', 'productName', 'stock']);
        const proposed = cleanPlainObject(input.proposedState, ['stockAdjustment', 'newStock', 'recommendationType']);
        proposal.currentState = {
            productId: normalizeInteger(current.productId),
            productName: cleanText(current.productName, 120),
            stock: normalizeInteger(current.stock)
        };
        proposal.proposedState = {
            stockAdjustment: normalizeInteger(proposed.stockAdjustment),
            newStock: normalizeInteger(proposed.newStock),
            recommendationType: ['restock_reminder', 'inventory_adjustment', 'purchase_recommendation'].includes(proposed.recommendationType)
                ? proposed.recommendationType
                : 'inventory_adjustment'
        };
    } else if (actionType === 'create_reminder') {
        const proposed = cleanPlainObject(input.proposedState, ['message', 'scheduleType', 'dayOfWeek', 'time', 'scheduledAt', 'timezone', 'category', 'priority']);
        proposal.proposedState = {
            message: cleanText(proposed.message, 220),
            scheduleType: ['once', 'daily', 'weekly'].includes(proposed.scheduleType) ? proposed.scheduleType : 'once',
            dayOfWeek: cleanText(proposed.dayOfWeek, 20).toLowerCase(),
            time: normalizeTime(proposed.time) || '09:00',
            scheduledAt: cleanText(proposed.scheduledAt, 40),
            timezone: 'Asia/Singapore',
            category: REMINDER_CATEGORIES.has(proposed.category) ? proposed.category : 'support',
            priority: PRIORITIES.has(proposed.priority) ? proposed.priority : 'medium'
        };
    } else if (actionType === 'recommend_refund_decision') {
        const proposed = cleanPlainObject(input.proposedState, ['recommendation', 'suggestedPercentage']);
        const percentage = normalizeInteger(proposed.suggestedPercentage);
        proposal.proposedState = {
            recommendation: REFUND_RECOMMENDATIONS.has(proposed.recommendation) ? proposed.recommendation : 'manual_review',
            suggestedPercentage: PARTIAL_REFUND_PRESETS.has(percentage) ? percentage : null
        };
        proposal.requiresConfirmation = true;
    } else if (actionType === 'update_schedule' || actionType === 'recommend_schedule_change') {
        proposal.currentState = cleanPlainObject(input.currentState, ['day', 'openingTime', 'closingTime']);
        proposal.proposedState = {
            day: cleanText(input.proposedState?.day || input.day, 20),
            action: cleanText(input.proposedState?.action || input.action, 80),
            openingTime: normalizeTime(input.proposedState?.openingTime),
            closingTime: normalizeTime(input.proposedState?.closingTime),
            timezone: 'Asia/Singapore'
        };
        if (actionType === 'recommend_schedule_change') {
            proposal.requiresConfirmation = false;
        }
    }

    proposal.recordAllowlist = context.recordAllowlist || {};
    validateProposalRecordAllowlist(proposal, context.recordAllowlist || {});

    return proposal;
}

function validateProposalRecordAllowlist(proposal, allowlist = {}) {
    const services = new Set((allowlist.services || []).map((service) => Number(service.serviceId)));
    const products = new Set((allowlist.products || []).map((product) => Number(product.productId)));

    if (proposal.actionType === 'change_service_price' && !services.has(Number(proposal.currentState.serviceId))) {
        const error = new Error('The proposed service was not in the supplied merchant allowlist.');
        error.status = 400;
        error.code = 'SERVICE_NOT_ALLOWED';
        throw error;
    }

    if (proposal.actionType === 'create_promotion') {
        const serviceIds = proposal.proposedState.serviceIds || [];
        const productIds = proposal.proposedState.productIds || [];
        if (serviceIds.some((id) => !services.has(Number(id))) || productIds.some((id) => !products.has(Number(id)))) {
            const error = new Error('The proposed promotion targets records outside the merchant allowlist.');
            error.status = 400;
            error.code = 'PROMOTION_TARGET_NOT_ALLOWED';
            throw error;
        }
    }

    if (proposal.actionType === 'adjust_inventory' && !products.has(Number(proposal.currentState.productId))) {
        const error = new Error('The proposed product was not in the supplied merchant allowlist.');
        error.status = 400;
        error.code = 'PRODUCT_NOT_ALLOWED';
        throw error;
    }
}

async function buildMerchantActionContext(userId, period = 'last30') {
    const [analytics, products] = await Promise.all([
        buildMerchantAnalyticsSummary(userId, period),
        query(`
            SELECT p.product_id AS productId, p.name, p.price, p.stock_quantity AS stockQuantity
            FROM products p
            INNER JOIN salons s ON s.salon_id = p.salon_id
            WHERE s.merchant_id = ?
            ORDER BY p.stock_quantity ASC, p.product_id DESC
        `, [userId])
    ]);

    const services = (analytics.topServicesByRevenue || [])
        .concat(analytics.lowestPerformingServices || [])
        .reduce((map, row) => {
            const source = (analytics.recordServices || []).find((service) => service.name === row.serviceName);
            if (source) map.set(source.serviceId, source);
            return map;
        }, new Map());

    const recordServices = await query(`
        SELECT svc.service_id AS serviceId, svc.service_name AS name, svc.price, svc.duration_mins AS durationMins
        FROM services svc
        INNER JOIN salons s ON s.salon_id = svc.salon_id
        WHERE s.merchant_id = ?
        ORDER BY svc.service_id
    `, [userId]);

    recordServices.forEach((service) => {
        services.set(Number(service.serviceId), {
            serviceId: Number(service.serviceId),
            name: service.name,
            price: roundMoney(service.price),
            durationMins: Number(service.durationMins || 0)
        });
    });

    return {
        analytics,
        recordAllowlist: {
            services: Array.from(services.values()).slice(0, 30),
            products: products.map((product) => ({
                productId: Number(product.productId),
                name: product.name,
                price: roundMoney(product.price),
                stockQuantity: Number(product.stockQuantity || 0)
            })).slice(0, 30)
        }
    };
}

function chooseQuietestDay(analytics = {}) {
    const row = (analytics.leastBusyBookingDays || [])[0];
    return row?.day || 'Tuesday';
}

function chooseTopService(context = {}) {
    const allowServices = context.recordAllowlist?.services || [];
    return allowServices[0] || null;
}

function chooseLowestStockProduct(context = {}) {
    return (context.recordAllowlist?.products || []).slice().sort((a, b) => Number(a.stockQuantity) - Number(b.stockQuantity))[0] || null;
}

function nextDateForDay(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const target = days.indexOf(String(dayName || '').toLowerCase());
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const toDateKey = (date) => {
        const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const todayKey = toDateKey(new Date());
    const today = new Date(`${todayKey}T00:00:00+08:00`);
    const current = today.getDay();
    const offset = target >= 0 ? ((target - current + 7) % 7 || 7) : 7;
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return toDateKey(date);
}

function buildDeterministicMerchantProposal(prompt, context) {
    const text = sanitizeAnalyticsQuestion(prompt, 500).toLowerCase();
    const analytics = context.analytics || {};

    if (/\b(refund|return|damaged|defective)\b/.test(text)) {
        return normalizeActionProposal({
            actionType: 'recommend_refund_decision',
            riskLevel: 'recommend_only',
            title: 'Review Refund Request Carefully',
            reason: 'Refund decisions must remain with the merchant and should use the existing refund review workflow.',
            evidence: [`Pending refund requests: ${analytics.metrics?.refundCount || 0}`],
            proposedState: {
                recommendation: 'manual_review'
            },
            warnings: ['AI cannot approve, reject or process refunds.', 'Use the merchant refund review page for the final decision.'],
            requiresConfirmation: true
        }, context);
    }

    if (/\b(remind|reminder)\b/.test(text)) {
        const weekly = /\bevery\s+monday\b/i.test(prompt);
        return normalizeActionProposal({
            actionType: 'create_reminder',
            riskLevel: 'prepare_for_confirmation',
            title: weekly ? 'Weekly inventory review reminder' : 'Merchant reminder',
            reason: 'The merchant asked AI to prepare a reminder.',
            evidence: ['Reminder text came from the merchant request.'],
            proposedState: {
                message: cleanText(prompt.replace(/^remind me/i, ''), 200) || 'Review business tasks.',
                scheduleType: weekly ? 'weekly' : 'once',
                dayOfWeek: weekly ? 'monday' : '',
                time: /\b9\s*(am|AM)\b/.test(prompt) ? '09:00' : '09:00',
                timezone: 'Asia/Singapore',
                category: 'support',
                priority: 'medium'
            },
            warnings: ['Reminder delivery uses the merchant dashboard reminder centre in this implementation.']
        }, context);
    }

    if (/\b(spin|wheel|reward|voucher|cashback|redemption|conversion|claim\s+limit|campaign|popular|replace)\b/.test(text)) {
        const evidence = cleanList([
            prompt.match(/Spin data:[^.]+\./i)?.[0],
            prompt.match(/Most won:[^.]+\./i)?.[0],
            prompt.match(/Weak redemption:[^.]+\./i)?.[0],
            prompt.match(/Limit\/inventory issues:[^.]+\./i)?.[0],
            prompt.match(/Selected rewards:[^.]+\./i)?.[0]
        ], 5, 220);

        return normalizeActionProposal({
            actionType: 'recommend_promotion',
            riskLevel: 'recommend_only',
            title: 'Review Spin & Discover Rewards',
            reason: 'AI reviewed the current wheel signals and prepared a recommendation for merchant review only.',
            evidence: evidence.length ? evidence : ['Review wins, redemptions, inventory, claim limits and conversion before changing wheel rewards.'],
            proposedState: {
                recommendation: 'review_spin_rewards'
            },
            warnings: [
                'AI cannot automatically add, remove or edit Spin & Discover rewards.',
                'Apply any voucher, cashback, promotion or inventory changes through the existing merchant controls.'
            ],
            requiresConfirmation: false
        }, context);
    }

    if (/\b(price|pricing|charge)\b/.test(text)) {
        const service = chooseTopService(context);
        if (!service) throw createNoDataError('No merchant service is available for a price proposal.');
        const currentPrice = roundMoney(service.price);
        const suggestedPrice = roundMoney(currentPrice * 1.05);
        return normalizeActionProposal({
            actionType: 'change_service_price',
            riskLevel: 'prepare_for_confirmation',
            title: `Review ${service.name} Price`,
            reason: 'AI prepared a conservative price review based on merchant service performance.',
            evidence: [`Current service price: S$${currentPrice.toFixed(2)}`, `Maximum AI-assisted change without manual editing: ${MAX_PRICE_CHANGE_PERCENT}%`],
            currentState: { serviceId: service.serviceId, serviceName: service.name, price: currentPrice },
            proposedState: { price: suggestedPrice },
            warnings: ['A price change may affect future booking conversion.']
        }, context);
    }

    if (/\b(stock|inventory|restock|product)\b/.test(text)) {
        const product = chooseLowestStockProduct(context);
        if (!product) throw createNoDataError('No merchant product is available for an inventory proposal.');
        const adjustment = product.stockQuantity <= 5 ? 10 : 5;
        return normalizeActionProposal({
            actionType: 'adjust_inventory',
            riskLevel: 'prepare_for_confirmation',
            title: `Review ${product.name} Stock`,
            reason: 'AI identified a stock review opportunity from current merchant inventory.',
            evidence: [`Current stock: ${product.stockQuantity}`],
            currentState: { productId: product.productId, productName: product.name, stock: product.stockQuantity },
            proposedState: { stockAdjustment: adjustment, newStock: product.stockQuantity + adjustment, recommendationType: 'inventory_adjustment' },
            warnings: ['Confirm physical stock has arrived before applying an inventory adjustment.']
        }, context);
    }

    if (/\b(schedule|hours|slot|capacity)\b/.test(text)) {
        const day = (analytics.busiestBookingDays || [])[0]?.day || 'Saturday';
        return normalizeActionProposal({
            actionType: 'recommend_schedule_change',
            riskLevel: 'recommend_only',
            title: `Review ${day} Schedule Capacity`,
            reason: 'AI found a schedule optimisation opportunity from booking patterns.',
            evidence: (analytics.busiestBookingDays || []).map((row) => `${row.day}: ${row.bookings} bookings`),
            proposedState: { day, action: 'review_capacity', timezone: 'Asia/Singapore' },
            warnings: ['Schedule changes are proposal-only here and must be applied through the existing schedule tools.']
        }, context);
    }

    const quietestDay = chooseQuietestDay(analytics);
    const service = chooseTopService(context);
    return normalizeActionProposal({
        actionType: 'create_promotion',
        riskLevel: 'prepare_for_confirmation',
        title: `${quietestDay} Promotion Draft`,
        reason: 'AI prepared a promotion draft for a low-demand period.',
        evidence: [`Quietest day: ${quietestDay}`],
        currentState: { quietestDay },
        proposedState: {
            promotionName: `${quietestDay} ${service?.name || 'Service'} Special`,
            discountType: 'percentage',
            discountValue: 10,
            startDate: nextDateForDay(quietestDay),
            endDate: nextDateForDay(quietestDay),
            serviceIds: service ? [service.serviceId] : []
        },
        warnings: ['Confirm available appointment capacity before activation.']
    }, context);
}

function createNoDataError(message) {
    const error = new Error(message);
    error.status = 400;
    error.code = 'INSUFFICIENT_DATA';
    return error;
}

function ensureProposalStore(req) {
    if (!req.session.aiActionProposals) {
        req.session.aiActionProposals = {};
    }
    return req.session.aiActionProposals;
}

function storeProposal(req, proposal) {
    const proposalId = crypto.randomUUID();
    const stored = {
        ...proposal,
        proposalId,
        actorUserId: req.session.user.id,
        actorRole: req.session.user.role,
        expiresAt: Date.now() + PROPOSAL_TTL_MS,
        createdAt: new Date().toISOString(),
        used: false
    };

    ensureProposalStore(req)[proposalId] = stored;
    return stored;
}

function getStoredProposal(req, proposalId, actionType) {
    const proposal = ensureProposalStore(req)[proposalId];

    if (!proposal || proposal.actorUserId !== req.session.user.id || proposal.actionType !== actionType) {
        const error = new Error('AI proposal could not be verified. Please generate a new suggestion.');
        error.status = 400;
        error.code = 'PROPOSAL_NOT_FOUND';
        throw error;
    }

    if (proposal.used || Date.now() > Number(proposal.expiresAt || 0)) {
        const error = new Error('This AI proposal expired or was already used. Please generate a new suggestion.');
        error.status = 409;
        error.code = 'PROPOSAL_EXPIRED';
        throw error;
    }

    return proposal;
}

async function createMerchantActionProposal(req, prompt, period) {
    const context = await buildMerchantActionContext(req.session.user.id, period);
    const proposal = buildDeterministicMerchantProposal(prompt, context);
    return storeProposal(req, proposal);
}

async function createMerchantScheduleRecommendations(req, period) {
    const context = await buildMerchantActionContext(req.session.user.id, period);
    const proposal = buildDeterministicMerchantProposal('schedule recommendations', context);
    return {
        summary: proposal.reason,
        recommendations: [storeProposal(req, proposal)]
    };
}

async function buildSmartReminders(userId, period = 'last30', existingDismissed = {}) {
    const context = await buildMerchantActionContext(userId, period);
    const analytics = context.analytics;
    const reminders = [];

    const add = (reminder) => {
        const id = `smart-${reminder.category}-${crypto.createHash('sha1').update(JSON.stringify(reminder.evidence || [])).digest('hex').slice(0, 10)}`;
        if (existingDismissed[id]) return;
        reminders.push({
            id,
            category: reminder.category,
            priority: reminder.priority,
            title: reminder.title,
            message: reminder.message,
            evidence: reminder.evidence || [],
            recommendedAction: reminder.recommendedAction || null,
            dueAt: reminder.dueAt || null,
            dismissible: true,
            source: 'smart_rule'
        });
    };

    if (analytics.metrics?.refundCount > 0) {
        add({
            category: 'refund',
            priority: 'high',
            title: 'Refund requests need review',
            message: `${analytics.metrics.refundCount} refund request${analytics.metrics.refundCount === 1 ? '' : 's'} appear in the selected period.`,
            evidence: [`Refund count: ${analytics.metrics.refundCount}`],
            recommendedAction: { actionType: 'recommend_refund_decision', label: 'Review Refund Requests', href: '/merchant/support' }
        });
    }

    (context.recordAllowlist.products || []).filter((product) => Number(product.stockQuantity) <= 5).slice(0, 3).forEach((product) => {
        add({
            category: 'inventory',
            priority: Number(product.stockQuantity) <= 0 ? 'high' : 'medium',
            title: 'Low stock requires attention',
            message: `${product.name} has ${product.stockQuantity} unit${product.stockQuantity === 1 ? '' : 's'} remaining.`,
            evidence: [`Current stock: ${product.stockQuantity}`],
            recommendedAction: { actionType: 'adjust_inventory', label: 'Review Inventory', href: '/merchant/products' }
        });
    });

    if (analytics.metrics?.lowRatedReviews > 0) {
        add({
            category: 'review',
            priority: 'medium',
            title: 'Low-rated reviews need attention',
            message: `${analytics.metrics.lowRatedReviews} low-rated review${analytics.metrics.lowRatedReviews === 1 ? '' : 's'} appear in the selected period.`,
            evidence: [`Low-rated reviews: ${analytics.metrics.lowRatedReviews}`],
            recommendedAction: { actionType: 'review_reply', label: 'Reply to Review', href: '/merchant/support' }
        });
    }

    if (analytics.metrics?.revenueChange?.value !== null && Number(analytics.metrics.revenueChange.value) <= -10) {
        add({
            category: 'revenue',
            priority: 'medium',
            title: 'Revenue decline to review',
            message: `Revenue is ${Math.abs(Number(analytics.metrics.revenueChange.value))}% lower than the comparison period.`,
            evidence: [`Revenue change: ${analytics.metrics.revenueChange.label}`],
            recommendedAction: { actionType: 'recommend_promotion', label: 'Create Promotion', href: '/merchant/promotions/new' }
        });
    }

    if ((analytics.leastBusyBookingDays || []).length > 0) {
        const quiet = analytics.leastBusyBookingDays[0];
        add({
            category: 'promotion',
            priority: 'low',
            title: 'Quiet-day promotion opportunity',
            message: `${quiet.day} has the lowest booking volume in the selected period.`,
            evidence: [`${quiet.day}: ${quiet.bookings} bookings`],
            recommendedAction: { actionType: 'create_promotion', label: 'Create Promotion', href: '/merchant/promotions/new' }
        });
    }

    return reminders;
}

function parseReminderRequest(prompt) {
    const text = sanitizeAnalyticsQuestion(prompt, 500);
    const weeklyMatch = text.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    let time = '09:00';

    if (timeMatch) {
        let hours = Number(timeMatch[1]);
        const minutes = Number(timeMatch[2] || 0);
        const meridiem = timeMatch[3].toLowerCase();
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
        time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    return {
        actionType: 'create_reminder',
        riskLevel: 'prepare_for_confirmation',
        title: weeklyMatch ? `Weekly ${weeklyMatch[1].toLowerCase()} reminder` : 'Merchant reminder',
        reason: 'The merchant asked AI to prepare this reminder.',
        evidence: ['Parsed from merchant reminder request.'],
        proposedState: {
            message: text.replace(/^remind me\s*/i, '') || 'Review merchant tasks.',
            scheduleType: weeklyMatch ? 'weekly' : 'once',
            dayOfWeek: weeklyMatch ? weeklyMatch[1].toLowerCase() : '',
            time,
            timezone: 'Asia/Singapore',
            category: 'support',
            priority: 'medium'
        },
        warnings: ['Confirm the reminder before it is saved.']
    };
}

async function createReminderProposal(req, prompt) {
    const context = { recordAllowlist: { services: [], products: [] } };
    return storeProposal(req, normalizeActionProposal(parseReminderRequest(prompt), context));
}

async function confirmPriceChange(req, proposalId) {
    const proposal = getStoredProposal(req, proposalId, 'change_service_price');
    const service = await callbackToPromise((callback) => MerchantService.findServiceForMerchant(req.session.user.id, proposal.currentState.serviceId, callback));
    if (!service) throw createConflict('This service no longer belongs to your merchant account.');

    const currentPrice = roundMoney(service.price);
    if (currentPrice !== roundMoney(proposal.currentState.price)) {
        throw createConflict('This information has changed since the AI suggestion was created. Please generate a new suggestion.');
    }

    const proposedPrice = roundMoney(proposal.proposedState.price);
    if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
        const error = new Error('Suggested price must be greater than zero.');
        error.status = 400;
        throw error;
    }

    const percentChange = Math.abs(((proposedPrice - currentPrice) / currentPrice) * 100);
    if (percentChange > MAX_PRICE_CHANGE_PERCENT) {
        const error = new Error(`AI-assisted price changes cannot exceed ${MAX_PRICE_CHANGE_PERCENT}%.`);
        error.status = 400;
        throw error;
    }

    const payload = {
        name: service.name,
        description: service.description || '',
        categoryId: service.categoryId,
        durationMins: service.durationMins,
        price: proposedPrice,
        slots: (service.slots || []).join(', '),
        packageEnabled: Boolean(service.packageEnabled),
        packageSessions: service.packageSessions || 0,
        packagePrice: service.packagePrice || 0,
        genderTarget: service.genderTarget || 'unisex',
        displayOrder: service.displayOrder || 999,
        shortDescription: service.shortDescription || '',
        inventoryProductId: service.inventoryProductId || null,
        inventoryQuantityRequired: service.inventoryQuantityRequired || 0,
        routineGoalTags: service.routineGoalTags || [],
        routineConcernTags: service.routineConcernTags || [],
        routineRecommendationNote: service.routineRecommendationNote || '',
        routineBudgetMin: service.routineBudgetMin,
        routineBudgetMax: service.routineBudgetMax
    };

    await callbackToPromise((callback) => MerchantService.updateService(req.session.user.id, service.id, payload, callback));
    proposal.used = true;
    auditAiAction(req, proposal, 'service', service.id, { oldValue: currentPrice, newValue: proposedPrice });
    return { serviceId: service.id, oldPrice: currentPrice, newPrice: proposedPrice };
}

async function confirmPromotion(req, proposalId) {
    const proposal = getStoredProposal(req, proposalId, 'create_promotion');
    const state = proposal.proposedState;
    const today = new Date().toISOString().slice(0, 10);

    if (!state.startDate || !state.endDate || state.startDate < today || state.endDate < state.startDate) {
        const error = new Error('Promotion dates are invalid or in the past.');
        error.status = 400;
        throw error;
    }

    if (state.discountType !== 'tag_only' && (!Number.isFinite(Number(state.discountValue)) || Number(state.discountValue) <= 0 || Number(state.discountValue) > 80)) {
        const error = new Error('Promotion discount is invalid.');
        error.status = 400;
        throw error;
    }

    const serviceId = state.serviceIds?.[0] || null;
    const productId = state.productIds?.[0] || null;
    if (serviceId) {
        const service = await callbackToPromise((callback) => MerchantService.findServiceForMerchant(req.session.user.id, serviceId, callback));
        if (!service) throw createConflict('This promotion service no longer belongs to your merchant account.');
    }
    if (productId) {
        const product = await callbackToPromise((callback) => Product.findForMerchant(req.session.user.id, productId, callback));
        if (!product) throw createConflict('This promotion product no longer belongs to your merchant account.');
    }

    const result = await callbackToPromise((callback) => Promotion.createForMerchant(req.session.user.id, {
        serviceId,
        productId,
        title: state.promotionName,
        type: 'happy_hour',
        discountType: state.discountType,
        discountValue: state.discountType === 'tag_only' ? null : Number(state.discountValue),
        startDate: state.startDate,
        endDate: state.endDate,
        allowedSlots: null,
        status: 'draft',
        description: proposal.reason,
        terms: proposal.evidence.join(' | '),
        spinEligible: false,
        spinRewardType: null,
        minimumSpend: 0,
        usageLimit: null,
        spinClaimLimit: null,
        spinInventoryRemaining: null,
        showInFlashDeals: false
    }, callback));

    proposal.used = true;
    auditAiAction(req, proposal, 'promotion', result?.insertId, { newValue: state });
    return { promotionId: result?.insertId || null, status: 'draft' };
}

async function confirmInventory(req, proposalId) {
    const proposal = getStoredProposal(req, proposalId, 'adjust_inventory');
    const product = await callbackToPromise((callback) => Product.findForMerchant(req.session.user.id, proposal.currentState.productId, callback));
    if (!product) throw createConflict('This product no longer belongs to your merchant account.');

    const currentStock = Number(product.stockQuantity || 0);
    if (currentStock !== Number(proposal.currentState.stock)) {
        throw createConflict('This information has changed since the AI suggestion was created. Please generate a new suggestion.');
    }

    const adjustment = Number(proposal.proposedState.stockAdjustment);
    if (!Number.isInteger(adjustment) || adjustment <= 0 || adjustment > 999) {
        const error = new Error('Inventory adjustment must be a positive whole number.');
        error.status = 400;
        throw error;
    }

    await callbackToPromise((callback) => Product.restockForMerchant(req.session.user.id, product.id, adjustment, callback));
    proposal.used = true;
    auditAiAction(req, proposal, 'product', product.id, { oldValue: currentStock, newValue: currentStock + adjustment });
    return { productId: product.id, oldStock: currentStock, newStock: currentStock + adjustment };
}

async function confirmReminder(req, proposalId) {
    const proposal = getStoredProposal(req, proposalId, 'create_reminder');
    const state = proposal.proposedState;
    if (!state.message || !normalizeTime(state.time)) {
        const error = new Error('Reminder schedule is invalid.');
        error.status = 400;
        throw error;
    }

    if (!req.session.merchantReminders) {
        req.session.merchantReminders = [];
    }

    const reminder = {
        id: `merchant-${crypto.randomUUID()}`,
        category: state.category,
        priority: state.priority,
        title: proposal.title,
        message: state.message,
        evidence: proposal.evidence,
        recommendedAction: null,
        dueAt: state.scheduledAt || null,
        scheduleType: state.scheduleType,
        dayOfWeek: state.dayOfWeek,
        time: state.time,
        timezone: 'Asia/Singapore',
        dismissible: true,
        source: 'merchant_created',
        status: 'active',
        createdAt: new Date().toISOString()
    };

    req.session.merchantReminders.push(reminder);
    proposal.used = true;
    auditAiAction(req, proposal, 'merchant_reminder', reminder.id, { newValue: reminder });
    return reminder;
}

function createConflict(message) {
    const error = new Error(message);
    error.status = 409;
    error.code = 'STALE_AI_PROPOSAL';
    return error;
}

function auditAiAction(req, proposal, entityType, entityId, values) {
    AuditLog.log({
        actorUserId: req.session.user.id,
        actorRole: req.session.user.role,
        action: `ai_confirmed_${proposal.actionType}`,
        entityType,
        entityId,
        details: {
            aiAssisted: true,
            proposalId: proposal.proposalId,
            actionType: proposal.actionType,
            reason: proposal.reason,
            confirmedAt: new Date().toISOString(),
            ...values
        }
    }, (error) => {
        if (error) {
            console.error('AI action audit failed:', { message: error.message });
        }
    });
}

module.exports = {
    ACTION_RISK_LEVELS,
    ADMIN_RECOMMENDATION_ACTIONS,
    ALL_ACTION_TYPES,
    MERCHANT_CONFIRM_ACTIONS,
    MERCHANT_RECOMMEND_ONLY_ACTIONS,
    MAX_PRICE_CHANGE_PERCENT,
    buildMerchantActionContext,
    buildSmartReminders,
    confirmInventory,
    confirmPriceChange,
    confirmPromotion,
    confirmReminder,
    createMerchantActionProposal,
    createMerchantScheduleRecommendations,
    createReminderProposal,
    normalizeActionProposal
};
