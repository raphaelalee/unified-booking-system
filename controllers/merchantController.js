const QRCode = require('qrcode');
const crypto = require('crypto');
const MerchantService = require('../models/MerchantService');
const Promotion = require('../models/Promotion');
const Booking = require('../models/Booking');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const PurchaseHistory = require('../models/PurchaseHistory');
const Loyalty = require('../models/Loyalty');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const UserVoucher = require('../models/UserVoucher');
const User = require('../models/User');
const GiftCardVoucher = require('../models/GiftCardVoucher');
const GiftCardConfig = require('../models/GiftCardConfig');
const FavouriteMerchant = require('../models/FavouriteMerchant');
const CustomerAddress = require('../models/CustomerAddress');
const PaymentAttempt = require('../models/PaymentAttempt');
const CustomerCart = require('../models/CustomerCart');
const EWallet = require('../models/EWallet');
const { getCartItemCount, getCartLineTotal, getCartQuantity } = require('../utils/cart');
const { sendBookingConfirmationEmail, sendGiftCardEmail } = require('../utils/emailNotifications');
const { getPublicHolidayDateMap, getPublicHolidayName } = require('../utils/publicHolidays');
const { sendBookingConfirmationSms } = require('../utils/smsNotifications');
const { sendBookingNotification } = require('../utils/whatsappNotifications');
const { formatAppointmentDateTime } = require('../utils/dateTimeFormat');
const {
    formatPaymentBreakdown,
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');
const { buildBookingReference } = require('../utils/bookingReference');
const { extractProviderFeeSnapshot } = require('../services/refundCalculation');
const hitpay = require('../services/hitpay');
const paypal = require('../services/paypal');
const nets = require('../services/nets');
const stripe = require('../services/stripe');
const {
    getBookingCheckInUrl,
    getGuestReceiptPath,
    getGuestReceiptUrl,
    getMerchantStorefrontPath,
    getMerchantStorefrontSlug,
    getMerchantStorefrontUrl,
    parseMerchantStorefrontSlug,
    signMerchantToken,
    verifyBookingCheckInToken,
    verifyMerchantToken
} = require('../utils/qrToken');
const { getBirthdayPromotionContext } = require('../utils/birthdayPromotions');

const hitpayPendingStore = new Map();

const NETS_STATUS_POLL_MS = 3000;
const NETS_STATUS_TIMEOUT_MS = 5 * 60 * 1000;
const CART_DELIVERY_FEE = 4.90;
const FLASH_DEALS_BATCH_SIZE = 6;
const FLASH_DEALS_ROTATION_MS = 6 * 60 * 60 * 1000;

function normalizeText(value) {
    return String(value || '').trim();
}

function formatFlashDealDiscount(discountType, discountValue) {
    const numericValue = Number(discountValue || 0);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return 'Limited deal';
    }

    if (discountType === 'percentage') {
        return `${Math.round(numericValue)}% off`;
    }

    if (discountType === 'fixed_amount') {
        return `$${numericValue.toFixed(numericValue % 1 === 0 ? 0 : 2)} off`;
    }

    if (discountType === 'fixed_price') {
        return `Now $${numericValue.toFixed(numericValue % 1 === 0 ? 0 : 2)}`;
    }

    return 'Flash deal';
}

function resolveFlashDealPricing(promotion, linkedItem) {
    const basePrice = Number(linkedItem?.price || 0);
    const discountValue = Number(promotion?.discountValue || 0);

    if (!Number.isFinite(basePrice) || basePrice <= 0) {
        return {
            basePrice: null,
            dealPrice: null
        };
    }

    if (promotion.discountType === 'fixed_price' && discountValue > 0) {
        return {
            basePrice,
            dealPrice: discountValue
        };
    }

    if (promotion.discountType === 'fixed_amount' && discountValue > 0) {
        return {
            basePrice,
            dealPrice: Math.max(0, basePrice - discountValue)
        };
    }

    if (promotion.discountType === 'percentage' && discountValue > 0) {
        return {
            basePrice,
            dealPrice: Math.max(0, basePrice * (1 - (discountValue / 100)))
        };
    }

    return {
        basePrice,
        dealPrice: null
    };
}

function rotateFlashDeals(items = [], cycleIndex = 0, batchSize = FLASH_DEALS_BATCH_SIZE) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    if (items.length <= batchSize) {
        return items.slice(0, batchSize);
    }

    const offset = (cycleIndex * batchSize) % items.length;
    const ordered = items.slice(offset).concat(items.slice(0, offset));
    return ordered.slice(0, batchSize);
}

function getFlashDealDiscountPercent(item, cycleIndex) {
    const identity = `${item?.flashItemType || 'item'}-${item?.id || 0}-${cycleIndex}`;
    let hash = 0;

    for (let index = 0; index < identity.length; index += 1) {
        hash = ((hash * 31) + identity.charCodeAt(index)) >>> 0;
    }

    return 10 + (hash % 11);
}

function createFlashDealToken(itemType, itemId, cycleIndex, discountPercent) {
    const payload = `${itemType}:${itemId}:${cycleIndex}:${discountPercent}`;
    const secret = process.env.SESSION_SECRET || process.env.FLASH_DEAL_SECRET || 'vaniday-flash-deals';
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyFlashDealRequest(itemType, itemId, cycleIndex, discountPercent, token) {
    const numericCycle = Number(cycleIndex);
    const currentCycle = Math.floor(Date.now() / FLASH_DEALS_ROTATION_MS);
    const numericDiscount = Number(discountPercent);

    if (!Number.isInteger(numericCycle) || numericCycle !== currentCycle || !Number.isInteger(numericDiscount) || numericDiscount < 10 || numericDiscount > 20) {
        return false;
    }

    const expected = createFlashDealToken(itemType, itemId, numericCycle, numericDiscount);
    const supplied = String(token || '');
    return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function selectLowSellingItems(items = [], salesCounts = {}, limit = 12) {
    const ranked = items
        .filter((item) => Number(item.price || 0) > 0)
        .map((item) => ({
            ...item,
            salesCount: Number(salesCounts[Number(item.id)] || 0)
        }))
        .sort((left, right) => left.salesCount - right.salesCount || Number(left.id) - Number(right.id));

    if (ranked.length === 0) {
        return [];
    }

    const averageSales = ranked.reduce((total, item) => total + item.salesCount, 0) / ranked.length;
    const underperformers = ranked.filter((item) => item.salesCount <= averageSales);
    return (underperformers.length > 0 ? underperformers : ranked.slice(0, Math.ceil(ranked.length / 2))).slice(0, limit);
}

function loadLowSellingFlashInventory(callback) {
    let products = [];
    let services = [];
    let productSales = {};
    let serviceSales = {};
    let pending = 4;

    const finish = () => {
        pending -= 1;
        if (pending > 0) return;

        callback({
            products: selectLowSellingItems(products.filter((product) => Number(product.stockQuantity || 0) > 0), productSales),
            services: selectLowSellingItems(services, serviceSales)
        });
    };

    Product.getAll((error, rows = []) => {
        if (error) console.error(error);
        products = rows;
        finish();
    });
    MerchantService.getAllServices((error, rows = []) => {
        if (error) console.error(error);
        services = rows;
        finish();
    });
    PurchaseHistory.getProductSalesCounts((error, counts = {}) => {
        if (error) console.error(error);
        productSales = counts;
        finish();
    });
    Booking.getServiceSalesCounts((error, counts = {}) => {
        if (error) console.error(error);
        serviceSales = counts;
        finish();
    });
}

function buildFlashDeals(promotions = [], featuredProducts = [], featuredServices = []) {
    const now = Date.now();
    const cycleIndex = Math.floor(now / FLASH_DEALS_ROTATION_MS);
    const nextRotationAt = new Date((cycleIndex + 1) * FLASH_DEALS_ROTATION_MS);
    const productById = new Map(featuredProducts.map((product) => [String(product.id), product]));
    const serviceById = new Map(featuredServices.map((service) => [String(service.id), service]));
    const promotionDeals = promotions
        .filter((promotion) => String(promotion.status || '').toLowerCase() === 'active' && Boolean(promotion.showInFlashDeals))
        .map((promotion, index) => {
            const linkedService = serviceById.get(String(promotion.serviceId || '')) || null;
            const linkedProduct = productById.get(String(promotion.productId || '')) || null;
            const linkedItem = linkedService || linkedProduct || null;
            const isProductDeal = Boolean(linkedProduct) && !linkedService;
            const targetName = normalizeText(linkedService?.name || linkedProduct?.name || promotion.serviceName || promotion.productName || promotion.title);
            const { basePrice, dealPrice } = resolveFlashDealPricing(promotion, linkedItem);

            if (!linkedItem) {
                return null;
            }

            return {
                id: `promo-${promotion.id}`,
                title: targetName || normalizeText(promotion.title) || 'Flash deal',
                merchantName: normalizeText(promotion.salonName) || 'Vaniday merchant',
                description: normalizeText(promotion.description) || normalizeText(promotion.title) || 'Limited-time marketplace offer.',
                discountLabel: formatFlashDealDiscount(promotion.discountType, promotion.discountValue),
                badge: isProductDeal ? 'Product deal' : 'Service deal',
                href: linkedProduct
                    ? `/products/${linkedProduct.id}?from=flash-deals`
                    : (linkedService
                        ? `/merchants/${promotion.salonId}?from=flash-deals`
                        : '/promotions'),
                imageUrl: normalizeText(linkedProduct?.imageUrl || linkedProduct?.fallbackImageUrl || linkedService?.imageUrl),
                imageClass: isProductDeal ? 'home-product-image' : '',
                endsAt: promotion.endDate || null,
                basePrice,
                dealPrice,
                urgency: Number(promotion.totalRedemptions || 0) >= 10 ? 'Selling fast' : 'Limited time',
                priority: index
            };
        })
        .filter(Boolean);

    if (promotionDeals.length > 0) {
        const eligibleDeals = promotionDeals
            .sort((left, right) => {
                const leftEndsAt = left.endsAt ? new Date(left.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
                const rightEndsAt = right.endsAt ? new Date(right.endsAt).getTime() : Number.MAX_SAFE_INTEGER;

                if (leftEndsAt !== rightEndsAt) {
                    return leftEndsAt - rightEndsAt;
                }

                return left.priority - right.priority;
            });
        const deals = rotateFlashDeals(eligibleDeals, cycleIndex, FLASH_DEALS_BATCH_SIZE);
        const earliestDealEnd = deals.reduce((soonest, deal) => {
            const dealEnd = deal.endsAt ? new Date(deal.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
            return Math.min(soonest, dealEnd);
        }, Number.MAX_SAFE_INTEGER);
        const sectionEndsAt = new Date(Math.min(nextRotationAt.getTime(), earliestDealEnd));

        return {
            deals,
            sectionEndsAt: Number.isFinite(sectionEndsAt.getTime()) ? sectionEndsAt.toISOString() : nextRotationAt.toISOString(),
            cycleMs: FLASH_DEALS_ROTATION_MS
        };
    }

    const lowSellingInventory = [
        ...featuredProducts.map((product) => ({ ...product, flashItemType: 'product' })),
        ...featuredServices.map((service) => ({ ...service, flashItemType: 'service' }))
    ].sort((left, right) => Number(left.salesCount || 0) - Number(right.salesCount || 0));
    const fallbackDeals = rotateFlashDeals(lowSellingInventory, cycleIndex, FLASH_DEALS_BATCH_SIZE).map((item) => {
        const isProduct = item.flashItemType === 'product';
        const basePrice = Number(item.price || 0);
        const discountPercent = getFlashDealDiscountPercent(item, cycleIndex);
        const dealPrice = Math.round((basePrice * (1 - (discountPercent / 100))) * 100) / 100;
        const flashToken = createFlashDealToken(item.flashItemType, item.id, cycleIndex, discountPercent);
        const serviceBookingHref = `/merchants/${item.salonId || item.merchantId}?${new URLSearchParams({
            serviceId: String(item.id),
            from: 'flash-deals',
            flashDealCycle: String(cycleIndex),
            flashDiscountPercent: String(discountPercent),
            flashDealToken: flashToken
        }).toString()}#storefront-services`;
        return {
            id: `${item.flashItemType}-${item.id}`,
            title: normalizeText(item.name) || (isProduct ? 'Product deal' : 'Service deal'),
            merchantName: normalizeText(item.salonName || item.merchantName) || 'Vaniday merchant',
            description: normalizeText(item.description || item.shortDescription) || 'A limited marketplace offer that deserves more attention.',
            discountLabel: `${discountPercent}% off`,
            badge: isProduct ? 'Product deal' : 'Service deal',
            href: isProduct
                ? `/products/${item.id}?from=flash-deals`
                : serviceBookingHref,
            imageUrl: normalizeText(item.imageUrl || item.fallbackImageUrl),
            imageClass: isProduct ? 'home-product-image' : '',
            endsAt: null,
            basePrice,
            dealPrice,
            discountPercent,
            flashDealCycle: cycleIndex,
            flashToken,
            isProductDeal: isProduct,
            itemId: item.id,
            merchantId: item.salonId || item.merchantId,
            urgency: Number(item.salesCount || 0) === 0 ? 'New discovery' : 'Needs a boost'
        };
    });

    return {
        deals: fallbackDeals,
        sectionEndsAt: nextRotationAt.toISOString(),
        cycleMs: FLASH_DEALS_ROTATION_MS
    };
}

function normalizeFulfilment(value) {
    return String(value || '').toLowerCase() === 'delivery' ? 'delivery' : 'pickup';
}

function normalizeAddressText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function getApprovedSalons() {
    return new Promise((resolve, reject) => {
        MerchantService.getSalons((error, rows = []) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(rows);
        });
    });
}

function buildPickupMerchantOptions(cart = [], salonRows = []) {
    const optionMap = new Map();
    const salonMap = new Map((salonRows || []).map((row) => [
        String(row.salon_id),
        {
            address: normalizeAddressText(row.address),
            pickupInstructions: normalizeAddressText(row.description)
        }
    ]));

    (cart || []).forEach((item) => {
        const merchantId = String(item.merchantId || '').trim();
        const merchantName = String(item.merchantName || '').trim();

        if (!merchantId || !merchantName) {
            return;
        }

        const existing = optionMap.get(merchantId) || {
            id: merchantId,
            name: merchantName,
            address: salonMap.get(merchantId)?.address || '',
            pickupInstructions: salonMap.get(merchantId)?.pickupInstructions || '',
            items: []
        };
        const quantity = Math.max(1, Number(item.quantity || 1));
        const lineTotal = Number(item.lineTotal || (Number(item.price || 0) * quantity));

        existing.items.push({
            id: String(item.id || ''),
            name: item.serviceName || item.name || 'Cart item',
            type: item.type || 'Service',
            quantity,
            lineTotal
        });

        optionMap.set(merchantId, existing);
    });

    return Array.from(optionMap.values())
        .map((merchant) => ({
            ...merchant,
            itemCount: merchant.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
            totalAmount: Math.round(merchant.items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0) * 100) / 100
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

async function resolvePickupMerchantOptions(cart = []) {
    const baseOptions = buildPickupMerchantOptions(cart, []);

    if (!baseOptions.length) {
        return [];
    }

    try {
        const salonRows = await getApprovedSalons();
        return buildPickupMerchantOptions(cart, salonRows);
    } catch (error) {
        console.error('Pickup merchant details could not be enriched:', error);
        return baseOptions;
    }
}

function getSelectedCartIds(body = {}) {
    if (typeof body.selectedItemIds === 'undefined') {
        return [];
    }

    const rawIds = Array.isArray(body.selectedItemIds)
        ? body.selectedItemIds
        : String(body.selectedItemIds || '').split(',');

    return rawIds.map((id) => String(id).trim()).filter(Boolean);
}

function validateDeliveryDetails(body = {}) {
    const deliveryAddress = String(body.deliveryAddress || '').trim().replace(/\s+/g, ' ');
    const deliveryUnit = String(body.deliveryUnit || '').trim();
    const deliveryPostal = String(body.deliveryPostal || '').trim();
    const deliveryPhone = String(body.deliveryPhone || '').trim();
    const errors = [];

    if (!deliveryAddress) {
        errors.push('Enter a delivery address.');
    }

    if (!/^#\d{1,3}-\d{1,3}$/.test(deliveryUnit)) {
        errors.push('Use unit format #12-34.');
    }

    if (!/^\d{6}$/.test(deliveryPostal)) {
        errors.push('Enter a valid 6-digit postal code.');
    }

    if (!/^\d{8}$/.test(deliveryPhone)) {
        errors.push('Enter an 8-digit contact number.');
    }

    return {
        details: {
            deliveryAddress,
            deliveryUnit,
            deliveryPostal,
            deliveryPhone
        },
        errors
    };
}

function getTodayInputValue() {
    return Booking.getSingaporeTodayKey();
}

function buildBirthdayPromotion(user, vouchers = []) {
    const context = getBirthdayPromotionContext(user?.birthday);
    const voucher = vouchers.find((entry) => {
        return String(entry.sourceType || '').toLowerCase() === 'birthday'
            && String(entry.sourceReference || '') === `birthday-${context.rewardYear}`;
    }) || null;

    return {
        hasBirthday: context.hasBirthday,
        isBirthdayMonth: context.isBirthdayMonth,
        monthName: context.monthName,
        monthEndLabel: context.monthEndLabel,
        voucher,
        pointsMultiplier: context.isBirthdayMonth ? 2 : 1
    };
}

function mergeFeaturedMerchantRows(baseMerchants = [], featuredMerchants = []) {
    const featuredMap = new Map((featuredMerchants || []).map((merchant) => [String(merchant.id), merchant]));

    const merged = baseMerchants.map((merchant) => {
        const featured = featuredMap.get(String(merchant.id));

        if (!featured) {
            return {
                ...merchant,
                isFeatured: false,
                featuredType: '',
                featuredOrder: 999,
                featuredScore: 0
            };
        }

        return {
            ...merchant,
            ...featured,
            qrToken: merchant.qrToken || featured.qrToken || ''
        };
    });

    featuredMerchants.forEach((merchant) => {
        if (!merged.some((item) => String(item.id) === String(merchant.id))) {
            merged.push(merchant);
        }
    });

    return merged;
}

function sortMerchantsByFeatured(merchants = []) {
    return [...merchants].sort((left, right) => {
        if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) {
            return left.isFeatured ? -1 : 1;
        }

        if (Number(left.featuredOrder || 0) !== Number(right.featuredOrder || 0)) {
            return Number(left.featuredOrder || 0) - Number(right.featuredOrder || 0);
        }

        return Number(right.featuredScore || 0) - Number(left.featuredScore || 0);
    });
}

function sortServicesByFeatured(services = []) {
    return [...services].sort((left, right) => {
        if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) {
            return left.isFeatured ? -1 : 1;
        }

        if (Number(left.featuredOrder || 0) !== Number(right.featuredOrder || 0)) {
            return Number(left.featuredOrder || 0) - Number(right.featuredOrder || 0);
        }

        return Number(right.merchantFeaturedScore || 0) - Number(left.merchantFeaturedScore || 0);
    });
}

function sortProductsByFeatured(products = []) {
    return [...products].sort((left, right) => {
        if (Boolean(left.isFeatured) !== Boolean(right.isFeatured)) {
            return left.isFeatured ? -1 : 1;
        }

        if (Number(left.featuredOrder || 0) !== Number(right.featuredOrder || 0)) {
            return Number(left.featuredOrder || 0) - Number(right.featuredOrder || 0);
        }

        return Number(right.id || 0) - Number(left.id || 0);
    });
}

function matchesPublicSearch(search, values = []) {
    const normalized = String(search || '').trim().toLowerCase();

    if (!normalized) {
        return true;
    }

    return values.some((value) => String(value || '').toLowerCase().includes(normalized));
}

function isApprovedMerchant(merchant) {
    return merchant && String(merchant.approvalStatus || 'approved') === 'approved';
}

function mapSalonForPublic(row) {
    return {
        id: row.salon_id,
        salonId: row.salon_id,
        name: row.salon_name,
        category: row.business_category || 'Merchant',
        location: row.address || 'Singapore',
        description: row.description || '',
        ownerEmail: row.owner_email || '',
        rating: 'New',
        services: []
    };
}

function getPublicMerchants(search, callback) {
    return MerchantService.getSalons((error, salons = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, salons
            .map(mapSalonForPublic)
            .filter((merchant) => matchesPublicSearch(search, [
                merchant.name,
                merchant.category,
                merchant.location,
                merchant.description,
                merchant.ownerEmail
            ])));
    });
}

function mapServiceForPublic(service, req) {
    return {
        ...service,
        merchantId: service.salonId,
        merchantName: service.salonName,
        merchantLocation: service.salonAddress || '',
        merchantCategory: service.category || 'Service',
        merchantRating: 'New',
        serviceBookingPath: `/booking/${service.salonId}?serviceId=${service.id}`,
        serviceBookingUrl: `${req.protocol}://${req.get('host')}/booking/${service.salonId}?serviceId=${service.id}`
    };
}

function getPublicServiceCatalog(req, search, callback) {
    return MerchantService.getAllServices((error, services = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, services
            .map((service) => mapServiceForPublic(service, req))
            .filter((service) => !service.inventoryBlocked)
            .filter((service) => matchesPublicSearch(search, [
                service.name,
                service.category,
                service.merchantName,
                service.merchantLocation,
                service.description
            ])));
    });
}

function getPortalStatsFromServices(services = [], promotions = []) {
    const prices = services.map((service) => Number(service.price)).filter((price) => !Number.isNaN(price));
    const merchantIds = new Set(services.map((service) => service.merchantId || service.salonId).filter(Boolean));

    return {
        merchantCount: merchantIds.size,
        serviceCount: services.length,
        promotionCount: Array.isArray(promotions) ? promotions.length : 0,
        slotCount: services.reduce((total, service) => total + (service.slots || []).length, 0),
        startingPrice: prices.length > 0 ? Math.min(...prices) : 0
    };
}

function calculateVoucherDiscount(voucher, amount) {
    const grossAmount = Number(amount || 0);

    if (!voucher || grossAmount <= 0) {
        return 0;
    }

    if (voucher.discountType === 'percentage') {
        return Math.round((grossAmount * (Number(voucher.discountPercent || 0) / 100)) * 100) / 100;
    }

    return Math.min(Number(voucher.remainingValue || 0), grossAmount);
}

function getOrderVoucherEligibleAmount(voucher, payment = {}) {
    const items = Array.isArray(payment.items) ? payment.items : [];

    return items.reduce((sum, item) => {
        if (String(item.type || '') !== 'Product') {
            return sum;
        }

        if (voucher.sourceType !== 'reward_shop_merchant') {
            return sum + Number(item.lineTotal || 0);
        }

        if (voucher.merchantId && String(voucher.merchantId) !== String(item.merchantId || item.salonId || '')) {
            return sum;
        }

        if (voucher.linkedItemType === 'product' && voucher.linkedItemId && String(voucher.linkedItemId) !== String(item.serviceId || item.productId || '')) {
            return sum;
        }

        return sum + Number(item.lineTotal || 0);
    }, 0);
}

function getVoucherEligibleAmount(voucher, payment = {}) {
    if (!voucher) {
        return 0;
    }

    if (payment.kind === 'order') {
        return getOrderVoucherEligibleAmount(voucher, payment);
    }

    return Number(payment.amount || 0);
}

function compareVoucherRecommendations(left, right) {
    if (!left) {
        return 1;
    }

    if (!right) {
        return -1;
    }

    if (Number(left.discount || 0) !== Number(right.discount || 0)) {
        return Number(right.discount || 0) - Number(left.discount || 0);
    }

    if (Number(left.voucher?.discountPercent || 0) !== Number(right.voucher?.discountPercent || 0)) {
        return Number(right.voucher?.discountPercent || 0) - Number(left.voucher?.discountPercent || 0);
    }

    const leftExpiry = left.voucher?.expiresAt ? new Date(left.voucher.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightExpiry = right.voucher?.expiresAt ? new Date(right.voucher.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;

    if (leftExpiry !== rightExpiry) {
        return leftExpiry - rightExpiry;
    }

    return Number(left.voucher?.id || 0) - Number(right.voucher?.id || 0);
}

async function getVoucherRecommendation(vouchers = [], payment = {}, validator = UserVoucher.validateForBooking) {
    if (!Array.isArray(vouchers) || !vouchers.length) {
        return null;
    }

    const validRecommendations = await Promise.all(vouchers.map((voucher) => new Promise((resolve) => {
        validator(voucher, payment, (error) => {
            if (error) {
                resolve(null);
                return;
            }

            const eligibleAmount = getVoucherEligibleAmount(voucher, payment);
            const discount = calculateVoucherDiscount(voucher, eligibleAmount);

            if (discount <= 0) {
                resolve(null);
                return;
            }

            resolve({
                voucher,
                discount: Math.round(Number(discount || 0) * 100) / 100
            });
        });
    })));

    const ranked = validRecommendations.filter(Boolean).sort(compareVoucherRecommendations);
    return ranked[0] || null;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getGiftCardExpiryDate(validityMonths = 12) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + Math.max(1, Number(validityMonths || 12)));
    return expiry.toISOString().slice(0, 19).replace('T', ' ');
}

function parseGiftCardForm(body, sessionUser) {
    const rawAmount = String(body.customAmount || body.amount || '').trim();
    const amount = Number(rawAmount || 0);
    const deliveryOption = String(body.deliveryOption || 'self') === 'recipient' ? 'recipient' : 'self';
    const recipientEmail = deliveryOption === 'recipient'
        ? String(body.recipientEmail || '').trim()
        : String(sessionUser?.email || '').trim();
    const recipientName = String(body.recipientName || '').trim();
    const senderName = String(body.senderName || sessionUser?.name || '').trim();
    const message = String(body.message || '').trim();

    return {
        amount,
        deliveryOption,
        recipientEmail,
        recipientName,
        senderName,
        message
    };
}

function getGiftCardConfigView() {
    return new Promise((resolve, reject) => {
        GiftCardConfig.getConfig((error, config) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(config);
        });
    });
}

async function persistGiftCardVouchers(req, payment) {
    const giftCardItems = (payment.items || []).filter((item) => String(item.type) === 'Gift Card' && item.giftCard);

    if (!giftCardItems.length) {
        return [];
    }

    const saved = [];
    const giftCardConfig = await getGiftCardConfigView();
    const minAmount = Number(giftCardConfig.minAmount);
    const maxAmount = Number(giftCardConfig.maxAmount);

    if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount <= 0 || maxAmount < minAmount) {
        throw new Error('Gift card settings are incomplete.');
    }

    for (const [index, item] of giftCardItems.entries()) {
        const giftCard = item.giftCard || {};
        const amount = Number(item.price || 0);
        const recipientEmail = giftCard.deliveryOption === 'recipient'
            ? giftCard.recipientEmail
            : String(req.session.user?.email || payment.userEmail || '').trim();

        if (!Number.isFinite(amount) || amount < minAmount || amount > maxAmount) {
            throw new Error(`Gift card amount must be between $${minAmount} and $${maxAmount}.`);
        }

        if (!isValidEmail(recipientEmail)) {
            throw new Error('Gift card recipient email is invalid.');
        }

        const payload = {
            code: GiftCardVoucher.generateCode('VANI'),
            amount,
            balance: amount,
            senderUserId: Number(req.session.user?.id || payment.userId || null) || null,
            senderName: String(giftCard.senderName || req.session.user?.name || payment.userName || '').trim(),
            recipientName: String(giftCard.recipientName || '').trim(),
            recipientEmail: recipientEmail || null,
            message: String(giftCard.message || '').trim(),
            deliveryOption: giftCard.deliveryOption || 'self',
            scheduledSendDate: null,
            expiryDate: getGiftCardExpiryDate(giftCard.validityMonths),
            status: 'active',
            sourceReference: null
        };

        try {
            const result = await new Promise((resolve, reject) => {
                GiftCardVoucher.create(payload, (error, resultData) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve({
                        id: resultData.insertId,
                        voucherCode: resultData.voucherCode || payload.code,
                        duplicate: resultData.duplicate === true,
                        ...payload
                    });
                });
            });

            if (!result.duplicate) {
                saved.push(result);
            }
        } catch (error) {
            console.error('Gift card voucher persistence failed:', error.message);
            throw error;
        }
    }

    return saved;
}

