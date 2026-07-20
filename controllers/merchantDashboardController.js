const QRCode = require('qrcode');
const MerchantService = require('../models/MerchantService');
const Booking = require('../models/Booking');
const Product = require('../models/Product');
const PurchaseHistory = require('../models/PurchaseHistory');
const Promotion = require('../models/Promotion');
const RewardVoucher = require('../models/RewardVoucher');
const CashbackCampaign = require('../models/CashbackCampaign');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const Loyalty = require('../models/Loyalty');
const AuditLog = require('../models/AuditLog');
const SupportRequest = require('../models/SupportRequest');
const MerchantAnalyticsExport = require('../services/merchantAnalyticsExport');
const {
    getProductImagePath,
    deleteProductImageFile
} = require('../utils/productUpload');
const {
    getBookingCheckInUrl,
    getMerchantStorefrontSlug,
    getMerchantStorefrontUrl
} = require('../utils/qrToken');

function renderMerchantLookupError(res, error, merchant) {
    if (error) {
        console.error(error);
        res.status(500).render('error', {
            title: 'Merchant Portal Error',
            message: 'Merchant data could not be loaded from the database.'
        });
        return true;
    }

    if (!merchant) {
        res.status(403).render('error', {
            title: 'Merchant Not Assigned',
            message: 'Your merchant account is not assigned to a salon in the database yet.'
        });
        return true;
    }

    return false;
}

function buildStorefrontQrPayload(req, merchant, callback) {
    const storefrontSlug = getMerchantStorefrontSlug(merchant);
    const merchantWithSlug = { ...merchant, slug: storefrontSlug };
    const qrUrl = getMerchantStorefrontUrl(req, merchantWithSlug);

    return QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320
    }, (error, qrImage) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, {
            merchant: merchantWithSlug,
            qrImage,
            qrCodeDataUrl: qrImage,
            qrBookingUrl: qrUrl,
            qrDebug: {
                system: 'storefront',
                label: 'Scan to Book',
                token: storefrontSlug,
                routeTarget: `/m/${storefrontSlug}`,
                url: qrUrl
            }
        });
    });
}

function getRequestBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function toQrDataUrl(value) {
    if (!value) {
        return Promise.resolve('');
    }

    return QRCode.toDataURL(value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 240
    });
}

function formatDateInputValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function formatDateTimeInputValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 16);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function isTruthyFormValue(value) {
    if (Array.isArray(value)) {
        return value.some((item) => isTruthyFormValue(item));
    }

    return ['1', 'on', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

const routineTagOptions = [
    { value: 'glow', label: 'Healthy glow' },
    { value: 'relax', label: 'Relaxation' },
    { value: 'hair', label: 'Hair refresh' },
    { value: 'nails', label: 'Nail care' },
    { value: 'grooming', label: 'Grooming' },
    { value: 'event', label: 'Event prep' },
    { value: 'dry_skin', label: 'Dry skin' },
    { value: 'oily_skin', label: 'Oily skin' },
    { value: 'acne_pores', label: 'Acne or pores' },
    { value: 'damaged_hair', label: 'Damaged hair' },
    { value: 'hair_loss', label: 'Hair loss' },
    { value: 'frizzy_hair', label: 'Frizzy hair' },
    { value: 'stress', label: 'Stress' },
    { value: 'anti_aging', label: 'Anti-aging' },
    { value: 'brightening', label: 'Brightening' },
    { value: 'maintenance', label: 'Maintenance' }
];

function asFormArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    const normalized = String(value || '').trim();
    return normalized ? [normalized] : [];
}

function normalizeTagList(value) {
    const allowed = new Set(routineTagOptions.map((option) => option.value));
    return Array.from(new Set(asFormArray(value).filter((item) => allowed.has(item)))).slice(0, 12);
}

function normalizeNullableMoney(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const amount = Number(raw);
    return Number.isFinite(amount) ? Math.max(0, amount) : NaN;
}

function normalizeNullableInteger(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const amount = Number(raw);
    return Number.isInteger(amount) ? Math.max(0, amount) : NaN;
}

function buildFeaturedWindowDefaults() {
    const today = new Date();

    return {
        featuredStartDate: formatDateInputValue(today),
        featuredEndDate: formatDateInputValue(addDays(today, 30))
    };
}

function buildServiceFeaturedRecommendations(services = [], salesCounts = {}) {
    const featuredCount = services.filter((service) => service.isFeatured).length;
    const defaults = buildFeaturedWindowDefaults();
    const candidates = services
        .filter((service) => !service.isFeatured)
        .map((service) => {
            const salesCount = Number(salesCounts[Number(service.id)] || 0);
            const slotCount = Array.isArray(service.slots) ? service.slots.length : 0;
            const routineTagCount = (service.routineGoalTags || []).length + (service.routineConcernTags || []).length;
            const hasInventorySupport = !service.inventoryProductId || Number(service.inventoryStockQuantity || 0) > 0;
            const score = (salesCount * 100)
                + (slotCount * 6)
                + (service.description ? 12 : 0)
                + (routineTagCount * 4)
                + (service.packageEnabled ? 5 : 0)
                + (hasInventorySupport ? 8 : 0)
                + (Number(service.price || 0) > 0 ? 3 : 0);

            const reason = salesCount > 0
                ? `${salesCount} paid booking${salesCount === 1 ? '' : 's'} shows proven customer demand for this service.`
                : 'No paid bookings yet; ranked by available slots and listing readiness until sales data is available.';

            return {
                ...service,
                salesCount,
                recommendationScore: score,
                recommendationReason: reason
            };
        })
        .sort((left, right) => right.recommendationScore - left.recommendationScore);

    const recommendationMap = new Map();

    candidates.forEach((service, index) => {
        recommendationMap.set(String(service.id), {
            featuredOrder: String(featuredCount + index + 1),
            featuredStartDate: defaults.featuredStartDate,
            featuredEndDate: defaults.featuredEndDate,
            score: service.recommendationScore,
            salesCount: service.salesCount,
            reason: service.recommendationReason,
            canFeatureNow: featuredCount < 3,
            rank: index + 1
        });
    });

    return recommendationMap;
}

function buildProductFeaturedRecommendations(products = [], salesCounts = {}) {
    const featuredCount = products.filter((product) => product.isFeatured).length;
    const defaults = buildFeaturedWindowDefaults();
    const candidates = products
        .filter((product) => !product.isFeatured)
        .map((product) => {
            const salesCount = Number(salesCounts[Number(product.id)] || 0);
            const routineTagCount = (product.routineGoalTags || []).length + (product.routineConcernTags || []).length;
            const hasImage = Boolean(product.imageUrl || product.fallbackImageUrl);
            const stockQuantity = Number(product.stockQuantity || 0);
            const score = (salesCount * 100)
                + (stockQuantity >= 10 ? 18 : stockQuantity > 0 ? 10 : 0)
                + (hasImage ? 12 : 0)
                + (product.description ? 10 : 0)
                + (routineTagCount * 4)
                + (Number(product.price || 0) > 0 ? 3 : 0);

            let reason = salesCount > 0
                ? `${salesCount} paid unit${salesCount === 1 ? '' : 's'} sold gives this product strong customer demand.`
                : 'No paid sales yet; ranked by stock and listing readiness until sales data is available.';

            if (salesCount > 0 && stockQuantity <= 0) {
                reason = `${salesCount} paid unit${salesCount === 1 ? '' : 's'} sold, but restock is needed before featuring.`;
            }

            return {
                ...product,
                salesCount,
                recommendationScore: score,
                recommendationReason: reason
            };
        })
        .sort((left, right) => right.recommendationScore - left.recommendationScore);

    const recommendationMap = new Map();

    candidates.forEach((product, index) => {
        recommendationMap.set(String(product.id), {
            featuredOrder: String(featuredCount + index + 1),
            featuredStartDate: defaults.featuredStartDate,
            featuredEndDate: defaults.featuredEndDate,
            score: product.recommendationScore,
            salesCount: product.salesCount,
            reason: product.recommendationReason,
            canFeatureNow: featuredCount < 3,
            rank: index + 1
        });
    });

    return recommendationMap;
}

function getFeaturedConfigForm(body = {}) {
    return {
        featuredOrder: String(body.featuredOrder || body.featured_order || '').trim(),
        featuredStartDate: String(body.featuredStartDate || body.featured_start_date || '').trim(),
        featuredEndDate: String(body.featuredEndDate || body.featured_end_date || '').trim()
    };
}

function getServiceForm(body = {}) {
    return {
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        categoryId: String(body.categoryId || '').trim(),
        durationMins: String(body.durationMins || '').trim(),
        price: String(body.price || '').trim(),
        slots: String(body.slots || '').trim(),
        packageEnabled: isTruthyFormValue(body.packageEnabled),
        packageSessions: String(body.packageSessions || '').trim(),
        packagePrice: String(body.packagePrice || '').trim(),
        inventoryProductId: String(body.inventoryProductId || '').trim(),
        inventoryQuantityRequired: String(body.inventoryQuantityRequired || '').trim(),
        routineGoalTags: normalizeTagList(body.routineGoalTags || body.routine_goal_tags),
        routineConcernTags: normalizeTagList(body.routineConcernTags || body.routine_concern_tags),
        routineRecommendationNote: String(body.routineRecommendationNote || body.routine_recommendation_note || '').trim(),
        routineBudgetMin: String(body.routineBudgetMin || body.routine_budget_min || '').trim(),
        routineBudgetMax: String(body.routineBudgetMax || body.routine_budget_max || '').trim()
    };
}

function validateServiceForm(form, products = []) {
    const errors = [];
    const categoryId = Number(form.categoryId);
    const durationMins = Number(form.durationMins);
    const price = Number(form.price);
    const packageSessions = Number(form.packageSessions);
    const packagePrice = Number(form.packagePrice);
    const inventoryProductId = form.inventoryProductId === '' ? null : Number(form.inventoryProductId);
    const inventoryQuantityRequired = form.inventoryQuantityRequired === '' ? 1 : Number(form.inventoryQuantityRequired);
    const routineBudgetMin = normalizeNullableMoney(form.routineBudgetMin);
    const routineBudgetMax = normalizeNullableMoney(form.routineBudgetMax);
    const slots = form.slots.split(',').map((slot) => slot.trim()).filter(Boolean);
    const validProductIds = new Set((products || []).map((product) => Number(product.id)));

    if (form.name.length < 2) {
        errors.push('Service name must be at least 2 characters.');
    }

    if (!Number.isInteger(categoryId) || categoryId < 1) {
        errors.push('Please select a category.');
    }

    if (!Number.isInteger(durationMins) || durationMins < 1) {
        errors.push('Please enter a valid duration in minutes.');
    }

    if (!Number.isFinite(price) || price < 0) {
        errors.push('Please enter a valid price.');
    }

    if (slots.length === 0) {
        errors.push('Please enter at least one available slot.');
    }

    if (form.packageEnabled) {
        if (!Number.isInteger(packageSessions) || packageSessions < 2) {
            errors.push('Package sessions must be at least 2.');
        }

        if (!Number.isFinite(packagePrice) || packagePrice <= 0) {
            errors.push('Please enter a valid package price.');
        }
    }

    if (inventoryProductId !== null) {
        if (!Number.isInteger(inventoryProductId) || !validProductIds.has(inventoryProductId)) {
            errors.push('Please choose a valid linked inventory product.');
        }

        if (!Number.isInteger(inventoryQuantityRequired) || inventoryQuantityRequired < 1) {
            errors.push('Inventory quantity required must be at least 1.');
        }
    }

    if (Number.isNaN(routineBudgetMin) || Number.isNaN(routineBudgetMax)) {
        errors.push('Routine Finder budget range must use valid numbers.');
    }

    if (routineBudgetMin !== null && routineBudgetMax !== null && routineBudgetMin > routineBudgetMax) {
        errors.push('Routine Finder minimum budget cannot be higher than maximum budget.');
    }

    if (form.routineRecommendationNote.length > 255) {
        errors.push('Routine recommendation note must be 255 characters or less.');
    }

    return errors;
}

function buildServicePayload(form) {
    return {
        name: form.name,
        description: form.description,
        categoryId: Number(form.categoryId),
        durationMins: Number(form.durationMins),
        price: Number(form.price),
        slots: form.slots,
        packageEnabled: Boolean(form.packageEnabled),
        packageSessions: form.packageEnabled ? Number(form.packageSessions) : 0,
        packagePrice: form.packageEnabled ? Number(form.packagePrice) : 0,
        inventoryProductId: form.inventoryProductId ? Number(form.inventoryProductId) : null,
        inventoryQuantityRequired: form.inventoryProductId ? Number(form.inventoryQuantityRequired || 1) : 0,
        routineGoalTags: form.routineGoalTags || [],
        routineConcernTags: form.routineConcernTags || [],
        routineRecommendationNote: form.routineRecommendationNote,
        routineBudgetMin: normalizeNullableMoney(form.routineBudgetMin),
        routineBudgetMax: normalizeNullableMoney(form.routineBudgetMax)
    };
}

function renderServiceForm(res, {
    title,
    merchant,
    categories,
    products = [],
    service = null,
    form,
    errors,
    status = 200
}) {
    return res.status(status).render('merchant-service-form', {
        title,
        merchant,
        categories,
        products,
        service,
        form,
        routineTagOptions,
        errors
    });
}

function getProductForm(body = {}, imageUrlOverride = null) {
    return {
        name: String(body.name || '').trim(),
        categoryId: String(body.categoryId || body.category_id || '').trim(),
        price: String(body.price || '').trim(),
        stockQuantity: String(body.stockQuantity || body.stock_quantity || '').trim(),
        imageUrl: imageUrlOverride !== null
            ? String(imageUrlOverride || '').trim()
            : String(body.imageUrl || body.image_url || body.currentImageUrl || '').trim(),
        description: String(body.description || '').trim(),
        ingredients: String(body.ingredients || '').trim(),
        howToUse: String(body.howToUse || body.how_to_use || '').trim(),
        routineGoalTags: normalizeTagList(body.routineGoalTags || body.routine_goal_tags),
        routineConcernTags: normalizeTagList(body.routineConcernTags || body.routine_concern_tags),
        routineRecommendationNote: String(body.routineRecommendationNote || body.routine_recommendation_note || '').trim(),
        routineBudgetMin: String(body.routineBudgetMin || body.routine_budget_min || '').trim(),
        routineBudgetMax: String(body.routineBudgetMax || body.routine_budget_max || '').trim()
    };
}

function getPromotionForm(body = {}) {
    return {
        title: String(body.title || '').trim(),
        serviceId: String(body.serviceId || '').trim(),
        productId: String(body.productId || '').trim(),
        type: String(body.type || '').trim(),
        discountType: String(body.discountType || '').trim(),
        discountValue: String(body.discountValue || '').trim(),
        minimumSpend: String(body.minimumSpend || '').trim(),
        usageLimit: String(body.usageLimit || '').trim(),
        spinEligible: isTruthyFormValue(body.spinEligible),
        spinRewardType: String(body.spinRewardType || '').trim(),
        spinClaimLimit: String(body.spinClaimLimit || '').trim(),
        spinInventoryRemaining: String(body.spinInventoryRemaining || '').trim(),
        showInFlashDeals: isTruthyFormValue(body.showInFlashDeals),
        startDate: String(body.startDate || '').trim(),
        endDate: String(body.endDate || '').trim(),
        slots: String(body.slots || '').trim(),
        status: String(body.status || '').trim(),
        description: String(body.description || '').trim(),
        terms: String(body.terms || '').trim()
    };
}

function normalizePromotionSlots(value = '') {
    return String(value)
        .split(',')
        .map((slot) => slot.trim())
        .filter(Boolean)
        .join(', ');
}

function parsePromotionSlots(value = '') {
    return normalizePromotionSlots(value)
        .split(',')
        .map((slot) => slot.trim())
        .filter(Boolean);
}

function isValidSlotFormat(value) {
    return /^\d{1,2}:\d{2}$/.test(value);
}

function isWeekday(date) {
    const day = date.getDay();
    return day >= 1 && day <= 5;
}

function validatePromotionForm(form, merchant, products = []) {
    const errors = [];
    const serviceId = form.serviceId ? Number(form.serviceId) : null;
    const productId = form.productId ? Number(form.productId) : null;
    const discountValue = form.discountValue === '' ? null : Number(form.discountValue);
    const minimumSpend = normalizeNullableMoney(form.minimumSpend);
    const usageLimit = normalizeNullableInteger(form.usageLimit);
    const spinClaimLimit = normalizeNullableInteger(form.spinClaimLimit);
    const spinInventoryRemaining = normalizeNullableInteger(form.spinInventoryRemaining);
    const startDate = form.startDate ? new Date(form.startDate) : null;
    const endDate = form.endDate ? new Date(form.endDate) : null;
    const slots = parsePromotionSlots(form.slots);
    const merchantServiceIds = new Set((merchant.services || []).map((service) => Number(service.id)));
    const merchantProductIds = new Set((products || []).map((product) => Number(product.id)));

    if (form.title.length < 2) {
        errors.push('Promotion title must be at least 2 characters.');
    }

    if (!Promotion.PROMOTION_TYPES.includes(form.type)) {
        errors.push('Please choose a valid promotion type.');
    }

    if (!Promotion.DISCOUNT_TYPES.includes(form.discountType)) {
        errors.push('Please choose a valid discount type.');
    }

    if (serviceId !== null && (!Number.isInteger(serviceId) || !merchantServiceIds.has(serviceId))) {
        errors.push('Please choose a valid service for this merchant.');
    }

    if (productId !== null && (!Number.isInteger(productId) || !merchantProductIds.has(productId))) {
        errors.push('Please choose a valid product for this merchant.');
    }

    if (serviceId !== null && productId !== null) {
        errors.push('Choose either a linked service or a linked product, not both.');
    }

    if (form.discountType !== 'tag_only') {
        if (!Number.isFinite(discountValue) || discountValue <= 0) {
            errors.push('Please enter a valid discount value.');
        }
    }

    if (Number.isNaN(minimumSpend) || Number.isNaN(usageLimit) || Number.isNaN(spinClaimLimit) || Number.isNaN(spinInventoryRemaining)) {
        errors.push('Minimum spend and limits must use valid numbers.');
    }

    if (form.spinEligible && !Promotion.SPIN_REWARD_TYPES.includes(form.spinRewardType)) {
        errors.push('Please choose a valid Spin & Discover reward type.');
    }

    if (form.spinEligible && form.spinRewardType === 'product_discount' && !productId) {
        errors.push('Product discount Spin rewards must be linked to one of your products.');
    }

    if (form.spinEligible && ['service_discount', 'free_add_on'].includes(form.spinRewardType) && !serviceId) {
        errors.push('Service Spin rewards must be linked to one of your services.');
    }

    if (!(startDate instanceof Date) || Number.isNaN(startDate?.getTime())) {
        errors.push('Please enter a valid promotion start date.');
    }

    if (!(endDate instanceof Date) || Number.isNaN(endDate?.getTime())) {
        errors.push('Please enter a valid promotion end date.');
    }

    if (startDate && endDate && startDate > endDate) {
        errors.push('Promotion end date must be after the start date.');
    }

    if (slots.length > 0 && slots.some((slot) => !isValidSlotFormat(slot))) {
        errors.push('Slots must use HH:MM format, for example 10:00, 14:00, 17:00.');
    }

    if (form.type === 'happy_hour' && startDate && endDate && (!isWeekday(startDate) || !isWeekday(endDate))) {
        errors.push('Happy Hour promotions must be scheduled on weekdays only.');
    }

    if (!Promotion.PROMOTION_STATUSES.includes(form.status)) {
        errors.push('Please choose a valid promotion status.');
    }

    return errors;
}

function buildPromotionPayload(form) {
    return {
        title: form.title,
        serviceId: form.serviceId ? Number(form.serviceId) : null,
        productId: form.productId ? Number(form.productId) : null,
        type: form.type,
        discountType: form.discountType,
        discountValue: form.discountType === 'tag_only' || form.discountValue === '' ? null : Number(form.discountValue),
        minimumSpend: normalizeNullableMoney(form.minimumSpend) || 0,
        usageLimit: normalizeNullableInteger(form.usageLimit),
        spinEligible: Boolean(form.spinEligible),
        spinRewardType: form.spinEligible ? form.spinRewardType : null,
        spinClaimLimit: normalizeNullableInteger(form.spinClaimLimit),
        spinInventoryRemaining: normalizeNullableInteger(form.spinInventoryRemaining),
        showInFlashDeals: Boolean(form.showInFlashDeals),
        startDate: form.startDate,
        endDate: form.endDate,
        allowedSlots: normalizePromotionSlots(form.slots),
        status: form.status,
        description: form.description,
        terms: form.terms
    };
}

function validateProductForm(form) {
    const errors = [];
    const price = Number(form.price);
    const stockQuantity = Number(form.stockQuantity);
    const routineBudgetMin = normalizeNullableMoney(form.routineBudgetMin);
    const routineBudgetMax = normalizeNullableMoney(form.routineBudgetMax);

    if (form.name.length < 2) {
        errors.push('Product name must be at least 2 characters.');
    }

    if (!Number.isFinite(price) || price < 0) {
        errors.push('Please enter a valid product price.');
    }

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        errors.push('Please enter a valid stock quantity.');
    }

    if (Number.isNaN(routineBudgetMin) || Number.isNaN(routineBudgetMax)) {
        errors.push('Routine Finder budget range must use valid numbers.');
    }

    if (routineBudgetMin !== null && routineBudgetMax !== null && routineBudgetMin > routineBudgetMax) {
        errors.push('Routine Finder minimum budget cannot be higher than maximum budget.');
    }

    if (form.routineRecommendationNote.length > 255) {
        errors.push('Routine recommendation note must be 255 characters or less.');
    }

    return errors;
}

