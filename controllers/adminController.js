const bcrypt = require('bcrypt');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Promotion = require('../models/Promotion');
const CashbackCampaign = require('../models/CashbackCampaign');
const Product = require('../models/Product');
const RewardShop = require('../models/RewardShop');
const RewardVoucher = require('../models/RewardVoucher');
const User = require('../models/User');
const Loyalty = require('../models/Loyalty');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const SupportRequest = require('../models/SupportRequest');
const AuditLog = require('../models/AuditLog');

function getBookingAmount(booking) {
    return Number(booking.service_price || booking.price || 0);
}

function getUniqueCount(items, getValue) {
    return new Set(items.map(getValue).filter(Boolean)).size;
}

function logNotificationError(error) {
    if (error) {
        console.error('Notification error:', error.message || error);
    }
}

function notifyAdmins(notification) {
    Notification.createForRole('admin', notification, logNotificationError);
}

function notifyCustomers(notification) {
    Notification.createForRole('customer', notification, logNotificationError);
}

function notifyMerchantUser(userId, notification) {
    if (!userId) {
        return;
    }

    Notification.create({
        ...notification,
        recipientUserId: userId,
        recipientRole: 'merchant'
    }, logNotificationError);
}

function notifyMerchantBySalonId(salonId, notification) {
    MerchantService.getMerchantBySalonId(salonId, (error, merchant) => {
        if (error) {
            logNotificationError(error);
            return;
        }

        notifyMerchantUser(merchant?.merchantUserId, notification);
    });
}

function buildValidationReport({ merchants, bookings, bookingError, userError }) {
    const issues = [];
    const merchantsWithoutServices = merchants.filter((merchant) => Number(merchant.service_count || 0) === 0);
    const merchantsMissingAddress = merchants.filter((merchant) => !merchant.address);
    const merchantsMissingDescription = merchants.filter((merchant) => !merchant.description);
    const merchantsMissingRegistration = merchants.filter((merchant) => !merchant.uen);
    const merchantsMissingOwnerPhone = merchants.filter((merchant) => !merchant.owner_phone);

    if (bookingError) {
        issues.push('Booking database reporting could not be loaded, so fallback booking data is displayed.');
    }

    if (userError) {
        issues.push('Customer account reporting could not be loaded from the database.');
    }

    if (merchantsWithoutServices.length > 0) {
        issues.push(`${merchantsWithoutServices.length} merchant account${merchantsWithoutServices.length === 1 ? '' : 's'} currently ${merchantsWithoutServices.length === 1 ? 'has' : 'have'} no services.`);
    }

    if (merchantsMissingAddress.length > 0) {
        issues.push(`${merchantsMissingAddress.length} merchant profile${merchantsMissingAddress.length === 1 ? '' : 's'} ${merchantsMissingAddress.length === 1 ? 'is' : 'are'} missing an address.`);
    }

    if (merchantsMissingDescription.length > 0) {
        issues.push(`${merchantsMissingDescription.length} merchant profile${merchantsMissingDescription.length === 1 ? '' : 's'} ${merchantsMissingDescription.length === 1 ? 'needs' : 'need'} a description.`);
    }

    if (merchantsMissingRegistration.length > 0) {
        issues.push(`${merchantsMissingRegistration.length} merchant profile${merchantsMissingRegistration.length === 1 ? '' : 's'} ${merchantsMissingRegistration.length === 1 ? 'is' : 'are'} missing a UEN or registration number.`);
    }

    if (merchantsMissingOwnerPhone.length > 0) {
        issues.push(`${merchantsMissingOwnerPhone.length} merchant owner contact${merchantsMissingOwnerPhone.length === 1 ? '' : 's'} ${merchantsMissingOwnerPhone.length === 1 ? 'is' : 'are'} missing a phone number.`);
    }

    if (bookings.some((booking) => !booking.status)) {
        issues.push('Some bookings are missing a status value.');
    }

    return {
        issues,
        status: issues.length === 0 ? 'Healthy' : 'Needs Review'
    };
}