function appendQueryParams(path, params = {}) {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, String(value));
        }
    });

    const queryString = searchParams.toString();

    if (!queryString) {
        return path;
    }

    return `${path}${path.includes('?') ? '&' : '?'}${queryString}`;
}

function getWhatsAppNumber() {
    return String(process.env.WHATSAPP_BOOKING_PHONE || '').replace(/[^\d]/g, '');
}

function getWhatsAppUrl(message) {
    const text = encodeURIComponent(message);
    const phone = getWhatsAppNumber();

    if (phone) {
        return `https://wa.me/${phone}?text=${text}`;
    }

    return `https://wa.me/?text=${text}`;
}

function buildWhatsAppBookingMessage({ merchant, service = null, bookingDate = '', bookingTime = '', customerName = '', phone = '', bookingUrl = '' }) {
    const lines = [
        `Hi ${merchant.name}, I would like to make a booking enquiry through Vaniday.`,
        service ? `Service: ${service.name || service.service_name}` : 'Service: Please advise available services',
        bookingDate ? `Date: ${bookingDate}` : 'Date: Please advise availability',
        bookingTime ? `Time: ${bookingTime}` : 'Time: Please advise availability',
        customerName ? `Name: ${customerName}` : '',
        phone ? `Phone: ${phone}` : '',
        bookingUrl ? `Booking page: ${bookingUrl}` : '',
        'Please confirm if this slot is available. Thank you.'
    ];

    return lines.filter(Boolean).join('\n');
}

function getWhatsAppEnquiryUrl(merchant, service = null, bookingUrl = '') {
    return getWhatsAppUrl(buildWhatsAppBookingMessage({ merchant, service, bookingUrl }));
}

function notifyBookingByWhatsApp(booking) {
    sendBookingNotification(booking).catch((error) => {
        console.error('WhatsApp booking notification failed:', error.message);
    });
}

function notifyBookingByEmail(booking) {
    sendBookingConfirmationEmail(booking)
        .then((result) => {
            if (result?.skipped) {
                console.log('Email booking confirmation skipped: SMTP is not configured or booking email is missing.');
                return;
            }

            console.log(`Email booking confirmation sent to ${booking.email}.`);
        })
        .catch((error) => {
            console.error('Email booking confirmation failed:', error.message);
        });
}

function notifyBookingBySms(booking) {
    sendBookingConfirmationSms(booking)
        .then((result) => {
            if (result?.skipped) {
                console.log('SMS booking confirmation skipped: SMS is not configured or booking phone is missing.');
                return;
            }

            console.log(`SMS booking confirmation sent to ${booking.phone}.`);
        })
        .catch((error) => {
            console.error('SMS booking confirmation failed:', error.message);
        });
}

function notifyBooking(booking) {
    notifyBookingByWhatsApp(booking);
    notifyBookingByEmail(booking);
    notifyBookingBySms(booking);
}

async function buildBookingReceiptForSuccess(req, { bookingId, merchant, validation, bookingDate, bookingTime, checkInUrl }) {
    if (!bookingId || !checkInUrl) {
        return null;
    }

    const qrCodeDataUrl = await QRCode.toDataURL(checkInUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 240
    });

    return {
        id: bookingId,
        displayReference: buildBookingReference(bookingId, bookingDate),
        customerName: validation.customerName || req.session.user?.name || 'Guest',
        email: validation.email || req.session.user?.email || '',
        merchantName: merchant.name,
        serviceName: validation.serviceName,
        servicePrice: Number(validation.bookableItem?.price || validation.service?.price || 0),
        bookingDate,
        bookingTime,
        appointmentLabel: formatAppointmentDateTime(bookingDate, bookingTime),
        checkinUrl: checkInUrl,
        qrCodeDataUrl,
        receiptPath: getGuestReceiptPath(bookingId),
        receiptUrl: getGuestReceiptUrl(req, bookingId)
    };
}

function logNotificationError(error) {
    if (error) {
        console.error('Notification error:', error.message || error);
    }
}

function createNotification(notification) {
    Notification.create(notification, logNotificationError);
}

function createRoleNotification(role, notification) {
    Notification.createForRole(role, notification, logNotificationError);
}

function createMerchantNotification(merchant, notification) {
    if (merchant?.merchantUserId) {
        createNotification({
            ...notification,
            recipientUserId: merchant.merchantUserId,
            recipientRole: 'merchant'
        });
        return;
    }

    if (!merchant?.ownerEmail) {
        return;
    }

    User.findByEmail(merchant.ownerEmail, (error, user) => {
        if (error) {
            logNotificationError(error);
            return;
        }

        if (!user) {
            return;
        }

        createNotification({
            ...notification,
            recipientUserId: user.user_id,
            recipientRole: 'merchant'
        });
    });
}

function notifyBookingCreated(req, merchant, validation, bookingId = null, status = 'confirmed') {
    const serviceName = validation.serviceName || validation.service?.name || 'your service';
    const appointmentLabel = `${req.body.bookingDate} at ${req.body.bookingTime}`;
    const customerLink = bookingId ? `/receipt/${bookingId}` : '/profile#bookings';
    const currentUserId = req.session.user?.id || null;
    const bookingKey = bookingId || `${merchant.id}-${currentUserId || 'guest'}-${Date.now()}`;
    const isPending = String(status || '').toLowerCase() === 'pending';

    if (currentUserId) {
        createNotification({
            recipientUserId: currentUserId,
            recipientRole: 'customer',
            actorUserId: merchant.merchantUserId || null,
            type: isPending ? 'booking_pending' : 'booking_confirmed',
            title: isPending ? 'Booking request pending' : 'Booking request confirmed',
            message: isPending
                ? `${serviceName} at ${merchant.name} for ${appointmentLabel} is waiting for merchant review.`
                : `${serviceName} at ${merchant.name} is booked for ${appointmentLabel}.`,
            linkUrl: customerLink,
            dedupeKey: bookingId ? `booking-created-customer-${bookingId}` : null,
            metadata: { merchantId: merchant.id, bookingId, serviceName }
        });
    }

    createMerchantNotification(merchant, {
        actorUserId: currentUserId,
        type: 'booking',
        title: isPending ? 'Booking needs review' : 'New booking received',
        message: isPending
            ? `${validation.customerName || 'A customer'} requested ${serviceName} for ${appointmentLabel}.`
            : `${validation.customerName || 'A customer'} booked ${serviceName} for ${appointmentLabel}.`,
        linkUrl: '/merchant/schedule',
        dedupeKey: bookingId ? `booking-created-merchant-${bookingId}` : null,
        metadata: { merchantId: merchant.id, bookingId, serviceName }
    });

    createRoleNotification('admin', {
        actorUserId: currentUserId,
        type: 'booking',
        title: isPending ? 'Customer booking needs review' : 'New customer booking',
        message: isPending
            ? `${validation.customerName || 'A customer'} requested ${serviceName} at ${merchant.name}.`
            : `${validation.customerName || 'A customer'} booked ${serviceName} at ${merchant.name}.`,
        linkUrl: '/admin',
        dedupeKey: `booking-created-admin-${bookingKey}`,
        metadata: { merchantId: merchant.id, bookingId, serviceName }
    });
}

function getInsertedBookingId(result) {
    return result?.insertId || result?.[0]?.insertId || null;
}

function getBookingPath(merchant, service = null) {
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';
    if (!merchant.qrToken) {
        return `/booking/${merchant.id}${serviceQuery}`;
    }
    return `/booking/${merchant.id}/${merchant.qrToken}${serviceQuery}`;
}

function getSecureBookingPath(merchant, service = null) {
    const path = getMerchantStorefrontPath(merchant);
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';

    return `${path}${serviceQuery}`;
}

function getCurrentBookingPostPath(req, merchant, service = null, options = {}) {
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';

    if (options.secureQr && req.params.merchantSlug) {
        return `/m/${encodeURIComponent(req.params.merchantSlug)}${serviceQuery}`;
    }

    if (options.secureQr && req.params.merchantId && req.query.token) {
        return `/scan/${encodeURIComponent(req.params.merchantId)}?token=${encodeURIComponent(req.query.token)}`;
    }

    if (req.params.merchantId && req.params.qrToken) {
        return `/booking/${encodeURIComponent(req.params.merchantId)}/${encodeURIComponent(req.params.qrToken)}${serviceQuery}`;
    }

    if (req.params.merchantId && merchant?.qrToken) {
        return `/booking/${encodeURIComponent(req.params.merchantId)}/${encodeURIComponent(merchant.qrToken)}${serviceQuery}`;
    }

    if (options.secureQr) {
        return getSecureBookingPath(merchant, service);
    }

    return getBookingPath(merchant, service);
}

function getBookingUrl(req, merchant, service = null) {
    return `${req.protocol}://${req.get('host')}${getBookingPath(merchant, service)}`;
}

function getSecureBookingUrl(req, merchant, service = null) {
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';

    return `${getMerchantStorefrontUrl(req, merchant)}${serviceQuery}`;
}

function getPromotionQueryParams(promotion = null) {
    if (!promotion) {
        return {};
    }

    return {
        source: 'promotions',
        promotionId: promotion.promotionId || promotion.id,
        promoCampaign: promotion.campaignLabel,
        promoTitle: promotion.title || promotion.name,
        promoPrice: promotion.price,
        promoOriginalPrice: promotion.originalPrice,
        promoDiscountPercent: promotion.discountPercent,
        promoSlots: promotion.allowedSlots || ''
    };
}

function getPromotionSelection(query = {}) {
    if (query.source !== 'promotions') {
        return null;
    }

    const promotionId = Number(query.promotionId);
    const campaignLabel = (query.promoCampaign || '').trim();
    const title = (query.promoTitle || '').trim();
    const price = Number(query.promoPrice);
    const originalPrice = Number(query.promoOriginalPrice);
    const discountPercent = Number(query.promoDiscountPercent);

    if (!campaignLabel && !title) {
        return null;
    }

    return {
        promotionId: Number.isFinite(promotionId) ? promotionId : null,
        campaignLabel,
        title,
        price: Number.isFinite(price) ? price : null,
        originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
        discountPercent: Number.isFinite(discountPercent) ? discountPercent : null,
        allowedSlots: String(query.promoSlots || '').trim()
    };
}

function isHappyHourPromotion(selectedPromotion = null) {
    return String(selectedPromotion?.campaignLabel || '').trim().toLowerCase() === 'happy hour';
}

function getSelectedService(merchant, serviceId) {
    if (!serviceId) {
        return null;
    }

    const services = Array.isArray(merchant.services) ? merchant.services : [];

    return services.find((service) => String(service.id) === String(serviceId)) || null;
}

function getServiceByOptionId(merchant, serviceOptionId) {
    if (!serviceOptionId) {
        return null;
    }

    const services = Array.isArray(merchant.services) ? merchant.services : [];

    return services.find((service) => {
        return Array.isArray(service.options)
            && service.options.some((option) => String(option.id) === String(serviceOptionId));
    }) || null;
}

function getServiceOptions(service) {
    return Array.isArray(service?.options) && service.options.length > 0
        ? service.options
        : [];
}

function getSelectedServiceOption(service, serviceOptionId) {
    const options = getServiceOptions(service);

    return serviceOptionId ? options.find((option) => String(option.id) === String(serviceOptionId)) || null : null;
}

function getBookableSelection(service, serviceOptionId) {
    const options = getServiceOptions(service);
    const selectedOption = getSelectedServiceOption(service, serviceOptionId) || (!serviceOptionId && options.length > 0 ? options[0] : null);

    return {
        options,
        selectedOption,
        bookableItem: selectedOption || service,
        requiresOption: options.length > 0
    };
}

function getPrefilledBookingForm(req, existingForm = {}) {
    const profile = req.session.profile || {};
    const user = req.session.user || {};

    return {
        customerName: profile.name || user.name || '',
        email: profile.email || user.email || '',
        phone: profile.phone || user.phone || '',
        ...existingForm
    };
}

function getBookingServices(merchant, selectedService = null) {
    const services = Array.isArray(merchant.services) && merchant.services.length > 0
        ? merchant.services
        : [];

    return selectedService ? [selectedService] : services;
}

function filterSlotsToHappyHour(slots = []) {
    return (Array.isArray(slots) ? slots : []).filter((slot) => {
        const minutes = extractMinutesFromTime(slot);
        return minutes !== null && minutes >= 600 && minutes <= 960;
    });
}

function parseAllowedSlots(value = '') {
    return String(value).split(',').map((slot) => slot.trim()).filter(Boolean);
}

function filterSlotsByPromotion(slots = [], selectedPromotion = null) {
    const allowedSlots = parseAllowedSlots(selectedPromotion?.allowedSlots || '');

    if (allowedSlots.length > 0) {
        return (Array.isArray(slots) ? slots : []).filter((slot) => allowedSlots.includes(String(slot).trim()));
    }

    if (isHappyHourPromotion(selectedPromotion)) {
        return filterSlotsToHappyHour(slots);
    }

    return Array.isArray(slots) ? slots : [];
}

function applyPromotionAvailability(merchant, selectedPromotion = null) {
    if (!selectedPromotion) {
        return merchant;
    }

    const services = (Array.isArray(merchant.services) ? merchant.services : []).map((service) => ({
        ...service,
        slots: filterSlotsByPromotion(service.slots, selectedPromotion),
        options: Array.isArray(service.options)
            ? service.options.map((option) => ({
                ...option,
                slots: filterSlotsByPromotion(option.slots, selectedPromotion)
            }))
            : service.options
    }));

    return {
        ...merchant,
        services
    };
}

function filterInventoryAvailableServices(merchant) {
    const services = (merchant?.services || []).filter((service) => !service.inventoryBlocked);

    return {
        ...merchant,
        services
    };
}

function renderBookingPage(req, res, merchant, options = {}) {
    const selectedPromotion = options.selectedPromotion || getPromotionSelection(req.query);
    const bookingMerchant = filterInventoryAvailableServices(applyPromotionAvailability(merchant, selectedPromotion));
    const rawServiceId = options.form?.serviceId || req.query.serviceId;
    const rawServiceOptionId = options.form?.serviceOptionId || req.query.serviceOptionId;
    const serviceFromId = getSelectedService(bookingMerchant, rawServiceId);
    const serviceFromOptionId = getServiceByOptionId(bookingMerchant, rawServiceId);
    const selectedService = serviceFromId || serviceFromOptionId;
    const shouldDefaultFirstOption = !options.form && selectedService && getServiceOptions(selectedService).length > 0;
    const requestedServiceId = selectedService ? selectedService.id : rawServiceId;
    const requestedServiceOptionId = rawServiceOptionId
        || (serviceFromOptionId ? rawServiceId : '')
        || (shouldDefaultFirstOption ? getServiceOptions(selectedService)[0].id : '');
    const selectedServiceOption = selectedService
        ? getSelectedServiceOption(selectedService, requestedServiceOptionId)
        : null;

    const form = getPrefilledBookingForm(req, options.form || {});

    if (requestedServiceId && !selectedService) {
        delete form.serviceId;
        delete form.serviceOptionId;
    }

    if (requestedServiceOptionId && selectedService && !selectedServiceOption) {
        delete form.serviceOptionId;
    }

    const sanitizedForm = {
        ...form,
        ...(selectedService ? { serviceId: selectedService.id } : {}),
        ...(selectedServiceOption ? { serviceOptionId: selectedServiceOption.id } : {}),
        purchaseType: form.purchaseType || (req.query.package === '1' ? 'package' : 'single')
    };
    const scopedServices = getBookingServices(bookingMerchant, selectedService);
    const useSecureQr = options.secureQr || Boolean(req.params.token || req.query.token);
    const bookingPath = appendQueryParams(
        getCurrentBookingPostPath(req, bookingMerchant, selectedService, { ...options, secureQr: useSecureQr }),
        {
            serviceOptionId: selectedServiceOption ? selectedServiceOption.id : '',
            ...getPromotionQueryParams(selectedPromotion)
        }
    );
    const bookingUrl = appendQueryParams(
        useSecureQr
            ? getSecureBookingUrl(req, bookingMerchant, selectedService)
            : getBookingUrl(req, bookingMerchant, selectedService),
        {
            serviceOptionId: selectedServiceOption ? selectedServiceOption.id : '',
            ...getPromotionQueryParams(selectedPromotion)
        }
    );

    const featuredRecommendedServices = sortServicesByFeatured((merchant.services || []).filter((service) => service.isFeatured)).slice(0, 3);

    return Promise.all(scopedServices.map(async (service) => ({
        ...service,
        campaignCashback: await getCampaignCashbackEstimate({
            kind: 'booking',
            receiptId: `booking-service-${service.id}`,
            userId: req.session.user?.id || 0,
            merchantId: bookingMerchant.id,
            merchantName: bookingMerchant.name,
            serviceId: service.id,
            serviceName: service.name,
            amount: Number(service.price || 0)
        })
    }))).then((cashbackScopedServices) => res.status(options.status || 200).render('booking', {
        title: `Book ${merchant.name}`,
        merchant: bookingMerchant,
        scopedServices: cashbackScopedServices,
        featuredRecommendedServices,
        errors: options.errors || [],
        form: sanitizedForm,
        selectedPromotion,
        selectedServiceId: selectedService ? selectedService.id : null,
        bookingPath,
        bookingUrl,
        encodedBookingUrl: encodeURIComponent(bookingUrl),
        whatsappEnquiryUrl: getWhatsAppEnquiryUrl(bookingMerchant, selectedService, bookingUrl),
        qrDebug: options.qrDebug || null,
        todayDate: getTodayInputValue(),
        maxBookingDate: Booking.getBookingMaxDateKey(),
        publicHolidays: getPublicHolidayDateMap()
    }));
}

function getBookingAvailability(req, res) {
    const merchantId = Number(req.params.merchantId);
    const serviceId = Number(req.query.serviceId);
    const bookingDate = String(req.query.bookingDate || '').trim();

    if (!merchantId || !serviceId || !bookingDate) {
        return res.status(400).json({
            success: false,
            message: 'Merchant, service, and booking date are required.',
            slots: []
        });
    }

    const dateState = Booking.getBookingDateState(bookingDate);

    if (!dateState.valid || dateState.timing === 'past') {
        return res.status(400).json({
            success: false,
            message: 'Please choose today or a future booking date.',
            slots: []
        });
    }

    if (dateState.timing === 'too_future') {
        return res.status(400).json({
            success: false,
            message: 'Please choose a booking date within 2 months.',
            slots: []
        });
    }

    const holidayName = getPublicHolidayName(bookingDate);

    if (holidayName) {
        return res.json({
            success: true,
            closed: true,
            message: `Closed on ${holidayName}. Please choose another date.`,
            slots: []
        });
    }

    return Booking.getAvailableSlots(merchantId, serviceId, bookingDate, (error, slots = [], meta = {}) => {
        if (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message: 'Booking availability could not be loaded.',
                slots: []
            });
        }

        return res.json({
            success: true,
            slots,
            message: slots.length ? '' : 'No available slots for this date.',
            meta
        });
    });
}

function renderMerchantDetail(req, res, merchant, options = {}) {
    const bookingUrl = getBookingUrl(req, merchant);
    const favouriteIds = req.session.favouriteMerchantIds || [];
    const source = String(req.query.from || '').trim().toLowerCase();
    const backLinks = {
        services: { url: '/services', label: 'Back to services' },
        directory: { url: '/merchants', label: 'Back to merchants' },
        home: { url: '/', label: 'Back to home' },
        profile: { url: '/profile', label: 'Back to profile' }
    };
    const backLink = backLinks[source] || (source === 'flash-deals' ? backLinks.home : backLinks.services);
    const flashServiceId = Number(req.query.serviceId || 0);
    const flashDiscountPercent = Number(req.query.flashDiscountPercent || 0);
    const hasValidServiceFlashDeal = verifyFlashDealRequest(
        'service',
        flashServiceId,
        req.query.flashDealCycle,
        flashDiscountPercent,
        req.query.flashDealToken
    );
    const detailMerchant = hasValidServiceFlashDeal
        ? {
            ...merchant,
            services: (merchant.services || []).map((service) => String(service.id) === String(flashServiceId)
                ? {
                    ...service,
                    originalPrice: Number(service.price || 0),
                    price: Math.round((Number(service.price || 0) * (1 - (flashDiscountPercent / 100))) * 100) / 100,
                    flashDealDiscountPercent: flashDiscountPercent,
                    flashDealCycle: Number(req.query.flashDealCycle),
                    flashDealToken: String(req.query.flashDealToken || '')
                }
                : service)
        }
        : merchant;

    return Review.getSummaryByMerchantId(merchant.id, (summaryError, reviewSummary) => {
        if (summaryError) {
            console.error(summaryError);
        }

        return Review.listByMerchantId(merchant.id, 6, (reviewsError, reviews = []) => {
            if (reviewsError) {
                console.error(reviewsError);
            }

            return Product.getAll((productError, products = []) => {
                if (productError) {
                    console.error(productError);
                }

                const summary = reviewSummary && reviewSummary.reviewCount > 0
                    ? reviewSummary
                    : {
                        averageRating: Number(merchant.rating || 0) || null,
                        reviewCount: 0
                    };
                const merchantProducts = sortProductsByFeatured((productError ? [] : products).filter((product) => {
                    return String(product.salonId || '') === String(merchant.id || '');
                }));
                const featuredServices = sortServicesByFeatured((merchant.services || []).filter((service) => service.isFeatured)).slice(0, 3);
                const featuredProducts = merchantProducts.filter((product) => product.isFeatured).slice(0, 3);

                return res.status(options.status || 200).render('merchant-detail', {
                    title: merchant.name,
                    merchant: {
                        ...detailMerchant,
                        services: sortServicesByFeatured(detailMerchant.services || [])
                    },
                    products: merchantProducts,
                    featuredServices,
                    featuredProducts,
                    isFavourite: favouriteIds.includes(merchant.id),
                    canGenerateQr: Boolean(options.canGenerateQr),
                    errors: options.errors || [],
                    form: getPrefilledBookingForm(req, options.form || {}),
                    todayDate: getTodayInputValue(),
                    bookingUrl,
                    encodedBookingUrl: encodeURIComponent(bookingUrl),
                    whatsappEnquiryUrl: getWhatsAppEnquiryUrl(merchant, null, bookingUrl),
                    backUrl: backLink.url,
                    backLabel: backLink.label,
                    publicHolidays: getPublicHolidayDateMap(),
                    reviews: reviewsError ? [] : reviews,
                    reviewSummary: summary
                });
            });
        });
    });
}