function getCashbackCampaignForm(body = {}) {
    return CashbackCampaign.buildCampaignPayload({
        salonId: body.salonId || body.salon_id || '',
        title: body.title,
        cashbackPercent: body.cashbackPercent,
        minimumSpend: body.minimumSpend,
        startAt: body.startAt,
        endAt: body.endAt,
        status: body.status || 'draft',
        applicableType: body.applicableType || 'both'
    });
}

function buildProductPayload(form) {
    return {
        name: form.name,
        price: Number(form.price),
        stockQuantity: Number(form.stockQuantity),
        imageUrl: form.imageUrl,
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        description: form.description || `${form.name} from Vaniday merchant.`,
        ingredients: form.ingredients || 'Ingredients will be updated by the merchant.',
        howToUse: form.howToUse || 'Use as directed by the merchant.',
        routineGoalTags: form.routineGoalTags || [],
        routineConcernTags: form.routineConcernTags || [],
        routineRecommendationNote: form.routineRecommendationNote,
        routineBudgetMin: normalizeNullableMoney(form.routineBudgetMin),
        routineBudgetMax: normalizeNullableMoney(form.routineBudgetMax)
    };
}

function logNotificationError(error) {
    if (error) {
        console.error('Notification error:', error.message || error);
    }
}

function notifyMerchant(userId, notification) {
    Notification.create({
        ...notification,
        recipientUserId: userId,
        recipientRole: 'merchant'
    }, logNotificationError);
}

function notifyCustomer(userId, notification) {
    Notification.create({
        ...notification,
        recipientUserId: userId,
        recipientRole: 'customer'
    }, logNotificationError);
}

function notifyAdmins(notification) {
    Notification.createForRole('admin', notification, logNotificationError);
}

function notifyCustomers(notification) {
    Notification.createForRole('customer', notification, logNotificationError);
}

function normalizeMerchantBookingStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    const allowed = new Set(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
    return allowed.has(status) ? status : '';
}

function normalizeOrderDeliveryStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    const allowed = new Set([
        'processing',
        'packed',
        'ready_for_pickup',
        'delivered_to_pickup_location',
        'shipped',
        'out_for_delivery',
        'delivered',
        'cancelled'
    ]);
    return allowed.has(status) ? status : '';
}

function getDeliveryStatusLabel(value) {
    const normalized = String(value || 'processing').trim().toLowerCase();
    const labels = {
        processing: 'Processing',
        packed: 'Packed',
        ready_for_pickup: 'Ready for Pickup',
        delivered_to_pickup_location: 'Delivered to Pickup Location',
        shipped: 'Shipped',
        out_for_delivery: 'Out for Delivery',
        delivered: 'Delivered',
        completed: 'Completed',
        picked_up: 'Picked Up',
        cancelled: 'Cancelled'
    };
    return labels[normalized] || normalized.replace(/_/g, ' ');
}

function buildMerchantReports(merchant, bookings = [], hadError = false) {
    return {
        totalBookings: bookings.length,
        recentBookings: Array.isArray(bookings) ? bookings.slice(0, 5) : [],
        hasError: Boolean(hadError)
    };
}

function getLastSevenSalesDays(orders = []) {
    const days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let index = 6; index >= 0; index -= 1) {
        const date = new Date(today);
        date.setDate(today.getDate() - index);
        const key = date.toISOString().slice(0, 10);
        days.push({
            key,
            label: date.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' }),
            revenue: 0,
            orders: 0
        });
    }

    const dayMap = days.reduce((map, day) => {
        map[day.key] = day;
        return map;
    }, {});

    orders.forEach((order) => {
        const date = new Date(order.createdAt);
        if (Number.isNaN(date.getTime())) return;
        const key = date.toISOString().slice(0, 10);
        if (!dayMap[key]) return;
        dayMap[key].revenue += Number(order.totalAmount || 0);
        dayMap[key].orders += 1;
    });

    return days;
}

function getLocalDateKey(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

function parseDashboardDate(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const rawValue = String(value).trim();
    const dateOnlyMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (dateOnlyMatch) {
        return new Date(
            Number(dateOnlyMatch[1]),
            Number(dateOnlyMatch[2]) - 1,
            Number(dateOnlyMatch[3])
        );
    }

    const date = new Date(rawValue);

    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDashboardDate(value) {
    const date = parseDashboardDate(value);

    if (date) {
        return getLocalDateKey(date);
    }

    return String(value).slice(0, 10);
}

function formatCustomerBirthday(value) {
    const date = parseDashboardDate(value);

    if (!date) {
        return '';
    }

    return getLocalDateKey(date);
}

function formatCustomerGender(value) {
    const labels = {
        female: 'Female',
        male: 'Male',
        non_binary: 'Non-binary',
        prefer_not_to_say: 'Prefer not to say',
        other: 'Other'
    };

    return labels[String(value || '').trim()] || '';
}

function formatPreferredContactMethod(value) {
    const labels = {
        email: 'Email',
        phone: 'Phone call',
        whatsapp: 'WhatsApp'
    };

    return labels[String(value || '').trim()] || '';
}

function buildDashboardWeekDays(startDate) {
    const weekDays = [];

    for (let index = 0; index < 7; index += 1) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + index);
        weekDays.push({
            key: getLocalDateKey(date),
            label: date.toLocaleDateString('en-SG', { weekday: 'short' }),
            day: date.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' }),
            appointments: []
        });
    }

    return weekDays;
}

function buildDashboardMonthDays(startDate, bookings = []) {
    const monthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    const monthDays = [];

    for (let index = 0; index < monthStart.getDay(); index += 1) {
        monthDays.push({ isPlaceholder: true, appointments: [] });
    }

    for (let dayNumber = 1; dayNumber <= monthEnd.getDate(); dayNumber += 1) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth(), dayNumber);
        const key = getLocalDateKey(date);
        monthDays.push({
            key,
            label: date.toLocaleDateString('en-SG', { weekday: 'short' }),
            dayNumber,
            appointments: bookings.filter((booking) => booking.bookingDate === key)
        });
    }

    return {
        label: monthStart.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' }),
        days: monthDays
    };
}

function buildAppointmentReport(bookings = []) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = getLocalDateKey(today);
    const monthKey = todayKey.slice(0, 7);
    const customerCounts = {};

    const normalizedBookings = bookings.map((booking) => {
        const bookingDate = normalizeDashboardDate(booking.booking_date || booking.bookingDate);
        const status = String(booking.status || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
        const customerKey = booking.email || booking.customer_email || booking.customer_name || booking.customerName || '';

        if (customerKey) {
            customerCounts[customerKey] = (customerCounts[customerKey] || 0) + 1;
        }

        return {
            ...booking,
            id: booking.id,
            serviceId: booking.service_id || booking.serviceId || '',
            merchantId: booking.merchant_id || booking.merchantId || '',
            qrCodeToken: booking.qr_code_token || booking.qrCodeToken || '',
            transactionId: booking.transaction_id || booking.transactionId || '',
            checkedInAt: booking.checked_in_at || booking.checkedInAt || '',
            bookingDate,
            bookingTime: booking.booking_time || booking.bookingTime || '',
            status,
            paymentStatus: booking.payment_status || booking.paymentStatus || (status === 'paid' || booking.transaction_id || booking.transactionId ? 'paid' : 'pending'),
            refundStatus: booking.refund_status || booking.refundStatus || '',
            serviceName: booking.service_name || booking.serviceName || 'Service',
            customerName: booking.customer_name || booking.customerName || 'Customer',
            customerEmail: booking.email || booking.customer_email || '',
            customerPhone: booking.customer_phone || booking.phone || '',
            customerAge: booking.customer_age || booking.customerAge || '',
            customerBirthday: formatCustomerBirthday(booking.customer_birthday || booking.customerBirthday),
            customerGender: formatCustomerGender(booking.customer_gender || booking.customerGender),
            customerPostalCode: booking.customer_postal_code || booking.customerPostalCode || '',
            customerPreferredContactMethod: formatPreferredContactMethod(booking.customer_preferred_contact_method || booking.customerPreferredContactMethod),
            amount: Number(booking.service_price || booking.price || 0)
        };
    });

    const currentWeekDays = buildDashboardWeekDays(today);
    const currentWeekKeys = new Set(currentWeekDays.map((day) => day.key));
    const hasCurrentWeekAppointments = normalizedBookings.some((booking) => currentWeekKeys.has(booking.bookingDate));
    const nextUpcomingDate = normalizedBookings
        .filter((booking) => booking.bookingDate >= todayKey && booking.status !== 'cancelled')
        .map((booking) => parseDashboardDate(booking.bookingDate))
        .filter(Boolean)
        .sort((left, right) => left - right)[0];
    const calendarStartDate = hasCurrentWeekAppointments || !nextUpcomingDate ? today : nextUpcomingDate;
    const weekDays = buildDashboardWeekDays(calendarStartDate);
    const weekMap = weekDays.reduce((map, day) => {
        map[day.key] = day;
        return map;
    }, {});

    normalizedBookings.forEach((booking) => {
        if (weekMap[booking.bookingDate]) {
            weekMap[booking.bookingDate].appointments.push(booking);
        }
    });

    return {
        allBookings: normalizedBookings,
        todayKey,
        todayBookings: normalizedBookings.filter((booking) => booking.bookingDate === todayKey),
        upcomingBookings: normalizedBookings
            .filter((booking) => booking.bookingDate >= todayKey && booking.status !== 'cancelled')
            .sort((a, b) => `${a.bookingDate} ${a.bookingTime}`.localeCompare(`${b.bookingDate} ${b.bookingTime}`))
            .slice(0, 8),
        pendingAppointments: normalizedBookings.filter((booking) => booking.status === 'pending'),
        repeatCustomers: Object.values(customerCounts).filter((count) => count > 1).length,
        qrWalkIns: normalizedBookings.filter((booking) => {
            return booking.bookingDate === todayKey && ['checked_in', 'completed'].includes(booking.status);
        }).length,
        monthlyRevenue: normalizedBookings
            .filter((booking) => booking.bookingDate.slice(0, 7) === monthKey)
            .reduce((sum, booking) => sum + booking.amount, 0),
        loyaltyRedemptions: 0,
        weekDays,
        monthView: buildDashboardMonthDays(calendarStartDate, normalizedBookings)
    };
}