function buildAdminReports(merchants, bookings, userSummary, bookingError, userError) {
    const serviceCount = merchants.reduce((total, merchant) => {
        return total + Number(merchant.service_count || 0);
    }, 0);
    const bookingRevenue = bookings.reduce((sum, booking) => sum + getBookingAmount(booking), 0);
    const customerCount = Number(userSummary.roleCounts.customer || 0);
    const merchantUserCount = Number(userSummary.roleCounts.merchant || merchants.length || 0);
    const merchantsWithoutServices = merchants.filter((merchant) => Number(merchant.service_count || 0) === 0);
    const merchantsMissingBusinessProfile = merchants.filter((merchant) => {
        return !merchant.business_category
            || !merchant.uen
            || !merchant.owner_phone
            || !merchant.address
            || !merchant.description;
    });
    const merchantCategories = merchants.reduce((counts, merchant) => {
        const key = merchant.business_category || 'Not set';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
    const merchantsWithStaffCount = merchants.filter((merchant) => Number.isFinite(Number(merchant.staff_count)) && Number(merchant.staff_count) > 0);
    const topMerchant = merchants.reduce((top, merchant) => {
        return Number(merchant.service_count || 0) > Number(top?.service_count || 0) ? merchant : top;
    }, null);

    return {
        stats: {
            merchantCount: merchants.length,
            merchantUserCount,
            customerCount,
            adminCount: Number(userSummary.roleCounts.admin || 0),
            serviceCount,
            bookingCount: bookings.length,
            uniqueBookedCustomers: getUniqueCount(bookings, (booking) => booking.email),
            bookingRevenue,
            averageServicesPerMerchant: merchants.length > 0 ? serviceCount / merchants.length : 0,
            totalGlints: Number(userSummary.totalGlints || 0)
        },
        customerReport: {
            totalCustomers: customerCount,
            bookedCustomers: getUniqueCount(bookings, (booking) => booking.email),
            recentCustomers: userSummary.recentCustomers || [],
            totalGlints: Number(userSummary.totalGlints || 0)
        },
        merchantReport: {
            totalMerchants: merchants.length,
            totalServices: serviceCount,
            merchantsWithoutServices,
            topMerchant,
            merchantsMissingBusinessProfile,
            averageStaffCount: merchantsWithStaffCount.length
                ? merchantsWithStaffCount.reduce((sum, merchant) => sum + Number(merchant.staff_count || 0), 0) / merchantsWithStaffCount.length
                : 0,
            merchantCategories
        },
        validationReport: buildValidationReport({ merchants, bookings, bookingError, userError })
    };
}

function getMerchantForm(body = {}) {
    return {
        ownerName: String(body.ownerName || '').trim(),
        email: String(body.email || '').trim().toLowerCase(),
        ownerPhone: String(body.ownerPhone || '').trim(),
        password: String(body.password || ''),
        salonName: String(body.salonName || '').trim(),
        businessCategory: String(body.businessCategory || '').trim(),
        uen: String(body.uen || '').trim().toUpperCase(),
        yearsInBusiness: String(body.yearsInBusiness || '').trim(),
        staffCount: String(body.staffCount || '').trim(),
        address: String(body.address || '').trim(),
        description: String(body.description || '').trim(),
        imageUrl: String(body.imageUrl || '').trim()
    };
}

function normalizeCommissionRate(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return NaN;
    }

    return Math.round(numeric * 100) / 100;
}

function validateMerchantForm(form) {
    const errors = [];

    if (form.ownerName.length < 2) {
        errors.push('Merchant owner name must be at least 2 characters.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        errors.push('Please enter a valid merchant email.');
    }

    if (!/^[689]\d{7}$/.test(form.ownerPhone)) {
        errors.push('Please enter a valid 8-digit Singapore owner handphone number.');
    }

    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
        errors.push('Password must be at least 8 characters and include at least one letter and one number.');
    }

    if (form.salonName.length < 2) {
        errors.push('Salon name must be at least 2 characters.');
    }

    if (form.businessCategory.length < 2) {
        errors.push('Please enter the business category.');
    }

    if (!/^[A-Z0-9-]{8,20}$/.test(form.uen)) {
        errors.push('Please enter a valid UEN or registration number.');
    }

    if (!Number.isInteger(Number(form.yearsInBusiness)) || Number(form.yearsInBusiness) < 0 || Number(form.yearsInBusiness) > 100) {
        errors.push('Years in business must be a whole number from 0 to 100.');
    }

    if (!Number.isInteger(Number(form.staffCount)) || Number(form.staffCount) < 1 || Number(form.staffCount) > 5000) {
        errors.push('Staff count must be a whole number from 1 to 5000.');
    }

    if (form.address.length < 2) {
        errors.push('Please enter the salon address or location.');
    }

    return errors;
}

function getServiceForm(body = {}) {
    return {
        salonId: String(body.salonId || '').trim(),
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        categoryId: String(body.categoryId || '').trim(),
        durationMins: String(body.durationMins || '').trim(),
        price: String(body.price || '').trim(),
        slots: String(body.slots || '').trim()
    };
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

function formatDateInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function buildMerchantFeaturedRecommendations(merchants = []) {
    const today = new Date();
    const activeFeaturedCount = merchants.filter((merchant) => Boolean(merchant.is_featured)).length;
    const candidates = merchants
        .filter((merchant) => !merchant.is_featured)
        .map((merchant) => {
            const score = Number(merchant.featured_score || 0);
            const serviceCount = Number(merchant.service_count || 0);
            const staffCount = Number(merchant.staff_count || 0);
            const readiness = Number(Boolean(merchant.business_category))
                + Number(Boolean(merchant.uen))
                + Number(Boolean(merchant.owner_phone))
                + Number(Boolean(merchant.address))
                + Number(Boolean(merchant.description));

            return {
                ...merchant,
                recommendationScore: (score * 10) + (serviceCount * 6) + (staffCount * 2) + (readiness * 8)
            };
        })
        .sort((left, right) => {
            if (Number(right.recommendationScore || 0) !== Number(left.recommendationScore || 0)) {
                return Number(right.recommendationScore || 0) - Number(left.recommendationScore || 0);
            }

            if (Number(right.featured_score || 0) !== Number(left.featured_score || 0)) {
                return Number(right.featured_score || 0) - Number(left.featured_score || 0);
            }

            return Number(right.service_count || 0) - Number(left.service_count || 0);
        });

    const recommendationMap = new Map();

    candidates.forEach((merchant, index) => {
        const rank = index + 1;
        let featuredType = 'trending';
        let reason = 'Strong marketplace activity and merchant profile readiness.';

        if (rank === 1) {
            featuredType = 'featured_month';
            reason = 'Highest combined score across bookings, reviews, revenue, and repeat customers.';
        } else if (Number(merchant.featured_score || 0) >= 80 || Number(merchant.service_count || 0) >= 4) {
            featuredType = 'trending';
            reason = 'High marketplace momentum based on featured score and listed services.';
        } else {
            featuredType = 'top_rated';
            reason = 'Solid merchant quality and readiness for discovery placement.';
        }

        recommendationMap.set(String(merchant.salon_id), {
            featuredType,
            featuredOrder: String(activeFeaturedCount + rank),
            featuredStartDate: formatDateInputValue(today),
            featuredEndDate: formatDateInputValue(addDays(today, 30)),
            reason
        });
    });

    return merchants.map((merchant) => ({
        ...merchant,
        featuredRecommendation: recommendationMap.get(String(merchant.salon_id)) || {
            featuredType: merchant.featured_type || 'trending',
            featuredOrder: String(Number(merchant.featured_order || 0)),
            featuredStartDate: merchant.featured_start_date ? formatDateInputValue(new Date(merchant.featured_start_date)) : formatDateInputValue(today),
            featuredEndDate: merchant.featured_end_date ? formatDateInputValue(new Date(merchant.featured_end_date)) : formatDateInputValue(addDays(today, 30)),
            reason: 'Already featured.'
        }
    }));
}

function getMerchantFeaturedForm(body = {}) {
    return {
        featuredType: String(body.featuredType || body.featured_type || '').trim(),
        featuredOrder: String(body.featuredOrder || body.featured_order || '').trim(),
        featuredStartDate: String(body.featuredStartDate || body.featured_start_date || '').trim(),
        featuredEndDate: String(body.featuredEndDate || body.featured_end_date || '').trim()
    };
}

function validateServiceForm(form) {
    const errors = [];
    const salonId = Number(form.salonId);
    const categoryId = Number(form.categoryId);
    const durationMins = Number(form.durationMins);
    const price = Number(form.price);
    const slots = form.slots.split(',').map((slot) => slot.trim()).filter(Boolean);

    if (!Number.isInteger(salonId) || salonId < 1) {
        errors.push('Please select a merchant salon.');
    }

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

    return errors;
}

function getProductForm(body = {}) {
    return {
        salonId: String(body.salonId || '').trim(),
        name: String(body.name || '').trim(),
        price: String(body.price || '').trim(),
        stockQuantity: String(body.stockQuantity || '').trim(),
        imageUrl: String(body.imageUrl || '').trim(),
        description: String(body.description || '').trim(),
        ingredients: String(body.ingredients || '').trim(),
        howToUse: String(body.howToUse || '').trim()
    };
}

function validateProductForm(form, salons = []) {
    const errors = [];
    const salonId = Number(form.salonId);
    const price = Number(form.price);
    const stockQuantity = Number(form.stockQuantity);
    const validSalonIds = new Set((salons || []).map((salon) => Number(salon.salon_id)));

    if (!Number.isInteger(salonId) || !validSalonIds.has(salonId)) {
        errors.push('Please select a valid merchant salon.');
    }

    if (form.name.length < 2) {
        errors.push('Product name must be at least 2 characters.');
    }

    if (!Number.isFinite(price) || price < 0) {
        errors.push('Please enter a valid product price.');
    }

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        errors.push('Please enter a valid stock quantity.');
    }

    if (form.imageUrl && !/^https?:\/\//i.test(form.imageUrl) && !form.imageUrl.startsWith('/')) {
        errors.push('Image URL must start with http://, https://, or /.');
    }

    return errors;
}

function buildProductPayload(form) {
    return {
        salonId: Number(form.salonId),
        name: form.name,
        price: Number(form.price),
        stockQuantity: Number(form.stockQuantity),
        imageUrl: form.imageUrl,
        description: form.description || `${form.name} from Vaniday merchant.`,
        ingredients: form.ingredients || 'Ingredients will be updated by the merchant.',
        howToUse: form.howToUse || 'Use as directed by the merchant.'
    };
}

function getPromotionForm(body = {}) {
    return {
        salonId: String(body.salonId || '').trim(),
        serviceId: String(body.serviceId || '').trim(),
        title: String(body.title || '').trim(),
        type: String(body.type || '').trim(),
        discountType: String(body.discountType || '').trim(),
        discountValue: String(body.discountValue || '').trim(),
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

function validatePromotionForm(form, salons, services) {
    const errors = [];
    const salonId = Number(form.salonId);
    const serviceId = form.serviceId ? Number(form.serviceId) : null;
    const discountValue = form.discountValue === '' ? null : Number(form.discountValue);
    const startDate = form.startDate ? new Date(form.startDate) : null;
    const endDate = form.endDate ? new Date(form.endDate) : null;
    const slots = parsePromotionSlots(form.slots);
    const validSalonIds = new Set((salons || []).map((salon) => Number(salon.salon_id)));
    const validServices = (services || []).filter((service) => Number(service.salonId) === salonId);
    const validServiceIds = new Set(validServices.map((service) => Number(service.id)));

    if (!Number.isInteger(salonId) || !validSalonIds.has(salonId)) {
        errors.push('Please select a valid merchant salon.');
    }

    if (form.title.length < 2) {
        errors.push('Promotion title must be at least 2 characters.');
    }

    if (!Promotion.PROMOTION_TYPES.includes(form.type)) {
        errors.push('Please choose a valid promotion type.');
    }

    if (!Promotion.DISCOUNT_TYPES.includes(form.discountType)) {
        errors.push('Please choose a valid discount type.');
    }

    if (serviceId !== null && (!Number.isInteger(serviceId) || !validServiceIds.has(serviceId))) {
        errors.push('Please choose a valid service for the selected salon.');
    }

    if (form.discountType !== 'tag_only') {
        if (!Number.isFinite(discountValue) || discountValue <= 0) {
            errors.push('Please enter a valid discount value.');
        }
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
        salonId: Number(form.salonId),
        serviceId: form.serviceId ? Number(form.serviceId) : null,
        title: form.title,
        type: form.type,
        discountType: form.discountType,
        discountValue: form.discountType === 'tag_only' || form.discountValue === '' ? null : Number(form.discountValue),
        startDate: form.startDate,
        endDate: form.endDate,
        allowedSlots: normalizePromotionSlots(form.slots),
        status: form.status,
        description: form.description,
        terms: form.terms
    };
}

function getRewardVoucherForm(body = {}) {
    const rawApplicableTypes = Array.isArray(body.applicableTypes)
        ? body.applicableTypes
        : (body.applicableTypes
            ? [body.applicableTypes]
            : (body.applicableType ? [body.applicableType] : []));
    const applicableTypes = rawApplicableTypes
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value, index, values) => value && values.indexOf(value) === index);

    return {
        title: String(body.title || '').trim(),
        detail: String(body.detail || '').trim(),
        glintsCost: String(body.glintsCost || '').trim(),
        voucherValue: String(body.voucherValue || '').trim(),
        status: String(body.status || 'active').trim(),
        sortOrder: String(body.sortOrder || '0').trim(),
        applicableTypes,
        linkedServiceId: String(body.linkedServiceId || '').trim(),
        linkedProductId: String(body.linkedProductId || '').trim()
    };
}

function validateRewardVoucherForm(form) {
    const errors = [];
    const glintsCost = Number(form.glintsCost);
    const voucherValue = Number(form.voucherValue);
    const sortOrder = Number(form.sortOrder);

    if (form.title.length < 2) {
        errors.push('Voucher title must be at least 2 characters.');
    }

    if (form.detail.length < 2) {
        errors.push('Voucher details must be at least 2 characters.');
    }

    if (!Number.isInteger(glintsCost) || glintsCost < 1) {
        errors.push('Glints cost must be a whole number above 0.');
    }

    if (!Number.isFinite(voucherValue) || voucherValue <= 0) {
        errors.push('Voucher value must be above 0.');
    }

    if (!RewardVoucher.STATUSES.includes(form.status)) {
        errors.push('Please choose a valid voucher status.');
    }

    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        errors.push('Sort order must be 0 or higher.');
    }

    const allowedTypes = ['booking', 'service', 'product'];

    if (!form.applicableTypes.length || form.applicableTypes.some((type) => !allowedTypes.includes(type))) {
        errors.push('Please choose at least one applicable checkout type.');
    }

    if (form.applicableTypes.includes('service') && (!Number.isInteger(Number(form.linkedServiceId)) || Number(form.linkedServiceId) < 1)) {
        errors.push('Please choose a linked service.');
    }

    if (form.applicableTypes.includes('product') && (!Number.isInteger(Number(form.linkedProductId)) || Number(form.linkedProductId) < 1)) {
        errors.push('Please choose a linked product.');
    }

    return errors;
}