function validateBooking(merchant, form) {
    const errors = [];
    const customerName = (form.customerName || '').trim();
    const email = (form.email || '').trim();
    const phone = (form.phone || '').trim();
    const service = getSelectedService(merchant, form.serviceId);
    const serviceSelection = getBookableSelection(service, form.serviceOptionId);
    const purchaseType = form.purchaseType === 'package' && service?.packageEnabled ? 'package' : 'single';
    const dateState = Booking.getBookingDateState(form.bookingDate);

    if (customerName.length < 2) {
        errors.push('Please enter your full name.');
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Please enter a valid email address.');
    }

    if (!/^[689]\d{7}$/.test(phone)) {
        errors.push('Please enter a valid 8-digit Singapore phone number.');
    }

    if (!service) {
        errors.push('Please select a valid service.');
    }

    if (service?.inventoryBlocked) {
        errors.push('This service is temporarily unavailable because the required inventory is out of stock.');
    }

    if (serviceSelection.requiresOption && !serviceSelection.selectedOption) {
        errors.push('Please select a valid service option.');
    }

    if (!dateState.valid || dateState.timing === 'past') {
        errors.push('Please choose today or a future booking date.');
    }

    if (dateState.timing === 'too_future') {
        errors.push('Please choose a booking date within 2 months.');
    }

    const holidayName = getPublicHolidayName(form.bookingDate);

    if (holidayName) {
        errors.push(`Bookings are unavailable on ${holidayName}. Please choose another date.`);
    }

    const normalizedBookingTime = normalizeBookingTime(form.bookingTime);

    if (!normalizedBookingTime || !service) {
        errors.push('Please select an available time slot for the selected service.');
    }

    const serviceName = serviceSelection.selectedOption
        ? `${service.name} - ${serviceSelection.selectedOption.name}`
        : service?.name;
    const displayServiceName = purchaseType === 'package'
        ? `${serviceName} (${service.packageSessions}-session package)`
        : serviceName;
    const displayBookableItem = purchaseType === 'package'
        ? {
            ...serviceSelection.bookableItem,
            price: Number(service.packagePrice || serviceSelection.bookableItem.price),
            packageSessions: service.packageSessions
        }
        : serviceSelection.bookableItem;

    return {
        errors,
        service,
        selectedOption: serviceSelection.selectedOption,
        bookableItem: displayBookableItem,
        serviceName: displayServiceName,
        purchaseType,
        customerName,
        email,
        phone,
        bookingTime: normalizedBookingTime
    };
}

function normalizeBookingDate(value) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
}

function isWeekdayDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return false;
    }

    const day = date.getDay();
    return day >= 1 && day <= 5;
}

function extractMinutesFromTime(value) {
    if (!value) {
        return null;
    }

    const rawValue = String(value).trim().toUpperCase();
    const meridiemMatch = rawValue.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/);

    if (meridiemMatch) {
        let hours = Number(meridiemMatch[1]);
        const minutes = Number(meridiemMatch[2]);
        const meridiem = meridiemMatch[3];

        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
            return null;
        }

        if (meridiem === 'PM' && hours < 12) {
            hours += 12;
        } else if (meridiem === 'AM' && hours === 12) {
            hours = 0;
        }

        return (hours * 60) + minutes;
    }

    const parts = rawValue.split(':');
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return null;
    }

    return (hours * 60) + minutes;
}

function normalizeBookingTime(value) {
    const minutes = extractMinutesFromTime(value);

    if (minutes === null || minutes < 0 || minutes >= 24 * 60) {
        return '';
    }

    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function validatePromotionForBooking(req, selectedPromotion, validation, callback) {
    if (!selectedPromotion?.promotionId) {
        callback(null, null);
        return;
    }

    return Promotion.findActivePublicById(selectedPromotion.promotionId, (promotionError, promotion) => {
        if (promotionError) {
            callback(promotionError);
            return;
        }

        if (!promotion) {
            callback(null, { error: 'This promotion is no longer active.' });
            return;
        }

        if (String(promotion.salonId) !== String(validation.service.salonId || validation.service.salon_id || req.params.merchantId)) {
            callback(null, { error: 'This promotion does not belong to the selected merchant.' });
            return;
        }

        if (promotion.serviceId && String(promotion.serviceId) !== String(validation.service.id)) {
            callback(null, { error: 'This promotion does not apply to the selected service.' });
            return;
        }

        const bookingDate = normalizeBookingDate(req.body.bookingDate);
        const promoStart = normalizeBookingDate(promotion.startDate);
        const promoEnd = normalizeBookingDate(promotion.endDate);

        if (!bookingDate || !promoStart || !promoEnd || bookingDate < promoStart || bookingDate > promoEnd) {
            callback(null, { error: 'This promotion is not valid for the selected booking date.' });
            return;
        }

        const allowedSlots = parseAllowedSlots(promotion.allowedSlots || '');

        if (allowedSlots.length > 0 && !allowedSlots.includes(String(req.body.bookingTime || '').trim())) {
            callback(null, { error: 'This booking time is not available for the selected promotion.' });
            return;
        }

        if (promotion.type === 'happy_hour' && !isWeekdayDate(bookingDate)) {
            callback(null, { error: 'Happy Hour promotions can only be booked on weekdays.' });
            return;
        }

        if (promotion.type === 'happy_hour') {
            const bookingMinutes = extractMinutesFromTime(req.body.bookingTime);

            if (bookingMinutes === null || bookingMinutes < 600 || bookingMinutes > 960) {
                callback(null, { error: 'Happy Hour promotions can only be booked between 10:00 AM and 4:00 PM.' });
                return;
            }
        }

        if (promotion.type === 'first_trial') {
            if (!req.session.user?.id) {
                callback(null, { error: 'Please create an account or log in to use this First Trial promotion.' });
                return;
            }

            return Promotion.hasUserRedeemedPromotion(req.session.user.id, promotion.id, (redemptionError, hasRedeemed) => {
                if (redemptionError) {
                    callback(redemptionError);
                    return;
                }

                if (hasRedeemed) {
                    callback(null, { error: 'You have already used this First Trial promotion.' });
                    return;
                }

                callback(null, promotion);
            });
        }

        callback(null, promotion);
    });
}

function showHome(req, res) {
    const search = req.query.search || '';
    const favouriteIds = req.session.favouriteMerchantIds || [];

    return getPublicMerchants(search, (publicMerchantError, publicMerchants = []) => {
        if (publicMerchantError) {
            console.error(publicMerchantError);
        }

    return getPublicServiceCatalog(req, search, (catalogError, serviceCatalog = []) => {
        if (catalogError) {
            console.error(catalogError);
        }

    return MerchantService.getFeaturedMerchants((merchantError, featuredMerchants = []) => {
        if (merchantError) {
            console.error(merchantError);
        }

        return MerchantService.getFeaturedServices((serviceError, featuredServices = []) => {
            if (serviceError) {
                console.error(serviceError);
            }

            return Product.getFeaturedProducts((productError, featuredProducts = []) => {
                if (productError) {
                    console.error(productError);
                }

                return Promotion.getActivePublic((promotionError, activePromotions = []) => {
                    if (promotionError) {
                        console.error(promotionError);
                    }

                    const featuredServiceItems = featuredServices.slice(0, 6);
                    const featuredProductItems = featuredProducts.slice(0, 6);
                    return loadLowSellingFlashInventory(({ products: lowSellingProducts, services: lowSellingServices }) => {
                    const flashDealSection = buildFlashDeals(activePromotions, lowSellingProducts, lowSellingServices);

                    res.render('home', {
                        title: 'Vaniday',
                        merchants: sortMerchantsByFeatured(mergeFeaturedMerchantRows(publicMerchants, featuredMerchants)),
                        favouriteIds,
                        serviceCatalog,
                        portalStats: getPortalStatsFromServices(serviceCatalog),
                        search,
                        success: req.session.success,
                        featuredMerchants: featuredMerchants.slice(0, 6),
                        featuredMerchantOfMonth: featuredMerchants.find((merchant) => merchant.featuredType === 'featured_month') || featuredMerchants[0] || null,
                        trendingMerchants: featuredMerchants.filter((merchant) => merchant.featuredType === 'trending').slice(0, 6),
                        featuredServices: featuredServiceItems,
                        featuredProducts: featuredProductItems,
                        flashDeals: flashDealSection.deals,
                        flashDealsSectionEndsAt: flashDealSection.sectionEndsAt,
                        showChatbot: true
                    });
                    req.session.success = null;
                    });
                });
            });
        });
    });
    });
    });
}

function showServices(req, res) {
    const search = req.query.search || '';
    const filter = (req.query.filter || '').toLowerCase();
    const favouriteIds = req.session.favouriteMerchantIds || [];

    return getPublicMerchants(search, (merchantError, merchants = []) => {
        if (merchantError) {
            console.error(merchantError);
        }

    return getPublicServiceCatalog(req, search, (serviceError, databaseServices = []) => {
        if (serviceError) {
            console.error(serviceError);
        }

        const serviceCatalog = sortServicesByFeatured(databaseServices);
        return Promise.all(serviceCatalog.map(async (service) => ({
            ...service,
            campaignCashback: await getCampaignCashbackEstimate({
                kind: 'booking',
                receiptId: `service-${service.id}`,
                userId: req.session.user?.id || 0,
                merchantId: service.salonId || service.merchantId,
                merchantName: service.merchantName,
                serviceId: service.id,
                serviceName: service.name,
                amount: Number(service.price || 0)
            })
        }))).then((serviceCatalogWithCashback) => {
        // Determine active promotions and optionally filter the catalog by the requested filter.
        Promotion.getActivePublic((promoError, promoRows = []) => {
            const promoServiceIds = new Set((promoRows || []).map((p) => Number(p.serviceId || 0)).filter(Boolean));
            const promoSalonIds = new Set((promoRows || []).map((p) => String(p.salonId || '')).filter(Boolean));

            let filteredCatalog = serviceCatalogWithCashback;

            if (filter) {
                switch (filter) {
                    case 'men':
                    case 'male':
                        filteredCatalog = filteredCatalog.filter((s) => String(s.genderTarget || '').toLowerCase() === 'male');
                        break;
                    case 'women':
                    case 'female':
                        filteredCatalog = filteredCatalog.filter((s) => String(s.genderTarget || '').toLowerCase() === 'female');
                        break;
                    case 'hair':
                    case 'nails':
                    case 'spa':
                    case 'massage':
                        filteredCatalog = filteredCatalog.filter((s) => String(s.category || s.merchantCategory || '').toLowerCase().includes(filter));
                        break;
                    case 'packages':
                        filteredCatalog = filteredCatalog.filter((s) => Boolean(s.packageEnabled));
                        break;
                    case 'promotions':
                        filteredCatalog = filteredCatalog.filter((s) => promoServiceIds.has(Number(s.id)) || promoSalonIds.has(String(s.merchantId || s.salonId)));
                        break;
                    case 'all':
                    case 'view-all':
                    default:
                        // no-op, show all
                        break;
                }
            }

            const prices = filteredCatalog.map((service) => Number(service.price)).filter((price) => !Number.isNaN(price));
            const merchantIds = new Set(filteredCatalog.map((service) => service.merchantId).filter(Boolean));

            return res.render('services', {
                title: 'Services',
                merchants,
                favouriteIds,
                serviceCatalog: filteredCatalog,
                portalStats: {
                    merchantCount: merchantIds.size,
                    serviceCount: filteredCatalog.length,
                    promotionCount: Array.isArray(promoRows) ? promoRows.length : 0,
                    slotCount: filteredCatalog.reduce((total, service) => total + (service.slots || []).length, 0),
                    startingPrice: prices.length > 0 ? Math.min(...prices) : 0
                },
                search,
                showChatbot: true
            });
        });
        });
    });
    });
}

function buildPromotionOffers() {
    return [];
}

function calculatePromotionPrice(basePrice, promotion) {
    const price = Number(basePrice || 0);
    const discountValue = Number(promotion.discountValue || 0);

    if (!Number.isFinite(price) || price <= 0) {
        return { originalPrice: 0, price: 0, discountPercent: 0 };
    }

    let promoPrice = price;

    if (promotion.discountType === 'percentage') {
        promoPrice = price * Math.max(0, (100 - discountValue)) / 100;
    } else if (promotion.discountType === 'fixed_amount') {
        promoPrice = price - discountValue;
    } else if (promotion.discountType === 'fixed_price') {
        promoPrice = discountValue;
    }

    const roundedPrice = Math.max(1, Math.round(promoPrice * 100) / 100);
    const discountPercent = price > 0
        ? Math.max(0, Math.round(((price - roundedPrice) / price) * 100))
        : 0;

    return {
        originalPrice: Math.round(price * 100) / 100,
        price: roundedPrice,
        discountPercent
    };
}

function getCashbackPercent(promotionId) {
    const cashbackPattern = [10, 9, 8, 7, 6, 5];
    return cashbackPattern[Number(promotionId) % cashbackPattern.length];
}

function getPromotionLabel(type) {
    if (type === 'first_trial') {
        return 'First Trial';
    }

    if (type === 'happy_hour') {
        return 'Happy Hour';
    }

    if (type === 'one_for_one') {
        return '1 For 1';
    }

    if (type === 'featured') {
        return 'Featured';
    }

    return 'Promotion';
}

function buildPublicPromotionOffer(promotion, service) {
    const pricing = calculatePromotionPrice(service.price, promotion);
    const now = Date.now();
    const startsAt = promotion.startDate ? new Date(promotion.startDate).getTime() : Number.NEGATIVE_INFINITY;
    const endsAt = promotion.endDate ? new Date(promotion.endDate).getTime() : Number.POSITIVE_INFINITY;
    const isAvailable = String(promotion.status || '').toLowerCase() === 'active'
        && startsAt <= now
        && endsAt >= now;

    return {
        id: promotion.id,
        promotionId: promotion.id,
        merchantId: promotion.salonId,
        merchantName: promotion.salonName,
        merchantLocation: promotion.address || 'No address set',
        merchantCategory: service.category || 'Merchant',
        merchantRating: '4.8',
        merchantPromotion: promotion.description || promotion.terms || promotion.title,
        name: promotion.title,
        serviceCategory: service.category || service.name,
        duration: service.duration,
        price: pricing.price,
        originalPrice: pricing.originalPrice,
        discountPercent: pricing.discountPercent,
        cashbackPercent: getCashbackPercent(promotion.id),
        campaignLabel: getPromotionLabel(promotion.type),
        isAvailable,
        availabilityLabel: isAvailable ? 'Available now' : (startsAt > now ? 'Coming soon' : 'Ended'),
        endDate: promotion.endDate || null,
        priceTier: pricing.price < 30 ? '$' : pricing.price < 55 ? '$$' : pricing.price < 80 ? '$$$' : '$$$$',
        regions: [promotion.address || 'No address set', service.category || service.name],
        serviceBookingPath: appendQueryParams(
            getMerchantStorefrontPath({ id: promotion.salonId, name: promotion.salonName }),
            {
                source: 'promotions',
                promotionId: promotion.id,
                serviceId: service.id,
                promoCampaign: getPromotionLabel(promotion.type),
                promoTitle: promotion.title,
                promoPrice: pricing.price,
                promoOriginalPrice: pricing.originalPrice,
                promoDiscountPercent: pricing.discountPercent,
                promoSlots: promotion.allowedSlots || ''
            }
        )
    };
}

function getPromotionServiceForSalon(promotion, servicesBySalon) {
    const salonServices = servicesBySalon[promotion.salonId] || [];

    if (salonServices.length === 0) {
        return null;
    }

    if (promotion.serviceId) {
        const linkedService = salonServices.find((service) => String(service.id) === String(promotion.serviceId));

        if (linkedService) {
            return linkedService;
        }
    }

    return salonServices[0];
}

function loadPublicPromotionOffers(callback) {
    return Promotion.getActivePublic({ includeExpired: true }, (promotionError, promotions) => {
        if (promotionError) {
            console.error(promotionError);
            callback(null, buildPromotionOffers());
            return;
        }

        return MerchantService.getAllServices((serviceError, services) => {
            if (serviceError) {
                console.error(serviceError);
                callback(null, buildPromotionOffers());
                return;
            }

            const servicesBySalon = (services || []).reduce((groups, service) => {
                if (!groups[service.salonId]) {
                    groups[service.salonId] = [];
                }

                groups[service.salonId].push(service);
                return groups;
            }, {});

            const offers = (promotions || [])
                .filter((promotion) => promotion.type !== 'featured')
                .map((promotion) => {
                    const linkedService = getPromotionServiceForSalon(promotion, servicesBySalon);

                    if (!linkedService) {
                        return null;
                    }

                    return buildPublicPromotionOffer(promotion, linkedService);
                })
                .filter(Boolean)
                .sort((left, right) => right.discountPercent - left.discountPercent);

            callback(null, offers.length > 0 ? offers : buildPromotionOffers());
        });
    });
}

function loadFeaturedSalons(callback) {
    return Promotion.getActivePublic((promotionError, promotions) => {
        if (promotionError) {
            callback(promotionError);
            return;
        }

        return MerchantService.getAllServices((serviceError, services) => {
            if (serviceError) {
                callback(serviceError);
                return;
            }

            const servicesBySalon = (services || []).reduce((groups, service) => {
                if (!groups[service.salonId]) {
                    groups[service.salonId] = [];
                }

                groups[service.salonId].push(service);
                return groups;
            }, {});

            const featuredPromotions = (promotions || []).filter((promotion) => promotion.type === 'featured');
            const salonsById = new Map();

            featuredPromotions.forEach((promotion) => {
                const salonServices = servicesBySalon[promotion.salonId] || [];
                const linkedService = getPromotionServiceForSalon(promotion, servicesBySalon);

                if (!salonsById.has(promotion.salonId)) {
                    salonsById.set(promotion.salonId, {
                        id: promotion.salonId,
                        name: promotion.salonName,
                        location: promotion.address || 'No address set',
                        category: linkedService?.category || 'Merchant',
                        description: promotion.salonDescription || promotion.description || 'Featured merchant promotion.',
                        promotion: promotion.title,
                        posSystem: 'Merchant POS',
                        bookingSystem: 'Vaniday Booking',
                        rating: 4.8,
                        reviewCount: 48 + (Number(promotion.salonId) * 9),
                        featuredLabel: 'Featured Partner',
                        featuredReason: promotion.description || promotion.terms || 'Selected for featured merchant visibility.',
                        publicPath: `/merchant/${promotion.salonId}`,
                        highlightedServices: []
                    });
                }

                const salonEntry = salonsById.get(promotion.salonId);
                const highlightedPool = promotion.serviceId && linkedService
                    ? [linkedService, ...salonServices.filter((service) => String(service.id) !== String(linkedService.id))]
                    : salonServices;

                const uniqueServices = [];
                const seenIds = new Set();

                highlightedPool.forEach((service) => {
                    if (service && !seenIds.has(String(service.id)) && uniqueServices.length < 3) {
                        seenIds.add(String(service.id));
                        uniqueServices.push(service);
                    }
                });

                salonEntry.highlightedServices = uniqueServices.map((service) => {
                    const promoSource = featuredPromotions.find((item) => String(item.salonId) === String(promotion.salonId) && String(item.serviceId || '') === String(service.id));
                    const pricing = promoSource
                        ? calculatePromotionPrice(service.price, promoSource)
                        : { originalPrice: null, price: Number(service.price) };

                    return {
                        name: service.name,
                        duration: service.duration,
                        price: pricing.price,
                        originalPrice: pricing.originalPrice && pricing.originalPrice > pricing.price ? pricing.originalPrice : null
                    };
                });
            });

            callback(null, Array.from(salonsById.values()));
        });
    });
}

const promotionCampaigns = {
    firstTrial: {
        label: 'First Trial',
        title: 'First Trial',
        pageClass: 'first-trial-page-title',
        summaryClass: 'first-trial-summary',
        copyListClass: 'first-trial-copy-list',
        heading: 'First Trial deals for first-time customers.',
        description: 'Book premium facials, hair treatments, massages and salon services at introductory prices before committing to regular menu rates.',
        filterAriaLabel: 'First trial filters',
        countLabel: 'first-trial services found',
        emptyMessage: 'No first-trial services match the selected filters.',
        badge: 'First trial',
        offerTitlePrefix: '[First Trial]',
        summaryCards: [
            {
                title: 'One-time use',
                body: 'Each first-trial offer is designed for new customers at that merchant, so you can test the service once at the introductory rate.'
            },
            {
                title: '30% to 50% off',
                body: 'These are genuine entry offers, with larger discounts against standard pricing instead of small campaign coupons.'
            },
            {
                title: 'No bill shock',
                body: 'The price shown on the page is the price you pay, with no hidden top-ups or surprise package conversion fees.'
            }
        ],
        noteTitle: 'What you will find',
        notes: [
            'Skincare trials like hydrating facials or deep cleansing sessions.',
            'Hair and scalp services for styling, colouring or treatment discovery visits.',
            'Wellness options like massage, grooming, lashes and nails at introductory rates.'
        ],
        staticTags: ['New customer only'],
        includeLocationTag: true,
        includeCategoryTag: true
    },
    happyHour: {
        label: 'Happy Hour',
        title: 'Happy Hour',
        pageClass: 'happy-hour-page-title',
        summaryClass: 'happy-hour-summary',
        copyListClass: 'happy-hour-copy-list',
        heading: 'Happy Hour deals for off-peak salon and wellness slots.',
        description: 'Book during quieter weekday windows to unlock repeatable discounts on facials, hair services, massages and more without paying prime-time rates.',
        filterAriaLabel: 'Happy hour filters',
        countLabel: 'happy-hour services found',
        emptyMessage: 'No happy-hour services match the selected filters.',
        badge: 'Happy hour',
        offerTitlePrefix: '[Happy Hour]',
        summaryCards: [
            {
                title: 'Time-restricted savings',
                body: 'These offers are usually tied to quieter hours like weekday mornings and afternoons, often between 10:00 AM and 4:00 PM.'
            },
            {
                title: 'Book more than once',
                body: 'Unlike first-trial deals, Happy Hour offers are often reusable as long as you can make the merchant off-peak window.'
            },
            {
                title: 'Flexible schedule wins',
                body: 'If you can book midweek, this is one of the easiest ways to visit better salons more often.'
            }
        ],
        noteTitle: 'Happy Hour notes',
        notes: [
            'These slots are designed to fill quiet periods, so weekday daytime appointments are the most common.',
            'Discounts are usually around 10% to 30% off standard pricing, which makes them ideal for regular upkeep.',
            'Watch for overlap with 1-for-1 offers because some off-peak windows can stack with bring-a-friend value.'
        ],
        staticTags: ['Weekday off-peak', 'Repeatable deal'],
        includeCategoryTag: true
    },
    oneForOne: {
        label: '1 For 1',
        title: '1 For 1',
        pageClass: 'one-for-one-page-title',
        summaryClass: 'one-for-one-summary',
        copyListClass: 'one-for-one-copy-list',
        heading: '1 For 1 deals with the highest value per booking.',
        description: 'Pay one final price and enjoy two matching treatments, whether you bring a friend, plan a couple session, or reserve a shared pampering slot in advance.',
        filterAriaLabel: '1 for 1 filters',
        countLabel: '1-for-1 services found',
        emptyMessage: 'No 1-for-1 services match the selected filters.',
        badge: '1 for 1',
        offerTitlePrefix: '[1 For 1]',
        summaryCards: [
            {
                title: 'Bring a friend',
                body: 'Most 1-for-1 deals are built for two people at the same time, so you can split the price or treat someone else.'
            },
            {
                title: 'High-value categories',
                body: 'Expect massages, facials, nails, lash treatments, scalp care and spa sessions where dual bookings make the offer worth chasing.'
            },
            {
                title: 'Final total shown',
                body: 'The displayed price is the total payable for both people, aligned with no hidden second-person fee.'
            }
        ],
        noteTitle: 'How to use it',
        notes: [
            'Book earlier than usual because most salons need to balance two simultaneous slots for the same offer.',
            'Check the fine print if you want to use the second treatment later, because most deals are same-time bookings.',
            'Grab good slots early, since salons usually release only a limited number of 1-for-1 appointments per day.'
        ],
        staticTags: ['Bring a friend', 'Final total shown'],
        includeCategoryTag: true
    }
};

function showPromotions(req, res) {
    return loadPublicPromotionOffers((error, promotionOffers) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Promotions Error',
                message: 'Promotions could not be loaded from the database.'
            });
        }

        return res.render('promotions', {
            title: 'Promotions',
            promotionOffers
        });
    });
}

function renderPromotionCampaign(req, res, campaignKey) {
    const campaign = promotionCampaigns[campaignKey];
    return loadPublicPromotionOffers((error, promotionOffers) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Promotions Error',
                message: 'Promotions could not be loaded from the database.'
            });
        }

        return res.render('promotion-campaign', {
            title: campaign.title,
            campaign,
            promotionOffers: promotionOffers.filter((offer) => offer.campaignLabel === campaign.label)
        });
    });
}