function getQrStatusForBooking(booking, todayKey = getLocalDateKey(new Date())) {
    if (!booking?.id) {
        return 'QR Not Generated';
    }

    if (['checked_in', 'completed'].includes(booking.status)) {
        return 'Checked-in';
    }

    if (booking.bookingDate < todayKey && !['cancelled'].includes(booking.status)) {
        return 'Expired';
    }

    if (['pending', 'confirmed', 'paid'].includes(booking.status)) {
        return 'Awaiting Customer Check-in';
    }

    if (['cancelled', 'no_show'].includes(booking.status)) {
        return 'Expired';
    }

    return 'QR Generated';
}

function enrichAppointmentReportQr(req, appointmentReport, callback) {
    const todayKey = getLocalDateKey(new Date());
    const baseUrl = getRequestBaseUrl(req);
    const bookings = appointmentReport.allBookings || [];

    Promise.all(bookings.map(async (booking) => {
        const checkinUrl = booking.id ? getBookingCheckInUrl(req, booking.id) : '';
        const bookingQrUrl = booking.qrCodeToken && booking.merchantId
            ? `${baseUrl}/booking/${encodeURIComponent(booking.merchantId)}/${encodeURIComponent(booking.qrCodeToken)}${booking.serviceId ? `?serviceId=${encodeURIComponent(booking.serviceId)}` : ''}`
            : '';
        const [bookingQrDataUrl, checkinQrDataUrl] = await Promise.all([
            toQrDataUrl(bookingQrUrl),
            toQrDataUrl(checkinUrl)
        ]);

        return {
            ...booking,
            bookingQrUrl: bookingQrUrl || checkinUrl,
            bookingQrDataUrl,
            checkinUrl,
            checkinQrDataUrl,
            qrStatus: getQrStatusForBooking(booking, todayKey),
            receiptUrl: `/receipt/${booking.id}`
        };
    }))
        .then((enrichedBookings) => {
            const byId = new Map(enrichedBookings.map((booking) => [String(booking.id), booking]));
            const replaceBookings = (items = []) => items.map((booking) => byId.get(String(booking.id)) || booking);

            callback(null, {
                ...appointmentReport,
                allBookings: enrichedBookings,
                todayBookings: replaceBookings(appointmentReport.todayBookings),
                upcomingBookings: replaceBookings(appointmentReport.upcomingBookings),
                pendingAppointments: replaceBookings(appointmentReport.pendingAppointments),
                weekDays: (appointmentReport.weekDays || []).map((day) => ({
                    ...day,
                    appointments: replaceBookings(day.appointments)
                })),
                monthView: {
                    ...appointmentReport.monthView,
                    days: (appointmentReport.monthView?.days || []).map((day) => ({
                        ...day,
                        appointments: replaceBookings(day.appointments)
                    }))
                }
            });
        })
        .catch(callback);
}

function buildRescheduleRecommendations(bookings = [], requests = []) {
    const serviceCounts = {};
    const hourCounts = {};
    const pendingReviews = requests.filter((request) => request.status === 'pending_review');

    bookings.forEach((booking) => {
        const serviceName = booking.serviceName || booking.service_name || 'Service';
        const hour = String(booking.bookingTime || booking.booking_time || '').slice(0, 2);
        serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
        if (hour) {
            hourCounts[`${hour}:00`] = (hourCounts[`${hour}:00`] || 0) + 1;
        }
    });

    const peakHour = topEntriesFromCounts(hourCounts, 'No peak hour', 1)[0];
    const busiestService = topEntriesFromCounts(serviceCounts, 'No service', 1)[0];
    const recommendations = [];

    if (pendingReviews.length > 0) {
        recommendations.push(`${pendingReviews.length} reschedule request${pendingReviews.length === 1 ? '' : 's'} need merchant review before the booking can move.`);
    }

    if (peakHour[1] > 1) {
        recommendations.push(`Protect ${peakHour[0]} as a peak period and route risky moves to manual review.`);
    }

    if (busiestService[1] > 1) {
        recommendations.push(`Suggest quieter alternatives around ${busiestService[0]} to reduce overlap risk.`);
    }

    if (!recommendations.length) {
        recommendations.push('Automation is ready to approve clear reschedules and escalate edge cases.');
    }

    return recommendations.slice(0, 3);
}

function getAgeBand(age) {
    const value = Number(age);

    if (!Number.isFinite(value) || value <= 0) {
        return 'Not set';
    }

    if (value < 18) return 'Under 18';
    if (value <= 24) return '18-24';
    if (value <= 34) return '25-34';
    if (value <= 44) return '35-44';
    if (value <= 54) return '45-54';
    return '55+';
}

function addCount(map, key, increment = 1) {
    const safeKey = key || 'Not set';
    map[safeKey] = (map[safeKey] || 0) + increment;
}

function topEntriesFromCounts(counts, fallbackLabel = 'No data', limit = 6) {
    const entries = Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, limit);

    return entries.length ? entries : [[fallbackLabel, 0]];
}

function buildCustomerInsightReport(bookings = []) {
    const customerMap = new Map();
    const serviceCounts = {};
    const ageBandCounts = {};
    const genderCounts = {};
    const contactMethodCounts = {};
    const postalDistrictCounts = {};
    const hourCounts = {};

    bookings.forEach((booking) => {
        const customerKey = booking.customerEmail || booking.email || booking.customerName || booking.customer_name || `booking-${booking.id}`;
        const serviceName = booking.serviceName || booking.service_name || 'Service';
        const gender = booking.customerGender || formatCustomerGender(booking.customer_gender) || 'Not set';
        const ageBand = getAgeBand(booking.customerAge || booking.customer_age);
        const contactMethod = booking.customerPreferredContactMethod || formatPreferredContactMethod(booking.customer_preferred_contact_method) || 'Not set';
        const postalCode = String(booking.customerPostalCode || booking.customer_postal_code || '').trim();
        const postalDistrict = postalCode ? `Prefix ${postalCode.slice(0, 2)}` : 'Not set';
        const hour = String(booking.bookingTime || booking.booking_time || '').slice(0, 2);

        addCount(serviceCounts, serviceName);
        addCount(ageBandCounts, ageBand);
        addCount(genderCounts, gender);
        addCount(contactMethodCounts, contactMethod);
        addCount(postalDistrictCounts, postalDistrict);
        if (hour) {
            addCount(hourCounts, `${hour}:00`);
        }

        const current = customerMap.get(customerKey) || {
            customerName: booking.customerName || booking.customer_name || 'Customer',
            customerEmail: booking.customerEmail || booking.email || '',
            customerPhone: booking.customerPhone || booking.customer_phone || '',
            customerAge: booking.customerAge || booking.customer_age || '',
            customerGender: gender,
            customerPostalCode: postalCode,
            customerPreferredContactMethod: contactMethod,
            visits: 0,
            spend: 0,
            lastBookingDate: ''
        };

        current.visits += 1;
        current.spend += Number(booking.amount || booking.service_price || booking.price || 0);
        if (!current.lastBookingDate || String(booking.bookingDate || booking.booking_date || '') > current.lastBookingDate) {
            current.lastBookingDate = String(booking.bookingDate || booking.booking_date || '');
        }

        customerMap.set(customerKey, current);
    });

    const customers = Array.from(customerMap.values());
    const repeatCustomers = customers.filter((customer) => customer.visits > 1);
    const topCustomers = customers
        .slice()
        .sort((left, right) => {
            if (right.visits === left.visits) {
                return right.spend - left.spend;
            }

            return right.visits - left.visits;
        })
        .slice(0, 5);
    const topService = topEntriesFromCounts(serviceCounts, 'No service')[0];
    const peakHour = topEntriesFromCounts(hourCounts, 'No bookings')[0];
    const suggestedFocus = topService[1] > 0
        ? `Promote ${topService[0]} to your most active customer groups.`
        : 'Customer patterns will appear after more bookings.';

    return {
        totalCustomers: customers.length,
        repeatCustomers: repeatCustomers.length,
        repeatRate: customers.length ? Math.round((repeatCustomers.length / customers.length) * 100) : 0,
        averageVisits: customers.length ? customers.reduce((sum, customer) => sum + customer.visits, 0) / customers.length : 0,
        averageCustomerValue: customers.length ? customers.reduce((sum, customer) => sum + customer.spend, 0) / customers.length : 0,
        topCustomers,
        suggestedFocus,
        topServiceName: topService[0],
        peakHour: peakHour[0],
        chartPayload: {
            ageLabels: topEntriesFromCounts(ageBandCounts, 'Not set').map((entry) => entry[0]),
            ageValues: topEntriesFromCounts(ageBandCounts, 'Not set').map((entry) => entry[1]),
            genderLabels: topEntriesFromCounts(genderCounts, 'Not set').map((entry) => entry[0]),
            genderValues: topEntriesFromCounts(genderCounts, 'Not set').map((entry) => entry[1]),
            contactMethodLabels: topEntriesFromCounts(contactMethodCounts, 'Not set').map((entry) => entry[0]),
            contactMethodValues: topEntriesFromCounts(contactMethodCounts, 'Not set').map((entry) => entry[1]),
            postalDistrictLabels: topEntriesFromCounts(postalDistrictCounts, 'Not set').map((entry) => entry[0]),
            postalDistrictValues: topEntriesFromCounts(postalDistrictCounts, 'Not set').map((entry) => entry[1]),
            serviceLabels: topEntriesFromCounts(serviceCounts, 'No service').map((entry) => entry[0]),
            serviceValues: topEntriesFromCounts(serviceCounts, 'No service').map((entry) => entry[1]),
            hourLabels: topEntriesFromCounts(hourCounts, 'No bookings').map((entry) => entry[0]),
            hourValues: topEntriesFromCounts(hourCounts, 'No bookings').map((entry) => entry[1])
        }
    };
}