function getCashbackCampaignForm(body = {}) {
    return CashbackCampaign.buildCampaignPayload({
        salonId: body.salonId,
        title: body.title,
        cashbackPercent: body.cashbackPercent,
        minimumSpend: body.minimumSpend,
        startAt: body.startAt,
        endAt: body.endAt,
        status: body.status || 'draft',
        applicableType: body.applicableType || 'both'
    });
}

function buildRewardVoucherPayload(form, linkedTargets = {}) {
    const appliesToBooking = form.applicableTypes.includes('booking');
    const linkedService = linkedTargets.service || null;
    const linkedProduct = linkedTargets.product || null;
    const hasLegacySingleLinkedTarget = !appliesToBooking && Boolean(linkedService) !== Boolean(linkedProduct);
    const legacyLinkedType = linkedService ? 'service' : (linkedProduct ? 'product' : '');
    const legacyLinkedTarget = linkedService || linkedProduct || null;

    return {
        title: form.title,
        detail: form.detail,
        glintsCost: Number(form.glintsCost),
        voucherValue: Number(form.voucherValue),
        status: form.status,
        sortOrder: Number(form.sortOrder),
        voucherSource: 'platform',
        merchantId: null,
        linkedItemType: hasLegacySingleLinkedTarget ? legacyLinkedType : '',
        linkedItemId: hasLegacySingleLinkedTarget ? (Number(legacyLinkedTarget?.id || 0) || null) : null,
        appliesToBooking,
        linkedServiceId: Number(linkedService?.id || 0) || null,
        linkedProductId: Number(linkedProduct?.id || 0) || null
    };
}

function loadRewardVoucherLinkOptions(callback) {
    return MerchantService.getAllServices((serviceError, services = []) => {
        if (serviceError) {
            callback(serviceError);
            return;
        }

        return Product.getAllMerchantProducts((productError, products = []) => {
            if (productError) {
                callback(productError);
                return;
            }

            callback(null, {
                services,
                products
            });
        });
    });
}

function findRewardVoucherLinkedTargets(form, linkOptions) {
    const linkedTargets = {
        service: null,
        product: null
    };

    if (form.applicableTypes.includes('service')) {
        linkedTargets.service = linkOptions.services.find((entry) => String(entry.id) === String(form.linkedServiceId)) || null;

        if (!linkedTargets.service) {
            return {
                linkedTargets,
                error: 'The selected service could not be found.'
            };
        }
    }

    if (form.applicableTypes.includes('product')) {
        linkedTargets.product = linkOptions.products.find((entry) => String(entry.id) === String(form.linkedProductId)) || null;

        if (!linkedTargets.product) {
            return {
                linkedTargets,
                error: 'The selected product could not be found.'
            };
        }
    }

    return { linkedTargets, error: null };
}

function renderRewardVoucherForm(res, options) {
    return loadRewardVoucherLinkOptions((linkError, linkOptions) => {
        if (linkError) {
            console.error(linkError);
            return res.status(500).render('error', {
                title: 'Reward Shop Error',
                message: 'Voucher products and services could not be loaded from the database.'
            });
        }

        return res.status(options.status || 200).render('admin-reward-voucher-form', {
            title: options.title,
            voucher: options.voucher || null,
            form: options.form,
            statuses: RewardVoucher.STATUSES,
            availableApplicableTypes: ['booking', 'service', 'product'],
            services: linkOptions.services,
            products: linkOptions.products,
            errors: options.errors || []
        });
    });
}

function getRewardVoucherPersistenceError(error) {
    if (error && error.code === 'ER_NO_SUCH_TABLE') {
        return 'Reward shop voucher table is missing. Run database/20260506_create_reward_shop_vouchers.sql first.';
    }

    return 'Reward shop voucher could not be saved. Please try again.';
}

function getDailyRewardFormValues(body = {}) {
    return RewardShop.DEFAULT_DAILY_REWARD_VALUES.map((fallbackValue, index) => {
        return String(body[`day${index + 1}`] ?? fallbackValue).trim();
    });
}

function validateDailyRewardForm(values) {
    const errors = [];

    values.forEach((value, index) => {
        const points = Number(value);

        if (!Number.isInteger(points) || points < 0) {
            errors.push(`Day ${index + 1} points must be a whole number of 0 or higher.`);
        }
    });

    return errors;
}

function getDailyRewardPersistenceError(error) {
    if (error && error.code === 'ER_NO_SUCH_TABLE') {
        return 'Daily reward settings table is missing. Run database/20260506_create_reward_shop_vouchers.sql first.';
    }

    return 'Daily reward points could not be saved. Please try again.';
}

function renderServiceForm(res, options) {
    return MerchantService.getSalons((salonError, salons) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Salons Not Found',
                message: 'Merchant salons could not be loaded.'
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

            return res.status(options.status || 200).render('admin-service-form', {
                title: options.title,
                salons,
                categories,
                service: options.service || null,
                form: options.form,
                errors: options.errors || []
            });
        });
    });
}