function showFirstTrial(req, res) {
    return renderPromotionCampaign(req, res, 'firstTrial');
}

function showHappyHour(req, res) {
    return renderPromotionCampaign(req, res, 'happyHour');
}

function showOneForOne(req, res) {
    return renderPromotionCampaign(req, res, 'oneForOne');
}

function showFeaturedSalons(req, res) {
    return loadFeaturedSalons((error, featuredSalons) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Featured Salons Error',
                message: 'Featured salons could not be loaded from the database.'
            });
        }

        return res.render('featured-salons', {
            title: 'Featured Salons',
            featuredSalons
        });
    });
}

function listMerchants(req, res) {
    const search = req.query.search || '';
    const favouriteIds = req.session.favouriteMerchantIds || [];

    return getPublicMerchants(search, (merchantListError, merchants = []) => {
        if (merchantListError) {
            console.error(merchantListError);
        }

    return MerchantService.getFeaturedMerchants((error, featuredMerchants = []) => {
        if (error) {
            console.error(error);
        }

        res.render('merchants', {
            title: 'Merchants',
            merchants: sortMerchantsByFeatured(mergeFeaturedMerchantRows(merchants, featuredMerchants)),
            featuredMerchants,
            favouriteIds,
            search
        });
    });
    });
}

function showMerchant(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.id, (error, merchant) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant data could not be loaded from the database.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant you selected could not be found.'
            });
        }

        if (req.session.user?.role !== 'merchant') {
            return renderMerchantDetail(req, res, merchant);
        }

        return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, ownedMerchant) => {
        if (lookupError) {
            console.error(lookupError);
            return renderMerchantDetail(req, res, merchant);
        }

        return renderMerchantDetail(req, res, merchant, {
            canGenerateQr: Boolean(ownedMerchant && String(ownedMerchant.id) === String(merchant.id))
        });
    });
    });
}

function showMerchantQr(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'Merchant data could not be loaded.'
            });
        }

        if (!merchant || String(merchant.id) !== String(req.params.merchantId)) {
            return res.status(403).render('error', {
                title: 'Access Denied',
                message: 'You can only generate the QR code for your own merchant account.'
            });
        }

        const bookingUrl = getMerchantStorefrontUrl(req, merchant);
        const storefrontSlug = getMerchantStorefrontSlug(merchant);

        return QRCode.toDataURL(bookingUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 }, (qrError, qrCodeDataUrl) => {
            if (qrError) {
                console.error(qrError);
                return res.status(500).render('error', {
                    title: 'QR Error',
                    message: 'QR code could not be generated.'
                });
            }

            return res.render('merchant-qr', {
                title: `${merchant.name} QR Code`,
                merchant,
                bookingUrl,
                qrImage: qrCodeDataUrl,
                qrCodeDataUrl,
                qrDebug: {
                    system: 'storefront',
                    label: 'Scan to Book',
                    token: storefrontSlug,
                    routeTarget: `/m/${storefrontSlug}`,
                    url: bookingUrl
                }
            });
        });
    });
}

function loadStorefrontMerchant(req, res, callback) {
    const merchantId = parseMerchantStorefrontSlug(req.params.merchantSlug);

    if (merchantId) {
        return MerchantService.getMerchantBySalonId(merchantId, (error, merchant) => {
            if (error) {
                console.error(error);
                return res.status(500).render('error', {
                    title: 'Storefront Error',
                    message: 'The merchant storefront could not be loaded.'
                });
            }

            if (!merchant) {
                return res.status(404).render('error', {
                    title: 'Storefront Not Found',
                    message: 'This merchant storefront could not be found.'
                });
            }

            return callback(merchant);
        });
    }

    return MerchantService.getSalons((listError, salons = []) => {
        if (listError) {
            console.error(listError);
            return res.status(500).render('error', {
                title: 'Storefront Error',
                message: 'The merchant storefront could not be loaded.'
            });
        }

        const matchedSalon = salons.find((salon) => {
            const generatedSlug = getMerchantStorefrontSlug({
                id: salon.salon_id,
                name: salon.salon_name
            });
            const cleanSlug = generatedSlug.replace(/-\d+$/, '');

            return cleanSlug === req.params.merchantSlug || generatedSlug === req.params.merchantSlug;
        });

        if (!matchedSalon) {
            return res.status(404).render('error', {
                title: 'Storefront Not Found',
                message: 'This merchant storefront QR link is invalid.'
            });
        }

        return MerchantService.getMerchantBySalonId(matchedSalon.salon_id, (error, merchant) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Storefront Error',
                message: 'The merchant storefront could not be loaded.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Storefront Not Found',
                message: 'This merchant storefront could not be found.'
            });
        }

        return callback(merchant);
        });
    });
}

function showMerchantStorefront(req, res) {
    return loadStorefrontMerchant(req, res, (merchant) => {
        return renderMerchantDetail(req, res, merchant, {
            backUrl: '/services',
            backLabel: 'Back to services'
        });
    });
}

function saveStorefrontBooking(req, res) {
    return loadStorefrontMerchant(req, res, (merchant) => {
        req.params.merchantId = merchant.id;
        req.query.token = signMerchantToken(merchant.id);
        return saveSecureScanBooking(req, res);
    });
}

function showBookingPage(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.merchantId, (error, merchant) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be loaded.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        return renderBookingPage(req, res, merchant);
    });
}

function showPublicMerchantBooking(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.merchantId, (error, merchant) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be loaded.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        return renderBookingPage(req, res, merchant);
    });
}

function showSecureScanBooking(req, res) {
    const merchantId = req.params.merchantId;

    if (!verifyMerchantToken(merchantId, req.query.token)) {
        return res.status(403).render('error', {
            title: 'Invalid Booking QR',
            message: 'This QR booking link is invalid or does not belong to this merchant.'
        });
    }

    return MerchantService.getMerchantBySalonId(merchantId, (error, merchant) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be loaded.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        return renderBookingPage(req, res, merchant, { secureQr: true });
    });
}

function saveQrBooking(req, res) {
    if (req.params.qrToken && !verifyMerchantToken(req.params.merchantId, req.params.qrToken)) {
        return res.status(400).render('error', {
            title: 'Invalid Booking QR',
            message: 'This merchant-specific QR booking link is invalid.'
        });
    }

    return MerchantService.getMerchantBySalonId(req.params.merchantId, (merchantLookupError, merchant) => {
        if (merchantLookupError) {
            console.error(merchantLookupError);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be loaded.'
            });
        }

        if (!merchant || !isApprovedMerchant(merchant)) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        const validation = validateBooking(merchant, req.body);

        if (validation.errors.length > 0) {
            return renderBookingPage(req, res, merchant, {
                status: 400,
                errors: validation.errors,
                form: req.body
            });
        }

        req.body.bookingTime = validation.bookingTime;

        return validatePromotionForBooking(req, getPromotionSelection(req.query), validation, (promotionValidationError, promotionRecord) => {
        if (promotionValidationError) {
            console.error(promotionValidationError);
            return renderBookingPage(req, res, merchant, {
                status: 500,
                errors: ['Promotion eligibility could not be checked. Please try again.'],
                form: req.body
            });
        }

        if (promotionRecord?.error) {
            return renderBookingPage(req, res, merchant, {
                status: 400,
                errors: [promotionRecord.error],
                form: req.body
            });
        }

        const bookingData = {
            userId: req.session.user?.id || null,
            merchantId: merchant.id,
            merchantName: merchant.name,
            serviceId: validation.service.id,
            serviceName: validation.serviceName,
            customerName: validation.customerName,
            email: validation.email,
            phone: validation.phone,
            bookingDate: req.body.bookingDate,
            bookingTime: validation.bookingTime,
            qrCodeToken: req.params.qrToken
        };

        return Booking.autoConfirmBooking({
            ...bookingData,
            bookingTime: validation.bookingTime,
            durationMins: validation.bookableItem.durationMins || validation.service.durationMins
        }, (bookingError, confirmation) => {
            if (bookingError) {
                console.error(bookingError);
                return renderBookingPage(req, res, merchant, {
                    status: 500,
                    errors: ['Booking availability could not be checked. Please try again.'],
                    form: req.body
                });
            }

            if (!confirmation?.created) {
                return renderBookingPage(req, res, merchant, {
                    status: 400,
                    errors: [confirmation?.message || 'This slot is already booked. Please choose another time.'],
                    form: req.body
                });
            }

                const bookingId = getInsertedBookingId(confirmation.result);
                const bookingReference = buildBookingReference(bookingId, req.body.bookingDate);
                const checkInUrl = bookingId ? getBookingCheckInUrl(req, bookingId) : '';
                const finishSuccess = async () => {
                    const bookingReceipt = await buildBookingReceiptForSuccess(req, {
                        bookingId,
                        merchant,
                        validation,
                        bookingDate: req.body.bookingDate,
                        bookingTime: validation.bookingTime,
                        checkInUrl
                    });

                    return res.render('booking-success', {
                    title: confirmation.confirmed ? 'Booking Confirmed' : 'Booking Pending',
                    merchant,
                    service: {
                        ...validation.service,
                        name: validation.serviceName,
                        duration: validation.bookableItem.duration,
                        price: validation.bookableItem.price
                    },
                    bookingDate: req.body.bookingDate,
                    bookingTime: validation.bookingTime,
                    bookingId,
                    bookingReference,
                    bookingStatus: confirmation.status,
                    bookingReceipt,
                    whatsappConfirmationUrl: getWhatsAppUrl(buildWhatsAppBookingMessage({
                        merchant,
                        service: { name: validation.serviceName },
                        bookingDate: req.body.bookingDate,
                        bookingTime: validation.bookingTime,
                        customerName: validation.customerName,
                        phone: validation.phone,
                        bookingUrl: getBookingUrl(req, merchant, validation.service)
                    }))
                    });
                };

                notifyBookingCreated(req, merchant, validation, bookingId, confirmation.status);
                notifyBooking({
                    bookingId,
                    displayReference: bookingReference,
                    customerName: validation.customerName,
                    email: validation.email,
                    phone: validation.phone,
                    merchantName: merchant.name,
                    serviceName: validation.serviceName,
                    bookingDate: req.body.bookingDate,
                    bookingTime: validation.bookingTime,
                    checkInUrl,
                    receiptUrl: bookingId ? getGuestReceiptUrl(req, bookingId) : ''
                });

                if (promotionRecord?.id && req.session.user?.id) {
                    return Promotion.createRedemption({
                        promotionId: promotionRecord.id,
                        userId: req.session.user.id,
                        bookingId,
                        status: 'used'
                    }, (redemptionError) => {
                        if (redemptionError) {
                            console.error(redemptionError);
                        }

                        return finishSuccess().catch((successError) => {
                            console.error(successError);
                            return res.redirect('/services');
                        });
                    });
                }

                return finishSuccess().catch((successError) => {
                    console.error(successError);
                    return res.redirect('/services');
                });
        });
    });
    });
}

function saveSecureScanBooking(req, res) {
    const merchantId = req.params.merchantId;

    if (!verifyMerchantToken(merchantId, req.query.token)) {
        return res.status(403).render('error', {
            title: 'Invalid Booking QR',
            message: 'Booking requests must use this merchant-specific signed QR link.'
        });
    }

    return MerchantService.getMerchantBySalonId(merchantId, (lookupError, merchant) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be loaded.'
            });
        }

        if (!merchant) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        const validation = validateBooking(merchant, req.body);

        if (validation.errors.length > 0) {
            return renderBookingPage(req, res, merchant, {
                status: 400,
                errors: validation.errors,
                form: req.body,
                secureQr: true
            });
        }

        req.body.bookingTime = validation.bookingTime;

        return validatePromotionForBooking(req, getPromotionSelection(req.query), validation, (promotionValidationError, promotionRecord) => {
            if (promotionValidationError) {
                console.error(promotionValidationError);
                return renderBookingPage(req, res, merchant, {
                    status: 500,
                    errors: ['Promotion eligibility could not be checked. Please try again.'],
                    form: req.body,
                    secureQr: true
                });
            }

            if (promotionRecord?.error) {
                return renderBookingPage(req, res, merchant, {
                    status: 400,
                    errors: [promotionRecord.error],
                    form: req.body,
                    secureQr: true
                });
            }

            const bookingData = {
                userId: req.session.user?.id || null,
                merchantId: merchant.id,
                merchantName: merchant.name,
                serviceId: validation.service.id,
                serviceName: validation.serviceName,
                customerName: validation.customerName,
                email: validation.email,
                phone: validation.phone,
                bookingDate: req.body.bookingDate,
                bookingTime: validation.bookingTime,
                qrCodeToken: req.query.token
            };

            return Booking.autoConfirmBooking({
                ...bookingData,
                durationMins: validation.bookableItem.durationMins || validation.service.durationMins
            }, (bookingError, confirmation) => {
                if (bookingError) {
                    console.error(bookingError);
                    return renderBookingPage(req, res, merchant, {
                        status: 500,
                        errors: ['Booking availability could not be checked. Please try again.'],
                        form: req.body,
                        secureQr: true
                    });
                }

                if (!confirmation?.created) {
                    return renderBookingPage(req, res, merchant, {
                        status: 400,
                        errors: [confirmation?.message || 'This slot is already booked. Please choose another time.'],
                        form: req.body,
                        secureQr: true
                    });
                }

                    const bookingId = getInsertedBookingId(confirmation.result);
                    const bookingReference = buildBookingReference(bookingId, req.body.bookingDate);
                    const checkInUrl = bookingId ? getBookingCheckInUrl(req, bookingId) : '';
                    const finishSuccess = async () => {
                        const bookingReceipt = await buildBookingReceiptForSuccess(req, {
                            bookingId,
                            merchant,
                            validation,
                            bookingDate: req.body.bookingDate,
                            bookingTime: validation.bookingTime,
                            checkInUrl
                        });

                        return res.render('booking-success', {
                        title: confirmation.confirmed ? 'Booking Confirmed' : 'Booking Pending',
                        merchant,
                        service: {
                            ...validation.service,
                            name: validation.serviceName,
                            duration: validation.bookableItem.duration,
                            price: validation.bookableItem.price
                        },
                        bookingDate: req.body.bookingDate,
                        bookingTime: validation.bookingTime,
                        bookingId,
                        bookingReference,
                        bookingStatus: confirmation.status,
                        bookingReceipt,
                        anotherBookingPath: getSecureBookingPath(merchant),
                        whatsappConfirmationUrl: getWhatsAppUrl(buildWhatsAppBookingMessage({
                            merchant,
                            service: { name: validation.serviceName },
                            bookingDate: req.body.bookingDate,
                            bookingTime: validation.bookingTime,
                            customerName: validation.customerName,
                            phone: validation.phone,
                            bookingUrl: getSecureBookingUrl(req, merchant, validation.service)
                        }))
                        });
                    };

                    notifyBookingCreated(req, merchant, validation, bookingId, confirmation.status);
                    notifyBooking({
                        bookingId,
                        displayReference: bookingReference,
                        customerName: validation.customerName,
                        email: validation.email,
                        phone: validation.phone,
                        merchantName: merchant.name,
                        serviceName: validation.serviceName,
                        bookingDate: req.body.bookingDate,
                        bookingTime: validation.bookingTime,
                        checkInUrl,
                        receiptUrl: bookingId ? getGuestReceiptUrl(req, bookingId) : ''
                    });

                    if (promotionRecord?.id && req.session.user?.id) {
                        return Promotion.createRedemption({
                            promotionId: promotionRecord.id,
                            userId: req.session.user.id,
                            bookingId,
                            status: 'used'
                        }, (redemptionError) => {
                            if (redemptionError) {
                                console.error(redemptionError);
                            }

                            return finishSuccess().catch((successError) => {
                                console.error(successError);
                                return res.redirect(getSecureBookingPath(merchant));
                            });
                        });
                    }

                    return finishSuccess().catch((successError) => {
                        console.error(successError);
                        return res.redirect(getSecureBookingPath(merchant));
                    });
            });
        });
    });
}

function loadCheckInBooking(req, res, callback) {
    const bookingId = verifyBookingCheckInToken(req.params.token);

    if (!bookingId) {
        return res.status(403).render('error', {
            title: 'Invalid Check-In QR',
            message: 'This booking check-in QR code is invalid.'
        });
    }

    return Booking.getCheckInDetails(bookingId, req.session.user.id, (error, booking) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Check-In Error',
                message: 'Booking check-in details could not be loaded.'
            });
        }

        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'This booking does not belong to your merchant account or no longer exists.'
            });
        }

        return callback(bookingId, booking);
    });
}

function showBookingCheckIn(req, res) {
    return loadCheckInBooking(req, res, (bookingId, booking) => {
        res.render('merchant-check-in', {
            title: 'Booking Check-In',
            booking,
            alreadyCheckedIn: String(booking.status || '').toLowerCase() === 'checked_in'
        });
    });
}

function confirmBookingCheckIn(req, res) {
    return loadCheckInBooking(req, res, (bookingId, booking) => {
        if (String(booking.status || '').toLowerCase() === 'checked_in') {
            return res.render('merchant-check-in', {
                title: 'Booking Check-In',
                booking,
                alreadyCheckedIn: true,
                success: 'This booking was already checked in.'
            });
        }

        return Booking.markCheckedIn(bookingId, req.session.user.id, (error) => {
            if (error) {
                console.error(error);
                return res.status(500).render('error', {
                    title: 'Check-In Error',
                    message: 'Booking could not be checked in. Please try again.'
                });
            }

            return Booking.getCheckInDetails(bookingId, req.session.user.id, (lookupError, updatedBooking) => {
                if (lookupError) {
                    console.error(lookupError);
                }

                return res.render('merchant-check-in', {
                    title: 'Booking Check-In',
                    booking: updatedBooking || { ...booking, status: 'checked_in' },
                    alreadyCheckedIn: true,
                    success: 'Booking checked in successfully.'
                });
            });
        });
    });
}

function createBooking(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.id, (lookupError, merchant) => {
    if (lookupError) {
        console.error(lookupError);
        return res.status(500).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be loaded.'
        });
    }

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    const validation = validateBooking(merchant, req.body);

    if (validation.errors.length > 0) {
        return renderMerchantDetail(req, res, merchant, {
            status: 400,
            errors: validation.errors,
            form: req.body
        });
    }

    return Booking.autoConfirmBooking({
        userId: req.session.user?.id || null,
        merchantId: merchant.id,
        serviceId: validation.service.id,
        customerName: validation.customerName,
        email: validation.email,
        phone: validation.phone,
        bookingDate: req.body.bookingDate,
        bookingTime: validation.bookingTime,
        durationMins: validation.bookableItem.durationMins || validation.service.durationMins
    }, (bookingError, confirmation) => {
        if (bookingError) {
            console.error(bookingError);
            return renderMerchantDetail(req, res, merchant, {
                status: 500,
                errors: ['Booking availability could not be checked. Please try again.'],
                form: req.body
            });
        }

        if (!confirmation?.created) {
            return renderMerchantDetail(req, res, merchant, {
                status: 400,
                errors: [confirmation?.message || 'This slot is already booked. Please choose another time.'],
                form: req.body
            });
        }

        const bookingId = confirmation.result?.insertId || null;
        notifyBookingCreated(req, merchant, validation, bookingId);
        req.session.success = confirmation.confirmed
            ? `Booking confirmed for ${validation.serviceName} at ${merchant.name} on ${req.body.bookingDate}, ${validation.bookingTime}.`
            : `Booking submitted for ${validation.serviceName} at ${merchant.name} and is waiting for merchant review.`;
        return res.redirect('/');
    });
    });
}

function wantsCartJson(req) {
    return req.xhr
        || String(req.body?.responseType || req.query?.responseType || '').toLowerCase() === 'json'
        || String(req.get('accept') || '').includes('application/json');
}

function respondCartAdded(req, res, message, item = null) {
    const cartCount = getCartItemCount(req.session.cart || []);

    if (wantsCartJson(req)) {
        return res.json({
            success: true,
            message,
            cartCount,
            item
        });
    }

    req.session.success = message;
    return res.redirect('/cart');
}

function addToCart(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.merchantId, (lookupError, merchant) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Service Not Found',
                message: 'The service you selected could not be loaded.'
            });
        }

        const service = getSelectedService(merchant, req.body.serviceId);

    if (!merchant || !service) {
        return res.status(404).render('error', {
            title: 'Service Not Found',
            message: 'The service you selected could not be found.'
        });
    }

    const hasValidFlashDeal = verifyFlashDealRequest(
        'service',
        service.id,
        req.body.flashDealCycle,
        req.body.flashDiscountPercent,
        req.body.flashDealToken
    );
    const flashDiscountPercent = hasValidFlashDeal ? Number(req.body.flashDiscountPercent) : 0;
    const cartPrice = hasValidFlashDeal
        ? Math.round((Number(service.price || 0) * (1 - (flashDiscountPercent / 100))) * 100) / 100
        : Number(service.price || 0);

    req.session.cart = req.session.cart || [];
    const cartItem = {
        id: Date.now(),
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantQrToken: signMerchantToken(merchant.id),
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: cartPrice,
        flashDealDiscountPercent: flashDiscountPercent
    };
    req.session.cart.push(cartItem);

    return respondCartAdded(req, res, `${service.name} was added to your cart.`, cartItem);
    });
}

function addProductToCart(req, res) {
    return Product.findById(req.params.productId, (lookupError, product) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Product Error',
                message: 'Product details could not be loaded.'
            });
        }

        if (!product) {
            return res.status(404).render('error', {
                title: 'Product Not Found',
                message: 'The product you selected could not be found.'
            });
        }

        const hasValidFlashDeal = verifyFlashDealRequest(
            'product',
            product.id,
            req.body.flashDealCycle,
            req.body.flashDiscountPercent,
            req.body.flashDealToken
        );
        const flashDiscountPercent = hasValidFlashDeal ? Number(req.body.flashDiscountPercent) : 0;
        const cartPrice = hasValidFlashDeal
            ? Math.round((Number(product.price || 0) * (1 - (flashDiscountPercent / 100))) * 100) / 100
            : Number(product.price || 0);

        req.session.cart = req.session.cart || [];
        const existingProduct = req.session.cart.find((item) => item.type === 'Product' && String(item.serviceId) === String(product.id));

        if (existingProduct) {
            existingProduct.quantity = Math.min(Number(existingProduct.quantity || 1) + 1, 99);
            if (hasValidFlashDeal) {
                existingProduct.price = cartPrice;
                existingProduct.flashDealDiscountPercent = flashDiscountPercent;
            }
        } else {
            req.session.cart.push({
                id: Date.now(),
                type: 'Product',
                merchantId: product.salonId || null,
                merchantName: product.salonName || product.category,
                serviceId: product.id,
                serviceName: product.name,
                duration: product.description,
                price: cartPrice,
                flashDealDiscountPercent: flashDiscountPercent,
                quantity: 1
            });
        }

        return respondCartAdded(req, res, `${product.name} was added to your cart.`, existingProduct || req.session.cart[req.session.cart.length - 1]);
    });
}

function showGiftCards(req, res) {
    const success = req.session.success;
    req.session.success = null;

    return GiftCardConfig.getConfig((error, giftCardConfig) => {
        if (error) {
            console.error(error);
            req.session.success = 'Gift card settings could not be loaded. Please try again later.';
            return res.redirect('/');
        }

        return res.render('giftcards', {
            title: 'Gift Cards',
            success,
            giftCardConfig
        });
    });
}

function addGiftCardToCart(req, res) {
    const giftCard = parseGiftCardForm(req.body, req.session.user);

    return GiftCardConfig.getConfig((configError, giftCardConfig) => {
        if (configError) {
            console.error(configError);
            req.session.success = 'Gift card settings could not be loaded. Please try again later.';
            return res.redirect('/giftcards');
        }

        const minAmount = Number(giftCardConfig.minAmount);
        const maxAmount = Number(giftCardConfig.maxAmount);

        if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount <= 0 || maxAmount < minAmount) {
            req.session.success = 'Gift card settings are incomplete. Please contact support.';
            return res.redirect('/giftcards');
        }

        if (!Number.isFinite(giftCard.amount) || giftCard.amount < minAmount || giftCard.amount > maxAmount) {
            req.session.success = `Please enter a valid gift card amount between $${minAmount} and $${maxAmount}.`;
            return res.redirect('/giftcards');
        }

        if (!isValidEmail(giftCard.recipientEmail)) {
            req.session.success = giftCard.deliveryOption === 'recipient'
                ? 'Please enter a valid recipient email address.'
                : 'Your account email is missing or invalid. Please update your profile before buying a gift card.';
            return res.redirect('/giftcards');
        }

        req.session.cart = req.session.cart || [];
        req.session.cart.push({
            id: Date.now(),
            type: 'Gift Card',
            merchantId: null,
            merchantName: 'Vaniday',
            serviceId: `gift-card-${giftCard.amount}-${Date.now()}`,
            serviceName: `$${giftCard.amount} Vaniday Gift Card`,
            duration: `Digital gift card valid for ${giftCardConfig.validityMonths} months after purchase.`,
            price: giftCard.amount,
            quantity: 1,
            giftCard: {
                ...giftCard,
                validityMonths: giftCardConfig.validityMonths
            }
        });

        req.session.success = `$${giftCard.amount} gift card was added to your cart.`;
        return res.redirect('/cart');
    });
}