function renderMerchantDashboard(req, res, merchant, options = {}) {
    return Booking.getByMerchantUserId(req.session.user.id, (bookingError, bookings) => {
        if (bookingError) {
            console.error(bookingError);
        }

        return Promotion.getByMerchantUserId(req.session.user.id, (promotionError, promotions) => {
            if (promotionError) {
                console.error(promotionError);
            }

            return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                if (productError) {
                    console.error(productError);
                }

                return Transaction.getMerchantOrderReport(req.session.user.id, (orderError, orders = []) => {
                    if (orderError) {
                        console.error(orderError);
                    }

                    return Review.getSummaryByMerchantId(merchant.id, (reviewSummaryError, reviewSummary = { reviewCount: 0, averageRating: null }) => {
                        if (reviewSummaryError) {
                            console.error(reviewSummaryError);
                        }

                        return Review.listByMerchantId(merchant.id, 12, (reviewListError, reviews = []) => {
                            if (reviewListError) {
                                console.error(reviewListError);
                            }

                            return Booking.listRescheduleRequestsForMerchant(req.session.user.id, (rescheduleError, rescheduleRequests = []) => {
                                if (rescheduleError) {
                                    console.error(rescheduleError);
                                }

                                return Booking.getRescheduleSettings(merchant.id, (rescheduleSettingsError, rescheduleSettings) => {
                                    if (rescheduleSettingsError) {
                                        console.error(rescheduleSettingsError);
                                    }

                                    return Loyalty.getMerchantRewardAnalytics(merchant.id, (rewardAnalyticsError, rewardAnalytics = {}) => {
                                        if (rewardAnalyticsError) {
                                            console.error(rewardAnalyticsError);
                                        }

                            const safeBookings = bookingError ? [] : bookings || [];
                            const safePromotions = promotionError ? [] : promotions || [];
                            const safeProducts = productError ? [] : products || [];
                            const safeOrders = orderError ? [] : orders || [];
                            const safeReviews = reviewListError ? [] : reviews || [];
                            const safeRescheduleRequests = rescheduleError ? [] : rescheduleRequests || [];
                            const safeRescheduleSettings = rescheduleSettingsError ? null : rescheduleSettings;
                            const safeReviewSummary = reviewSummaryError
                                ? { reviewCount: 0, averageRating: null }
                                : reviewSummary || { reviewCount: 0, averageRating: null };
                            const serviceCount = Array.isArray(merchant.services) ? merchant.services.length : 0;
                            const slotCount = Array.isArray(merchant.services)
                                ? merchant.services.reduce((total, svc) => total + ((Array.isArray(svc.slots) ? svc.slots.length : 0)), 0)
                                : 0;
                            const bookingRevenue = safeBookings.reduce((total, booking) => {
                                return total + Number(booking.service_price || booking.price || 0);
                            }, 0);
                            const productRevenue = safeOrders.reduce((total, order) => total + Number(order.totalAmount || 0), 0);
                            const grossOrderSales = safeOrders.reduce((total, order) => total + Number(order.grossAmount || order.totalAmount || 0), 0);
                            const totalCommissionDeducted = safeOrders.reduce((total, order) => total + Number(order.commissionAmount || 0), 0);
                            const totalNetPayout = safeOrders.reduce((total, order) => total + Number(order.payoutAmount || order.totalAmount || 0), 0);
                            const totalRevenue = bookingRevenue + productRevenue;
                            const totalOrders = safeOrders.length + safeBookings.length;
                            const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
                            const uniqueCustomers = new Set([
                                ...safeBookings.map((booking) => booking.customer_email || booking.email || booking.customerName || booking.customer_name),
                                ...safeOrders.map((order) => order.userId)
                            ].filter(Boolean)).size;
                            const averagePrice = serviceCount > 0
                                ? merchant.services.reduce((total, service) => total + Number(service.price || 0), 0) / serviceCount
                                : 0;
                            const topService = Array.isArray(merchant.services)
                                ? merchant.services.reduce((top, service) => {
                                    const servicePrice = Number(service.price || 0);
                                    return servicePrice > Number(top?.price || 0) ? service : top;
                                }, null)
                                : null;
                            const lowStockProducts = safeProducts.filter((product) => Number(product.stockQuantity || 0) <= 5);
                            const salesDays = getLastSevenSalesDays(safeOrders);
                            const appointmentReport = buildAppointmentReport(safeBookings);
                            const promotionRedemptions = safePromotions.reduce((total, promotion) => total + Number(promotion.redemptionCount || 0), 0);
                            appointmentReport.loyaltyRedemptions = promotionRedemptions;
                            appointmentReport.rewardRedemptions = rewardAnalyticsError ? {
                                rewardBookingCount: 0,
                                totalRedeemedValue: 0,
                                loyaltyDrivenRevenue: 0,
                                repeatRewardCustomers: 0
                            } : rewardAnalytics;
                            const customerInsightReport = buildCustomerInsightReport(appointmentReport.allBookings);
                            const previousRevenue = salesDays.slice(0, 3).reduce((sum, day) => sum + day.revenue, 0);
                            const currentRevenue = salesDays.slice(4).reduce((sum, day) => sum + day.revenue, 0);
                            const growthPercent = previousRevenue > 0
                                ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
                                : currentRevenue > 0 ? 100 : 0;
                            const validationIssues = [];

                            if (!merchant.location && !merchant.address) {
                                validationIssues.push('Merchant location is not configured yet.');
                            }
                            if (!merchant.businessCategory) {
                                validationIssues.push('Business category is not configured yet.');
                            }
                            if (!merchant.uen) {
                                validationIssues.push('UEN or registration number is not configured yet.');
                            }
                            if (!merchant.ownerPhone) {
                                validationIssues.push('Owner handphone number is not configured yet.');
                            }
                            if (serviceCount === 0) {
                                validationIssues.push('No services are active. Add a service to start booking customers.');
                            }
                            if (lowStockProducts.length > 0) {
                                validationIssues.push(`${lowStockProducts.length} product${lowStockProducts.length === 1 ? '' : 's'} need stock review.`);
                            }
                            if (bookingError) {
                                validationIssues.push('Booking records could not be loaded, so customer reporting is temporarily limited.');
                            }
                            if (promotionError) {
                                validationIssues.push('Promotion records could not be loaded, so campaign reporting is temporarily limited.');
                            }
                            if (productError || orderError) {
                                validationIssues.push('Product sales reporting could not be fully loaded.');
                            }
                            if (rescheduleError || rescheduleSettingsError) {
                                validationIssues.push('Reschedule automation reporting could not be fully loaded.');
                            }

                            const reports = {
                                stats: {
                                    serviceCount,
                                    slotCount,
                                    bookingCount: safeBookings.length,
                                    customerCount: uniqueCustomers,
                                    bookingRevenue,
                                    productRevenue,
                                    totalRevenue,
                                    totalOrders,
                                    averageOrderValue,
                                    averagePrice,
                                    promotionCount: safePromotions.length,
                                    productCount: safeProducts.length,
                                    growthPercent
                                },
                                customerReport: {
                                    totalCustomers: uniqueCustomers,
                                    recentBookings: safeBookings.slice(0, 5),
                                    insights: customerInsightReport
                                },
                                appointmentReport,
                                rescheduleAutomation: {
                                    settings: safeRescheduleSettings,
                                    requests: safeRescheduleRequests,
                                    autoApproved: safeRescheduleRequests.filter((request) => request.status === 'auto_approved'),
                                    pendingReviews: safeRescheduleRequests.filter((request) => request.status === 'pending_review'),
                                    recommendations: buildRescheduleRecommendations(appointmentReport.allBookings, safeRescheduleRequests)
                                },
                                merchantReport: {
                                    categoryCount: Array.isArray(merchant.services)
                                        ? new Set(merchant.services.map((service) => service.category || '')).size
                                        : 0,
                                    slotCount,
                                    serviceCount,
                                    topService
                                },
                                salesReport: {
                                    dailySales: salesDays,
                                    allOrders: safeOrders,
                                    recentOrders: safeOrders.slice(0, 5),
                                    lowStockProducts,
                                    payoutSummary: {
                                        grossOrderSales,
                                        totalCommissionDeducted,
                                        totalNetPayout
                                    }
                                },
                                validationReport: {
                                    issues: validationIssues,
                                    status: validationIssues.length === 0 ? 'Healthy' : 'Needs Review'
                                }
                            };

                            const success = options.success !== undefined ? options.success : req.session.merchantSuccess;
                            const error = options.error !== undefined ? options.error : req.session.merchantError;
                            req.session.merchantSuccess = null;
                            req.session.merchantError = null;
                            const defaultRefundStats = {
                                pendingCount: 0,
                                approvedCount: 0,
                                processingCount: 0,
                                refundedCount: 0,
                                rejectedCount: 0,
                                failedCount: 0
                            };

                            const renderView = (qrPayload = {}, refundStats = defaultRefundStats) => res.status(options.status || 200).render(options.viewName || 'merchant-dashboard', {
                                title: options.title || 'Merchant Dashboard',
                                merchant: qrPayload.merchant || { ...merchant, slug: getMerchantStorefrontSlug(merchant) },
                                success,
                                error,
                                databaseError: Boolean(bookingError || promotionError || productError || orderError || reviewSummaryError || reviewListError),
                                stats: reports.stats,
                                customerReport: reports.customerReport,
                                appointmentReport: reports.appointmentReport,
                                rescheduleAutomation: reports.rescheduleAutomation,
                                refundStats,
                                merchantReport: reports.merchantReport,
                                salesReport: reports.salesReport,
                                validationReport: reports.validationReport,
                                reviewSummary: safeReviewSummary,
                                reviews: safeReviews,
                                promotions: safePromotions,
                                qrImage: options.qrImage || qrPayload.qrImage || options.qrCodeDataUrl || null,
                                qrCodeDataUrl: options.qrCodeDataUrl || qrPayload.qrCodeDataUrl || options.qrImage || null,
                                qrBookingUrl: options.qrBookingUrl || qrPayload.qrBookingUrl || null,
                                qrDebug: options.qrDebug || qrPayload.qrDebug || null
                            });

                            return SupportRequest.getMerchantRefundStats(req.session.user.id, (refundStatsError, refundStats = defaultRefundStats) => {
                                if (refundStatsError) {
                                    console.error(refundStatsError);
                                }

                                if (options.qrImage || options.qrCodeDataUrl) {
                                    return renderView({}, refundStatsError ? defaultRefundStats : refundStats);
                                }

                                return buildStorefrontQrPayload(req, merchant, (qrError, qrPayload) => {
                                    if (qrError) {
                                        console.error(qrError);
                                        return renderView({}, refundStatsError ? defaultRefundStats : refundStats);
                                    }

                                    return renderView(qrPayload, refundStatsError ? defaultRefundStats : refundStats);
                                });
                            });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

function renderMerchantServices(req, res, merchant, options = {}) {
    const success = options.success !== undefined ? options.success : req.session.merchantSuccess;
    const error = options.error !== undefined ? options.error : req.session.merchantError;
    req.session.merchantSuccess = null;
    req.session.merchantError = null;
    const salesCounts = options.salesCounts || {};
    const recommendationMap = buildServiceFeaturedRecommendations(merchant.services || [], salesCounts);
    const merchantWithRecommendations = {
        ...merchant,
        services: (merchant.services || []).map((service) => ({
            ...service,
            salesCount: Number(salesCounts[Number(service.id)] || 0),
            featuredRecommendation: recommendationMap.get(String(service.id)) || null
        }))
    };

    return res.status(options.status || 200).render('merchant-services', {
        title: 'My Services',
        merchant: merchantWithRecommendations,
        success,
        error
    });
}

function showServices(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Booking.getServiceSalesCounts((salesError, salesCounts = {}) => {
            if (salesError) {
                console.error(salesError);
            }

            return renderMerchantServices(req, res, merchant, { salesCounts });
        });
    });
}

function renderPortalView(viewName, title) {
    return (req, res) => {
        return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
            const handled = renderMerchantLookupError(res, lookupError, merchant);

            if (handled) {
                return handled;
            }

            return renderMerchantDashboard(req, res, merchant, { viewName, title });
        });
    };
}

const showDashboard = renderPortalView('merchant-dashboard', 'Merchant Dashboard');
const showBookings = renderPortalView('merchant-bookings', 'Merchant Bookings');
const showCustomers = renderPortalView('merchant-customers', 'Merchant Customers');
const showAnalytics = renderPortalView('merchant-analytics', 'Merchant Analytics');
const showSupport = renderPortalView('merchant-support', 'Merchant Support');
const showProfile = renderPortalView('merchant-profile', 'Merchant Profile');
const showOrders = renderPortalView('merchant-orders', 'Product Orders');

function exportAnalytics(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, async (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return;
        }

        try {
            const { workbook, filename } = await MerchantAnalyticsExport.buildExport({
                merchant,
                merchantUserId: req.session.user.id,
                body: req.body || {}
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            const status = /unknown dataset|select at least|date/i.test(error.message || '') ? 400 : 500;
            if (status >= 500) {
                console.error('Merchant analytics export failed:', error);
            }
            res.status(status).json({
                success: false,
                message: error.message || 'Analytics export could not be generated.'
            });
        }
    });
}

function showOnboarding(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const success = req.session.merchantSuccess;
        const error = req.session.merchantError;
        req.session.merchantSuccess = null;
        req.session.merchantError = null;

        return res.render('merchant-onboarding', {
            title: 'Merchant Onboarding',
            merchant,
            success,
            error
        });
    });
}

function updateOrderStatus(req, res) {
    const transactionId = Number(req.params.transactionId);
    const status = normalizeOrderDeliveryStatus(req.body.deliveryStatus);

    if (!Number.isInteger(transactionId) || transactionId < 1) {
        req.session.merchantError = 'Order could not be found.';
        return res.redirect('/merchant/orders');
    }

    if (!status) {
        req.session.merchantError = 'Please choose a valid order status.';
        return res.redirect('/merchant/orders');
    }

    return Transaction.getOrderById(transactionId, (lookupError, order) => {
        if (lookupError) {
            console.error(lookupError);
            req.session.merchantError = 'Order details could not be loaded.';
            return res.redirect('/merchant/orders');
        }

        if (!order || !order.merchantUserIds.includes(Number(req.session.user.id))) {
            req.session.merchantError = 'This order could not be found for your merchant account.';
            return res.redirect('/merchant/orders');
        }

        return Transaction.updateDeliveryStatus(transactionId, status, { merchantUserId: req.session.user.id }, (updateError, result) => {
            if (updateError) {
                console.error(updateError);
                req.session.merchantError = 'Order status could not be updated.';
                return res.redirect('/merchant/orders');
            }

            if (!result?.affectedRows) {
                req.session.merchantError = result?.conflict
                    ? (result.message || 'Order status could not be updated because the order state changed.')
                    : 'Order status could not be updated. Pickup might already be verified or the selected status is not valid for this fulfilment type.';
                return res.redirect('/merchant/orders');
            }

            const statusLabel = getDeliveryStatusLabel(status);
            const orderDisplayReference = order.order_number || order.orderNumber || `#${transactionId}`;
            notifyCustomer(order.userId, {
                actorUserId: req.session.user.id,
                type: 'order_update',
                title: 'Order status updated',
                message: `Your ${order.itemNames || 'product order'} order is now ${statusLabel}.`,
                linkUrl: `/receipt/order-${transactionId}`,
                dedupeKey: `merchant-order-status-${transactionId}-${status}-${Date.now()}`,
                metadata: { transactionId, status }
            });

            req.session.merchantSuccess = `Order ${orderDisplayReference} updated to ${statusLabel}.`;
            return res.redirect('/merchant/orders');
        });
    });
}

function showLoyaltySettings(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Loyalty.getRules((adminError, adminRules) => {
            if (adminError) {
                console.error(adminError);
                return res.status(500).render('error', {
                    title: 'Rewards Settings Error',
                    message: 'Platform reward rules could not be loaded.'
                });
            }

            return Loyalty.getMerchantRules(merchant.id, (rulesError, merchantRules) => {
                if (rulesError) {
                    console.error(rulesError);
                    return res.status(500).render('error', {
                        title: 'Rewards Settings Error',
                        message: 'Merchant reward rules could not be loaded.'
                    });
                }

                const success = req.session.merchantSuccess;
                const error = req.session.merchantError;
                req.session.merchantSuccess = null;
                req.session.merchantError = null;

                return res.render('merchant-loyalty', {
                    title: 'Merchant Rewards',
                    merchant,
                    adminRules,
                    merchantRules,
                    success,
                    error
                });
            });
        });
    });
}

function updateLoyaltySettings(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Loyalty.getRules((adminError, adminRules) => {
            if (adminError) {
                console.error(adminError);
                req.session.merchantError = 'Platform reward rules could not be checked.';
                return res.redirect('/merchant/loyalty');
            }

            const postedServiceIds = Array.isArray(req.body.rewardServiceIds)
                ? req.body.rewardServiceIds
                : req.body.rewardServiceIds
                    ? [req.body.rewardServiceIds]
                    : [];
            const merchantServiceIds = (merchant.services || []).map((service) => Number(service.id));
            const enabledServiceIds = postedServiceIds
                .map((id) => Number(id))
                .filter((id) => merchantServiceIds.includes(id));
            const maxDiscountPercent = Number(req.body.maxDiscountPercent || 0);
            const promotionMultiplier = Number(req.body.promotionMultiplier || 1);
            const errors = [];

            if (!Number.isFinite(maxDiscountPercent) || maxDiscountPercent < 0) {
                errors.push('Merchant maximum discount must be zero or more.');
            }

            if (maxDiscountPercent > Number(adminRules.maxDiscountPercent || 0)) {
                errors.push(`Merchant maximum discount cannot exceed the platform limit of ${Number(adminRules.maxDiscountPercent || 0)}%.`);
            }

            if (!Number.isFinite(promotionMultiplier) || promotionMultiplier < 0 || promotionMultiplier > 1) {
                errors.push('Promotion multiplier must be between 0 and 1 so merchant rules stay within platform limits.');
            }

            if (errors.length) {
                req.session.merchantError = errors.join(' ');
                return res.redirect('/merchant/loyalty');
            }

            return Loyalty.updateMerchantRules(merchant.id, {
                isEnabled: req.body.isEnabled === 'on',
                maxDiscountPercent,
                promotionLabel: req.body.promotionLabel || '',
                promotionMultiplier,
                serviceIds: merchantServiceIds,
                enabledServiceIds
            }, (updateError) => {
                if (updateError) {
                    console.error(updateError);
                    req.session.merchantError = 'Merchant reward settings could not be saved.';
                } else {
                    AuditLog.log({
                        actorUserId: req.session.user?.id,
                        actorRole: req.session.user?.role || 'merchant',
                        action: 'merchant_reward_rules_updated',
                        entityType: 'merchant_loyalty_rules',
                        entityId: merchant.id,
                        details: {
                            isEnabled: req.body.isEnabled === 'on',
                            maxDiscountPercent,
                            promotionLabel: req.body.promotionLabel || '',
                            promotionMultiplier,
                            enabledServiceIds
                        }
                    }, (auditError) => {
                        if (auditError) console.error(auditError);
                    });
                    req.session.merchantSuccess = 'Merchant reward settings updated.';
                }

                return res.redirect('/merchant/loyalty');
            });
        });
    });
}

function getMerchantProfileForm(body = {}) {
    return {
        ownerName: String(body.ownerName || '').trim(),
        ownerPhone: String(body.ownerPhone || '').trim(),
        salonName: String(body.salonName || '').trim(),
        businessCategory: String(body.businessCategory || '').trim(),
        uen: String(body.uen || '').trim().toUpperCase(),
        yearsInBusiness: String(body.yearsInBusiness || '').trim(),
        staffCount: String(body.staffCount || '').trim(),
        address: String(body.address || '').trim(),
        description: String(body.description || '').trim()
    };
}

function validateMerchantProfileForm(form) {
    const errors = [];

    if (form.ownerName.length < 2) errors.push('Owner name must be at least 2 characters.');
    if (!/^[689]\d{7}$/.test(form.ownerPhone)) errors.push('Please enter a valid 8-digit Singapore owner handphone number.');
    if (form.salonName.length < 2) errors.push('Business name must be at least 2 characters.');
    if (form.businessCategory.length < 2) errors.push('Please enter a business category.');
    if (!/^[A-Z0-9-]{8,20}$/.test(form.uen)) errors.push('Please enter a valid UEN or registration number.');
    if (!Number.isInteger(Number(form.yearsInBusiness)) || Number(form.yearsInBusiness) < 0 || Number(form.yearsInBusiness) > 100) {
        errors.push('Years in business must be a whole number from 0 to 100.');
    }
    if (!Number.isInteger(Number(form.staffCount)) || Number(form.staffCount) < 1 || Number(form.staffCount) > 5000) {
        errors.push('Staff count must be a whole number from 1 to 5000.');
    }
    if (form.address.length < 2) errors.push('Please enter the business address.');

    return errors;
}

function updateProfile(req, res) {
    const form = getMerchantProfileForm(req.body);
    const errors = validateMerchantProfileForm(form);

    if (errors.length > 0) {
        req.session.merchantError = errors.join(' ');
        return res.redirect('/merchant/profile');
    }

    return MerchantService.updateMerchantProfile(req.session.user.id, {
        ...form,
        yearsInBusiness: Number(form.yearsInBusiness),
        staffCount: Number(form.staffCount)
    }, (error) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Merchant profile could not be updated. Please try again.';
            return res.redirect('/merchant/profile');
        }

        req.session.user.name = form.ownerName;
        req.session.user.phone = form.ownerPhone;
        req.session.merchantSuccess = 'Merchant profile updated successfully.';
        return res.redirect('/merchant/profile');
    });
}

function generateQr(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return buildStorefrontQrPayload(req, merchant, (qrError, qrPayload) => {
            if (qrError) {
                console.error(qrError);
                return renderMerchantDashboard(req, res, merchant, {
                    status: 500,
                    viewName: req.body.returnTo === 'profile' ? 'merchant-profile' : 'merchant-dashboard',
                    title: req.body.returnTo === 'profile' ? 'Merchant Profile' : 'Merchant Dashboard',
                    success: null,
                    error: 'QR code could not be generated. Please try again.'
                });
            }

            return renderMerchantDashboard(req, res, merchant, {
                viewName: req.body.returnTo === 'profile' ? 'merchant-profile' : 'merchant-dashboard',
                title: req.body.returnTo === 'profile' ? 'Merchant Profile' : 'Merchant Dashboard',
                success: 'Merchant QR code generated.',
                error: null,
                qrImage: qrPayload.qrImage,
                qrCodeDataUrl: qrPayload.qrCodeDataUrl,
                qrBookingUrl: qrPayload.qrBookingUrl,
                qrDebug: qrPayload.qrDebug
            });
        });
    });
}

function updateBookingStatus(req, res) {
    const bookingId = Number(req.params.bookingId);
    const status = normalizeMerchantBookingStatus(req.body.status);

    if (!bookingId || !status) {
        req.session.merchantError = 'Choose a valid booking action.';
        return res.redirect(req.body.returnTo === 'schedule' ? '/merchant/schedule' : '/merchant/bookings');
    }

    return Booking.updateStatusForMerchant(bookingId, req.session.user.id, status, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Booking status could not be updated.';
            return res.redirect(req.body.returnTo === 'schedule' ? '/merchant/schedule' : '/merchant/bookings');
        }

        if (!result?.affectedRows) {
            req.session.merchantError = result?.conflict
                ? (result.message || 'Booking status could not be updated because the booking state changed.')
                : 'That booking was not found for your merchant account.';
            return res.redirect(req.body.returnTo === 'schedule' ? '/merchant/schedule' : '/merchant/bookings');
        }

        const statusCopy = status.replace(/_/g, ' ');
        Booking.getNotificationDetailsById(bookingId, (lookupError, booking) => {
            if (lookupError) {
                console.error(lookupError);
                return;
            }

            if (!booking) {
                return;
            }

            const customerMessages = {
                pending: 'Your booking is pending merchant review.',
                confirmed: 'Your booking has been confirmed by the merchant.',
                completed: 'Your booking has been completed.',
                cancelled: 'Your booking was cancelled by the merchant.',
                no_show: 'Your booking was marked as no show by the merchant.'
            };

            Notification.create({
                recipientUserId: booking.user_id,
                recipientRole: 'customer',
                actorUserId: req.session.user.id,
                type: `booking_${status}`,
                title: `Booking ${statusCopy}`,
                message: `${customerMessages[status] || `Your booking is now ${statusCopy}.`} ${booking.service_name} at ${booking.merchant_name}.`,
                linkUrl: '/profile#bookings',
                dedupeKey: `merchant-booking-status-${bookingId}-${status}`
            }, logNotificationError);
        });

        req.session.merchantSuccess = `Booking #${bookingId} marked as ${statusCopy}.`;
        return res.redirect(req.body.returnTo === 'schedule' ? '/merchant/schedule' : '/merchant/bookings');
    });
}

function normalizeTimeInput(value, fallback) {
    const rawValue = String(value || fallback || '').trim();
    const match = rawValue.match(/^(\d{1,2}):(\d{2})/);

    if (!match) {
        return fallback;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return fallback;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeToMinutes(value) {
    const normalized = normalizeTimeInput(value, '');

    if (!normalized) {
        return null;
    }

    return (Number(normalized.slice(0, 2)) * 60) + Number(normalized.slice(3, 5));
}

function normalizeBlockedTimes(value) {
    const rawValues = Array.isArray(value)
        ? value
        : String(value || '').split(',');

    return [...new Set(rawValues
        .map((item) => normalizeTimeInput(item, ''))
        .filter(Boolean))]
        .sort()
        .join(', ');
}

function updateRescheduleSettings(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const businessStart = normalizeTimeInput(req.body.businessStart, '09:00');
        const businessEnd = normalizeTimeInput(req.body.businessEnd, '20:00');

        if (timeToMinutes(businessEnd) <= timeToMinutes(businessStart)) {
            req.session.merchantError = 'Business end time must be later than business start time.';
            return res.redirect('/merchant/bookings');
        }

        const settings = {
            autoApproveEnabled: isTruthyFormValue(req.body.autoApproveEnabled),
            autoApproveBookings: isTruthyFormValue(req.body.autoApproveBookings),
            minimumNoticeHours: Number(req.body.minimumNoticeHours || 24),
            maxReschedulesAllowed: Number(req.body.maxReschedulesAllowed || 2),
            blockedTimes: normalizeBlockedTimes(req.body.blockedTimes),
            peakHourRestrictions: isTruthyFormValue(req.body.peakHourRestrictions),
            businessStart,
            businessEnd
        };

        return Booking.updateRescheduleSettings(merchant.id, settings, (error, result) => {
            if (error) {
                console.error(error);
                req.session.merchantError = 'Reschedule automation settings could not be saved.';
                return res.redirect('/merchant/bookings');
            }

            req.session.merchantSuccess = result?.affectedRows ? 'Reschedule automation settings saved.' : 'Reschedule automation settings checked.';
            return res.redirect('/merchant/bookings');
        });
    });
}

function reviewRescheduleRequest(req, res) {
    const requestId = Number(req.params.requestId);
    const action = String(req.body.action || '').trim().toLowerCase();

    if (!requestId || !['approve', 'reject'].includes(action)) {
        req.session.merchantError = 'Choose a valid reschedule review action.';
        return res.redirect('/merchant/bookings');
    }

    return Booking.reviewRescheduleRequest(requestId, req.session.user.id, action, (error, result, request) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Reschedule request could not be reviewed.';
            return res.redirect('/merchant/bookings');
        }

        if (!result?.affectedRows) {
            req.session.merchantError = 'That reschedule request was not found or was already reviewed.';
            return res.redirect('/merchant/bookings');
        }

        const approved = action === 'approve';
        if (request?.user_id) {
            Notification.create({
                recipientUserId: request.user_id,
                recipientRole: 'customer',
                actorUserId: req.session.user.id,
                type: approved ? 'booking_reschedule_approved' : 'booking_reschedule_rejected',
                title: approved ? 'Reschedule approved' : 'Reschedule declined',
                message: approved
                    ? `Your booking was moved to ${formatDateInputValue(request.requested_booking_date)} at ${String(request.requested_timeslot || '').slice(0, 5)}.`
                    : 'Your reschedule request was declined by the merchant. Your original appointment remains unchanged.',
                linkUrl: '/profile#bookings',
                dedupeKey: `merchant-reschedule-review-${requestId}-${action}`
            }, logNotificationError);
        }

        req.session.merchantSuccess = approved
            ? 'Reschedule approved and booking updated.'
            : 'Reschedule request rejected. The original booking was kept.';
        return res.redirect('/merchant/bookings');
    });
}