function showDashboard(req, res, options = {}) {
    return MerchantService.calculateFeaturedScore((scoreError) => {
        if (scoreError) {
            console.error(scoreError);
        }

        return MerchantService.getAdminOverview((merchantError, merchants) => {
        if (merchantError) {
            console.error(merchantError);
            return res.status(500).render('error', {
                title: 'Admin Dashboard Error',
                message: 'Merchant data could not be loaded from the database.'
            });
        }

        const recommendedMerchants = buildMerchantFeaturedRecommendations(merchants);

        return Booking.getAllInDatabase((bookingError, bookings) => {
            if (bookingError) {
                console.error(bookingError);
            }

            return User.getDashboardSummary((userError, userSummary) => {
                if (userError) {
                    console.error(userError);
                }

                return Review.getPlatformSummary((reviewSummaryError, reviewSummary) => {
                    if (reviewSummaryError) {
                        console.error(reviewSummaryError);
                    }

                    return Review.getMerchantLeaderboard(8, (reviewLeaderboardError, reviewLeaderboard = []) => {
                        if (reviewLeaderboardError) {
                            console.error(reviewLeaderboardError);
                        }

                        return Review.listAll(24, (reviewListError, reviews = []) => {
                            if (reviewListError) {
                                console.error(reviewListError);
                            }

                            return Loyalty.getPlatformSummary((loyaltyError, loyaltySummary = {}) => {
                                if (loyaltyError) {
                                    console.error(loyaltyError);
                                }

                                return SupportRequest.getSummary((supportError, supportSummary = {}) => {
                                    if (supportError) {
                                        console.error(supportError);
                                    }

                                    const dashboardBookings = bookingError ? Booking.getAll() : bookings;
                                    const reports = buildAdminReports(
                                        recommendedMerchants,
                                        dashboardBookings,
                                        userError ? { roleCounts: {}, totalGlints: 0, recentCustomers: [] } : userSummary,
                                        Boolean(bookingError),
                                        Boolean(userError)
                                    );
                                    const success = req.session.adminSuccess;
                                    const error = req.session.adminError;
                                    req.session.adminSuccess = null;
                                    req.session.adminError = null;

                                    return res.render(options.viewName || 'admin-overview', {
                                        title: options.title || 'Admin Overview',
                                        merchants: recommendedMerchants,
                                        bookings: dashboardBookings,
                                        reviews,
                                        reviewSummary: reviewSummaryError ? { reviewCount: 0, averageRating: null, mediaReviewCount: 0, merchantCount: 0 } : reviewSummary,
                                        reviewLeaderboard: reviewLeaderboardError ? [] : reviewLeaderboard,
                                        loyaltySummary: loyaltyError ? { transactionCount: 0, redemptionCount: 0, pointsDeltaTotal: 0, cashbackDeltaTotal: 0 } : loyaltySummary,
                                        supportSummary: supportError ? { totalCount: 0, openCount: 0, pendingRefundCount: 0, pendingRefundAmount: 0 } : supportSummary,
                                        databaseError: Boolean(bookingError || userError || reviewSummaryError || reviewLeaderboardError || reviewListError || loyaltyError || supportError),
                                        success,
                                        error,
                                        auditLogs: options.auditLogs || [],
                                        ...reports
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

function renderAdminView(viewName, title) {
    return (req, res) => showDashboard(req, res, { viewName, title });
}

const showOverview = renderAdminView('admin-overview', 'Admin Overview');
const showBookings = renderAdminView('admin-bookings', 'Admin Bookings');
const showMerchants = renderAdminView('admin-merchants', 'Admin Merchants');
const showReviews = renderAdminView('admin-reviews', 'Admin Reviews');
const showAnalytics = renderAdminView('admin-analytics', 'Admin Analytics');
function showAuditTrail(req, res) {
    return AuditLog.listRecent(50, (auditError, auditLogs = []) => {
        if (auditError) {
            console.error(auditError);
        }

        return showDashboard(req, res, {
            viewName: 'admin-audit-trail',
            title: 'Admin Audit Trail',
            auditLogs: auditError ? [] : auditLogs
        });
    });
}

function showUsers(req, res) {
    return User.getAllUsers((error, users = []) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Admin User Management Error',
                message: 'User accounts could not be loaded.'
            });
        }

        const success = req.session.adminSuccess;
        const errorMessage = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-users', {
            title: 'Admin User Management',
            users,
            success,
            error: errorMessage
        });
    });
}

function terminateUser(req, res) {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId < 1) {
        req.session.adminError = 'Invalid user selected.';
        return res.redirect('/admin/users');
    }

    if (userId === Number(req.session.user.id)) {
        req.session.adminError = 'You cannot terminate your own admin account.';
        return res.redirect('/admin/users');
    }

    return User.terminateById(userId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'User account could not be terminated.';
            return res.redirect('/admin/users');
        }

        req.session.adminSuccess = result?.affectedRows ? 'User account terminated.' : null;
        req.session.adminError = result?.affectedRows ? null : 'User account could not be terminated.';
        return res.redirect('/admin/users');
    });
}

function deleteUser(req, res) {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId < 1) {
        req.session.adminError = 'Invalid user selected.';
        return res.redirect('/admin/users');
    }

    if (userId === Number(req.session.user.id)) {
        req.session.adminError = 'You cannot delete your own admin account.';
        return res.redirect('/admin/users');
    }

    return User.deleteById(userId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'User account could not be deleted.';
            return res.redirect('/admin/users');
        }

        req.session.adminSuccess = result?.affectedRows ? 'User account deleted.' : null;
        req.session.adminError = result?.affectedRows ? null : 'User account could not be deleted.';
        return res.redirect('/admin/users');
    });
}

const showPlatformHealth = renderAdminView('admin-platform-health', 'Platform Health');

function showNewMerchant(req, res) {
    return res.render('admin-merchant-form', {
        title: 'Add Merchant',
        form: getMerchantForm(),
        errors: []
    });
}

function createMerchant(req, res) {
    const form = getMerchantForm(req.body);
    const errors = validateMerchantForm(form);

    if (errors.length > 0) {
        return res.status(400).render('admin-merchant-form', {
            title: 'Add Merchant',
            form,
            errors
        });
    }

    return bcrypt.hash(form.password, 12, (hashError, passwordHash) => {
        if (hashError) {
            console.error(hashError);
            return res.status(500).render('admin-merchant-form', {
                title: 'Add Merchant',
                form,
                errors: ['Merchant password could not be prepared. Please try again.']
            });
        }

        return MerchantService.createMerchant({
            ...form,
            passwordHash
        }, (createError, createdMerchant) => {
            if (createError) {
                console.error(createError);
                return res.status(500).render('admin-merchant-form', {
                    title: 'Add Merchant',
                    form,
                    errors: [
                        createError.code === 'ER_DUP_ENTRY'
                            ? 'A user with this email already exists.'
                            : 'Merchant could not be created. Please try again.'
                    ]
                });
            }

            req.session.adminSuccess = `${form.salonName} was added as a merchant.`;
            notifyMerchantUser(createdMerchant?.userId, {
                actorUserId: req.session.user.id,
                type: 'merchant_update',
                title: 'Merchant account approved',
                message: `${form.salonName} is ready. You can now manage services, products, promotions, and rewards.`,
                linkUrl: '/merchant',
                dedupeKey: `merchant-account-created-${createdMerchant?.userId || Date.now()}`
            });
            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'merchant_update',
                title: 'Merchant onboarded',
                message: `${form.salonName} was added as a merchant by ${req.session.user.name || 'admin'}.`,
                linkUrl: '/admin/overview',
                dedupeKey: `admin-merchant-created-${createdMerchant?.userId || Date.now()}`
            });
            return res.redirect('/admin/overview');
        });
    });
}

function updateMerchantCommission(req, res) {
    const salonId = Number(req.params.salonId);
    const commissionRate = normalizeCommissionRate(req.body.commissionRate);

    if (!Number.isInteger(salonId) || salonId < 1) {
        req.session.adminError = 'Invalid merchant selected for commission update.';
        return res.redirect('/admin/merchants');
    }

    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
        req.session.adminError = 'Commission rate must be between 0 and 100.';
        return res.redirect('/admin/merchants');
    }

    return MerchantService.updateCommissionRate(salonId, commissionRate, (updateError, updated) => {
        if (updateError) {
            console.error(updateError);
            req.session.adminError = 'Merchant commission could not be updated.';
            return res.redirect('/admin/merchants');
        }

        req.session.adminSuccess = updated
            ? `Merchant commission updated to ${commissionRate.toFixed(2)}%.`
            : 'Merchant commission could not be updated.';
        req.session.adminError = updated ? null : 'Merchant commission could not be updated.';
        return res.redirect('/admin/merchants');
    });
}

function featureMerchant(req, res) {
    const salonId = Number(req.params.salonId || req.params.id);
    const form = getMerchantFeaturedForm(req.body);

    return MerchantService.markMerchantFeatured(salonId, form, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = error.message || 'Merchant could not be featured.';
            return res.redirect('/admin/merchants');
        }

        req.session.adminSuccess = result?.affectedRows
            ? 'Merchant featured successfully.'
            : 'Merchant could not be featured.';
        return res.redirect('/admin/merchants');
    });
}

function unfeatureMerchant(req, res) {
    const salonId = Number(req.params.salonId || req.params.id);

    return MerchantService.removeMerchantFeatured(salonId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Merchant could not be removed from featured.';
            return res.redirect('/admin/merchants');
        }

        req.session.adminSuccess = result?.affectedRows
            ? 'Merchant removed from featured.'
            : 'Merchant could not be updated.';
        return res.redirect('/admin/merchants');
    });
}

function listServices(req, res) {
    return MerchantService.getAllServices((serviceError, services) => {
        if (serviceError) {
            console.error(serviceError);
            return res.status(500).render('error', {
                title: 'Admin Services Error',
                message: 'Services could not be loaded from the database.'
            });
        }

        const success = req.session.adminSuccess;
        const error = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-services', {
            title: 'Manage Services',
            services,
            success,
            error
        });
    });
}