function showCart(req, res) {
    const cart = (req.session.cart || []).map((item) => {
        const quantity = getCartQuantity(item);
        const lineTotal = getCartLineTotal(item);

        if (!item.merchantId || item.merchantQrToken) {
            return {
                ...item,
                quantity,
                lineTotal
            };
        }

        return {
            ...item,
            merchantQrToken: signMerchantToken(item.merchantId),
            quantity,
            lineTotal
        };
    });
    const total = cart.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const itemCount = getCartItemCount(cart);
    const success = req.session.success;
    const pickupMerchants = buildPickupMerchantOptions(cart);
    const hasProductItems = cart.some((item) => item.type === 'Product');
    req.session.success = null;

    return Loyalty.getWalletView(req.session.user.id, async (walletError, loyalty) => {
        if (walletError) {
            console.error(walletError);
        }

        const eWallet = await getEWalletView(req.session.user.id);

        const availableVouchers = hasProductItems
            ? await getEligibleProductVouchers(req.session.user.id, {
                kind: 'order',
                items: cart,
                amount: total,
                itemSubtotal: total
            })
            : [];
        const campaignCashback = await getCampaignCashbackEstimate({
            kind: 'order',
            receiptId: 'cart-estimate',
            userId: req.session.user.id,
            amount: total,
            items: cart
        });

        return res.render('cart', {
            title: 'Cart',
            cart,
            total,
            itemCount,
            success,
            pickupMerchants,
            shippingFee: CART_DELIVERY_FEE,
            loyalty: walletError ? null : loyalty,
            campaignCashback,
            availableVouchers,
            hasProductItems
        });
    });
}

async function checkout(req, res) {
    const selectedIds = getSelectedCartIds(req.body);

    const cart = (req.session.cart || []).map((item) => {
        const quantity = getCartQuantity(item);
        const lineTotal = getCartLineTotal(item);
        return { ...item, quantity, lineTotal };
    });

    const selectedItems = selectedIds.length
        ? cart.filter((item) => selectedIds.includes(String(item.id)))
        : [];
    const itemSubtotal = selectedItems.reduce((sum, i) => sum + Number(i.lineTotal || 0), 0);

    if (selectedItems.length === 0 || itemSubtotal <= 0) {
        req.session.success = 'Please select at least one item before checkout.';
        return res.redirect('/cart');
    }

    const hasProductItems = selectedItems.some((item) => item.type === 'Product');
    const fulfilment = hasProductItems ? 'pickup' : '';
    const pickupMerchantId = hasProductItems ? 'any' : '';
    const shippingFee = 0;
    const amount = Math.round(itemSubtotal * 100) / 100;
    const checkoutId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const userName = req.session.profile?.name || req.session.user?.name || 'Customer';
    const pickupMerchants = await resolvePickupMerchantOptions(selectedItems);
    const isMultiMerchantPickup = pickupMerchants.length > 1;
    const defaultPickupMerchantId = pickupMerchants.length === 1 ? String(pickupMerchants[0].id) : 'grouped';
    const defaultPickupMerchantAddress = pickupMerchants.length === 1 ? String(pickupMerchants[0].address || '') : '';
    const fulfilmentMerchantName = hasProductItems ? 'Any merchant' : 'Cart checkout';
    const selectedVoucherId = String(req.body.selectedVoucherId || 'none').trim();
    const hasSelectedVoucher = Boolean(selectedVoucherId && selectedVoucherId !== 'none');
    const useCashback = !hasSelectedVoucher && (req.body.redeemCashback === 'on' || req.session.applyCashback === true);
    const deliveryDetails = {
        deliveryAddress: '',
        deliveryUnit: '',
        deliveryPostal: '',
        deliveryPhone: ''
    };

    req.session.pendingPayments = req.session.pendingPayments || {};
    req.session.pendingPayments[checkoutId] = {
        kind: 'order',
        receiptId: checkoutId,
        checkoutId,
        cartCheckout: true,
        userId: req.session.user.id,
        userName,
        userEmail: req.session.user.email || '',
        merchantName: fulfilmentMerchantName,
        serviceName: 'Cart checkout',
        amount,
        itemSubtotal,
        shippingFee,
        originalAmount: amount,
        items: selectedItems.map((item) => ({
            name: item.serviceName,
            type: item.type || 'Service',
            serviceId: item.serviceId,
            merchantId: item.merchantId || null,
            merchantName: item.merchantName || '',
            quantity: item.quantity,
            price: Number(item.price || 0),
            unitPrice: Number(item.price || 0),
            lineTotal: Number(item.lineTotal || 0),
            detail: item.merchantName || ''
        })),
        selectedItemIds: selectedItems.map((item) => String(item.id)).join(','),
        selectedVoucherId,
        useCashback,
        fulfilment,
        pickupMerchantId: isMultiMerchantPickup ? 'grouped' : pickupMerchantId,
        pickupMerchantAddress: defaultPickupMerchantAddress,
        pickupMode: isMultiMerchantPickup ? 'grouped' : 'single',
        pickupMerchantName: '',
        pickupMerchantOptions: pickupMerchants,
        ...deliveryDetails
    };

    if (req.session.pendingPayments[checkoutId].selectedVoucherId && req.session.pendingPayments[checkoutId].selectedVoucherId !== 'none') {
        try {
            const eligibleVouchers = await getEligibleProductVouchers(req.session.user.id, req.session.pendingPayments[checkoutId]);
            const eligibleVoucherIds = new Set(eligibleVouchers.map((voucher) => String(voucher.id)));

            if (!eligibleVoucherIds.has(String(req.session.pendingPayments[checkoutId].selectedVoucherId))) {
                req.session.pendingPayments[checkoutId].selectedVoucherId = 'none';
                req.session.pendingPayments[checkoutId].useCashback = Boolean(req.session.applyCashback === true);
            }
        } catch (error) {
            console.error('Cart reward selection could not be verified:', error);
        }
    }

    savePaymentAttempt('checkout', checkoutId, req.session.pendingPayments[checkoutId]).catch((error) => {
        console.error('Pending checkout could not be persisted:', error);
    });
    req.session.applyCashback = false;

    return Loyalty.getWalletView(req.session.user.id, async (walletError, loyalty) => {
        if (walletError) {
            console.error(walletError);
        }

        const eWallet = await getEWalletView(req.session.user.id);

        const availableVouchers = selectedItems.some((item) => item.type === 'Product')
            ? await getEligibleProductVouchers(req.session.user.id, req.session.pendingPayments[checkoutId])
            : [];
        const smartVoucher = await getSmartVoucherRecommendationDetails(req.session.user.id, req.session.pendingPayments[checkoutId]);
        const trustedCheckoutPayment = await prepareTrustedPayment(req, req.session.pendingPayments[checkoutId]).catch((error) => {
            console.error('Cart checkout reward summary could not be verified:', error);
            return null;
        });
        const campaignCashback = trustedCheckoutPayment?.campaignCashback || await getCampaignCashbackEstimate(req.session.pendingPayments[checkoutId]);
        const paymentSummary = trustedCheckoutPayment ? {
            originalAmount: Number(trustedCheckoutPayment.originalAmount || amount),
            voucherDiscount: Number(trustedCheckoutPayment.voucherDiscount || 0),
            pointsDiscount: Number(trustedCheckoutPayment.pointsDiscount || 0),
            cashbackDiscount: Number(trustedCheckoutPayment.cashbackRedeemed || 0),
            finalAmount: Number(trustedCheckoutPayment.amount || amount),
            campaignCashback: Number(trustedCheckoutPayment.campaignCashback?.total || 0)
        } : {
            originalAmount: Number(amount),
            voucherDiscount: 0,
            pointsDiscount: 0,
            cashbackDiscount: 0,
            finalAmount: Number(amount),
            campaignCashback: 0
        };

        return res.render('payment', getPaymentViewModel({
            title: 'Payment',
            amount: paymentSummary.finalAmount,
            itemSubtotal,
            shippingFee,
            merchantName: fulfilmentMerchantName,
            serviceName: 'Cart checkout',
            cartItemId: '',
            cartCheckout: true,
            checkoutId,
            bookingId: '',
            selectedItemIds: selectedIds,
            items: req.session.pendingPayments[checkoutId].items,
            useCashback,
            fulfilment,
            pickupMerchantId: hasProductItems ? defaultPickupMerchantId : pickupMerchantId,
            pickupMerchantAddress: hasProductItems ? defaultPickupMerchantAddress : '',
            pickupMerchantOptions: pickupMerchants,
            deliveryFee: CART_DELIVERY_FEE,
            ...deliveryDetails,
            selectedVoucherId,
            availableVouchers,
            voucherRecommendation: smartVoucher.recommendation,
            smartVoucherMessage: smartVoucher.message,
            birthdayPromotion: null,
            rewardRedemption: null,
            campaignCashback,
            paymentSummary,
            redeemPointsRequested: 0,
            loyalty: walletError ? null : loyalty,
            eWallet,
            error: null
        }));
    });
}

function deleteSelectedCartItems(req, res) {
    const raw = req.body.selectedItemIds || '';
    const ids = Array.isArray(raw) ? raw.map(String) : raw.toString().split(',').map(s => s.trim()).filter(Boolean);

    if (!ids.length) {
        return res.redirect('/cart');
    }

    req.session.cart = (req.session.cart || []).filter((item) => !ids.includes(String(item.id)));

    req.session.success = `${ids.length} item${ids.length === 1 ? '' : 's'} removed from your cart.`;

    return res.redirect('/cart');
}

function removeFromCart(req, res) {
    const cart = req.session.cart || [];
    req.session.cart = cart.filter((item) => String(item.id) !== String(req.params.itemId));

    return res.redirect('/cart');
}

function updateCartItem(req, res) {
    const cart = req.session.cart || [];
    const item = cart.find((cartItem) => String(cartItem.id) === String(req.params.itemId));

    if (!item || item.type !== 'Product') {
        return res.redirect('/cart');
    }

    const currentQuantity = Math.max(1, Number(item.quantity || 1));
    const quantityDelta = Number(req.body.quantityDelta || 0);
    const nextQuantity = quantityDelta
        ? currentQuantity + quantityDelta
        : Number(req.body.quantity || currentQuantity);
    const requestedQuantity = Number.isFinite(nextQuantity) ? nextQuantity : currentQuantity;

    item.quantity = getCartQuantity({ quantity: requestedQuantity });

    return res.redirect('/cart');
}

function toggleFavouriteMerchant(req, res) {
    return MerchantService.getMerchantBySalonId(req.params.merchantId, (lookupError, merchant) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant you selected could not be loaded.'
            });
        }

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    const merchantId = merchant.id;
    const redirectPath = req.get('referer') || '/merchants';

    return FavouriteMerchant.toggle(req.session.user.id, merchantId, (error, isFavourite) => {
        if (error) {
            console.error('Favourite merchant could not be saved:', error);
            req.session.success = 'Favourite merchant could not be saved. Please try again.';
            return res.redirect(redirectPath);
        }

        const favouriteIds = new Set(req.session.favouriteMerchantIds || []);

        if (isFavourite) {
            favouriteIds.add(merchantId);
        } else {
            favouriteIds.delete(merchantId);
        }

        req.session.favouriteMerchantIds = Array.from(favouriteIds);
        req.session.favouritesLoadedForUserId = req.session.user.id;
        return res.redirect(redirectPath);
    });
    });
}

function getBookingReceipt(bookingId) {
    return new Promise((resolve, reject) => {
        Booking.getReceiptById(bookingId, (error, booking) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(booking);
        });
    });
}

async function showPayment(req, res) {
    const bookingId = req.query.bookingId || '';

    if (!bookingId) {
        if (req.session.lastBookingId) {
            return res.redirect(`/payment?bookingId=${encodeURIComponent(req.session.lastBookingId)}`);
        }

        return res.redirect('/cart');
    }

    try {
        const booking = await getBookingReceipt(bookingId);

        if (!booking || String(booking.user_id) !== String(req.session.user.id)) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'The booking payment could not be found.'
            });
        }

        const loyalty = await getLoyaltyView(req.session.user.id);
        const eWallet = await getEWalletView(req.session.user.id);
        const availableVouchers = await getActiveBookingVouchers(req.session.user.id);
        const birthdayPromotion = buildBirthdayPromotion(req.session.user, availableVouchers);
        const rewardRedemption = await getRewardRedemptionView(
            req.session.user.id,
            booking.merchant_id,
            booking.service_id,
            Number(booking.service_price || 0)
        );
        const campaignCashback = await getCampaignCashbackEstimate({
            kind: 'booking',
            receiptId: String(booking.id),
            userId: booking.user_id,
            merchantId: booking.merchant_id,
            merchantName: booking.merchant_name,
            serviceId: booking.service_id,
            serviceName: booking.service_name,
            amount: Number(booking.service_price || 0)
        });
        const featuredProductsUpsell = await new Promise((resolve) => {
            Product.getFeaturedProductsByMerchant(booking.merchant_id, (featuredError, items = []) => {
                if (featuredError) {
                    console.error(featuredError);
                    resolve([]);
                    return;
                }

                resolve(items.slice(0, 3));
            });
        });
        const smartVoucher = await getSmartVoucherRecommendationDetails(req.session.user.id, {
            amount: Number(booking.service_price || 0),
            merchantId: booking.merchant_id,
            bookingId: booking.id,
            kind: 'booking'
        });

        return res.render('payment', getPaymentViewModel({
            title: 'Payment',
            amount: Number(booking.service_price || 0),
            merchantName: booking.merchant_name,
            serviceName: booking.service_name,
            cartItemId: '',
            cartCheckout: false,
            checkoutId: '',
            bookingId: booking.id,
            selectedItemIds: [],
            useCashback: false,
            fulfilment: '',
            pickupMerchantId: '',
            deliveryAddress: '',
            deliveryUnit: '',
            deliveryPostal: '',
            deliveryPhone: '',
            selectedVoucherId: '',
            availableVouchers,
            voucherRecommendation: smartVoucher.recommendation,
            smartVoucherMessage: smartVoucher.message,
            birthdayPromotion,
            loyalty,
            eWallet,
            rewardRedemption,
            campaignCashback,
            featuredProductsUpsell,
            redeemPointsRequested: 0,
            error: null
        }));
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Payment Error',
            message: 'An error occurred while loading payment.'
        });
    }

}

function getPaymentPayload(body = {}) {
    const isCartCheckout = body.cartCheckout === 'true';

    return {
        amount: Number(body.amount || 0),
        itemSubtotal: Number(body.itemSubtotal || 0),
        shippingFee: Number(body.shippingFee || 0),
        merchantName: body.merchantName || 'Vaniday',
        serviceName: body.serviceName || 'Booking',
        cartItemId: body.cartItemId || '',
        cartCheckout: isCartCheckout,
        checkoutId: body.checkoutId || '',
        bookingId: body.bookingId || '',
        selectedVoucherId: isCartCheckout ? '' : (body.selectedVoucherId || ''),
        selectedItemIds: String(body.selectedItemIds || ''),
        fulfilment: body.fulfilment || '',
        pickupMerchantId: body.pickupMerchantId || '',
        pickupMerchantAddress: body.pickupMerchantAddress || '',
        deliveryAddress: body.deliveryAddress || '',
        deliveryUnit: body.deliveryUnit || '',
        deliveryPostal: body.deliveryPostal || '',
        deliveryPhone: body.deliveryPhone || '',
        redeemPoints: isCartCheckout ? 0 : Math.max(0, Math.floor(Number(body.redeemPoints || 0))),
        useCashback: isCartCheckout ? false : (body.redeemCashback === 'on' || body.useCashback === 'true')
    };
}

function getPaymentMethodLabel(method) {
    const labels = {
        apple_pay: 'Apple Pay',
        wallet: 'E-wallet',
        paypal: 'PayPal',
        nets: 'NETS QR',
        stripe: 'Stripe',
        paynow: 'PayNow',
        card: 'Card payment'
    };

    return labels[method] || labels.card;
}

async function handleWalletCheckout(req, res, payment) {
    const userId = payment.userId || req.session.user?.id;
    if (!userId) {
        return renderPaymentForm(res, payment, 'Please log in to pay with your e-wallet.');
    }

    try {
        const walletSummary = await new Promise((resolve, reject) => {
            EWallet.getWalletSummary(userId, (error, result) => error ? reject(error) : resolve(result));
        });
        const balance = Number(walletSummary?.wallet?.balance || 0);
        const amountDue = Number(payment.amount || 0);

        if (balance < amountDue) {
            return renderPaymentForm(res, payment, 'Your e-wallet balance is not enough for this payment. Please top up first.');
        }

        const durablePayment = await savePaymentAttempt('wallet', `${payment.receiptId || payment.bookingId || payment.checkoutId || 'wallet'}-${Date.now()}`, {
            ...payment,
            paymentMethod: 'wallet'
        });

        const debitPaymentAttempt = await new Promise((resolve, reject) => {
            EWallet.debitWalletForPayment({
                userId,
                amount: amountDue,
                paymentMethod: 'wallet',
                description: 'Checkout payment via E-wallet',
                referenceId: durablePayment.paymentAttemptId,
                paymentAttemptId: durablePayment.paymentAttemptId
            }, (error, result) => error ? reject(error) : resolve(result));
        });

        let receiptId;
        try {
            receiptId = await completeTrustedPayment(req, {
                ...payment,
                paymentAttemptId: durablePayment.paymentAttemptId,
                paymentMethod: 'wallet'
            }, 'E-wallet');

            await new Promise((resolve, reject) => {
                EWallet.updateTransactionStatus(debitPaymentAttempt.transactionId, userId, 'COMPLETED', 'Checkout payment via E-wallet', receiptId, (error) => error ? reject(error) : resolve());
            });
        } catch (completionError) {
            console.error('Wallet checkout completion failed after debit', {
                paymentAttemptId: durablePayment.paymentAttemptId,
                receiptId: payment.receiptId || payment.checkoutId || payment.bookingId || '',
                amountDue,
                message: completionError?.message || String(completionError)
            });
            await new Promise((resolve) => {
                EWallet.createAdjustment({
                    userId,
                    amount: amountDue,
                    paymentMethod: 'wallet',
                    description: 'Refund for failed wallet checkout',
                    referenceId: durablePayment.paymentAttemptId,
                    paymentAttemptId: durablePayment.paymentAttemptId
                }, () => resolve());
            });

            try {
                const durableAttempt = await findPaymentAttemptById(durablePayment.paymentAttemptId);
                if (durableAttempt?.status === 'completed' && durableAttempt.receiptId) {
                    return res.redirect(`/receipt/${encodeURIComponent(durableAttempt.receiptId)}`);
                }
            } catch (attemptLookupError) {
                console.error('Wallet checkout attempt lookup failed', attemptLookupError);
            }

            throw completionError;
        }

        return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
    } catch (error) {
        console.error(error);
        return renderPaymentForm(res, payment, error.message || 'Your e-wallet payment could not be completed.');
    }
}

function getPaymentViewModel(payment) {
    return {
        paypalClientId: paypal.getClientId(),
        paypalEnabled: paypal.isConfigured(),
        availableVouchers: [],
        voucherMode: '',
        voucherRecommendation: null,
        smartVoucherMessage: '',
        featuredProductsUpsell: [],
        birthdayPromotion: null,
        rewardRedemption: null,
        campaignCashback: null,
        loyalty: null,
        eWallet: null,
        error: null,
        ...payment
    };
}

function buildPayPalDescription(payment) {
    const itemName = String(payment.serviceName || payment.kind || 'Vaniday payment').trim();
    const merchantName = String(payment.merchantName || 'Vaniday').trim();
    return `${itemName} - ${merchantName}`.slice(0, 127);
}

function buildHitPayPurpose(payment) {
    const itemName = String(payment.serviceName || payment.kind || 'Vaniday payment').trim();
    const merchantName = String(payment.merchantName || 'Vaniday').trim();
    return `${merchantName} - ${itemName}`.slice(0, 255);
}

function getPublicBaseUrl(req) {
    const configured = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();

    if (configured) {
        return configured.replace(/\/$/, '');
    }

    return `${req.protocol}://${req.get('host')}`;
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        if (!req.session) {
            resolve();
            return;
        }

        req.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function savePaymentAttempt(provider, providerReference, payment) {
    const attemptId = `${provider}:${providerReference}`.slice(0, 100);
    const durablePayment = { ...payment, paymentAttemptId: attemptId };

    return new Promise((resolve, reject) => {
        PaymentAttempt.save({
            attemptId,
            userId: payment.userId,
            provider,
            providerReference,
            payment: durablePayment
        }, (error) => error ? reject(error) : resolve(durablePayment));
    });
}

function findPaymentAttempt(provider, providerReference) {
    return new Promise((resolve, reject) => {
        PaymentAttempt.findByProviderReference(provider, providerReference, (error, attempt) => {
            if (error) reject(error);
            else resolve(attempt);
        });
    });
}

function findPaymentAttemptById(attemptId) {
    return new Promise((resolve, reject) => {
        PaymentAttempt.find(attemptId, (error, attempt) => {
            if (error) reject(error);
            else resolve(attempt);
        });
    });
}

function updatePaymentAttempt(method, ...args) {
    return new Promise((resolve, reject) => {
        PaymentAttempt[method](...args, (error, result) => error ? reject(error) : resolve(result));
    });
}

function getHitPayWebhookSalt() {
    return String(process.env.HITPAY_WEBHOOK_SALT || process.env.HITPAY_SALT || '').trim();
}

function shouldTrustHitPayRedirect() {
    return String(process.env.HITPAY_TRUST_REDIRECT || '').trim().toLowerCase() === 'true';
}

function verifyHitPayWebhookSignature(rawBody, signature) {
    const salt = getHitPayWebhookSalt();
    const signedPayload = String(rawBody || '');
    const receivedSignature = String(signature || '').trim();

    if (!salt || !signedPayload || !receivedSignature) {
        return false;
    }

    const expected = crypto.createHmac('sha256', salt).update(signedPayload).digest('hex');

    if (expected.length !== receivedSignature.length) {
        return false;
    }

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSignature));
}

function storePendingHitPayPayment(requestId, payment) {
    const key = String(requestId || '').trim();

    if (!key) {
        return;
    }

    hitpayPendingStore.set(key, {
        ...payment,
        storedAt: Date.now()
    });
}

function getPendingHitPayPayment(req, requestId) {
    const key = String(requestId || '').trim();

    if (!key) {
        return null;
    }

    return req.session?.pendingHitPayPayments?.[key]
        || hitpayPendingStore.get(key)
        || null;
}

function clearPendingHitPayPayment(req, requestId) {
    const key = String(requestId || '').trim();

    if (!key) {
        return;
    }

    if (req.session?.pendingHitPayPayments) {
        delete req.session.pendingHitPayPayments[key];
    }

    hitpayPendingStore.delete(key);
}

function findExistingReceipt(receiptId) {
    return new Promise((resolve, reject) => {
        PurchaseHistory.getByReceiptIdAny(receiptId, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(row ? String(row.receipt_id) : '');
        });
    });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStableHitPayStatus(requestId, redirectStatus) {
    const attempts = String(redirectStatus || '').trim().toLowerCase() === 'completed' ? 5 : 1;
    let paymentRequest = null;
    let actualStatus = '';

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        paymentRequest = await hitpay.getPaymentRequest(requestId);
        actualStatus = String(paymentRequest?.status || '').trim().toLowerCase();

        if (actualStatus === 'completed' || actualStatus === 'failed' || actualStatus === 'expired' || actualStatus === 'canceled' || actualStatus === 'inactive') {
            break;
        }

        if (attempt < attempts - 1) {
            await delay(1500);
        }
    }

    return {
        paymentRequest,
        actualStatus
    };
}

async function finalizeHitPayPayment(req, requestId, pendingPayment) {
    if (shouldTrustHitPayRedirect()) {
        const feeSnapshot = extractProviderFeeSnapshot({
            provider: 'hitpay',
            method: 'paynow',
            amount: pendingPayment.amount,
            providerResponse: {},
            paymentChannel: 'paynow_online'
        });
        const receiptId = await completeTrustedPayment(req, {
            ...pendingPayment,
            paymentProvider: 'hitpay',
            providerPaymentId: requestId,
            providerSessionId: requestId,
            hitpayRequestId: requestId,
            hitpayStatus: 'redirect_completed',
            processingFeeAmount: feeSnapshot.amount,
            processingFeeCurrency: feeSnapshot.currency,
            processingFeePercentage: feeSnapshot.percentage,
            processingFeeFixedAmount: feeSnapshot.fixedAmount,
            processingFeeSource: feeSnapshot.source,
            processingFeeCapturedAt: new Date()
        }, 'PayNow');

        clearPendingHitPayPayment(req, requestId);
        await saveSession(req);

        return {
            done: true,
            actualStatus: 'redirect_completed',
            receiptId
        };
    }

    const existingReceiptId = await findExistingReceipt(pendingPayment.receiptId);

    if (existingReceiptId) {
        clearPendingHitPayPayment(req, requestId);
        await saveSession(req);
        return {
            done: true,
            actualStatus: 'completed',
            receiptId: existingReceiptId
        };
    }

    const paymentRequest = await hitpay.getPaymentRequest(requestId);
    const actualStatus = String(paymentRequest?.status || '').trim().toLowerCase();

    if (actualStatus !== 'completed') {
        return {
            done: false,
            actualStatus
        };
    }

    const feeSnapshot = extractProviderFeeSnapshot({
        provider: 'hitpay',
        method: 'paynow',
        amount: pendingPayment.amount,
        providerResponse: paymentRequest,
        paymentChannel: paymentRequest?.payment_method || 'paynow_online'
    });

    const receiptId = await completeTrustedPayment(req, {
        ...pendingPayment,
        paymentProvider: 'hitpay',
        providerPaymentId: requestId,
        providerSessionId: requestId,
        hitpayRequestId: requestId,
        hitpayStatus: actualStatus,
        processingFeeAmount: feeSnapshot.amount,
        processingFeeCurrency: feeSnapshot.currency,
        processingFeePercentage: feeSnapshot.percentage,
        processingFeeFixedAmount: feeSnapshot.fixedAmount,
        processingFeeSource: feeSnapshot.source,
        processingFeeCapturedAt: new Date()
    }, 'PayNow');

    clearPendingHitPayPayment(req, requestId);
    await saveSession(req);

    return {
        done: true,
        actualStatus,
        receiptId
    };
}