function showSchedule(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Booking.getByMerchantUserId(req.session.user.id, (bookingError, bookings = []) => {
            if (bookingError) {
                console.error(bookingError);
            }

            const appointmentReport = buildAppointmentReport(bookingError ? [] : bookings || []);

            return enrichAppointmentReportQr(req, appointmentReport, (qrError, enrichedAppointmentReport) => {
                if (qrError) {
                    console.error(qrError);
                }

                const success = req.session.merchantSuccess;
                const error = req.session.merchantError;
                req.session.merchantSuccess = null;
                req.session.merchantError = null;

                return res.render('merchant-schedule', {
                    title: 'Appointment Calendar',
                    merchant,
                    appointmentReport: qrError ? appointmentReport : enrichedAppointmentReport,
                    databaseError: Boolean(bookingError || qrError),
                    success,
                    error
                });
            });
        });
    });
}

function showNewService(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return MerchantService.getCategories((categoryError, categories) => {
            if (categoryError) {
                console.error(categoryError);
                return res.status(500).render('error', {
                    title: 'Categories Not Found',
                    message: 'Service categories could not be loaded.'
                });
            }

            return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                if (productError) {
                    console.error(productError);
                    return res.status(500).render('error', {
                        title: 'Products Not Found',
                        message: 'Merchant inventory could not be loaded.'
                    });
                }

                return renderServiceForm(res, {
                    title: 'Add Service',
                    merchant,
                    categories,
                    products,
                    service: null,
                    form: getServiceForm(),
                    errors: []
                });
            });
        });
    });
}

function createService(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const form = getServiceForm(req.body);

        return MerchantService.getCategories((categoryError, categories) => {
            if (categoryError) {
                console.error(categoryError);
                return res.status(500).render('error', {
                    title: 'Categories Not Found',
                    message: 'Service categories could not be loaded.'
                });
            }

            return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                if (productError) {
                    console.error(productError);
                    return res.status(500).render('error', {
                        title: 'Products Not Found',
                        message: 'Merchant inventory could not be loaded.'
                    });
                }

                const errors = validateServiceForm(form, products);

                if (errors.length > 0) {
                    return renderServiceForm(res, {
                        title: 'Add Service',
                        merchant,
                        categories,
                        products,
                        service: null,
                        form,
                        errors,
                        status: 400
                    });
                }

                return MerchantService.createService(req.session.user.id, buildServicePayload(form), (createError) => {
                    if (createError) {
                        console.error(createError);
                        return renderServiceForm(res, {
                            title: 'Add Service',
                            merchant,
                            categories,
                            products,
                            service: null,
                            form,
                            errors: ['Service could not be created. Please check the category, inventory link, and timeslots.'],
                            status: 500
                        });
                    }

                    req.session.merchantSuccess = 'Service created successfully.';
                    notifyMerchant(req.session.user.id, {
                        actorUserId: req.session.user.id,
                        type: 'merchant_update',
                        title: 'Service listed',
                        message: `${form.name} is now listed with customer booking slots.`,
                        linkUrl: '/merchant/services',
                        dedupeKey: `merchant-service-created-${Date.now()}-${req.session.user.id}`
                    });
                    notifyAdmins({
                        actorUserId: req.session.user.id,
                        type: 'merchant_update',
                        title: 'Merchant added a service',
                        message: `${merchant.name} listed ${form.name}.`,
                        linkUrl: '/admin/services',
                        dedupeKey: `admin-merchant-service-created-${Date.now()}`
                    });
                    return res.redirect('/merchant/services');
                });
            });
        });
    });
}

function showEditService(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return MerchantService.findServiceForMerchant(req.session.user.id, req.params.serviceId, (serviceError, service) => {
            if (serviceError) {
                console.error(serviceError);
                return res.status(500).render('error', {
                    title: 'Service Not Found',
                    message: 'Service data could not be loaded.'
                });
            }

            if (!service) {
                return res.status(404).render('error', {
                    title: 'Service Not Found',
                    message: 'This service does not belong to your merchant account.'
                });
            }

            return MerchantService.getCategories((categoryError, categories) => {
                if (categoryError) {
                    console.error(categoryError);
                    return res.status(500).render('error', {
                        title: 'Categories Not Found',
                        message: 'Service categories could not be loaded.'
                    });
                }

                return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                    if (productError) {
                        console.error(productError);
                        return res.status(500).render('error', {
                            title: 'Products Not Found',
                            message: 'Merchant inventory could not be loaded.'
                        });
                    }

                    return renderServiceForm(res, {
                        title: 'Edit Service',
                        merchant,
                        categories,
                        products,
                        service,
                        form: {
                            name: service.name,
                            description: service.description,
                            categoryId: String(service.categoryId),
                            durationMins: String(service.durationMins),
                            price: String(service.price),
                            slots: (service.slots || []).join(', '),
                            packageEnabled: Boolean(service.packageEnabled),
                            packageSessions: service.packageSessions ? String(service.packageSessions) : '',
                            packagePrice: service.packagePrice ? String(service.packagePrice) : '',
                            inventoryProductId: service.inventoryProductId ? String(service.inventoryProductId) : '',
                            inventoryQuantityRequired: service.inventoryQuantityRequired ? String(service.inventoryQuantityRequired) : '',
                            routineGoalTags: service.routineGoalTags || [],
                            routineConcernTags: service.routineConcernTags || [],
                            routineRecommendationNote: service.routineRecommendationNote || '',
                            routineBudgetMin: service.routineBudgetMin === null || service.routineBudgetMin === undefined ? '' : String(service.routineBudgetMin),
                            routineBudgetMax: service.routineBudgetMax === null || service.routineBudgetMax === undefined ? '' : String(service.routineBudgetMax)
                        },
                        errors: []
                    });
                });
            });
        });
    });
}