function showNewService(req, res) {
    return renderServiceForm(res, {
        title: 'Add Service',
        form: getServiceForm()
    });
}

function createService(req, res) {
    const form = getServiceForm(req.body);
    const errors = validateServiceForm(form);

    if (errors.length > 0) {
        return renderServiceForm(res, {
            status: 400,
            title: 'Add Service',
            form,
            errors
        });
    }

    return MerchantService.createServiceForSalon({
        salonId: Number(form.salonId),
        name: form.name,
        description: form.description,
        categoryId: Number(form.categoryId),
        durationMins: Number(form.durationMins),
        price: Number(form.price),
        slots: form.slots
    }, (createError) => {
        if (createError) {
            console.error(createError);
            return renderServiceForm(res, {
                status: 500,
                title: 'Add Service',
                form,
                errors: ['Service could not be created. Please check the merchant, category, and timeslots.']
            });
        }

        req.session.adminSuccess = 'Service created successfully.';
        notifyMerchantBySalonId(form.salonId, {
            actorUserId: req.session.user.id,
            type: 'merchant_update',
            title: 'Admin added a service',
            message: `${form.name} was added to your merchant service menu by Vaniday admin.`,
            linkUrl: '/merchant/services',
            dedupeKey: `merchant-admin-service-created-${form.salonId}-${Date.now()}`
        });
        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'merchant_update',
            title: 'Admin service created',
            message: `${form.name} was added for a merchant salon.`,
            linkUrl: '/admin/services',
            dedupeKey: `admin-service-created-${form.salonId}-${Date.now()}`
        });
        return res.redirect('/admin/services');
    });
}

function showEditService(req, res) {
    return MerchantService.findServiceById(req.params.serviceId, (serviceError, service) => {
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
                message: 'The selected service could not be found.'
            });
        }

        return renderServiceForm(res, {
            title: 'Edit Service',
            service,
            form: {
                salonId: String(service.salonId),
                name: service.name,
                description: service.description,
                categoryId: String(service.categoryId),
                durationMins: String(service.durationMins),
                price: String(service.price),
                slots: (service.slots || []).join(', ')
            }
        });
    });
}

function updateService(req, res) {
    return MerchantService.findServiceById(req.params.serviceId, (serviceError, service) => {
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
                message: 'The selected service could not be found.'
            });
        }

        const form = getServiceForm(req.body);
        const errors = validateServiceForm(form);

        if (errors.length > 0) {
            return renderServiceForm(res, {
                status: 400,
                title: 'Edit Service',
                service,
                form,
                errors
            });
        }

        return MerchantService.updateServiceAsAdmin(service.id, {
            salonId: Number(form.salonId),
            name: form.name,
            description: form.description,
            categoryId: Number(form.categoryId),
            durationMins: Number(form.durationMins),
            price: Number(form.price),
            slots: form.slots
        }, (updateError) => {
            if (updateError) {
                console.error(updateError);
                return renderServiceForm(res, {
                    status: 500,
                    title: 'Edit Service',
                    service,
                    form,
                    errors: ['Service could not be updated. Please check the merchant, category, and timeslots.']
                });
            }

            req.session.adminSuccess = 'Service updated successfully.';
            return res.redirect('/admin/services');
        });
    });
}

function deleteService(req, res) {
    return MerchantService.deleteServiceAsAdmin(req.params.serviceId, (deleteError, deleted) => {
        if (deleteError) {
            console.error(deleteError);
            req.session.adminError = 'Service could not be deleted. It may already have bookings.';
            return res.redirect('/admin/services');
        }

        req.session.adminSuccess = deleted ? 'Service deleted successfully.' : null;
        req.session.adminError = deleted ? null : 'Service could not be deleted.';

        return res.redirect('/admin/services');
    });
}

function renderPromotionForm(res, options) {
    return MerchantService.getSalons((salonError, salons) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Salons Not Found',
                message: 'Merchant salons could not be loaded.'
            });
        }

        return MerchantService.getAllServices((serviceError, services) => {
            if (serviceError) {
                console.error(serviceError);
                return res.status(500).render('error', {
                    title: 'Services Not Found',
                    message: 'Merchant services could not be loaded.'
                });
            }

            return res.status(options.status || 200).render('admin-promotion-form', {
                title: options.title,
                salons,
                services,
                promotion: options.promotion || null,
                form: options.form,
                promotionTypes: Promotion.PROMOTION_TYPES,
                discountTypes: Promotion.DISCOUNT_TYPES,
                statuses: Promotion.PROMOTION_STATUSES,
                errors: options.errors || []
            });
        });
    });
}

function listPromotions(req, res) {
    return Promotion.getAll((promotionError, promotions) => {
        if (promotionError) {
            console.error(promotionError);
            return res.status(500).render('error', {
                title: 'Admin Promotions Error',
                message: 'Promotions could not be loaded from the database.'
            });
        }

        const groupedPromotions = {
            first_trial: promotions.filter((promotion) => promotion.type === 'first_trial'),
            happy_hour: promotions.filter((promotion) => promotion.type === 'happy_hour'),
            one_for_one: promotions.filter((promotion) => promotion.type === 'one_for_one'),
            featured: promotions.filter((promotion) => promotion.type === 'featured')
        };

        const success = req.session.adminSuccess;
        const error = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-promotions', {
            title: 'Manage Promotions',
            promotions,
            groupedPromotions,
            success,
            error
        });
    });
}

function listProducts(req, res) {
    return Product.getAllMerchantProducts((productError, products = []) => {
        if (productError) {
            console.error(productError);
            return res.status(500).render('error', {
                title: 'Admin Products Error',
                message: 'Merchant products could not be loaded from the database.'
            });
        }

        const success = req.session.adminSuccess;
        const error = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-products', {
            title: 'Manage Products',
            products,
            success,
            error
        });
    });
}

function renderAdminProductForm(res, status, viewModel) {
    return MerchantService.getSalons((salonError, salons = []) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Merchant Salons Error',
                message: 'Merchant salons could not be loaded from the database.'
            });
        }

        return res.status(status).render('admin-product-form', {
            salons,
            ...viewModel
        });
    });
}

function showNewProduct(req, res) {
    return renderAdminProductForm(res, 200, {
        title: 'Add Product',
        product: null,
        form: getProductForm(),
        errors: []
    });
}

function createProduct(req, res) {
    return MerchantService.getSalons((salonError, salons = []) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Merchant Salons Error',
                message: 'Merchant salons could not be loaded from the database.'
            });
        }

        const form = getProductForm(req.body);
        const errors = validateProductForm(form, salons);

        if (errors.length > 0) {
            return res.status(400).render('admin-product-form', {
                title: 'Add Product',
                salons,
                product: null,
                form,
                errors
            });
        }

        const payload = buildProductPayload(form);

        return Product.createAsAdmin(payload, (createError, result) => {
            if (createError) {
                console.error(createError);
                return res.status(500).render('admin-product-form', {
                    title: 'Add Product',
                    salons,
                    product: null,
                    form,
                    errors: ['Product could not be created. Please check the merchant and product details.']
                });
            }

            req.session.adminSuccess = 'Product created successfully.';
            notifyMerchantBySalonId(payload.salonId, {
                actorUserId: req.session.user.id,
                type: 'product_update',
                title: 'Admin added a product',
                message: `${payload.name} was added to your product catalogue by Vaniday admin.`,
                linkUrl: '/merchant/products',
                dedupeKey: `merchant-admin-product-created-${result?.insertId || Date.now()}`
            });
            return res.redirect('/admin/products');
        });
    });
}