async function buildTrustedPayment(req, payment) {
    if (payment.bookingId) {
        const booking = await getBookingReceipt(payment.bookingId);

        if (!booking || String(booking.user_id) !== String(req.session.user.id)) {
            throw new Error('Booking payment session is invalid.');
        }

        return {
            kind: 'booking',
            receiptId: String(booking.id),
            userId: booking.user_id,
            userName: booking.customer_name,
            merchantId: booking.merchant_id,
            merchantName: booking.merchant_name,
            merchantUserId: booking.merchant_user_id,
            serviceId: booking.service_id,
            serviceName: booking.service_name,
            amount: Number(booking.service_price || 0),
            items: [
                {
                    name: booking.service_name,
                    type: 'Service',
                    merchantId: booking.merchant_id,
                    salonId: booking.merchant_id,
                    serviceId: booking.service_id,
                    merchantName: booking.merchant_name,
                    quantity: 1,
                    price: Number(booking.service_price || 0),
                    unitPrice: Number(booking.service_price || 0),
                    lineTotal: Number(booking.service_price || 0),
                    detail: `${booking.booking_date} at ${booking.booking_time}`
                }
            ],
            bookingDate: booking.booking_date,
            bookingTime: booking.booking_time,
            redeemPointsRequested: Number(payment.redeemPoints || 0)
        };
    }

    if (payment.checkoutId) {
        let pending = req.session.pendingPayments?.[payment.checkoutId];

        if (!pending) {
            const attempt = await findPaymentAttempt('checkout', payment.checkoutId);
            pending = attempt?.payment || null;
        }

        if (!pending || String(pending.userId) !== String(req.session.user.id)) {
            throw new Error('Order payment session is invalid or expired.');
        }

        return applyCheckoutFulfilment(pending, payment);
    }

    throw new Error('Payment session is invalid or expired.');
}

function applyCheckoutFulfilment(pending, payment) {
    if (pending.kind !== 'order' || pending.cartCheckout !== true) {
        return pending;
    }

    const items = Array.isArray(pending.items) ? pending.items : [];
    const hasProductItems = items.some((item) => item.type === 'Product');
    const itemSubtotal = Math.round(Number(pending.itemSubtotal || items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)) * 100) / 100;

    if (!hasProductItems) {
        return {
            ...pending,
            itemSubtotal,
            shippingFee: 0,
            amount: itemSubtotal,
            originalAmount: itemSubtotal,
            fulfilment: '',
            pickupMerchantId: '',
            pickupMerchantName: '',
            pickupMerchantAddress: '',
            pickupMode: '',
            pickupGroups: [],
            deliveryAddress: '',
            deliveryUnit: '',
            deliveryPostal: '',
            deliveryPhone: ''
        };
    }

    const fulfilment = normalizeFulfilment(payment.fulfilment || pending.fulfilment || 'pickup');
    const pickupMerchantId = String(payment.pickupMerchantId || pending.pickupMerchantId || 'any').trim();
    const pickupMerchantAddress = normalizeAddressText(payment.pickupMerchantAddress || pending.pickupMerchantAddress || '');
    const pickupMerchants = Array.isArray(pending.pickupMerchantOptions) && pending.pickupMerchantOptions.length
        ? pending.pickupMerchantOptions
        : buildPickupMerchantOptions(items);
    const pickupMerchantMap = new Map(pickupMerchants.map((merchant) => [String(merchant.id), merchant]));
    const hasMultiplePickupMerchants = pickupMerchants.length > 1;
    const pickupGroups = pickupMerchants.map((merchant) => ({
        merchantId: String(merchant.id || ''),
        merchantName: merchant.name || '',
        pickupAddress: normalizeAddressText(merchant.address || ''),
        pickupInstructions: normalizeAddressText(merchant.pickupInstructions || ''),
        items: Array.isArray(merchant.items) ? merchant.items : []
    }));

    if (fulfilment === 'pickup') {
        if (hasMultiplePickupMerchants) {
            if (pickupMerchantId && pickupMerchantId !== 'grouped') {
                throw new Error('This order includes multiple merchants. Pickup is grouped by merchant and cannot be reassigned to a single location.');
            }
        } else {
            const expectedMerchant = pickupMerchants[0] || null;
            const expectedMerchantId = expectedMerchant ? String(expectedMerchant.id || '') : '';

            if (!expectedMerchantId) {
                throw new Error('No valid pickup merchant is available for this cart.');
            }

            if (pickupMerchantId && pickupMerchantId !== expectedMerchantId && pickupMerchantId !== 'any') {
                throw new Error('Please select a valid pickup merchant from your cart.');
            }

            const expectedAddress = normalizeAddressText(expectedMerchant.address || '');
            if (pickupMerchantAddress && expectedAddress && pickupMerchantAddress !== expectedAddress) {
                throw new Error('Selected pickup address does not match the selected merchant.');
            }
        }
    }

    const deliveryValidation = validateDeliveryDetails(payment);
    if (fulfilment === 'delivery' && deliveryValidation.errors.length > 0) {
        throw new Error(deliveryValidation.errors.join(' '));
    }

    const resolvedSinglePickupMerchantId = !hasMultiplePickupMerchants && (pickupMerchantId === 'any' || !pickupMerchantId)
        ? String(pickupMerchants[0]?.id || '')
        : String(pickupMerchantId || '');
    const selectedPickupMerchant = fulfilment === 'pickup' && !hasMultiplePickupMerchants
        ? pickupMerchantMap.get(resolvedSinglePickupMerchantId)
        : null;
    const selectedPickupName = selectedPickupMerchant?.name || (hasMultiplePickupMerchants && fulfilment === 'pickup' ? 'Grouped by merchant' : '');
    const selectedPickupAddress = selectedPickupMerchant?.address || '';
    const selectedPickupInstructions = selectedPickupMerchant?.pickupInstructions || '';
    const shippingFee = fulfilment === 'delivery' ? CART_DELIVERY_FEE : 0;
    const amount = Math.round((itemSubtotal + shippingFee) * 100) / 100;
    const deliveryDetails = fulfilment === 'delivery'
        ? deliveryValidation.details
        : {
            deliveryAddress: '',
            deliveryUnit: '',
            deliveryPostal: '',
            deliveryPhone: ''
        };

    return {
        ...pending,
        itemSubtotal,
        shippingFee,
        amount,
        originalAmount: amount,
        merchantName: fulfilment === 'delivery' ? 'Delivery' : (selectedPickupName || 'Any merchant'),
        fulfilment,
        pickupMerchantId: fulfilment === 'pickup'
            ? (hasMultiplePickupMerchants ? 'grouped' : String(selectedPickupMerchant?.id || pickupMerchants[0]?.id || ''))
            : '',
        pickupMerchantName: selectedPickupName,
        pickupMerchantAddress: fulfilment === 'pickup' ? normalizeAddressText(selectedPickupAddress) : '',
        pickupInstructions: fulfilment === 'pickup' ? normalizeAddressText(selectedPickupInstructions) : '',
        pickupMode: fulfilment === 'pickup' ? (hasMultiplePickupMerchants ? 'grouped' : 'single') : '',
        pickupGroups: fulfilment === 'pickup' ? pickupGroups : [],
        pickupMerchantOptions: pickupMerchants,
        ...deliveryDetails
    };
}

function renderPaymentForm(res, payment, error = null) {
    const paymentSummary = payment.paymentSummary || {
        originalAmount: Number(payment.originalAmount || payment.itemSubtotal || payment.amount || 0),
        voucherDiscount: Number(payment.voucherDiscount || 0),
        pointsDiscount: Number(payment.pointsDiscount || 0),
        cashbackDiscount: Number(payment.cashbackRedeemed || 0),
        finalAmount: Number(payment.amount || 0),
        campaignCashback: Number(payment.campaignCashback?.total || payment.campaignCashback || 0)
    };

    return res.status(error ? 400 : 200).render('payment', getPaymentViewModel({
        title: 'Payment',
        amount: Number(payment.amount || 0),
        itemSubtotal: Number(payment.itemSubtotal || payment.amount || 0),
        shippingFee: Number(payment.shippingFee || 0),
        deliveryFee: Number(payment.deliveryFee || CART_DELIVERY_FEE),
        merchantName: payment.merchantName || 'Vaniday',
        serviceName: payment.serviceName || 'Payment',
        cartItemId: payment.cartItemId || '',
        cartCheckout: payment.cartCheckout === true,
        checkoutId: payment.checkoutId || '',
        bookingId: payment.bookingId || '',
        selectedItemIds: [],
        items: payment.items || [],
        fulfilment: payment.fulfilment || '',
        pickupMerchantId: payment.pickupMerchantId || '',
        pickupMerchantAddress: payment.pickupMerchantAddress || '',
        pickupMerchantOptions: payment.pickupMerchantOptions || [],
        deliveryAddress: payment.deliveryAddress || '',
        deliveryUnit: payment.deliveryUnit || '',
        deliveryPostal: payment.deliveryPostal || '',
        deliveryPhone: payment.deliveryPhone || '',
        useCashback: payment.useCashback === true,
        selectedVoucherId: payment.selectedVoucherId || '',
        availableVouchers: payment.availableVouchers || [],
        voucherRecommendation: payment.voucherRecommendation || null,
        birthdayPromotion: payment.birthdayPromotion || null,
        paymentSummary,
        loyalty: null,
        eWallet: payment.eWallet || null,
        ...payment,
        error
    }));
}

function getLoyaltyView(userId) {
    return new Promise((resolve) => {
        Loyalty.getWalletView(userId, (error, loyalty) => {
            if (error) {
                console.error(error);
                resolve(null);
                return;
            }

            resolve(loyalty);
        });
    });
}

function getEWalletView(userId) {
    return new Promise((resolve) => {
        EWallet.getWalletSummary(userId, (error, summary) => {
            if (error) {
                console.error(error);
                resolve(null);
                return;
            }

            resolve(summary?.wallet || null);
        });
    });
}

function getRewardRedemptionView(userId, merchantId, serviceId, amount) {
    return new Promise((resolve) => {
        Loyalty.getEffectiveRedemptionRules({ merchantId, serviceId }, (rulesError, rules) => {
            if (rulesError) {
                console.error(rulesError);
                resolve(null);
                return;
            }

            Loyalty.getWalletView(userId, (walletError, loyalty) => {
                if (walletError) {
                    console.error(walletError);
                    resolve({ rules, wallet: null, enabled: false, reason: 'Rewards wallet could not be loaded.' });
                    return;
                }

                const maxDiscountAmount = Math.round(Number(amount || 0) * (Number(rules.maxDiscountPercent || 0) / 100) * 100) / 100;
                const maxPointsByDiscount = rules.pointsToCashRate > 0
                    ? Math.floor(maxDiscountAmount / rules.pointsToCashRate)
                    : 0;
                const walletPoints = Number(loyalty?.wallet?.pointsBalance || 0);

                resolve({
                    rules,
                    wallet: loyalty.wallet,
                    enabled: Boolean(rules.enabled && walletPoints >= Number(rules.minPointsToRedeem || 0) && maxDiscountAmount > 0 && maxPointsByDiscount > 0),
                    reason: rules.reason || (walletPoints < Number(rules.minPointsToRedeem || 0) ? 'Not enough points for this redemption.' : ''),
                    maxDiscountAmount,
                    maxPoints: Math.min(walletPoints, maxPointsByDiscount),
                    conversionLabel: rules.pointsToCashRate > 0
                        ? `${Math.round(1 / rules.pointsToCashRate)} points = $1`
                        : ''
                });
            });
        });
    });
}

function getActiveBookingVouchers(userId) {
    return new Promise((resolve) => {
        User.findById(userId, (userError, user) => {
            if (userError) {
                console.error(userError);
            }

            const loadVouchers = () => UserVoucher.getActiveForUser(userId, (error, vouchers = []) => {
                if (error) {
                    console.error(error);
                    resolve([]);
                    return;
                }

                resolve(vouchers.filter((voucher) => voucher.sourceType !== 'reward_shop_merchant'));
            });

            if (!user) {
                loadVouchers();
                return;
            }

            // Birthday vouchers are prepared on demand so existing users do not need a batch job.
            UserVoucher.ensureBirthdayVoucherForUser(user, (birthdayVoucherError) => {
                if (birthdayVoucherError) {
                    console.error(birthdayVoucherError);
                }

                loadVouchers();
            });
        });
    });
}

function getSmartBookingVouchers(userId) {
    return new Promise((resolve) => {
        User.findById(userId, (userError, user) => {
            if (userError) {
                console.error(userError);
            }

            const loadVouchers = () => UserVoucher.getActiveForUser(userId, (error, vouchers = []) => {
                if (error) {
                    console.error(error);
                    resolve([]);
                    return;
                }

                resolve(vouchers.filter((voucher) => voucher.bookingOnly && voucher.sourceType === 'reward_shop_merchant'));
            });

            if (!user) {
                loadVouchers();
                return;
            }

            UserVoucher.ensureBirthdayVoucherForUser(user, (birthdayVoucherError) => {
                if (birthdayVoucherError) {
                    console.error(birthdayVoucherError);
                }

                loadVouchers();
            });
        });
    });
}

function getActiveProductVouchers(userId) {
    return new Promise((resolve) => {
        UserVoucher.getActiveForUser(userId, (error, vouchers = []) => {
            if (error) {
                console.error(error);
                resolve([]);
                return;
            }

            resolve(vouchers.filter((voucher) => voucher.sourceType !== 'reward_shop_merchant'));
        });
    });
}

function getSmartProductVouchers(userId) {
    return new Promise((resolve) => {
        UserVoucher.getActiveForUser(userId, (error, vouchers = []) => {
            if (error) {
                console.error(error);
                resolve([]);
                return;
            }

            resolve(vouchers.filter((voucher) => voucher.bookingOnly === false && voucher.sourceType === 'reward_shop_merchant'));
        });
    });
}

async function getEligibleValidatedVouchers(vouchers, payment, validator) {
    if (!vouchers.length) {
        return [];
    }

    const eligibleVouchers = await Promise.all(vouchers.map((voucher) => new Promise((resolve) => {
        validator(voucher, payment, (error, validatedVoucher) => {
            if (error) {
                resolve(null);
                return;
            }

            resolve(validatedVoucher || voucher);
        });
    })));

    return eligibleVouchers.filter(Boolean);
}

async function getValidatedVoucherOutcomes(vouchers, payment, validator) {
    if (!Array.isArray(vouchers) || vouchers.length === 0) {
        return [];
    }

    return Promise.all(vouchers.map((voucher) => new Promise((resolve) => {
        validator(voucher, payment, (error, validatedVoucher) => {
            resolve({
                voucher,
                validatedVoucher: error ? null : (validatedVoucher || voucher),
                error: error || null
            });
        });
    })));
}

function buildSmartVoucherMessage(outcomes = [], payment = {}) {
    if (!outcomes.length) {
        return payment.kind === 'order'
            ? 'No merchant product smart vouchers are available for this checkout.'
            : 'No merchant service smart vouchers are available for this checkout.';
    }

    const firstFailure = outcomes.find((entry) => entry?.error?.message);

    if (firstFailure) {
        return firstFailure.error.message;
    }

    return payment.kind === 'order'
        ? 'No merchant product smart voucher matched this checkout.'
        : 'No merchant service smart voucher matched this checkout.';
}

async function getEligibleProductVouchers(userId, payment) {
    const vouchers = await getActiveProductVouchers(userId);
    return getEligibleValidatedVouchers(vouchers, payment, UserVoucher.validateForOrder);
}

async function getSmartVoucherRecommendationDetails(userId, payment) {
    if (payment.kind === 'booking') {
        const vouchers = await getSmartBookingVouchers(userId);
        const outcomes = await getValidatedVoucherOutcomes(vouchers, payment, UserVoucher.validateForBooking);
        const eligibleVouchers = outcomes.map((entry) => entry.validatedVoucher).filter(Boolean);
        const recommendation = eligibleVouchers.length
            ? await getVoucherRecommendation(eligibleVouchers, payment, UserVoucher.validateForBooking)
            : null;

        return {
            recommendation,
            message: recommendation ? '' : buildSmartVoucherMessage(outcomes, payment)
        };
    }

    if (payment.kind === 'order') {
        const vouchers = await getSmartProductVouchers(userId);
        const outcomes = await getValidatedVoucherOutcomes(vouchers, payment, UserVoucher.validateForOrder);
        const eligibleVouchers = outcomes.map((entry) => entry.validatedVoucher).filter(Boolean);
        const recommendation = eligibleVouchers.length
            ? await getVoucherRecommendation(eligibleVouchers, payment, UserVoucher.validateForOrder)
            : null;

        return {
            recommendation,
            message: recommendation ? '' : buildSmartVoucherMessage(outcomes, payment)
        };
    }

    return { recommendation: null, message: '' };
}

async function applyVoucherRedemption(req, payment) {
    const isCartCheckout = payment.kind === 'order' && payment.cartCheckout === true;
    const submittedVoucherValue = isCartCheckout
        ? payment.selectedVoucherId
        : (Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedVoucherId')
            ? req.body.selectedVoucherId
            : payment.selectedVoucherId);
    const rawSelectedVoucherId = String(submittedVoucherValue || '').trim();
    const fallbackVoucherId = isCartCheckout ? 0 : Number(payment.voucherRecommendation?.voucher?.id || 0);
    const selectedVoucherIds = rawSelectedVoucherId === 'none' ? [] : rawSelectedVoucherId
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
    const effectiveVoucherIds = Array.from(new Set([
        ...(fallbackVoucherId ? [fallbackVoucherId] : []),
        ...selectedVoucherIds
    ]));

    if (!effectiveVoucherIds.length) {
        return {
            ...payment,
            selectedVoucherId: selectedVoucherIds.join(',')
        };
    }

    const validator = payment.kind === 'order'
        ? UserVoucher.validateForOrder
        : UserVoucher.validateForBooking;
    const appliedVouchers = [];
    let remainingAmount = Number(payment.amount || 0);

    for (const voucherId of effectiveVoucherIds) {
        const voucher = await new Promise((resolve, reject) => {
            UserVoucher.findByIdForUser(voucherId, req.session.user.id, (error, row) => error ? reject(error) : resolve(row));
        });
        const validatedVoucher = await new Promise((resolve, reject) => {
            validator(voucher, payment, (error, row) => error ? reject(error) : resolve(row || voucher));
        });
        const eligibleAmount = Math.min(getVoucherEligibleAmount(validatedVoucher, payment), remainingAmount);
        const discount = calculateVoucherDiscount(validatedVoucher, eligibleAmount);

        if (discount > 0) {
            appliedVouchers.push({ voucher: validatedVoucher, discount });
            remainingAmount = Math.max(0, Math.round((remainingAmount - discount) * 100) / 100);
        }
    }

    const voucherDiscount = appliedVouchers.reduce((total, entry) => total + Number(entry.discount || 0), 0);

    if (voucherDiscount <= 0) {
        return payment;
    }

    const primaryVoucher = appliedVouchers[0].voucher;

    return {
        ...payment,
        selectedVoucherId: selectedVoucherIds.join(','),
        voucherIds: appliedVouchers.map((entry) => entry.voucher.id),
        voucherId: primaryVoucher.id,
        voucherCode: appliedVouchers.map((entry) => entry.voucher.code).filter(Boolean).join(', '),
        voucherTitle: appliedVouchers.map((entry) => entry.voucher.title).join(' + '),
        voucherDiscountType: appliedVouchers.length > 1 ? 'stacked' : (primaryVoucher.discountType || 'fixed'),
        voucherDiscountPercent: Number(primaryVoucher.discountPercent || 0),
        originalAmount: Number(payment.originalAmount || payment.amount || 0),
        voucherDiscount,
        amount: remainingAmount
    };
}

async function applyPointRedemption(req, payment) {
    const isCartCheckout = payment.kind === 'order' && payment.cartCheckout === true;
    const requestedPoints = isCartCheckout
        ? Math.max(0, Math.floor(Number(payment.redeemPointsRequested || 0)))
        : Math.max(0, Math.floor(Number(req.body.redeemPoints || payment.redeemPointsRequested || 0)));

    if (payment.kind !== 'booking' || requestedPoints <= 0) {
        return payment;
    }

    const redemption = await new Promise((resolve, reject) => {
        Loyalty.calculatePointRedemption({
            userId: payment.userId,
            merchantId: payment.merchantId,
            serviceId: payment.serviceId,
            amount: payment.amount,
            requestedPoints
        }, (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(result);
        });
    });

    if (!redemption || Number(redemption.discount || 0) <= 0 || Number(redemption.points || 0) <= 0) {
        return payment;
    }

    return {
        ...payment,
        originalAmount: Number(payment.originalAmount || payment.amount || 0),
        redeemPointsRequested: requestedPoints,
        pointsRedeemed: Number(redemption.points || 0),
        pointsDiscount: Number(redemption.discount || 0),
        rewardMaxDiscountPercent: Number(redemption.rules?.maxDiscountPercent || 0),
        amount: Math.max(0, Math.round((Number(payment.amount || 0) - Number(redemption.discount || 0)) * 100) / 100)
    };
}

async function applyCashbackRedemption(req, payment) {
    if (Number(payment.voucherId || 0) > 0 || Number(payment.voucherDiscount || 0) > 0) {
        return {
            ...payment,
            useCashback: false,
            cashbackRedeemed: 0
        };
    }

    const isCartCheckout = payment.kind === 'order' && payment.cartCheckout === true;
    const shouldUseCashback = isCartCheckout
        ? payment.useCashback === true
        : (req.body.redeemCashback === 'on' || payment.useCashback === true);

    if (!shouldUseCashback) {
        return payment;
    }

    const loyalty = await getLoyaltyView(req.session.user.id);
    const availableCashback = Number(loyalty?.wallet?.cashbackBalance || 0);
    const redeemableAmount = Math.min(availableCashback, Number(payment.amount || 0));
    const cashbackRedeemed = Math.round(redeemableAmount * 100) / 100;

    if (cashbackRedeemed <= 0) {
        return payment;
    }

    return {
        ...payment,
        originalAmount: Number(payment.originalAmount || payment.amount || 0),
        cashbackRedeemed,
        amount: Math.max(0, Math.round((Number(payment.amount || 0) - cashbackRedeemed) * 100) / 100)
    };
}

async function prepareTrustedPayment(req, payment) {
    let trustedPayment = await buildTrustedPayment(req, payment);

    if (trustedPayment.kind === 'booking') {
        trustedPayment.availableVouchers = await getActiveBookingVouchers(req.session.user.id);
        trustedPayment.birthdayPromotion = buildBirthdayPromotion(req.session.user, trustedPayment.availableVouchers);
        trustedPayment.selectedVoucherId = payment.selectedVoucherId || '';
        {
            const smartVoucher = await getSmartVoucherRecommendationDetails(req.session.user.id, trustedPayment);
            trustedPayment.voucherRecommendation = smartVoucher.recommendation;
            trustedPayment.smartVoucherMessage = smartVoucher.message;
        }
        trustedPayment.loyalty = await getLoyaltyView(req.session.user.id);
        trustedPayment.rewardRedemption = await getRewardRedemptionView(
            req.session.user.id,
            trustedPayment.merchantId,
            trustedPayment.serviceId,
            trustedPayment.amount
        );
        trustedPayment.voucherMode = 'booking';
    } else if (trustedPayment.kind === 'order') {
        trustedPayment.availableVouchers = await getEligibleProductVouchers(req.session.user.id, trustedPayment);
        trustedPayment.selectedVoucherId = trustedPayment.selectedVoucherId || '';
        trustedPayment.useCashback = trustedPayment.useCashback === true;
        trustedPayment.redeemPointsRequested = Math.max(0, Math.floor(Number(trustedPayment.redeemPointsRequested || 0)));
        {
            const smartVoucher = await getSmartVoucherRecommendationDetails(req.session.user.id, trustedPayment);
            trustedPayment.voucherRecommendation = smartVoucher.recommendation;
            trustedPayment.smartVoucherMessage = smartVoucher.message;
        }
        trustedPayment.voucherMode = trustedPayment.availableVouchers.length > 0 ? 'product' : '';
    }

    trustedPayment = await applyVoucherRedemption(req, trustedPayment);
    trustedPayment = await applyPointRedemption(req, trustedPayment);
    trustedPayment = await applyCashbackRedemption(req, trustedPayment);
    trustedPayment.campaignCashback = await getCampaignCashbackEstimate(trustedPayment);

    return trustedPayment;
}