function updateService(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return MerchantService.findServiceForMerchant(req.session.user.id, req.params.serviceId, (serviceError, service) => {
            if (serviceError) {
                console.error(serviceError);
                return res.status(500).render('error', {
                    title: 'Service Not Found',
                    message: 'Service data could not be loaded.'
                });
            }

            if (!service) {
                return res.status(404).render('error', {
                    title: 'Service Not Found',
                    message: 'This service does not belong to your merchant account.'
                });
            }

            const form = getServiceForm(req.body);

            return MerchantService.getCategories((categoryError, categories) => {
                if (categoryError) {
                    console.error(categoryError);
                    return res.status(500).render('error', {
                        title: 'Categories Not Found',
                        message: 'Service categories could not be loaded.'
                    });
                }

                return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                    if (productError) {
                        console.error(productError);
                        return res.status(500).render('error', {
                            title: 'Products Not Found',
                            message: 'Merchant inventory could not be loaded.'
                        });
                    }

                    const errors = validateServiceForm(form, products);

                    if (errors.length > 0) {
                        return renderServiceForm(res, {
                            title: 'Edit Service',
                            merchant,
                            categories,
                            products,
                            service,
                            form,
                            errors,
                            status: 400
                        });
                    }

                    return MerchantService.updateService(req.session.user.id, service.id, buildServicePayload(form), (updateError) => {
                        if (updateError) {
                            console.error(updateError);
                            return renderServiceForm(res, {
                                title: 'Edit Service',
                                merchant,
                                categories,
                                products,
                                service,
                                form,
                                errors: ['Service could not be updated. Please check the category, inventory link, and timeslots.'],
                                status: 500
                            });
                        }

                        req.session.merchantSuccess = 'Service updated successfully.';
                        notifyMerchant(req.session.user.id, {
                            actorUserId: req.session.user.id,
                            type: 'merchant_update',
                            title: 'Service updated',
                            message: `${form.name} was updated successfully.`,
                            linkUrl: '/merchant/services',
                            dedupeKey: `merchant-service-updated-${service.id}-${Date.now()}`
                        });
                        notifyAdmins({
                            actorUserId: req.session.user.id,
                            type: 'merchant_update',
                            title: 'Merchant updated a service',
                            message: `${merchant.name} updated ${form.name}.`,
                            linkUrl: '/admin/services',
                            dedupeKey: `admin-merchant-service-updated-${service.id}-${Date.now()}`
                        });
                        return res.redirect('/merchant/services');
                    });
                });
            });
        });
    });
}

function deleteService(req, res) {
    return MerchantService.deleteService(req.session.user.id, req.params.serviceId, (error, deleted) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Service could not be deleted. It may already have bookings.';
            return res.redirect('/merchant/services');
        }

        req.session.merchantSuccess = deleted ? 'Service deleted successfully.' : null;
        req.session.merchantError = deleted ? null : 'Service could not be deleted.';

        return res.redirect('/merchant/services');
    });
}

function getVoucherForm(body = {}) {
    return {
        title: String(body.title || '').trim(),
        detail: String(body.detail || '').trim(),
        linkedItemType: String(body.linkedItemType || '').trim(),
        linkedItemId: String(body.linkedItemId || '').trim(),
        discountType: String(body.discountType || '').trim(),
        discountValue: String(body.discountValue || '').trim(),
        minimumSpend: String(body.minimumSpend || '').trim(),
        pointsRequired: String(body.pointsRequired || '').trim(),
        startDate: String(body.startDate || '').trim(),
        expiryDate: String(body.expiryDate || '').trim(),
        usageLimitPerUser: String(body.usageLimitPerUser || '').trim(),
        usageLimitTotal: String(body.usageLimitTotal || '').trim(),
        status: String(body.status || '').trim()
    };
}

function validateVoucherForm(form, merchant, products = []) {
    const errors = [];
    const linkedItemId = Number(form.linkedItemId);
    const discountValue = Number(form.discountValue);
    const minimumSpend = form.minimumSpend === '' ? 0 : Number(form.minimumSpend);
    const pointsRequired = Number(form.pointsRequired);
    const usageLimitPerUser = form.usageLimitPerUser === '' ? null : Number(form.usageLimitPerUser);
    const usageLimitTotal = form.usageLimitTotal === '' ? null : Number(form.usageLimitTotal);
    const startDate = form.startDate ? new Date(form.startDate) : null;
    const expiryDate = form.expiryDate ? new Date(form.expiryDate) : null;
    const merchantServiceIds = new Set((merchant.services || []).map((service) => Number(service.id)));
    const merchantProductIds = new Set((products || []).map((product) => Number(product.id)));

    if (form.title.length < 2) {
        errors.push('Voucher title must be at least 2 characters.');
    }

    if (form.detail.length < 10) {
        errors.push('Voucher description must be at least 10 characters.');
    }

    if (!RewardVoucher.LINKED_ITEM_TYPES.includes(form.linkedItemType)) {
        errors.push('Please choose whether this voucher is for an existing service or product.');
    }

    if (!Number.isInteger(linkedItemId) || linkedItemId < 1) {
        errors.push('Please choose a valid listed service or product.');
    } else if (form.linkedItemType === 'service' && !merchantServiceIds.has(linkedItemId)) {
        errors.push('The selected service does not belong to your merchant listing.');
    } else if (form.linkedItemType === 'product' && !merchantProductIds.has(linkedItemId)) {
        errors.push('The selected product does not belong to your merchant listing.');
    }

    if (!RewardVoucher.DISCOUNT_TYPES.includes(form.discountType)) {
        errors.push('Please choose a valid discount type.');
    }

    if (!Number.isFinite(discountValue) || discountValue <= 0) {
        errors.push('Please enter a valid discount value.');
    } else if (form.discountType === 'percentage' && discountValue > 100) {
        errors.push('Percentage discount cannot exceed 100%.');
    }

    if (!Number.isFinite(minimumSpend) || minimumSpend < 0) {
        errors.push('Please enter a valid minimum spend.');
    }

    if (!Number.isInteger(pointsRequired) || pointsRequired < 1) {
        errors.push('Please enter a valid VaniGlints redemption cost.');
    }

    if (form.startDate && (!(startDate instanceof Date) || Number.isNaN(startDate?.getTime()))) {
        errors.push('Please enter a valid voucher start date.');
    }

    if (form.expiryDate && (!(expiryDate instanceof Date) || Number.isNaN(expiryDate?.getTime()))) {
        errors.push('Please enter a valid voucher expiry date.');
    }

    if (startDate && expiryDate && startDate > expiryDate) {
        errors.push('Voucher expiry date must be after the start date.');
    }

    if (usageLimitPerUser !== null && (!Number.isInteger(usageLimitPerUser) || usageLimitPerUser < 1)) {
        errors.push('Per-user usage limit must be at least 1.');
    }

    if (usageLimitTotal !== null && (!Number.isInteger(usageLimitTotal) || usageLimitTotal < 1)) {
        errors.push('Total usage limit must be at least 1.');
    }

    if (!RewardVoucher.STATUSES.includes(form.status)) {
        errors.push('Please choose a valid voucher status.');
    }

    return errors;
}

function buildVoucherPayload(form, merchant) {
    const discountType = form.discountType;
    const discountValue = Number(form.discountValue);

    return {
        title: form.title,
        detail: form.detail,
        merchantId: merchant.id,
        voucherSource: 'merchant',
        discountType,
        discountValue,
        voucherValue: discountType === 'fixed' ? discountValue : 0,
        minimumSpend: Number(form.minimumSpend || 0),
        pointsRequired: Number(form.pointsRequired),
        glintsCost: Number(form.pointsRequired),
        startDate: form.startDate ? form.startDate.replace('T', ' ') : null,
        expiryDate: form.expiryDate ? form.expiryDate.replace('T', ' ') : null,
        usageLimitPerUser: form.usageLimitPerUser === '' ? null : Number(form.usageLimitPerUser),
        usageLimitTotal: form.usageLimitTotal === '' ? null : Number(form.usageLimitTotal),
        status: form.status,
        sortOrder: 0,
        linkedItemType: form.linkedItemType,
        linkedItemId: Number(form.linkedItemId)
    };
}

function featureService(req, res) {
    const form = getFeaturedConfigForm(req.body);

    return MerchantService.markServiceFeatured(req.session.user.id, req.params.serviceId, form, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = error.message || 'Service could not be marked as featured.';
            return res.redirect('/merchant/services');
        }

        req.session.merchantSuccess = result?.affectedRows
            ? 'Service marked as featured.'
            : 'Service could not be marked as featured.';
        return res.redirect('/merchant/services');
    });
}

function unfeatureService(req, res) {
    return MerchantService.removeServiceFeatured(req.session.user.id, req.params.serviceId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Service could not be removed from featured.';
            return res.redirect('/merchant/services');
        }

        req.session.merchantSuccess = result?.affectedRows
            ? 'Service removed from featured.'
            : 'Service could not be updated.';
        return res.redirect('/merchant/services');
    });
}

function listProducts(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Merchant Products Error',
                    message: 'Products could not be loaded from the database.'
                });
            }

            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;
            return PurchaseHistory.getProductSalesCounts((salesError, salesCounts = {}) => {
                if (salesError) {
                    console.error(salesError);
                }

                const recommendationMap = buildProductFeaturedRecommendations(products || [], salesCounts);
                const productsWithRecommendations = (products || []).map((product) => ({
                    ...product,
                    salesCount: Number(salesCounts[Number(product.id)] || 0),
                    featuredRecommendation: recommendationMap.get(String(product.id)) || null
                }));

                return res.render('merchant-products', {
                    title: 'Merchant Products',
                    merchant,
                    products: productsWithRecommendations,
                    success,
                    error
                });
            });
        });
    });
}

function featureProduct(req, res) {
    const form = getFeaturedConfigForm(req.body);

    return Product.markProductFeatured(req.session.user.id, req.params.productId, form, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = error.message || 'Product could not be marked as featured.';
            return res.redirect('/merchant/products');
        }

        req.session.merchantSuccess = result?.affectedRows
            ? 'Product marked as featured.'
            : 'Product could not be marked as featured.';
        return res.redirect('/merchant/products');
    });
}

function unfeatureProduct(req, res) {
    return Product.removeProductFeatured(req.session.user.id, req.params.productId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Product could not be removed from featured.';
            return res.redirect('/merchant/products');
        }

        req.session.merchantSuccess = result?.affectedRows
            ? 'Product removed from featured.'
            : 'Product could not be updated.';
        return res.redirect('/merchant/products');
    });
}

function showNewProduct(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const uploadError = req.session.merchantError;
        req.session.merchantError = null;

        return MerchantService.getProductCategories((categoryError, categories) => {
            if (categoryError) {
                console.error(categoryError);
                return res.status(500).render('error', {
                    title: 'Categories Not Found',
                    message: 'Product categories could not be loaded.'
                });
            }

            return res.render('merchant-product-form', {
                title: 'Add Product',
                merchant,
                categories,
                product: null,
                form: getProductForm(),
                routineTagOptions,
                errors: uploadError ? [uploadError] : []
            });
        });
    });
}

function createProduct(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return MerchantService.getProductCategories((categoryError, categories) => {
            if (categoryError) {
                console.error(categoryError);
                return res.status(500).render('error', {
                    title: 'Categories Not Found',
                    message: 'Product categories could not be loaded.'
                });
            }

            const uploadedImagePath = getProductImagePath(req.file);
            const form = getProductForm(req.body, uploadedImagePath || '');
            const errors = validateProductForm(form);

            if (errors.length > 0) {
                deleteProductImageFile(uploadedImagePath);
                form.imageUrl = '';
                return res.status(400).render('merchant-product-form', {
                    title: 'Add Product',
                    merchant,
                    categories,
                    product: null,
                    form,
                    routineTagOptions,
                    errors
                });
            }

            return Product.createForMerchant(req.session.user.id, buildProductPayload(form), (createError, result) => {
                if (createError) {
                    console.error(createError);
                    deleteProductImageFile(uploadedImagePath);
                    return res.status(500).render('merchant-product-form', {
                        title: 'Add Product',
                        merchant,
                        categories,
                        product: null,
                        form,
                        routineTagOptions,
                        errors: ['Product could not be created. Please try again.']
                    });
                }

                if (!result || result.affectedRows === 0) {
                    deleteProductImageFile(uploadedImagePath);
                    return res.status(403).render('error', {
                        title: 'Merchant Not Assigned',
                        message: 'Your merchant account needs an admin-created salon before products can be listed.'
                    });
                }

                req.session.merchantSuccess = 'Product created successfully.';
                notifyMerchant(req.session.user.id, {
                    actorUserId: req.session.user.id,
                    type: 'product_update',
                    title: 'Product listed',
                    message: `${form.name} is now available in the Vaniday product catalogue.`,
                    linkUrl: '/merchant/products',
                    dedupeKey: `merchant-product-created-${result?.insertId || Date.now()}-${req.session.user.id}`
                });
                notifyCustomers({
                    actorUserId: req.session.user.id,
                    type: 'product_update',
                    title: 'New beauty product added',
                    message: `${merchant.name} added ${form.name} to the Vaniday shop.`,
                    linkUrl: '/products',
                    dedupeKey: `customer-product-created-${result?.insertId || Date.now()}`
                });
                notifyAdmins({
                    actorUserId: req.session.user.id,
                    type: 'product_update',
                    title: 'Merchant listed a product',
                    message: `${merchant.name} listed ${form.name}.`,
                    linkUrl: '/admin/products',
                    dedupeKey: `admin-product-created-${result?.insertId || Date.now()}`
                });
                return res.redirect('/merchant/products');
            });
        });
    });
}

function showEditProduct(req, res) {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId < 1) {
        req.session.merchantError = 'Product could not be found.';
        return res.redirect('/merchant/products');
    }

    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.findForMerchant(req.session.user.id, req.params.productId, (productError, product) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Product Not Found',
                    message: 'Product data could not be loaded.'
                });
            }

            if (!product) {
                return res.status(404).render('error', {
                    title: 'Product Not Found',
                    message: 'This product does not belong to your merchant account.'
                });
            }

            const uploadError = req.session.merchantError;
            req.session.merchantError = null;

            return MerchantService.getProductCategories((categoryError, categories) => {
                if (categoryError) {
                    console.error(categoryError);
                    return res.status(500).render('error', {
                        title: 'Categories Not Found',
                        message: 'Product categories could not be loaded.'
                    });
                }

                return res.render('merchant-product-form', {
                    title: 'Edit Product',
                    merchant,
                    categories,
                    product,
                    form: {
                        name: product.name,
                        categoryId: product.categoryId || '',
                        price: String(product.price),
                        stockQuantity: String(product.stockQuantity),
                        imageUrl: product.imageUrl || '',
                        description: product.description || '',
                        ingredients: product.ingredients || '',
                        howToUse: product.howToUse || '',
                        routineGoalTags: product.routineGoalTags || [],
                        routineConcernTags: product.routineConcernTags || [],
                        routineRecommendationNote: product.routineRecommendationNote || '',
                        routineBudgetMin: product.routineBudgetMin === null || product.routineBudgetMin === undefined ? '' : String(product.routineBudgetMin),
                        routineBudgetMax: product.routineBudgetMax === null || product.routineBudgetMax === undefined ? '' : String(product.routineBudgetMax)
                    },
                    routineTagOptions,
                    errors: uploadError ? [uploadError] : []
                });
            });
        });
    });
}