function showEditProduct(req, res) {
    return Product.findMerchantProductById(req.params.productId, (productError, product) => {
        if (productError || !product) {
            return res.status(productError ? 500 : 404).render('error', {
                title: 'Product Not Found',
                message: productError ? 'Product could not be loaded.' : 'The selected merchant product could not be found.'
            });
        }

        return renderAdminProductForm(res, 200, {
            title: 'Edit Product',
            product,
            form: {
                salonId: String(product.salonId || ''),
                name: product.name,
                price: Number(product.price || 0).toFixed(2),
                stockQuantity: String(product.stockQuantity || 0),
                imageUrl: product.imageUrl || '',
                description: product.description || '',
                ingredients: product.ingredients || '',
                howToUse: product.howToUse || ''
            },
            errors: []
        });
    });
}

function updateProduct(req, res) {
    return Product.findMerchantProductById(req.params.productId, (productError, product) => {
        if (productError || !product) {
            return res.status(productError ? 500 : 404).render('error', {
                title: 'Product Not Found',
                message: productError ? 'Product could not be loaded.' : 'The selected merchant product could not be found.'
            });
        }

        return MerchantService.getSalons((salonError, salons = []) => {
            if (salonError) {
                console.error(salonError);
                return res.status(500).render('error', {
                    title: 'Merchant Salons Error',
                    message: 'Merchant salons could not be loaded from the database.'
                });
            }

            const form = getProductForm(req.body);
            const errors = validateProductForm(form, salons);

            if (errors.length > 0) {
                return res.status(400).render('admin-product-form', {
                    title: 'Edit Product',
                    salons,
                    product,
                    form,
                    errors
                });
            }

            const payload = buildProductPayload(form);

            return Product.updateAsAdmin(product.id, payload, (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    return res.status(500).render('admin-product-form', {
                        title: 'Edit Product',
                        salons,
                        product,
                        form,
                        errors: ['Product could not be updated. Please check the merchant and product details.']
                    });
                }

                req.session.adminSuccess = result?.affectedRows ? 'Product updated successfully.' : null;
                req.session.adminError = result?.affectedRows ? null : 'Product could not be updated.';
                if (result?.affectedRows) {
                    notifyMerchantBySalonId(payload.salonId, {
                        actorUserId: req.session.user.id,
                        type: 'product_update',
                        title: 'Admin updated a product',
                        message: `${payload.name} was updated by Vaniday admin.`,
                        linkUrl: '/merchant/products',
                        dedupeKey: `merchant-admin-product-updated-${product.id}-${Date.now()}`
                    });
                }
                return res.redirect('/admin/products');
            });
        });
    });
}

function deleteProduct(req, res) {
    return Product.findMerchantProductById(req.params.productId, (productError, product) => {
        if (productError) {
            console.error(productError);
            req.session.adminError = 'Product could not be loaded for deletion.';
            return res.redirect('/admin/products');
        }

        return Product.deleteAsAdmin(req.params.productId, (deleteError, deleted) => {
            if (deleteError) {
                console.error(deleteError);
                req.session.adminError = 'Product could not be deleted.';
                return res.redirect('/admin/products');
            }

            req.session.adminSuccess = deleted ? 'Product deleted successfully.' : null;
            req.session.adminError = deleted ? null : 'Product could not be deleted.';
            if (deleted && product) {
                notifyMerchantBySalonId(product.salonId, {
                    actorUserId: req.session.user.id,
                    type: 'product_update',
                    title: 'Admin removed a product',
                    message: `${product.name} was removed from your product catalogue by Vaniday admin.`,
                    linkUrl: '/merchant/products',
                    dedupeKey: `merchant-admin-product-deleted-${product.id}-${Date.now()}`
                });
            }
            return res.redirect('/admin/products');
        });
    });
}

function showNewPromotion(req, res) {
    return renderPromotionForm(res, {
        title: 'Add Promotion',
        form: getPromotionForm({
            status: 'draft',
            discountType: 'percentage',
            type: 'first_trial'
        })
    });
}

function createPromotion(req, res) {
    const form = getPromotionForm(req.body);

    return MerchantService.getSalons((salonError, salons) => {
        if (salonError) {
            console.error(salonError);
            return res.status(500).render('error', {
                title: 'Salons Not Found',
                message: 'Merchant salons could not be loaded.'
            });
        }

        return MerchantService.getAllServices((serviceError, services) => {
            if (serviceError) {
                console.error(serviceError);
                return res.status(500).render('error', {
                    title: 'Services Not Found',
                    message: 'Merchant services could not be loaded.'
                });
            }

            const errors = validatePromotionForm(form, salons, services);

            if (errors.length > 0) {
                return res.status(400).render('admin-promotion-form', {
                    title: 'Add Promotion',
                    salons,
                    services,
                    promotion: null,
                    form,
                    promotionTypes: Promotion.PROMOTION_TYPES,
                    discountTypes: Promotion.DISCOUNT_TYPES,
                    statuses: Promotion.PROMOTION_STATUSES,
                    errors
                });
            }

            return Promotion.createAsAdmin(buildPromotionPayload(form), (createError) => {
                if (createError) {
                    console.error(createError);
                    return res.status(500).render('admin-promotion-form', {
                        title: 'Add Promotion',
                        salons,
                        services,
                        promotion: null,
                        form,
                        promotionTypes: Promotion.PROMOTION_TYPES,
                        discountTypes: Promotion.DISCOUNT_TYPES,
                        statuses: Promotion.PROMOTION_STATUSES,
                        errors: ['Promotion could not be created. Please try again.']
                    });
                }

                req.session.adminSuccess = 'Promotion created successfully.';
                notifyCustomers({
                    actorUserId: req.session.user.id,
                    type: 'offer_update',
                    title: 'New Vaniday offer',
                    message: `A new promotion is live: ${form.title}.`,
                    linkUrl: '/promotions',
                    dedupeKey: `customer-admin-promotion-created-${form.salonId}-${Date.now()}`
                });
                notifyMerchantBySalonId(form.salonId, {
                    actorUserId: req.session.user.id,
                    type: 'offer_update',
                    title: 'Admin created a promotion',
                    message: `${form.title} was created for your merchant profile.`,
                    linkUrl: '/merchant/promotions',
                    dedupeKey: `merchant-admin-promotion-created-${form.salonId}-${Date.now()}`
                });
                notifyAdmins({
                    actorUserId: req.session.user.id,
                    type: 'offer_update',
                    title: 'Promotion launched',
                    message: `${form.title} was created from the admin portal.`,
                    linkUrl: '/admin/promotions',
                    dedupeKey: `admin-promotion-created-${form.salonId}-${Date.now()}`
                });
                return res.redirect('/admin/promotions');
            });
        });
    });
}

function showEditPromotion(req, res) {
    return Promotion.findById(req.params.promotionId, (promotionError, promotion) => {
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
                message: 'The selected promotion could not be found.'
            });
        }

        return renderPromotionForm(res, {
            title: 'Edit Promotion',
            promotion,
            form: {
                salonId: String(promotion.salonId),
                serviceId: promotion.serviceId ? String(promotion.serviceId) : '',
                title: promotion.title,
                type: promotion.type,
                discountType: promotion.discountType,
                discountValue: promotion.discountValue === null ? '' : String(promotion.discountValue),
                startDate: formatDateInputValue(promotion.startDate),
                endDate: formatDateInputValue(promotion.endDate),
                slots: promotion.allowedSlots || '',
                status: promotion.status,
                description: promotion.description || '',
                terms: promotion.terms || ''
            }
        });
    });
}