function persistPaidTransaction(payment, paymentMethod) {
    const canonicalMethod = normalizePaymentMethod(payment.paymentMethod || paymentMethod || 'card');
    const canonicalProvider = normalizePaymentProvider(payment.paymentProvider, canonicalMethod);
    const cashbackUsed = Number(payment.cashbackRedeemed || 0);
    const walletAmountUsed = canonicalMethod === 'wallet' ? Number(payment.amount || 0) : Number(payment.walletAmountUsed || 0);
    const processingFeeSource = canonicalMethod === 'wallet'
        ? 'none'
        : (payment.processingFeeSource || 'unknown');

    return new Promise((resolve, reject) => {
        Transaction.createPaidTransaction(payment.userId, payment.amount, canonicalMethod, payment.items || [], {
            originalAmount: Number(payment.originalAmount || payment.amount || 0),
            cashbackUsed,
            cashbackAmountUsed: cashbackUsed,
            walletAmountUsed,
            voucherDiscountAmount: Number(payment.voucherDiscount || 0),
            loyaltyPointsUsed: Number(payment.pointsRedeemed || 0),
            loyaltyPointsValue: Number(payment.pointsDiscount || 0),
            bookingId: payment.kind === 'booking' ? payment.bookingId || payment.receiptId : null,
            createOrder: payment.kind === 'order',
            fulfilmentType: payment.kind === 'order' ? normalizeFulfilment(payment.fulfilment || 'pickup') : 'pickup',
            deliveryStatus: payment.kind === 'order' ? 'processing' : null,
            pickupStatus: payment.kind === 'order' && normalizeFulfilment(payment.fulfilment || 'pickup') === 'pickup'
                ? 'pending_pickup'
                : 'not_applicable',
            currency: payment.currency || 'SGD',
            paymentProvider: canonicalProvider,
            providerPaymentId: payment.providerPaymentId || payment.stripePaymentIntentId || payment.hitpayRequestId || null,
            providerSessionId: payment.providerSessionId || payment.stripeSessionId || payment.paypalOrderId || null,
            providerCaptureId: payment.providerCaptureId || payment.paypalCaptureId || null,
            providerTransactionId: payment.providerTransactionId || payment.providerPaymentId || payment.stripePaymentIntentId || payment.hitpayRequestId || null,
            providerOrderId: payment.providerOrderId || payment.paypalOrderId || null,
            processingFeeAmount: Number(payment.processingFeeAmount || 0),
            processingFeeCurrency: payment.processingFeeCurrency || payment.currency || 'SGD',
            processingFeePercentage: payment.processingFeePercentage ?? null,
            processingFeeFixedAmount: payment.processingFeeFixedAmount ?? null,
            processingFeeSource,
            processingFeeCapturedAt: payment.processingFeeCapturedAt || null,
            providerMetadata: {
                method: canonicalMethod,
                provider: canonicalProvider,
                hitpayStatus: payment.hitpayStatus || null,
                paypalPayerEmail: payment.paypalPayerEmail || null,
                processingFeeSource,
                netsRetrievalRef: payment.txnRetrievalRef || null,
                fulfilment: payment.kind === 'order'
                    ? {
                        type: normalizeFulfilment(payment.fulfilment || 'pickup'),
                        pickupMode: payment.pickupMode || '',
                        pickupMerchantId: payment.pickupMerchantId || '',
                        pickupMerchantName: payment.pickupMerchantName || '',
                        pickupMerchantAddress: payment.pickupMerchantAddress || '',
                        pickupInstructions: payment.pickupInstructions || '',
                        pickupGroups: Array.isArray(payment.pickupGroups) ? payment.pickupGroups : [],
                        deliveryAddress: payment.deliveryAddress || '',
                        deliveryUnit: payment.deliveryUnit || '',
                        deliveryPostal: payment.deliveryPostal || '',
                        deliveryPhone: payment.deliveryPhone || ''
                    }
                    : null
            }
        }, (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            const paymentTransactionId = result?.insertId || null;
            const transactionResult = {
                transactionId: paymentTransactionId,
                orderId: result?.orderId || null,
                order_number: result?.order_number || result?.orderNumber || '',
                orderNumber: result?.orderNumber || result?.order_number || ''
            };

            if (payment.kind !== 'booking' || !paymentTransactionId) {
                resolve(transactionResult);
                return;
            }

            Booking.attachTransaction(payment.receiptId, paymentTransactionId, (bookingError) => {
                if (bookingError) {
                    reject(bookingError);
                    return;
                }

                resolve(transactionResult);
            });
        });
    });
}

async function applyPaymentSideEffects(req, payment) {
    if (payment.kind !== 'order') return;

    const selectedIds = String(payment.selectedItemIds || '').split(',').map((id) => id.trim()).filter(Boolean);
    const filterPurchased = (cart) => selectedIds.length
        ? (cart || []).filter((item) => !selectedIds.includes(String(item.id)))
        : [];

    req.session.cart = filterPurchased(req.session.cart || []);

    await new Promise((resolve, reject) => {
        CustomerCart.load(payment.userId, (loadError, storedCart = []) => {
            if (loadError) {
                reject(loadError);
                return;
            }

            CustomerCart.save(payment.userId, filterPurchased(storedCart), (saveError) => {
                if (saveError) reject(saveError);
                else resolve();
            });
        });
    });
}

function getOrderRecipients(transactionId) {
    return new Promise((resolve) => {
        if (!transactionId) {
            resolve([]);
            return;
        }

        Transaction.getMerchantOrderRecipients(transactionId, (error, recipients) => {
            if (error) {
                logNotificationError(error);
                resolve([]);
                return;
            }

            resolve(recipients || []);
        });
    });
}

function getExistingOrderDetails(transactionId) {
    return new Promise((resolve) => {
        if (!transactionId) {
            resolve({ orderId: null, orderNumber: '' });
            return;
        }

        Transaction.getOrderRowByTransactionId(transactionId, (error, order) => {
            if (error) {
                logNotificationError(error);
                resolve({ orderId: null, orderNumber: '' });
                return;
            }

            resolve({
                orderId: order?.orderId || null,
                orderNumber: order?.order_number || order?.orderNumber || ''
            });
        });
    });
}

async function notifyPaymentCompleted(req, paidPayment, transactionId) {
    const receiptLink = `/receipt/${encodeURIComponent(paidPayment.receiptId)}`;
    const amountLabel = `$${Number(paidPayment.amount || 0).toFixed(2)}`;

    createNotification({
        recipientUserId: paidPayment.userId,
        recipientRole: 'customer',
        actorUserId: null,
        type: paidPayment.kind === 'booking' ? 'booking_paid' : 'order_paid',
        title: paidPayment.kind === 'booking' ? 'Booking payment successful' : 'Order purchased successfully',
        message: paidPayment.kind === 'booking'
            ? `${paidPayment.serviceName} at ${paidPayment.merchantName} has been paid (${amountLabel}).`
            : `Your Vaniday order has been paid successfully (${amountLabel}).`,
        linkUrl: receiptLink,
        dedupeKey: `payment-customer-${paidPayment.receiptId}`,
        metadata: { receiptId: paidPayment.receiptId, transactionId }
    });

    createRoleNotification('admin', {
        actorUserId: paidPayment.userId,
        type: paidPayment.kind === 'booking' ? 'booking_paid' : 'order_paid',
        title: paidPayment.kind === 'booking' ? 'Paid booking completed' : 'Paid order completed',
        message: `${paidPayment.userName || 'A customer'} completed a ${amountLabel} ${paidPayment.kind === 'booking' ? 'booking payment' : 'checkout'}.`,
        linkUrl: '/admin',
        dedupeKey: `payment-admin-${paidPayment.receiptId}`,
        metadata: { receiptId: paidPayment.receiptId, transactionId }
    });

    if (paidPayment.kind === 'booking' && paidPayment.merchantUserId) {
        createNotification({
            recipientUserId: paidPayment.merchantUserId,
            recipientRole: 'merchant',
            actorUserId: paidPayment.userId,
            type: 'booking_paid',
            title: 'Booking payment received',
            message: `${paidPayment.userName || 'A customer'} paid ${amountLabel} for ${paidPayment.serviceName}.`,
            linkUrl: '/merchant/schedule',
            dedupeKey: `payment-merchant-booking-${paidPayment.receiptId}`,
            metadata: { receiptId: paidPayment.receiptId, transactionId }
        });
    }

    if (paidPayment.kind === 'order') {
        const recipients = await getOrderRecipients(transactionId);

        recipients.forEach((recipient) => {
            createNotification({
                recipientUserId: recipient.merchantUserId,
                recipientRole: 'merchant',
                actorUserId: paidPayment.userId,
                type: 'order_received',
                title: 'New product order received',
                message: `${paidPayment.userName || 'A customer'} bought ${recipient.itemCount} item${recipient.itemCount === 1 ? '' : 's'} from ${recipient.salonName} ($${Number(recipient.totalAmount || 0).toFixed(2)}).`,
                linkUrl: '/merchant/orders',
                dedupeKey: `payment-merchant-order-${transactionId}-${recipient.merchantUserId}`,
                metadata: { receiptId: paidPayment.receiptId, transactionId }
            });
        });
    }
}

function savePaidReceipt(req, payment, paymentMethod) {
    const receiptId = String(payment.receiptId);
    const canonicalMethod = normalizePaymentMethod(payment.paymentMethod || paymentMethod || 'card');
    const canonicalProvider = normalizePaymentProvider(payment.paymentProvider, canonicalMethod);
    const paidAmount = Number(payment.amount || 0);
    const cashbackUsed = Number(payment.cashbackRedeemed || 0);
    const walletAmountUsed = canonicalMethod === 'wallet' ? paidAmount : Number(payment.walletAmountUsed || 0);
    const paymentBreakdown = formatPaymentBreakdown([], {
        paymentMethod: canonicalMethod,
        paymentProvider: canonicalProvider,
        amount: paidAmount,
        refundedAmount: 0
    });

    req.session.receipts = req.session.receipts || {};
    const receipt = {
        id: receiptId,
        displayId: payment.displayId,
        orderId: payment.orderId || null,
        order_number: payment.order_number || payment.orderNumber || '',
        orderNumber: payment.orderNumber || payment.order_number || '',
        type: payment.kind === 'booking' ? 'booking' : 'order',
        userId: payment.userId,
        userName: payment.userName || req.session.user?.name || 'Customer',
        merchantName: payment.merchantName,
        merchantId: payment.merchantId || payment.salonId || '',
        serviceId: payment.serviceId || '',
        serviceName: payment.serviceName || '',
        items: payment.items || [],
        totalAmount: Number(payment.amount || 0),
        itemSubtotal: Number(payment.itemSubtotal || payment.amount || 0),
        shippingFee: Number(payment.shippingFee || 0),
        originalAmount: Number(payment.originalAmount || payment.amount || 0),
        voucherDiscount: Number(payment.voucherDiscount || 0),
        voucherCode: payment.voucherCode || '',
        voucherTitle: payment.voucherTitle || '',
        voucherDiscountType: payment.voucherDiscountType || 'fixed',
        voucherDiscountPercent: Number(payment.voucherDiscountPercent || 0),
        pointsRedeemed: Number(payment.pointsRedeemed || 0),
        pointsDiscount: Number(payment.pointsDiscount || 0),
        cashbackRedeemed: Number(payment.cashbackRedeemed || 0),
        paymentMethod: canonicalMethod,
        paymentProvider: canonicalProvider,
        paymentMethodLabel: formatPaymentMethod(canonicalMethod, canonicalProvider),
        paymentBreakdown,
        paymentStatus: 'paid',
        paidAmount,
        refundedAmount: 0,
        remainingPaidAmount: paidAmount,
        remainingRefundableAmount: paidAmount,
        walletAmountUsed,
        cashbackAmountUsed: cashbackUsed,
        externalPaymentAmount: canonicalMethod === 'wallet' ? 0 : paidAmount,
        providerPaymentId: payment.providerPaymentId || payment.stripePaymentIntentId || payment.hitpayRequestId || '',
        providerSessionId: payment.providerSessionId || payment.stripeSessionId || payment.paypalOrderId || '',
        providerCaptureId: payment.providerCaptureId || payment.paypalCaptureId || '',
        paidAt: new Date().toISOString(),
        bookingDate: payment.bookingDate,
        bookingTime: payment.bookingTime,
        fulfilment: payment.fulfilment || '',
        pickupMerchantId: payment.pickupMerchantId || '',
        pickupMerchantName: payment.pickupMerchantName || (payment.fulfilment === 'pickup' ? payment.merchantName : ''),
        pickupStatus: payment.fulfilment === 'pickup' ? (payment.pickupStatus || 'pending_pickup') : '',
        pickupAt: payment.pickupAt || null,
        deliveryAddress: payment.deliveryAddress || '',
        deliveryUnit: payment.deliveryUnit || '',
        deliveryPostal: payment.deliveryPostal || '',
        deliveryPhone: payment.deliveryPhone || ''
    };
    req.session.receipts[receiptId] = receipt;

    return new Promise((resolve, reject) => {
        PurchaseHistory.save(receipt, (error) => {
            if (error) {
                reject(error);
                return;
            }

            Loyalty.awardForReceipt(receipt, (awardError, awardResult = {}) => {
                if (awardError) {
                    reject(awardError);
                    return;
                }

                if (awardResult.duplicate) {
                    req.session.loyaltyError = 'Points already awarded for this receipt';
                }

                Loyalty.awardCampaignCashbackForReceipt(receipt, (cashbackError, cashbackAward = {}) => {
                    if (cashbackError) {
                        reject(cashbackError);
                        return;
                    }

                    receipt.campaignCashbackEarned = Number(cashbackAward.total || 0);
                    receipt.campaignCashbackBreakdown = cashbackAward.breakdown || [];
                    req.session.receipts[receiptId] = receipt;

                    const finishReceiptSave = () => {
                        if (payment.kind === 'order' && req.session.pendingPayments) {
                            delete req.session.pendingPayments[payment.pendingPaymentId || receiptId];
                        }

                        if (payment.kind === 'booking') {
                            req.session.lastBookingId = null;
                        }

                        req.session.lastPayment = {
                            receiptId,
                            loyaltyAward: awardResult,
                            campaignCashbackAward: cashbackAward
                        };

                        resolve({ receipt, awardResult, cashbackAward });
                    };

                    CustomerAddress.saveFromReceipt(receipt, (addressError) => {
                        if (addressError) {
                            reject(addressError);
                            return;
                        }

                        finishReceiptSave();
                    });
                });
            });
        });
    });
}

function getCampaignCashbackEstimate(payment) {
    return new Promise((resolve) => {
        const receiptLike = {
            id: payment.receiptId || payment.checkoutId || 'estimate',
            type: payment.kind === 'booking' ? 'booking' : 'order',
            userId: payment.userId,
            merchantId: payment.merchantId || payment.salonId,
            merchantName: payment.merchantName,
            serviceName: payment.serviceName,
            serviceId: payment.serviceId,
            items: payment.items || [],
            totalAmount: Number(payment.amount || 0),
            originalAmount: Number(payment.originalAmount || payment.amount || 0),
            paymentStatus: 'paid'
        };

        Loyalty.estimateCampaignCashback(receiptLike, (error, estimate) => {
            if (error) {
                console.error(error);
                resolve({ total: 0, breakdown: [] });
                return;
            }

            resolve(estimate || { total: 0, breakdown: [] });
        });
    });
}

async function completeTrustedPaymentWork(req, payment, paymentMethod) {
    const pendingPaymentId = payment.receiptId;
    const transactionResult = payment.existingTransactionId
        ? { transactionId: payment.existingTransactionId }
        : await persistPaidTransaction(payment, paymentMethod);
    const paymentTransactionId = transactionResult?.transactionId || transactionResult;
    const existingOrderDetails = transactionResult?.orderId
        ? { orderId: transactionResult.orderId, orderNumber: transactionResult.order_number || transactionResult.orderNumber || '' }
        : (payment.kind === 'order' ? await getExistingOrderDetails(paymentTransactionId) : { orderId: null, orderNumber: '' });
    const createdOrderId = transactionResult?.orderId || existingOrderDetails.orderId || null;
    const createdOrderNumber = transactionResult?.order_number
        || transactionResult?.orderNumber
        || existingOrderDetails.orderNumber
        || '';

    if (payment.paymentAttemptId && !payment.existingTransactionId) {
        await updatePaymentAttempt('markTransaction', payment.paymentAttemptId, paymentTransactionId);
    }

    const paidPayment = {
        ...payment,
        pendingPaymentId,
        transactionId: paymentTransactionId,
        orderId: createdOrderId,
        order_number: createdOrderNumber,
        orderNumber: createdOrderNumber
    };

    if (payment.kind === 'order' && paymentTransactionId) {
        paidPayment.receiptId = createdOrderNumber || String(paymentTransactionId);
        paidPayment.displayId = createdOrderNumber || String(paymentTransactionId);
    }

    if (Number(paidPayment.pointsRedeemed || 0) > 0) {
        await new Promise((resolve, reject) => {
            Loyalty.redeemPointsForPayment(
                paidPayment.userId,
                paidPayment.pointsRedeemed,
                paidPayment.pointsDiscount,
                `points-${paidPayment.receiptId}`,
                {
                    bookingReference: paidPayment.displayId || paidPayment.receiptId,
                    merchantName: paidPayment.merchantName
                },
                (error, result) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    if (result?.duplicate) {
                        resolve();
                        return;
                    }

                    AuditLog.log({
                        actorUserId: paidPayment.userId,
                        actorRole: 'customer',
                        action: 'reward_points_redeemed',
                        entityType: 'booking',
                        entityId: paidPayment.receiptId,
                        details: {
                            merchantId: paidPayment.merchantId,
                            merchantName: paidPayment.merchantName,
                            serviceId: paidPayment.serviceId,
                            serviceName: paidPayment.serviceName,
                            pointsRedeemed: paidPayment.pointsRedeemed,
                            discount: paidPayment.pointsDiscount
                        }
                    }, (auditError) => {
                        if (auditError) console.error(auditError);
                    });

                    resolve();
                }
            );
        });
    }

    if (Number(paidPayment.cashbackRedeemed || 0) > 0) {
        await new Promise((resolve, reject) => {
            Loyalty.redeemCashback(
                paidPayment.userId,
                paidPayment.cashbackRedeemed,
                `cashback-${paidPayment.receiptId}`,
                {
                    orderId: paidPayment.orderId,
                    orderNumber: paidPayment.order_number || paidPayment.orderNumber || '',
                    receiptType: paidPayment.kind
                },
                (error) => error ? reject(error) : resolve()
            );
        });
    }

    const redeemedVoucherIds = Array.from(new Set((paidPayment.voucherIds || [paidPayment.voucherId]).map(Number).filter((id) => id > 0)));
    for (const voucherId of redeemedVoucherIds) {
        await new Promise((resolve, reject) => {
            UserVoucher.markRedeemed(voucherId, {
                bookingId: paidPayment.kind === 'booking' ? paidPayment.bookingId || null : null,
                transactionId: paidPayment.transactionId || null
            }, (error) => error ? reject(error) : resolve());
        });
    }

    await applyPaymentSideEffects(req, payment);
    await savePaidReceipt(req, paidPayment, paymentMethod);

    const savedGiftCards = await persistGiftCardVouchers(req, paidPayment);
    await Promise.all(savedGiftCards.map(async (giftCard) => {
        try {
            const emailTarget = giftCard.recipientEmail || req.session.user?.email;
            await sendGiftCardEmail({
                email: emailTarget,
                recipientName: giftCard.recipientName,
                senderName: giftCard.senderName,
                amount: giftCard.amount,
                voucherCode: giftCard.voucherCode,
                message: giftCard.message,
                expiryDate: giftCard.expiryDate,
                redeemLink: process.env.BASE_URL ? `${String(process.env.BASE_URL).replace(/\/$/, '')}` : 'https://vaniday.sg',
                deliveryOption: giftCard.deliveryOption
            });
            console.log(`Gift card email sent to ${emailTarget}`);
        } catch (error) {
            console.error('Gift card email failed:', error.message);
        }
    }));

    await notifyPaymentCompleted(req, paidPayment, paymentTransactionId);

    return paidPayment.receiptId;
}

async function completeTrustedPayment(req, payment, paymentMethod) {
    const attemptId = payment.paymentAttemptId || '';

    if (!attemptId) {
        return completeTrustedPaymentWork(req, payment, paymentMethod);
    }

    const lockName = `payment:${attemptId}`.slice(0, 64);
    const connection = await new Promise((resolve, reject) => {
        const db = require('../db');
        db.getConnection((error, value) => error ? reject(error) : resolve(value));
    });

    try {
        const acquired = await new Promise((resolve, reject) => {
            connection.query('SELECT GET_LOCK(?, 15) AS acquired', [lockName], (error, rows = []) => {
                if (error) reject(error);
                else resolve(Number(rows[0]?.acquired) === 1);
            });
        });

        if (!acquired) {
            throw new Error('Payment completion is already being processed. Please try again.');
        }

        const attempt = await findPaymentAttemptById(attemptId);

        if (attempt?.status === 'completed' && attempt.receiptId) {
            return attempt.receiptId;
        }

        const resumablePayment = {
            ...(attempt?.payment || {}),
            ...payment,
            paymentAttemptId: attemptId,
            existingTransactionId: attempt?.transactionId || payment.existingTransactionId || null
        };
        const receiptId = await completeTrustedPaymentWork(req, resumablePayment, paymentMethod);
        await updatePaymentAttempt('markCompleted', attemptId, receiptId);
        return receiptId;
    } catch (error) {
        await updatePaymentAttempt('markError', attemptId, error).catch(() => {});
        throw error;
    } finally {
        connection.query('SELECT RELEASE_LOCK(?)', [lockName], () => connection.release());
    }
}

async function renderNetsQrPayment(req, res, trustedPayment) {
    let qrData;
    let qrPayload;
    let txnRetrievalRef;
    let isPrototypeQr = false;
    let netsErrorMessage = null;

    try {
        const txnId = nets.createSandboxTxnId();
        qrData = await nets.requestNetsQr(trustedPayment.amount, txnId);

        if (!nets.isQrSuccess(qrData)) {
            throw new Error(`NETS QR request was not accepted: ${JSON.stringify(qrData)}`);
        }

        qrPayload = qrData.qr_code;
        txnRetrievalRef = qrData.txn_retrieval_ref;
    } catch (error) {
        console.error('NETS QR request failed:', error.message);
        const fallbackTxnId = `PROTO-${Date.now()}`;
        qrData = nets.createPrototypeNetsQr(trustedPayment.amount, fallbackTxnId);
        qrPayload = qrData.qr_code;
        txnRetrievalRef = qrData.txn_retrieval_ref;
        isPrototypeQr = true;
        netsErrorMessage = error.message;
    }

    req.session.pendingNetsPayment = await savePaymentAttempt('nets', txnRetrievalRef, {
        ...trustedPayment,
        txnRetrievalRef,
        netsQrData: qrData,
        isPrototypeQr,
        netsConfirmed: isPrototypeQr
    });

    return res.render('netsQR', {
        title: 'NETS QR Payment',
        total: trustedPayment.amount,
        qrCodeUrl: await buildNetsQrCodeUrl(qrPayload),
        txnRetrievalRef,
        isPrototypeQr,
        netsErrorMessage,
        completeUrl: '/nets/complete',
        failCompleteUrl: '/nets/complete-fail',
        successRedirect: '/payment/success',
        failRedirect: '/nets-qr/fail',
        backPrimaryUrl: '/cart',
        backPrimaryLabel: 'Back to cart',
        backSecondaryUrl: '/services',
        backSecondaryLabel: 'Browse services'
    });
}

function getImageDataUrlFromBase64(value) {
    const compact = String(value || '').replace(/\s/g, '');
    if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
        return null;
    }

    const buffer = Buffer.from(compact, 'base64');
    const signature = buffer.subarray(0, 8).toString('hex');

    if (signature === '89504e470d0a1a0a') {
        return `data:image/png;base64,${compact}`;
    }

    if (buffer.subarray(0, 3).toString('hex') === 'ffd8ff') {
        return `data:image/jpeg;base64,${compact}`;
    }

    return null;
}

async function buildNetsQrCodeUrl(qrPayload) {
    const payload = typeof qrPayload === 'string' ? qrPayload.trim() : '';

    if (!payload) {
        throw new Error('NETS did not return a QR payload.');
    }

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(payload)) {
        return payload;
    }

    if (/^https:\/\//i.test(payload)) {
        return payload;
    }

    const imageDataUrl = getImageDataUrlFromBase64(payload);
    if (imageDataUrl) {
        return imageDataUrl;
    }

    return QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280
    });
}