function updateProduct(req, res) {
    const productId = Number(req.params.productId);

    if (!Number.isInteger(productId) || productId < 1) {
        deleteProductImageFile(getProductImagePath(req.file));
        req.session.merchantError = 'Product could not be found.';
        return res.redirect('/merchant/products');
    }

    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const uploadedImagePath = getProductImagePath(req.file);

        return Product.findForMerchant(req.session.user.id, req.params.productId, (productError, product) => {
            if (productError) {
                console.error(productError);
                deleteProductImageFile(uploadedImagePath);
                return res.status(500).render('error', {
                    title: 'Product Not Found',
                    message: 'Product data could not be loaded.'
                });
            }

            if (!product) {
                deleteProductImageFile(uploadedImagePath);
                req.session.merchantError = 'This product could not be found for your merchant account.';
                return res.redirect('/merchant/products');
            }

            return MerchantService.getProductCategories((categoryError, categories) => {
                if (categoryError) {
                    console.error(categoryError);
                    deleteProductImageFile(uploadedImagePath);
                    return res.status(500).render('error', {
                        title: 'Categories Not Found',
                        message: 'Product categories could not be loaded.'
                    });
                }

                const form = getProductForm(req.body, uploadedImagePath || product.imageUrl || '');
                const errors = validateProductForm(form);

                if (errors.length > 0) {
                    deleteProductImageFile(uploadedImagePath);
                    form.imageUrl = product.imageUrl || '';
                    return res.status(400).render('merchant-product-form', {
                        title: 'Edit Product',
                        merchant,
                        categories,
                        product,
                        form,
                        routineTagOptions,
                        errors
                    });
                }

                return Product.updateForMerchant(req.session.user.id, product.id, buildProductPayload(form), (updateError, result) => {
                    if (updateError) {
                        console.error(updateError);
                        deleteProductImageFile(uploadedImagePath);
                        form.imageUrl = product.imageUrl || '';
                        return res.status(500).render('merchant-product-form', {
                            title: 'Edit Product',
                            merchant,
                            categories,
                            product,
                            form,
                            routineTagOptions,
                            errors: ['Product could not be updated. Please try again.']
                        });
                    }

                    req.session.merchantSuccess = result.affectedRows > 0 ? 'Product updated successfully.' : null;
                    req.session.merchantError = result.affectedRows > 0 ? null : 'Product could not be updated.';
                    if (result.affectedRows > 0) {
                        if (uploadedImagePath && uploadedImagePath !== product.imageUrl) {
                            deleteProductImageFile(product.imageUrl);
                        }
                        notifyMerchant(req.session.user.id, {
                            actorUserId: req.session.user.id,
                            type: 'product_update',
                            title: 'Product updated',
                            message: `${form.name} details were saved.`,
                            linkUrl: '/merchant/products',
                            dedupeKey: `merchant-product-updated-${product.id}-${Date.now()}`
                        });
                        notifyAdmins({
                            actorUserId: req.session.user.id,
                            type: 'product_update',
                            title: 'Merchant updated a product',
                            message: `${merchant.name} updated ${form.name}.`,
                            linkUrl: '/admin/products',
                            dedupeKey: `admin-product-updated-${product.id}-${Date.now()}`
                        });
                    } else {
                        deleteProductImageFile(uploadedImagePath);
                    }
                    return res.redirect('/merchant/products');
                });
            });

            return Product.updateForMerchant(req.session.user.id, product.id, buildProductPayload(form), (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    deleteProductImageFile(uploadedImagePath);
                    form.imageUrl = product.imageUrl || '';
                    return res.status(500).render('merchant-product-form', {
                        title: 'Edit Product',
                        merchant,
                        product,
                        form,
                        errors: ['Product could not be updated. Please try again.']
                    });
                }

                req.session.merchantSuccess = result.affectedRows > 0 ? 'Product updated successfully.' : null;
                req.session.merchantError = result.affectedRows > 0 ? null : 'Product could not be updated.';
                if (result.affectedRows > 0) {
                    if (uploadedImagePath && uploadedImagePath !== product.imageUrl) {
                        deleteProductImageFile(product.imageUrl);
                    }
                    notifyMerchant(req.session.user.id, {
                        actorUserId: req.session.user.id,
                        type: 'product_update',
                        title: 'Product updated',
                        message: `${form.name} details were saved.`,
                        linkUrl: '/merchant/products',
                        dedupeKey: `merchant-product-updated-${product.id}-${Date.now()}`
                    });
                    notifyAdmins({
                        actorUserId: req.session.user.id,
                        type: 'product_update',
                        title: 'Merchant updated a product',
                        message: `${merchant.name} updated ${form.name}.`,
                        linkUrl: '/admin/products',
                        dedupeKey: `admin-product-updated-${product.id}-${Date.now()}`
                    });
                } else {
                    deleteProductImageFile(uploadedImagePath);
                }
                return res.redirect('/merchant/products');
            });
        });
    });
}

function restockProduct(req, res) {
    const quantity = Number(req.body.quantity || 1);

    return Product.restockForMerchant(req.session.user.id, req.params.productId, quantity, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Product stock could not be updated.';
            return res.redirect('/merchant/products');
        }

        req.session.merchantSuccess = result.affectedRows > 0
            ? `Stock updated by ${Math.max(1, Math.min(Math.floor(quantity || 1), 999))}.`
            : null;
        req.session.merchantError = result.affectedRows > 0 ? null : 'This product could not be found for your merchant account.';
        if (result.affectedRows > 0) {
            notifyMerchant(req.session.user.id, {
                actorUserId: req.session.user.id,
                type: 'stock_update',
                title: 'Stock updated',
                message: `Product stock increased by ${Math.max(1, Math.min(Math.floor(quantity || 1), 999))}.`,
                linkUrl: '/merchant/products',
                dedupeKey: `merchant-stock-updated-${req.params.productId}-${Date.now()}`
            });
            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'stock_update',
                title: 'Merchant restocked a product',
                message: `Merchant product #${req.params.productId} stock increased by ${Math.max(1, Math.min(Math.floor(quantity || 1), 999))}.`,
                linkUrl: '/admin/products',
                dedupeKey: `admin-stock-updated-${req.params.productId}-${Date.now()}`
            });
        }

        return res.redirect('/merchant/products');
    });
}

function deleteProduct(req, res) {
    return Product.deleteForMerchant(req.session.user.id, req.params.productId, (error, deleted) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Product could not be deleted.';
            return res.redirect('/merchant/products');
        }

        req.session.merchantSuccess = deleted ? 'Product deleted successfully.' : null;
        req.session.merchantError = deleted ? null : 'Product could not be deleted.';
        return res.redirect('/merchant/products');
    });
}

function listPromotions(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Promotion.getByMerchantUserId(req.session.user.id, (promotionError, promotions) => {
            if (promotionError) {
                console.error(promotionError);
                return res.status(500).render('error', {
                    title: 'Merchant Promotions Error',
                    message: 'Promotions could not be loaded from the database.'
                });
            }

            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;

            return res.render('merchant-promotions', {
                title: 'Merchant Promotions',
                merchant,
                promotions,
                success,
                error
            });
        });
    });
}

function showNewPromotion(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
            }

            return res.render('merchant-promotion-form', {
                title: 'Add Promotion',
                merchant,
                products: productError ? [] : products,
                promotion: null,
                form: getPromotionForm({
                    status: 'draft',
                    discountType: 'percentage',
                    type: 'first_trial'
                }),
                promotionTypes: Promotion.PROMOTION_TYPES,
                spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                discountTypes: Promotion.DISCOUNT_TYPES,
                statuses: Promotion.PROMOTION_STATUSES,
                errors: []
            });
        });
    });
}

function updateOnboarding(req, res) {
    const form = getMerchantProfileForm(req.body);
    const errors = validateMerchantProfileForm(form);

    if (errors.length > 0) {
        req.session.merchantError = errors.join(' ');
        return res.redirect('/merchant/onboarding');
    }

    return MerchantService.updateMerchantProfile(req.session.user.id, {
        ...form,
        yearsInBusiness: Number(form.yearsInBusiness),
        staffCount: Number(form.staffCount)
    }, (error) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Merchant application could not be saved. Please try again.';
            return res.redirect('/merchant/onboarding');
        }

        req.session.user.name = form.ownerName;
        req.session.user.phone = form.ownerPhone;
        req.session.user.merchantApprovalStatus = 'pending_review';
        req.session.merchantSuccess = 'Business information saved and submitted for admin review.';
        return res.redirect('/merchant/onboarding');
    });
}

function createPromotion(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
            }

            const safeProducts = productError ? [] : products;
            const form = getPromotionForm(req.body);
            const errors = validatePromotionForm(form, merchant, safeProducts);

            if (errors.length > 0) {
                return res.status(400).render('merchant-promotion-form', {
                    title: 'Add Promotion',
                    merchant,
                    products: safeProducts,
                    promotion: null,
                    form,
                    promotionTypes: Promotion.PROMOTION_TYPES,
                    spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                    discountTypes: Promotion.DISCOUNT_TYPES,
                    statuses: Promotion.PROMOTION_STATUSES,
                    errors
                });
            }

            return Promotion.createForMerchant(req.session.user.id, buildPromotionPayload(form), (createError, result) => {
            if (createError) {
                console.error(createError);
                return res.status(500).render('merchant-promotion-form', {
                    title: 'Add Promotion',
                    merchant,
                    products: safeProducts,
                    promotion: null,
                    form,
                    promotionTypes: Promotion.PROMOTION_TYPES,
                    spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                    discountTypes: Promotion.DISCOUNT_TYPES,
                    statuses: Promotion.PROMOTION_STATUSES,
                    errors: ['Promotion could not be created. Please try again.']
                });
            }

            if (!result || result.affectedRows === 0) {
                return res.status(403).render('error', {
                    title: 'Merchant Not Assigned',
                    message: 'Your merchant account needs an admin-created salon before promotions can be created.'
                });
            }

            req.session.merchantSuccess = 'Promotion created successfully.';
            notifyMerchant(req.session.user.id, {
                actorUserId: req.session.user.id,
                type: 'offer_update',
                title: 'Promotion created',
                message: `${form.title} is now saved under your merchant promotions.`,
                linkUrl: '/merchant/promotions',
                dedupeKey: `merchant-promotion-created-${result?.insertId || Date.now()}-${req.session.user.id}`
            });
            notifyCustomers({
                actorUserId: req.session.user.id,
                type: 'offer_update',
                title: 'New offer from Vaniday',
                message: `${merchant.name} added a new promotion: ${form.title}.`,
                linkUrl: '/promotions',
                dedupeKey: `customer-merchant-promotion-created-${result?.insertId || Date.now()}`
            });
            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'offer_update',
                title: 'Merchant promotion created',
                message: `${merchant.name} created ${form.title}.`,
                linkUrl: '/admin/promotions',
                dedupeKey: `admin-merchant-promotion-created-${result?.insertId || Date.now()}`
            });
            return res.redirect('/merchant/promotions');
            });
        });
    });
}

function showEditPromotion(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Promotion.findForMerchant(req.session.user.id, req.params.promotionId, (promotionError, promotion) => {
            if (promotionError) {
                console.error(promotionError);
                return res.status(500).render('error', {
                    title: 'Promotion Not Found',
                    message: 'Promotion data could not be loaded.'
                });
            }

            if (!promotion) {
                return res.status(404).render('error', {
                    title: 'Promotion Not Found',
                    message: 'This promotion does not belong to your merchant account.'
                });
            }

            return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                if (productError) {
                    console.error(productError);
                }

                return res.render('merchant-promotion-form', {
                    title: 'Edit Promotion',
                    merchant,
                    products: productError ? [] : products,
                    promotion,
                    form: {
                        title: promotion.title,
                        serviceId: promotion.serviceId ? String(promotion.serviceId) : '',
                        productId: promotion.productId ? String(promotion.productId) : '',
                        type: promotion.type,
                        discountType: promotion.discountType,
                        discountValue: promotion.discountValue === null ? '' : String(promotion.discountValue),
                        minimumSpend: promotion.minimumSpend ? String(promotion.minimumSpend) : '',
                        usageLimit: promotion.usageLimit === null ? '' : String(promotion.usageLimit),
                        spinEligible: promotion.spinEligible,
                        spinRewardType: promotion.spinRewardType || '',
                        spinClaimLimit: promotion.spinClaimLimit === null ? '' : String(promotion.spinClaimLimit),
                        spinInventoryRemaining: promotion.spinInventoryRemaining === null ? '' : String(promotion.spinInventoryRemaining),
                        showInFlashDeals: promotion.showInFlashDeals,
                        startDate: formatDateInputValue(promotion.startDate),
                        endDate: formatDateInputValue(promotion.endDate),
                        slots: promotion.allowedSlots || '',
                        status: promotion.status,
                        description: promotion.description || '',
                        terms: promotion.terms || ''
                    },
                    promotionTypes: Promotion.PROMOTION_TYPES,
                    spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                    discountTypes: Promotion.DISCOUNT_TYPES,
                    statuses: Promotion.PROMOTION_STATUSES,
                    errors: []
                });
            });
        });
    });
}

function updatePromotion(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Promotion.findForMerchant(req.session.user.id, req.params.promotionId, (promotionError, promotion) => {
            if (promotionError) {
                console.error(promotionError);
                return res.status(500).render('error', {
                    title: 'Promotion Not Found',
                    message: 'Promotion data could not be loaded.'
                });
            }

            if (!promotion) {
                return res.status(404).render('error', {
                    title: 'Promotion Not Found',
                    message: 'This promotion does not belong to your merchant account.'
                });
            }

            return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
                if (productError) {
                    console.error(productError);
                }

                const safeProducts = productError ? [] : products;
                const form = getPromotionForm(req.body);
                const errors = validatePromotionForm(form, merchant, safeProducts);

                if (errors.length > 0) {
                    return res.status(400).render('merchant-promotion-form', {
                        title: 'Edit Promotion',
                        merchant,
                        products: safeProducts,
                        promotion,
                        form,
                        promotionTypes: Promotion.PROMOTION_TYPES,
                        spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                        discountTypes: Promotion.DISCOUNT_TYPES,
                        statuses: Promotion.PROMOTION_STATUSES,
                        errors
                    });
                }

                return Promotion.updateForMerchant(req.session.user.id, promotion.id, buildPromotionPayload(form), (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    return res.status(500).render('merchant-promotion-form', {
                        title: 'Edit Promotion',
                        merchant,
                        products: safeProducts,
                        promotion,
                        form,
                        promotionTypes: Promotion.PROMOTION_TYPES,
                        spinRewardTypes: Promotion.SPIN_REWARD_TYPES,
                        discountTypes: Promotion.DISCOUNT_TYPES,
                        statuses: Promotion.PROMOTION_STATUSES,
                        errors: ['Promotion could not be updated. Please try again.']
                    });
                }

                req.session.merchantSuccess = result.affectedRows > 0 ? 'Promotion updated successfully.' : null;
                req.session.merchantError = result.affectedRows > 0 ? null : 'Promotion could not be updated.';
                if (result.affectedRows > 0) {
                    notifyMerchant(req.session.user.id, {
                        actorUserId: req.session.user.id,
                        type: 'offer_update',
                        title: 'Promotion updated',
                        message: `${form.title} was updated successfully.`,
                        linkUrl: '/merchant/promotions',
                        dedupeKey: `merchant-promotion-updated-${promotion.id}-${Date.now()}`
                    });
                    notifyCustomers({
                        actorUserId: req.session.user.id,
                        type: 'offer_update',
                        title: 'Offer updated',
                        message: `${merchant.name} updated ${form.title}.`,
                        linkUrl: '/promotions',
                        dedupeKey: `customer-merchant-promotion-updated-${promotion.id}-${Date.now()}`
                    });
                    notifyAdmins({
                        actorUserId: req.session.user.id,
                        type: 'offer_update',
                        title: 'Merchant promotion updated',
                        message: `${merchant.name} updated ${form.title}.`,
                        linkUrl: '/admin/promotions',
                        dedupeKey: `admin-merchant-promotion-updated-${promotion.id}-${Date.now()}`
                    });
                }
                return res.redirect('/merchant/promotions');
                });
            });
        });
    });
}