function updatePromotion(req, res) {
    return Promotion.findById(req.params.promotionId, (promotionError, promotion) => {
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
                message: 'The selected promotion could not be found.'
            });
        }

        const form = getPromotionForm(req.body);

        return MerchantService.getSalons((salonError, salons) => {
            if (salonError) {
                console.error(salonError);
                return res.status(500).render('error', {
                    title: 'Salons Not Found',
                    message: 'Merchant salons could not be loaded.'
                });
            }

            return MerchantService.getAllServices((serviceError, services) => {
                if (serviceError) {
                    console.error(serviceError);
                    return res.status(500).render('error', {
                        title: 'Services Not Found',
                        message: 'Merchant services could not be loaded.'
                    });
                }

                const errors = validatePromotionForm(form, salons, services);

                if (errors.length > 0) {
                    return res.status(400).render('admin-promotion-form', {
                        title: 'Edit Promotion',
                        salons,
                        services,
                        promotion,
                        form,
                        promotionTypes: Promotion.PROMOTION_TYPES,
                        discountTypes: Promotion.DISCOUNT_TYPES,
                        statuses: Promotion.PROMOTION_STATUSES,
                        errors
                    });
                }

                return Promotion.updateAsAdmin(promotion.id, buildPromotionPayload(form), (updateError) => {
                    if (updateError) {
                        console.error(updateError);
                        return res.status(500).render('admin-promotion-form', {
                            title: 'Edit Promotion',
                            salons,
                            services,
                            promotion,
                            form,
                            promotionTypes: Promotion.PROMOTION_TYPES,
                            discountTypes: Promotion.DISCOUNT_TYPES,
                            statuses: Promotion.PROMOTION_STATUSES,
                            errors: ['Promotion could not be updated. Please check the salon, service, and dates.']
                        });
                    }

                    req.session.adminSuccess = 'Promotion updated successfully.';
                    return res.redirect('/admin/promotions');
                });
            });
        });
    });
}

function deletePromotion(req, res) {
    return Promotion.deleteAsAdmin(req.params.promotionId, (deleteError, result) => {
        if (deleteError) {
            console.error(deleteError);
            req.session.adminError = 'Promotion could not be deleted.';
            return res.redirect('/admin/promotions');
        }

        const deleted = Boolean(result && result.affectedRows > 0);
        req.session.adminSuccess = deleted ? 'Promotion deleted successfully.' : null;
        req.session.adminError = deleted ? null : 'Promotion could not be deleted.';
        return res.redirect('/admin/promotions');
    });
}

function listRewardVouchers(req, res) {
    return RewardVoucher.getAll((voucherError, vouchers = []) => {
        if (voucherError) {
            console.error(voucherError);
            return res.status(500).render('error', {
                title: 'Reward Shop Error',
                message: 'Reward shop vouchers could not be loaded from the database.'
            });
        }

        return RewardShop.getDailyRewardValues((dailyRewardError, dailyRewardValues = [], dailyRewardMeta = {}) => {
            if (dailyRewardError) {
                console.error(dailyRewardError);
                return res.status(500).render('error', {
                    title: 'Reward Shop Error',
                    message: 'Daily reward points could not be loaded from the database.'
                });
            }

            const success = req.session.adminSuccess;
            const error = req.session.adminError;
            req.session.adminSuccess = null;
            req.session.adminError = null;
            const isDatabaseBacked = !vouchers.some((voucher) => voucher.isDefault);
            const isDailySettingsBacked = !dailyRewardMeta.isDefault;

            return res.render('admin-reward-shop-vouchers', {
                title: 'Manage Reward Shop',
                vouchers,
                dailyRewardValues,
                isDatabaseBacked,
                isDailySettingsBacked,
                success,
                error
            });
        });
    });
}

function showNewRewardVoucher(req, res) {
    return renderRewardVoucherForm(res, {
        title: 'Add Reward Shop Voucher',
        form: getRewardVoucherForm({
            status: 'active',
            sortOrder: '0',
            applicableType: 'booking'
        })
    });
}

function createRewardVoucher(req, res) {
    const form = getRewardVoucherForm(req.body);
    const errors = validateRewardVoucherForm(form);

    if (errors.length > 0) {
        return renderRewardVoucherForm(res, {
            status: 400,
            title: 'Add Reward Shop Voucher',
            form,
            errors
        });
    }

    return loadRewardVoucherLinkOptions((linkError, linkOptions) => {
        if (linkError) {
            console.error(linkError);
            return renderRewardVoucherForm(res, {
                status: 500,
                title: 'Add Reward Shop Voucher',
                form,
                errors: ['Voucher products and services could not be loaded from the database.']
            });
        }

        const { linkedTargets, error: targetError } = findRewardVoucherLinkedTargets(form, linkOptions);

        if (targetError) {
            return renderRewardVoucherForm(res, {
                status: 400,
                title: 'Add Reward Shop Voucher',
                form,
                errors: [targetError]
            });
        }

        return RewardVoucher.create(buildRewardVoucherPayload(form, linkedTargets), (createError) => {
            if (createError) {
                console.error(createError);
                return renderRewardVoucherForm(res, {
                    status: 500,
                    title: 'Add Reward Shop Voucher',
                    form,
                    errors: [getRewardVoucherPersistenceError(createError)]
                });
            }

            req.session.adminSuccess = 'Reward shop voucher created successfully.';
            notifyCustomers({
                actorUserId: req.session.user.id,
                type: 'reward_update',
                title: 'New reward voucher',
                message: `${form.title} is now available in the Vaniday reward shop.`,
                linkUrl: '/reward-shop',
                dedupeKey: `customer-reward-voucher-created-${Date.now()}`
            });
            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'reward_update',
                title: 'Reward voucher created',
                message: `${form.title} was added to the reward shop.`,
                linkUrl: '/admin/reward-shop',
                dedupeKey: `admin-reward-voucher-created-${Date.now()}`
            });
            return res.redirect('/admin/reward-shop');
        });
    });
}

function showEditRewardVoucher(req, res) {
    return RewardVoucher.findById(req.params.voucherId, (voucherError, voucher) => {
        if (voucherError) {
            console.error(voucherError);
            return res.status(500).render('error', {
                title: 'Reward Voucher Not Found',
                message: getRewardVoucherPersistenceError(voucherError)
            });
        }

        if (!voucher) {
            return res.status(404).render('error', {
                title: 'Reward Voucher Not Found',
                message: 'The selected reward shop voucher could not be found.'
            });
        }

        return renderRewardVoucherForm(res, {
            title: 'Edit Reward Shop Voucher',
            voucher,
            form: {
                title: voucher.title,
                detail: voucher.detail,
                glintsCost: String(voucher.glintsCost),
                voucherValue: String(voucher.voucherValue),
                status: voucher.status,
                sortOrder: String(voucher.sortOrder),
                applicableTypes: [
                    voucher.appliesToBooking ? 'booking' : null,
                    voucher.linkedServiceId ? 'service' : null,
                    voucher.linkedProductId ? 'product' : null
                ].filter(Boolean),
                linkedServiceId: voucher.linkedServiceId ? String(voucher.linkedServiceId) : '',
                linkedProductId: voucher.linkedProductId ? String(voucher.linkedProductId) : ''
            }
        });
    });
}

function updateRewardVoucher(req, res) {
    return RewardVoucher.findById(req.params.voucherId, (voucherError, voucher) => {
        if (voucherError) {
            console.error(voucherError);
            return res.status(500).render('error', {
                title: 'Reward Voucher Not Found',
                message: getRewardVoucherPersistenceError(voucherError)
            });
        }

        if (!voucher) {
            return res.status(404).render('error', {
                title: 'Reward Voucher Not Found',
                message: 'The selected reward shop voucher could not be found.'
            });
        }

        const form = getRewardVoucherForm(req.body);
        const errors = validateRewardVoucherForm(form);

        if (errors.length > 0) {
            return renderRewardVoucherForm(res, {
                status: 400,
                title: 'Edit Reward Shop Voucher',
                voucher,
                form,
                errors
            });
        }

        return loadRewardVoucherLinkOptions((linkError, linkOptions) => {
            if (linkError) {
                console.error(linkError);
                return renderRewardVoucherForm(res, {
                    status: 500,
                    title: 'Edit Reward Shop Voucher',
                    voucher,
                    form,
                    errors: ['Voucher products and services could not be loaded from the database.']
                });
            }

            const { linkedTargets, error: targetError } = findRewardVoucherLinkedTargets(form, linkOptions);

            if (targetError) {
                return renderRewardVoucherForm(res, {
                    status: 400,
                    title: 'Edit Reward Shop Voucher',
                    voucher,
                    form,
                    errors: [targetError]
                });
            }

            return RewardVoucher.update(voucher.id, buildRewardVoucherPayload(form, linkedTargets), (updateError) => {
                if (updateError) {
                    console.error(updateError);
                    return renderRewardVoucherForm(res, {
                        status: 500,
                        title: 'Edit Reward Shop Voucher',
                        voucher,
                        form,
                        errors: [getRewardVoucherPersistenceError(updateError)]
                    });
                }

                req.session.adminSuccess = 'Reward shop voucher updated successfully.';
                return res.redirect('/admin/reward-shop');
            });
        });
    });
}