async function confirmPayment(req, res) {
    const payment = getPaymentPayload(req.body);
    let trustedPayment;

    try {
        trustedPayment = await prepareTrustedPayment(req, payment);
    } catch (error) {
        const fallbackVouchers = payment.bookingId ? await getActiveBookingVouchers(req.session.user.id) : [];
        const fallbackPaymentBase = trustedPayment || await buildTrustedPayment(req, payment).catch(() => null);
        const fallbackProductVouchers = payment.cartCheckout && fallbackPaymentBase
            ? await getEligibleProductVouchers(req.session.user.id, fallbackPaymentBase)
            : [];
        const fallbackRewardRedemption = trustedPayment?.kind === 'booking'
            ? await getRewardRedemptionView(req.session.user.id, trustedPayment.merchantId, trustedPayment.serviceId, trustedPayment.amount)
            : null;
        const fallbackPayment = trustedPayment ? {
            ...trustedPayment,
            rewardRedemption: trustedPayment.rewardRedemption || fallbackRewardRedemption,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        } : {
            ...payment,
            availableVouchers: payment.cartCheckout ? fallbackProductVouchers : fallbackVouchers,
            voucherMode: payment.cartCheckout ? 'product' : 'booking',
            birthdayPromotion: payment.bookingId ? buildBirthdayPromotion(req.session.user, fallbackVouchers) : null,
            loyalty: payment.bookingId ? await getLoyaltyView(req.session.user.id) : null,
            rewardRedemption: fallbackRewardRedemption,
            redeemPointsRequested: payment.redeemPoints || 0
        };
        return renderPaymentForm(res, fallbackPayment, error.message);
    }

    if (!Number.isFinite(trustedPayment.amount) || trustedPayment.amount < 0) {
        return renderPaymentForm(res, payment, 'Payment amount is invalid.');
    }

    if (trustedPayment.amount === 0) {
        try {
            const durablePayment = await savePaymentAttempt('direct', `zero-${trustedPayment.receiptId}`, trustedPayment);
            const receiptId = await completeTrustedPayment(req, durablePayment, trustedPayment.pointsRedeemed ? 'Rewards' : 'Cashback');
            return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
        } catch (error) {
            console.error(error);
            return renderPaymentForm(res, payment, 'Rewards could not be redeemed. Please try again.');
        }
    }

    const selectedPaymentMethod = req.body.paymentMethod || 'wallet';

    if (selectedPaymentMethod === 'wallet') {
        return handleWalletCheckout(req, res, {
            ...trustedPayment,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        });
    }

    if (selectedPaymentMethod === 'paypal') {
        return renderPaymentForm(res, getPaymentViewModel({
            ...trustedPayment,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        }), 'Use the PayPal button to approve this payment before it can be recorded.');
    }

    if (selectedPaymentMethod === 'paynow') {
        return startHitPayPayment(req, res, {
            ...trustedPayment,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        });
    }

    if (selectedPaymentMethod === 'nets') {
        return renderNetsQrPayment(req, res, trustedPayment);
    }

    if (selectedPaymentMethod === 'stripe') {
        return startStripePayment(req, res, {
            ...trustedPayment,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        });
    }

    try {
        const durablePayment = await savePaymentAttempt('direct', `${selectedPaymentMethod}-${trustedPayment.receiptId}`, trustedPayment);
        const receiptId = await completeTrustedPayment(req, durablePayment, getPaymentMethodLabel(selectedPaymentMethod));
        return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
    } catch (error) {
        console.error(error);
        return renderPaymentForm(res, payment, 'Payment could not be recorded. Please try again.');
    }
}

async function completeNetsPayment(req, res) {
    let payment = req.session.pendingNetsPayment;

    if (!payment && req.body?.txnRetrievalRef) {
        const attempt = await findPaymentAttempt('nets', String(req.body.txnRetrievalRef));
        payment = attempt?.payment || null;
    }

    if (!payment) {
        return res.status(400).json({ ok: false });
    }

    try {
        if (!payment.isPrototypeQr && !payment.netsConfirmed) {
            const status = await nets.checkStatus(payment.txnRetrievalRef);
            if (status.status !== 'SUCCESS') {
                return res.status(409).json({ ok: false, status: status.status });
            }
            payment.netsConfirmed = true;
        }

        const receiptId = await completeTrustedPayment(req, payment, 'NETS QR');
        req.session.lastPayment = { receiptId };
        req.session.pendingNetsPayment = null;
        return res.json({ ok: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false });
    }
}

function failNetsPayment(req, res) {
    req.session.pendingNetsPayment = null;
    return res.json({ ok: true });
}

function showNetsFail(req, res) {
    return res.render('netsQRfail', { title: 'Nets Payment Failed' });
}

function showPaymentSuccess(req, res) {
    const payment = req.session.lastPayment;

    if (payment?.receiptId) {
        req.session.lastPayment = null;
        return res.redirect(`/receipt/${encodeURIComponent(payment.receiptId)}`);
    }

    return res.render('payment-success', {
        title: 'Payment Successful',
        amount: req.query.amount || null,
        merchantName: req.query.merchantName || null,
        serviceName: req.query.serviceName || null
    });
}

async function createPayPalOrder(req, res) {
    const payment = getPaymentPayload(req.body || {});
    let trustedPayment;

    if (!paypal.isConfigured()) {
        return res.status(503).json({
            success: false,
            message: 'PayPal is not configured on the server.'
        });
    }

    try {
        trustedPayment = await prepareTrustedPayment(req, payment);
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message || 'Payment could not be prepared.'
        });
    }

    if (!Number.isFinite(trustedPayment.amount) || trustedPayment.amount <= 0) {
        return res.status(400).json({
            success: false,
            message: 'PayPal requires a positive payment amount.'
        });
    }

    try {
        const order = await paypal.createOrder({
            amount: trustedPayment.amount,
            currencyCode: 'SGD',
            referenceId: trustedPayment.receiptId,
            description: buildPayPalDescription(trustedPayment)
        });

        req.session.pendingPayPalOrders = req.session.pendingPayPalOrders || {};
        req.session.pendingPayPalOrders[order.id] = await savePaymentAttempt('paypal', order.id, {
            ...trustedPayment,
            paypalOrderId: order.id,
            paypalStatus: order.status || 'CREATED'
        });

        return res.json({
            success: true,
            orderId: order.id
        });
    } catch (error) {
        console.error('PayPal create order failed:', error.payload || error.message);
        return res.status(502).json({
            success: false,
            message: 'PayPal could not create the order. Check sandbox credentials and try again.'
        });
    }
}

async function capturePayPalOrder(req, res) {
    const orderId = String(req.body?.orderId || '').trim();
    let pendingPayment = req.session.pendingPayPalOrders?.[orderId];
    let durableAttempt = null;

    if (!pendingPayment && orderId) {
        durableAttempt = await findPaymentAttempt('paypal', orderId);
        pendingPayment = durableAttempt?.payment || null;
    }

    if (durableAttempt?.status === 'completed' && durableAttempt.receiptId) {
        return res.json({
            success: true,
            receiptId: durableAttempt.receiptId,
            redirectUrl: `/receipt/${encodeURIComponent(durableAttempt.receiptId)}`
        });
    }

    if (!paypal.isConfigured()) {
        return res.status(503).json({
            success: false,
            message: 'PayPal is not configured on the server.'
        });
    }

    if (!orderId || !pendingPayment) {
        return res.status(400).json({
            success: false,
            message: 'PayPal order session is missing or expired.'
        });
    }

    try {
        const capture = await paypal.captureOrder(orderId);
        const details = paypal.extractCaptureDetails(capture);
        const expectedAmount = Number(pendingPayment.amount || 0).toFixed(2);

        if (details.status !== 'COMPLETED' || details.captureStatus !== 'COMPLETED') {
            throw new Error('PayPal capture was not completed.');
        }

        if (details.currencyCode !== 'SGD' || details.value.toFixed(2) !== expectedAmount) {
            throw new Error('PayPal capture amount does not match the trusted payment amount.');
        }

        const feeSnapshot = extractProviderFeeSnapshot({
            provider: 'paypal',
            method: 'paypal',
            amount: details.value,
            providerResponse: {
                paypalFee: details.paypalFee,
                seller_receivable_breakdown: {
                    paypal_fee: { value: details.paypalFee },
                    gross_amount: { value: details.grossAmount },
                    net_amount: { value: details.netAmount }
                }
            }
        });

        const receiptId = await completeTrustedPayment(req, {
            ...pendingPayment,
            paymentProvider: 'paypal',
            providerPaymentId: details.captureId,
            providerSessionId: details.orderId,
            providerCaptureId: details.captureId,
            paypalOrderId: details.orderId,
            paypalCaptureId: details.captureId,
            paypalPayerEmail: details.payerEmail,
            paypalPayerId: details.payerId,
            processingFeeAmount: feeSnapshot.amount,
            processingFeeCurrency: feeSnapshot.currency,
            processingFeeSource: feeSnapshot.source,
            processingFeeCapturedAt: new Date()
        }, 'PayPal');

        delete req.session.pendingPayPalOrders[orderId];

        return res.json({
            success: true,
            receiptId,
            redirectUrl: `/receipt/${encodeURIComponent(receiptId)}`
        });
    } catch (error) {
        console.error('PayPal capture failed:', error.payload || error.message);
        delete req.session.pendingPayPalOrders[orderId];
        return res.status(502).json({
            success: false,
            message: error.message || 'PayPal capture failed.'
        });
    }
}

async function startHitPayPayment(req, res, trustedPayment) {
    if (!hitpay.isConfigured()) {
        return renderPaymentForm(res, {
            ...trustedPayment,
            redeemPointsRequested: trustedPayment.redeemPointsRequested || 0
        }, 'HitPay is not configured on the server.');
    }

    const baseUrl = getPublicBaseUrl(req);
    const redirectUrl = `${baseUrl}/payment/hitpay/return`;

    try {
        const request = await hitpay.createPaymentRequest({
            amount: Number(trustedPayment.amount || 0).toFixed(2),
            currency: 'SGD',
            payment_methods: ['paynow_online'],
            email: req.session.user?.email || '',
            name: req.session.user?.name || trustedPayment.userName || 'Customer',
            purpose: buildHitPayPurpose(trustedPayment),
            reference_number: String(trustedPayment.receiptId || ''),
            redirect_url: redirectUrl,
            send_email: false,
            send_sms: false
        });

        if (!request?.id || !request?.url) {
            throw new Error('HitPay did not return a checkout URL.');
        }

        req.session.pendingHitPayPayments = req.session.pendingHitPayPayments || {};
        req.session.pendingHitPayPayments[request.id] = await savePaymentAttempt('hitpay', request.id, {
            ...trustedPayment,
            hitpayRequestId: request.id
        });
        storePendingHitPayPayment(request.id, req.session.pendingHitPayPayments[request.id]);
        await saveSession(req);

        return res.redirect(request.url);
    } catch (error) {
        console.error('HitPay create payment failed:', error.payload || error.message);
        return renderPaymentForm(res, {
            ...trustedPayment,
            redeemPointsRequested: trustedPayment.redeemPointsRequested || 0
        }, 'HitPay checkout could not be started. Check sandbox configuration and try again.');
    }
}

async function handleHitPayReturn(req, res) {
    const requestId = String(req.query.reference || req.query.request_id || '').trim();
    const redirectStatus = String(req.query.status || '').trim().toLowerCase();
    let pendingPayment = getPendingHitPayPayment(req, requestId);

    if (!pendingPayment && requestId) {
        const attempt = await findPaymentAttempt('hitpay', requestId);
        pendingPayment = attempt?.payment || null;
    }
    const recordedReceiptId = req.session.lastPayment?.receiptId || '';

    if (!requestId || !pendingPayment) {
        if (redirectStatus === 'completed' && recordedReceiptId) {
            return res.redirect(`/receipt/${encodeURIComponent(recordedReceiptId)}`);
        }

        return res.status(400).render('error', {
            title: 'HitPay Session Missing',
            message: 'The HitPay payment session is missing or expired.'
        });
    }

    try {
        if (redirectStatus === 'completed' && shouldTrustHitPayRedirect()) {
            const { receiptId } = await finalizeHitPayPayment(req, requestId, pendingPayment);
            return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
        }

        const { actualStatus } = await getStableHitPayStatus(requestId, redirectStatus);

        if (actualStatus !== 'completed') {
            if (redirectStatus === 'completed' && actualStatus === 'pending') {
                return res.render('hitpay-pending', {
                    title: 'Confirming PayNow Payment',
                    requestId,
                    amount: Number(pendingPayment.amount || 0),
                    merchantName: pendingPayment.merchantName || 'Vaniday',
                    serviceName: pendingPayment.serviceName || 'Payment'
                });
            }

            clearPendingHitPayPayment(req, requestId);
            await saveSession(req);
            return renderPaymentForm(res, {
                ...pendingPayment,
                redeemPointsRequested: pendingPayment.redeemPointsRequested || 0
            }, `HitPay payment was not completed${actualStatus ? ` (${actualStatus})` : ''}.`);
        }

        const { receiptId } = await finalizeHitPayPayment(req, requestId, pendingPayment);
        return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
    } catch (error) {
        console.error('HitPay return verification failed:', error.payload || error.message);

        if (redirectStatus === 'completed' && recordedReceiptId) {
            return res.redirect(`/receipt/${encodeURIComponent(recordedReceiptId)}`);
        }

        return renderPaymentForm(res, {
            ...pendingPayment,
            redeemPointsRequested: pendingPayment.redeemPointsRequested || 0
        }, 'HitPay payment could not be verified. Please try again.');
    }
}

async function getHitPayStatus(req, res) {
    const requestId = String(req.params.requestId || '').trim();
    let pendingPayment = getPendingHitPayPayment(req, requestId);

    if (!pendingPayment && requestId) {
        const attempt = await findPaymentAttempt('hitpay', requestId);
        pendingPayment = attempt?.payment || null;
    }
    const recordedReceiptId = req.session.lastPayment?.receiptId || '';

    if (!requestId || !pendingPayment) {
        if (recordedReceiptId) {
            return res.json({
                success: true,
                status: 'completed',
                redirectUrl: `/receipt/${encodeURIComponent(recordedReceiptId)}`
            });
        }

        return res.status(400).json({
            success: false,
            message: 'HitPay payment session is missing or expired.'
        });
    }

    try {
        const result = await finalizeHitPayPayment(req, requestId, pendingPayment);

        if (result.done) {
            return res.json({
                success: true,
                status: 'completed',
                redirectUrl: `/receipt/${encodeURIComponent(result.receiptId)}`
            });
        }

        return res.json({
            success: true,
            status: result.actualStatus || 'pending'
        });
    } catch (error) {
        console.error('HitPay status polling failed:', error.payload || error.message);
        return res.status(502).json({
            success: false,
            message: 'HitPay payment could not be verified.'
        });
    }
}

async function handleHitPayWebhook(req, res) {
    const rawBody = req.rawBody || '';
    const signature = req.get('Hitpay-Signature') || '';
    const eventType = String(req.get('Hitpay-Event-Type') || '').trim().toLowerCase();
    const eventObject = String(req.get('Hitpay-Event-Object') || '').trim().toLowerCase();

    if (!verifyHitPayWebhookSignature(rawBody, signature)) {
        return res.status(401).json({
            success: false,
            message: 'Invalid HitPay signature.'
        });
    }

    if (eventType !== 'completed' || eventObject !== 'payment_request') {
        return res.json({
            success: true,
            ignored: true
        });
    }

    const payload = req.body || {};
    const requestId = String(payload.id || '').trim();
    let pendingPayment = getPendingHitPayPayment(req, requestId);

    if (!pendingPayment && requestId) {
        const attempt = await findPaymentAttempt('hitpay', requestId);
        pendingPayment = attempt?.payment || null;
    }

    if (!requestId) {
        return res.status(400).json({
            success: false,
            message: 'Missing HitPay payment request ID.'
        });
    }

    if (!pendingPayment) {
        const existingReceiptId = payload.reference_number
            ? await findExistingReceipt(String(payload.reference_number).trim()).catch(() => '')
            : '';

        return res.json({
            success: true,
            ignored: !existingReceiptId
        });
    }

    try {
        const result = await finalizeHitPayPayment(req, requestId, pendingPayment);
        return res.json({
            success: true,
            completed: result.done,
            receiptId: result.receiptId || null
        });
    } catch (error) {
        console.error('HitPay webhook failed:', error.payload || error.message);
        return res.status(500).json({
            success: false,
            message: 'HitPay webhook processing failed.'
        });
    }
}

async function startStripePayment(req, res, trustedPayment) {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY) {
        return renderPaymentForm(res, {
            ...trustedPayment,
            redeemPointsRequested: trustedPayment.redeemPointsRequested || 0
        }, 'Stripe is not configured on the server.');
    }

    const appUrl = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
    
    if (!appUrl) {
        console.error('Stripe payment failed: APP_URL not configured in environment');
        return renderPaymentForm(res, {
            ...trustedPayment,
            redeemPointsRequested: trustedPayment.redeemPointsRequested || 0
        }, 'Server configuration error. Please try again.');
    }

    const successUrl = `${appUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/stripe/cancel?session_id={CHECKOUT_SESSION_ID}`;

    try {
        const productName = `${trustedPayment.serviceName || 'Payment'} - ${trustedPayment.merchantName || 'Vaniday'}`;
        
        const session = await stripe.createCheckoutSession({
            items: (trustedPayment.items || []).map(item => ({
                name: item.name,
                type: item.type,
                quantity: item.quantity,
                price: item.price
            })),
            subtotal: trustedPayment.amount,
            deliveryFee: 0,
            successUrl,
            cancelUrl,
            productName
        });

        if (!session?.id || !session?.url) {
            throw new Error('Stripe did not return a valid session or URL.');
        }

        // Store pending payment in session
        req.session.pendingStripePayments = req.session.pendingStripePayments || {};
        req.session.pendingStripePayments[session.id] = await savePaymentAttempt('stripe', session.id, {
            ...trustedPayment,
            stripeSessionId: session.id
        });
        await saveSession(req);

        console.log('Stripe session ID:', session.id);
        console.log('Stripe session URL:', session.url);

        return res.redirect(303, session.url);
    } catch (error) {
        console.error('Stripe checkout session creation failed:', error);
        return renderPaymentForm(res, {
            ...trustedPayment,
            redeemPointsRequested: trustedPayment.redeemPointsRequested || 0
        }, 'Stripe checkout could not be started. Check configuration and try again.');
    }
}

async function handleStripeReturn(req, res) {
    const sessionId = String(req.query.session_id || '').trim();

    if (!sessionId) {
        console.error('Stripe return: Missing session_id parameter');
        return res.status(400).render('error', {
            title: 'Stripe Session Missing',
            message: 'The Stripe payment session is missing or invalid.'
        });
    }

    let pendingPayment = req.session.pendingStripePayments?.[sessionId];
    let durableAttempt = null;

    if (!pendingPayment) {
        durableAttempt = await findPaymentAttempt('stripe', sessionId);
        pendingPayment = durableAttempt?.payment || null;
    }

    if (durableAttempt?.status === 'completed' && durableAttempt.receiptId) {
        return res.redirect(`/receipt/${encodeURIComponent(durableAttempt.receiptId)}`);
    }

    if (!pendingPayment) {
        console.error(`Stripe return: No pending payment found for session ${sessionId}`);
        return res.status(400).render('error', {
            title: 'Stripe Session Missing',
            message: 'The Stripe payment session is missing or expired.'
        });
    }

    try {
        const session = await stripe.retrieveCheckoutSession(sessionId);

        if (!session) {
            throw new Error('Stripe session could not be retrieved.');
        }

        const paymentIntent = session.payment_intent;
        if (!paymentIntent) {
            throw new Error('Stripe payment intent not found in session.');
        }

        // Check if payment was successful
        if (paymentIntent.status !== 'succeeded') {
            console.warn(`Stripe payment not succeeded. Status: ${paymentIntent.status}`);
            delete req.session.pendingStripePayments[sessionId];
            await saveSession(req);
            
            return res.status(400).render('error', {
                title: 'Payment Failed',
                message: 'The Stripe payment was not completed. Please try again.'
            });
        }

        let feeSnapshot = { amount: 0, currency: 'SGD', source: 'unknown' };
        try {
            feeSnapshot = await stripe.retrieveProcessingFeeSnapshot(paymentIntent);
        } catch (feeError) {
            console.error('Stripe processing fee could not be retrieved:', feeError.message);
        }

        // Payment succeeded - complete the transaction
        const receiptId = await completeTrustedPayment(req, {
            ...pendingPayment,
            paymentProvider: 'stripe',
            providerPaymentId: paymentIntent.id,
            providerSessionId: sessionId,
            stripePaymentIntentId: paymentIntent.id,
            stripeSessionId: sessionId,
            processingFeeAmount: feeSnapshot.amount,
            processingFeeCurrency: feeSnapshot.currency,
            processingFeeSource: feeSnapshot.source,
            processingFeeCapturedAt: feeSnapshot.source === 'provider_reported' ? new Date() : null
        }, 'Stripe');
        delete req.session.pendingStripePayments[sessionId];
        req.session.lastPayment = { receiptId };
        await saveSession(req);

        console.log(`Stripe payment successful. Receipt: ${receiptId}, Session: ${sessionId}`);

        return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
    } catch (error) {
        console.error('Stripe return handler error:', error.message);
        delete req.session.pendingStripePayments[sessionId];
        
        return res.status(500).render('error', {
            title: 'Payment Error',
            message: 'An error occurred while processing your Stripe payment. Please try again.'
        });
    }
}

async function handleStripeCancel(req, res) {
    const sessionId = String(req.query.session_id || '').trim();
    const pendingPayment = sessionId ? req.session.pendingStripePayments?.[sessionId] : null;

    if (sessionId) {
        console.log(`Stripe payment cancelled by user. Session: ${sessionId}`);
        if (req.session.pendingStripePayments) {
            delete req.session.pendingStripePayments[sessionId];
        }
        await saveSession(req);
    }

    if (pendingPayment) {
        return renderPaymentForm(res, pendingPayment, 'Stripe payment was cancelled. Please try again or choose a different payment method.');
    }

    return res.redirect('/payment');
}

async function streamNetsPaymentStatus(req, res) {
    const txn = req.params.txnRetrievalRef;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // NETS QR is shared by checkout and wallet top-ups. Both flows use this
    // status stream, but keep their pending payment in separate session keys.
    let pendingPayment = req.session.pendingNetsPayment || req.session.walletPendingNets;

    if (!pendingPayment) {
        const attempt = await findPaymentAttempt('nets', String(txn));
        pendingPayment = attempt?.payment || null;
    }
    if (!pendingPayment || String(pendingPayment.txnRetrievalRef) !== String(txn)) {
        send({ fail: true, message: 'Payment session not found.' });
        res.end();
        return;
    }

    if (pendingPayment.isPrototypeQr || String(txn).startsWith('PROTO-')) {
        pendingPayment.netsConfirmed = true;
        send({ success: true, prototype: true });
        res.end();
        return;
    }

    let closed = false;
    const startedAt = Date.now();
    let interval;

    const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        res.end();
    };

    const poll = async () => {
        try {
            const result = await nets.checkStatus(txn);
            if (result.status === 'SUCCESS') {
                pendingPayment.netsConfirmed = true;
                send({ success: true, txnRetrievalRef: txn });
                close();
                return;
            }

            if (result.status === 'FAIL') {
                send({ fail: true, txnRetrievalRef: txn });
                close();
                return;
            }

            send({
                pending: true,
                txnRetrievalRef: txn,
                timeout: Date.now() - startedAt >= NETS_STATUS_TIMEOUT_MS
            });

            if (Date.now() - startedAt >= NETS_STATUS_TIMEOUT_MS) {
                close();
            }
        } catch (error) {
            console.error('NETS status check failed:', error.message);
            send({ pending: true, txnRetrievalRef: txn, message: error.message });
        }
    };

    interval = setInterval(poll, NETS_STATUS_POLL_MS);
    req.on('close', close);
    poll();
}

module.exports = {
    showHome,
    showServices,
    showPromotions,
    showFirstTrial,
    showHappyHour,
    showOneForOne,
    showFeaturedSalons,
    listMerchants,
    showMerchant,
    showMerchantQr,
    showMerchantStorefront,
    showBookingPage,
    showPublicMerchantBooking,
    showSecureScanBooking,
    getBookingAvailability,
    saveQrBooking,
    saveStorefrontBooking,
    saveSecureScanBooking,
    showBookingCheckIn,
    confirmBookingCheckIn,
    createBooking,
    addToCart,
    showGiftCards,
    addProductToCart,
    addGiftCardToCart,
    showCart,
    checkout,
    deleteSelectedCartItems,
    removeFromCart,
    updateCartItem,
    toggleFavouriteMerchant,
    showPayment,
    confirmPayment,
    completeNetsPayment,
    failNetsPayment,
    showNetsFail,
    showPaymentSuccess,
    createPayPalOrder,
    capturePayPalOrder,
    handleHitPayReturn,
    getHitPayStatus,
    handleHitPayWebhook,
    startStripePayment,
    handleStripeReturn,
    handleStripeCancel,
    streamNetsPaymentStatus
};