function deletePromotion(req, res) {
    return Promotion.deleteForMerchant(req.session.user.id, req.params.promotionId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Promotion could not be deleted.';
            return res.redirect('/merchant/promotions');
        }

        const deleted = Boolean(result && result.affectedRows > 0);
        req.session.merchantSuccess = deleted ? 'Promotion deleted successfully.' : null;
        req.session.merchantError = deleted ? null : 'Promotion could not be deleted.';
        return res.redirect('/merchant/promotions');
    });
}

function listVouchers(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return RewardVoucher.getByMerchantUserId(req.session.user.id, (voucherError, vouchers = []) => {
            if (voucherError) {
                console.error(voucherError);
                return res.status(500).render('error', {
                    title: 'Merchant Vouchers Error',
                    message: 'Vouchers could not be loaded from the database.'
                });
            }

            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;

            return res.render('merchant-vouchers', {
                title: 'Merchant Vouchers',
                merchant,
                vouchers,
                success,
                error
            });
        });
    });
}

function showNewVoucher(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Merchant Voucher Error',
                    message: 'Products could not be loaded for voucher creation.'
                });
            }

            return res.render('merchant-voucher-form', {
                title: 'Add Voucher',
                merchant,
                voucher: null,
                form: getVoucherForm({
                    status: 'active',
                    discountType: 'percentage',
                    linkedItemType: 'service'
                }),
                services: merchant.services || [],
                products,
                statuses: RewardVoucher.STATUSES,
                discountTypes: RewardVoucher.DISCOUNT_TYPES,
                linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                errors: []
            });
        });
    });
}

function createVoucher(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Merchant Voucher Error',
                    message: 'Products could not be loaded for voucher creation.'
                });
            }

            const form = getVoucherForm(req.body);
            const errors = validateVoucherForm(form, merchant, products);

            if (errors.length > 0) {
                return res.status(400).render('merchant-voucher-form', {
                    title: 'Add Voucher',
                    merchant,
                    voucher: null,
                    form,
                    services: merchant.services || [],
                    products,
                    statuses: RewardVoucher.STATUSES,
                    discountTypes: RewardVoucher.DISCOUNT_TYPES,
                    linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                    errors
                });
            }

            return RewardVoucher.createForMerchant(req.session.user.id, buildVoucherPayload(form, merchant), (createError, result) => {
                if (createError) {
                    console.error(createError);
                    return res.status(500).render('merchant-voucher-form', {
                        title: 'Add Voucher',
                        merchant,
                        voucher: null,
                        form,
                        services: merchant.services || [],
                        products,
                        statuses: RewardVoucher.STATUSES,
                        discountTypes: RewardVoucher.DISCOUNT_TYPES,
                        linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                        errors: ['Voucher could not be created. Please try again.']
                    });
                }

                req.session.merchantSuccess = result?.affectedRows === 0
                    ? null
                    : 'Voucher created successfully.';
                req.session.merchantError = result?.affectedRows === 0
                    ? 'Voucher could not be created.'
                    : null;
                return res.redirect('/merchant/vouchers');
            });
        });
    });
}

function showEditVoucher(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Merchant Voucher Error',
                    message: 'Products could not be loaded for voucher editing.'
                });
            }

            return RewardVoucher.findForMerchant(req.session.user.id, req.params.voucherId, (voucherError, voucher) => {
                if (voucherError) {
                    console.error(voucherError);
                    return res.status(500).render('error', {
                        title: 'Voucher Not Found',
                        message: 'Voucher data could not be loaded.'
                    });
                }

                if (!voucher) {
                    return res.status(404).render('error', {
                        title: 'Voucher Not Found',
                        message: 'This voucher does not belong to your merchant account.'
                    });
                }

                return res.render('merchant-voucher-form', {
                    title: 'Edit Voucher',
                    merchant,
                    voucher,
                    form: {
                        title: voucher.title,
                        detail: voucher.detail,
                        linkedItemType: voucher.linkedItemType || 'service',
                        linkedItemId: voucher.linkedItemId ? String(voucher.linkedItemId) : '',
                        discountType: voucher.discountType,
                        discountValue: String(voucher.discountValue),
                        minimumSpend: String(voucher.minimumSpend || 0),
                        pointsRequired: String(voucher.pointsRequired || 0),
                        startDate: formatDateTimeInputValue(voucher.startDate),
                        expiryDate: formatDateTimeInputValue(voucher.expiryDate),
                        usageLimitPerUser: voucher.usageLimitPerUser === null ? '' : String(voucher.usageLimitPerUser),
                        usageLimitTotal: voucher.usageLimitTotal === null ? '' : String(voucher.usageLimitTotal),
                        status: voucher.status
                    },
                    services: merchant.services || [],
                    products,
                    statuses: RewardVoucher.STATUSES,
                    discountTypes: RewardVoucher.DISCOUNT_TYPES,
                    linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                    errors: []
                });
            });
        });
    });
}

function updateVoucher(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Product.getByMerchantUserId(req.session.user.id, (productError, products = []) => {
            if (productError) {
                console.error(productError);
                return res.status(500).render('error', {
                    title: 'Merchant Voucher Error',
                    message: 'Products could not be loaded for voucher editing.'
                });
            }

            return RewardVoucher.findForMerchant(req.session.user.id, req.params.voucherId, (voucherError, voucher) => {
                if (voucherError) {
                    console.error(voucherError);
                    return res.status(500).render('error', {
                        title: 'Voucher Not Found',
                        message: 'Voucher data could not be loaded.'
                    });
                }

                if (!voucher) {
                    return res.status(404).render('error', {
                        title: 'Voucher Not Found',
                        message: 'This voucher does not belong to your merchant account.'
                    });
                }

                const form = getVoucherForm(req.body);
                const errors = validateVoucherForm(form, merchant, products);

                if (errors.length > 0) {
                    return res.status(400).render('merchant-voucher-form', {
                        title: 'Edit Voucher',
                        merchant,
                        voucher,
                        form,
                        services: merchant.services || [],
                        products,
                        statuses: RewardVoucher.STATUSES,
                        discountTypes: RewardVoucher.DISCOUNT_TYPES,
                        linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                        errors
                    });
                }

                return RewardVoucher.updateForMerchant(req.session.user.id, voucher.id, buildVoucherPayload(form, merchant), (updateError, result) => {
                    if (updateError) {
                        console.error(updateError);
                        return res.status(500).render('merchant-voucher-form', {
                            title: 'Edit Voucher',
                            merchant,
                            voucher,
                            form,
                            services: merchant.services || [],
                            products,
                            statuses: RewardVoucher.STATUSES,
                            discountTypes: RewardVoucher.DISCOUNT_TYPES,
                            linkedItemTypes: RewardVoucher.LINKED_ITEM_TYPES,
                            errors: ['Voucher could not be updated. Please try again.']
                        });
                    }

                    req.session.merchantSuccess = result?.affectedRows > 0 ? 'Voucher updated successfully.' : null;
                    req.session.merchantError = result?.affectedRows > 0 ? null : 'Voucher could not be updated.';
                    return res.redirect('/merchant/vouchers');
                });
            });
        });
    });
}

function deleteVoucher(req, res) {
    return RewardVoucher.deleteForMerchant(req.session.user.id, req.params.voucherId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Voucher could not be deleted.';
            return res.redirect('/merchant/vouchers');
        }

        req.session.merchantSuccess = result?.affectedRows ? 'Voucher deleted successfully.' : null;
        req.session.merchantError = result?.affectedRows ? null : 'Voucher could not be deleted.';
        return res.redirect('/merchant/vouchers');
    });
}

function listCashbackCampaigns(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return CashbackCampaign.getByMerchantUserId(req.session.user.id, (campaignError, campaigns = []) => {
            if (campaignError) {
                console.error(campaignError);
                return res.status(500).render('error', {
                    title: 'Cashback Campaigns Error',
                    message: 'Cashback campaigns could not be loaded.'
                });
            }

            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;

            return res.render('merchant-cashback', {
                title: 'Merchant Cashback',
                merchant,
                campaigns,
                success,
                error
            });
        });
    });
}

function showNewCashbackCampaign(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return res.render('merchant-cashback-form', {
            title: 'New Cashback Campaign',
            merchant,
            campaign: null,
            form: {
                salonId: merchant.id,
                title: '',
                cashbackPercent: '',
                minimumSpend: '0.00',
                startAt: '',
                endAt: '',
                status: 'draft',
                applicableType: 'both'
            },
            statuses: CashbackCampaign.CAMPAIGN_STATUSES,
            applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
            errors: []
        });
    });
}

function createCashbackCampaign(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const payload = {
            ...getCashbackCampaignForm(req.body),
            salonId: merchant.id,
            createdByUserId: req.session.user.id
        };
        const errors = CashbackCampaign.validateCampaign(payload);

        if (errors.length) {
            return res.status(400).render('merchant-cashback-form', {
                title: 'New Cashback Campaign',
                merchant,
                campaign: null,
                form: payload,
                statuses: CashbackCampaign.CAMPAIGN_STATUSES,
                applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
                errors
            });
        }

        return CashbackCampaign.createForMerchant(req.session.user.id, payload, (createError, result) => {
            if (createError) {
                console.error(createError);
                return res.status(500).render('merchant-cashback-form', {
                    title: 'New Cashback Campaign',
                    merchant,
                    campaign: null,
                    form: payload,
                    statuses: CashbackCampaign.CAMPAIGN_STATUSES,
                    applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
                    errors: ['Cashback campaign could not be created.']
                });
            }

            req.session.merchantSuccess = result?.affectedRows ? 'Cashback campaign created.' : null;
            req.session.merchantError = result?.affectedRows ? null : 'Cashback campaign could not be created for this merchant.';
            if (result?.affectedRows) {
                notifyAdmins({
                    actorUserId: req.session.user.id,
                    type: 'cashback_update',
                    title: 'Merchant cashback campaign created',
                    message: `${merchant.name} created ${payload.title}.`,
                    linkUrl: '/admin/cashback',
                    dedupeKey: `admin-merchant-cashback-created-${result?.insertId || Date.now()}`
                });
            }
            return res.redirect('/merchant/cashback');
        });
    });
}

function showEditCashbackCampaign(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return CashbackCampaign.findForMerchant(req.session.user.id, req.params.campaignId, (campaignError, campaign) => {
            if (campaignError) {
                console.error(campaignError);
                return res.status(500).render('error', {
                    title: 'Cashback Campaign Error',
                    message: 'Cashback campaign could not be loaded.'
                });
            }

            if (!campaign) {
                return res.status(404).render('error', {
                    title: 'Cashback Campaign Not Found',
                    message: 'This cashback campaign does not belong to your merchant account.'
                });
            }

            return res.render('merchant-cashback-form', {
                title: 'Edit Cashback Campaign',
                merchant,
                campaign,
                form: {
                    salonId: campaign.salonId,
                    title: campaign.title,
                    cashbackPercent: String(campaign.cashbackPercent),
                    minimumSpend: Number(campaign.minimumSpend || 0).toFixed(2),
                    startAt: formatDateTimeInputValue(campaign.startAt),
                    endAt: formatDateTimeInputValue(campaign.endAt),
                    status: campaign.status,
                    applicableType: campaign.applicableType
                },
                statuses: CashbackCampaign.CAMPAIGN_STATUSES,
                applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
                errors: []
            });
        });
    });
}

function updateCashbackCampaign(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return CashbackCampaign.findForMerchant(req.session.user.id, req.params.campaignId, (campaignError, campaign) => {
            if (campaignError || !campaign) {
                return res.status(campaignError ? 500 : 404).render('error', {
                    title: 'Cashback Campaign Not Found',
                    message: campaignError ? 'Cashback campaign could not be loaded.' : 'This cashback campaign does not belong to your merchant account.'
                });
            }

            const payload = {
                ...getCashbackCampaignForm(req.body),
                salonId: merchant.id
            };
            const errors = CashbackCampaign.validateCampaign(payload);

            if (errors.length) {
                return res.status(400).render('merchant-cashback-form', {
                    title: 'Edit Cashback Campaign',
                    merchant,
                    campaign,
                    form: payload,
                    statuses: CashbackCampaign.CAMPAIGN_STATUSES,
                    applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
                    errors
                });
            }

            return CashbackCampaign.updateForMerchant(req.session.user.id, campaign.id, payload, (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    return res.status(500).render('merchant-cashback-form', {
                        title: 'Edit Cashback Campaign',
                        merchant,
                        campaign,
                        form: payload,
                        statuses: CashbackCampaign.CAMPAIGN_STATUSES,
                        applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
                        errors: ['Cashback campaign could not be updated.']
                    });
                }

                req.session.merchantSuccess = result?.affectedRows ? 'Cashback campaign updated.' : null;
                req.session.merchantError = result?.affectedRows ? null : 'Cashback campaign could not be updated.';
                if (result?.affectedRows) {
                    notifyAdmins({
                        actorUserId: req.session.user.id,
                        type: 'cashback_update',
                        title: 'Merchant cashback campaign updated',
                        message: `${merchant.name} updated ${payload.title}.`,
                        linkUrl: '/admin/cashback',
                        dedupeKey: `admin-merchant-cashback-updated-${campaign.id}-${Date.now()}`
                    });
                }
                return res.redirect('/merchant/cashback');
            });
        });
    });
}

function deleteCashbackCampaign(req, res) {
    return CashbackCampaign.deleteForMerchant(req.session.user.id, req.params.campaignId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.merchantError = 'Cashback campaign could not be deleted.';
            return res.redirect('/merchant/cashback');
        }

        req.session.merchantSuccess = result?.affectedRows ? 'Cashback campaign deleted.' : null;
        req.session.merchantError = result?.affectedRows ? null : 'Cashback campaign could not be deleted.';
        return res.redirect('/merchant/cashback');
    });
}

module.exports = {
    showDashboard,
    showBookings,
    showCustomers,
    showAnalytics,
    exportAnalytics,
    showSupport,
    showProfile,
    showOnboarding,
    showOrders,
    showLoyaltySettings,
    updateLoyaltySettings,
    updateProfile,
    updateOnboarding,
    showServices,
    generateQr,
    updateBookingStatus,
    updateOrderStatus,
    updateRescheduleSettings,
    reviewRescheduleRequest,
    showSchedule,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService,
    featureService,
    unfeatureService,
    listProducts,
    showNewProduct,
    createProduct,
    showEditProduct,
    updateProduct,
    restockProduct,
    deleteProduct,
    featureProduct,
    unfeatureProduct,
    listPromotions,
    showNewPromotion,
    createPromotion,
    showEditPromotion,
    updatePromotion,
    deletePromotion,
    listVouchers,
    showNewVoucher,
    createVoucher,
    showEditVoucher,
    updateVoucher,
    deleteVoucher,
    listCashbackCampaigns,
    showNewCashbackCampaign,
    createCashbackCampaign,
    showEditCashbackCampaign,
    updateCashbackCampaign,
    deleteCashbackCampaign
};