function deleteRewardVoucher(req, res) {
    return RewardVoucher.deleteById(req.params.voucherId, (deleteError, result) => {
        if (deleteError) {
            console.error(deleteError);
            req.session.adminError = deleteError.code === 'ER_NO_SUCH_TABLE'
                ? 'Reward shop voucher table is missing. Run database/20260506_create_reward_shop_vouchers.sql first.'
                : 'Reward shop voucher could not be deleted.';
            return res.redirect('/admin/reward-shop');
        }

        const deleted = Boolean(result && result.affectedRows > 0);
        req.session.adminSuccess = deleted ? 'Reward shop voucher deleted successfully.' : null;
        req.session.adminError = deleted ? null : 'Reward shop voucher could not be deleted.';
        return res.redirect('/admin/reward-shop');
    });
}

function updateDailyRewards(req, res) {
    const values = getDailyRewardFormValues(req.body);
    const errors = validateDailyRewardForm(values);

    if (errors.length > 0) {
        req.session.adminError = errors.join(' ');
        return res.redirect('/admin/reward-shop');
    }

    return RewardShop.updateDailyRewardValues(values.map(Number), (updateError) => {
        if (updateError) {
            console.error(updateError);
            req.session.adminError = getDailyRewardPersistenceError(updateError);
            return res.redirect('/admin/reward-shop');
        }

        req.session.adminSuccess = 'Daily reward points updated successfully.';
        notifyCustomers({
            actorUserId: req.session.user.id,
            type: 'reward_update',
            title: 'Daily rewards updated',
            message: 'The Vaniday daily reward check-in values have been refreshed.',
            linkUrl: '/reward-shop',
            dedupeKey: `customer-daily-rewards-updated-${Date.now()}`
        });
        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'reward_update',
            title: 'Daily rewards updated',
            message: 'Daily reward points were updated from the admin portal.',
            linkUrl: '/admin/reward-shop',
            dedupeKey: `admin-daily-rewards-updated-${Date.now()}`
        });
        return res.redirect('/admin/reward-shop');
    });
}

function renderAdminCashbackForm(res, status, viewModel) {
    return res.status(status).render('admin-cashback-form', {
        statuses: CashbackCampaign.CAMPAIGN_STATUSES,
        applicableTypes: CashbackCampaign.APPLICABLE_TYPES,
        ...viewModel
    });
}

function listCashbackCampaigns(req, res) {
    return CashbackCampaign.getAll((campaignError, campaigns = []) => {
        if (campaignError) {
            console.error(campaignError);
            return res.status(500).render('error', {
                title: 'Admin Cashback Error',
                message: 'Cashback campaigns could not be loaded.'
            });
        }

        const success = req.session.adminSuccess;
        const error = req.session.adminError;
        req.session.adminSuccess = null;
        req.session.adminError = null;

        return res.render('admin-cashback', {
            title: 'Admin Cashback Campaigns',
            campaigns,
            success,
            error
        });
    });
}

function showNewCashbackCampaign(req, res) {
    return MerchantService.getSalons((salonError, salons = []) => {
        if (salonError) {
            console.error(salonError);
        }

        return renderAdminCashbackForm(res, 200, {
            title: 'New Cashback Campaign',
            salons: salonError ? [] : salons,
            campaign: null,
            form: {
                salonId: '',
                title: '',
                cashbackPercent: '',
                minimumSpend: '0.00',
                startAt: '',
                endAt: '',
                status: 'draft',
                applicableType: 'both'
            },
            errors: []
        });
    });
}

function createCashbackCampaign(req, res) {
    return MerchantService.getSalons((salonError, salons = []) => {
        if (salonError) {
            console.error(salonError);
        }

        const form = {
            ...getCashbackCampaignForm(req.body),
            createdByUserId: req.session.user.id
        };
        const errors = CashbackCampaign.validateCampaign(form);

        if (errors.length) {
            return renderAdminCashbackForm(res, 400, {
                title: 'New Cashback Campaign',
                salons: salonError ? [] : salons,
                campaign: null,
                form,
                errors
            });
        }

        return CashbackCampaign.createAsAdmin(form, (createError) => {
            if (createError) {
                console.error(createError);
                return renderAdminCashbackForm(res, 500, {
                    title: 'New Cashback Campaign',
                    salons: salonError ? [] : salons,
                    campaign: null,
                    form,
                    errors: ['Cashback campaign could not be created.']
                });
            }

            req.session.adminSuccess = 'Cashback campaign created.';
            return res.redirect('/admin/cashback');
        });
    });
}

function showEditCashbackCampaign(req, res) {
    return CashbackCampaign.findById(req.params.campaignId, (campaignError, campaign) => {
        if (campaignError || !campaign) {
            return res.status(campaignError ? 500 : 404).render('error', {
                title: 'Cashback Campaign Not Found',
                message: campaignError ? 'Cashback campaign could not be loaded.' : 'Cashback campaign was not found.'
            });
        }

        return MerchantService.getSalons((salonError, salons = []) => {
            if (salonError) {
                console.error(salonError);
            }

            return renderAdminCashbackForm(res, 200, {
                title: 'Edit Cashback Campaign',
                salons: salonError ? [] : salons,
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
                errors: []
            });
        });
    });
}

function updateCashbackCampaign(req, res) {
    return MerchantService.getSalons((salonError, salons = []) => {
        if (salonError) {
            console.error(salonError);
        }

        const form = getCashbackCampaignForm(req.body);
        const errors = CashbackCampaign.validateCampaign(form);

        if (errors.length) {
            return renderAdminCashbackForm(res, 400, {
                title: 'Edit Cashback Campaign',
                salons: salonError ? [] : salons,
                campaign: { id: req.params.campaignId },
                form,
                errors
            });
        }

        return CashbackCampaign.updateAsAdmin(req.params.campaignId, form, (updateError, result) => {
            if (updateError) {
                console.error(updateError);
                return renderAdminCashbackForm(res, 500, {
                    title: 'Edit Cashback Campaign',
                    salons: salonError ? [] : salons,
                    campaign: { id: req.params.campaignId },
                    form,
                    errors: ['Cashback campaign could not be updated.']
                });
            }

            req.session.adminSuccess = result?.affectedRows ? 'Cashback campaign updated.' : null;
            req.session.adminError = result?.affectedRows ? null : 'Cashback campaign could not be updated.';
            return res.redirect('/admin/cashback');
        });
    });
}

function deleteCashbackCampaign(req, res) {
    return CashbackCampaign.deleteAsAdmin(req.params.campaignId, (error, result) => {
        if (error) {
            console.error(error);
            req.session.adminError = 'Cashback campaign could not be deleted.';
            return res.redirect('/admin/cashback');
        }

        req.session.adminSuccess = result?.affectedRows ? 'Cashback campaign deleted.' : null;
        req.session.adminError = result?.affectedRows ? null : 'Cashback campaign could not be deleted.';
        return res.redirect('/admin/cashback');
    });
}

module.exports = {
    showDashboard,
    showOverview,
    showBookings,
    showMerchants,
    showReviews,
    showAnalytics,
    showAuditTrail,
    showPlatformHealth,
    showNewMerchant,
    createMerchant,
    updateMerchantCommission,
    featureMerchant,
    unfeatureMerchant,
    showUsers,
    terminateUser,
    deleteUser,
    listServices,
    showNewPromotion,
    createPromotion,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService,
    listPromotions,
    listProducts,
    showNewProduct,
    createProduct,
    showEditProduct,
    updateProduct,
    deleteProduct,
    showEditPromotion,
    updatePromotion,
    deletePromotion,
    listRewardVouchers,
    showNewRewardVoucher,
    createRewardVoucher,
    showEditRewardVoucher,
    updateRewardVoucher,
    deleteRewardVoucher,
    updateDailyRewards,
    listCashbackCampaigns,
    showNewCashbackCampaign,
    createCashbackCampaign,
    showEditCashbackCampaign,
    updateCashbackCampaign,
    deleteCashbackCampaign
};
