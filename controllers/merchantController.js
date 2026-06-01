const QRCode = require('qrcode');
const crypto = require('crypto');
const Merchant = require('../models/Merchant');
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
const { getCartItemCount, getCartLineTotal, getCartQuantity } = require('../utils/cart');
const { sendBookingConfirmationEmail, sendGiftCardEmail } = require('../utils/emailNotifications');
const { getPublicHolidayDateMap, getPublicHolidayName } = require('../utils/publicHolidays');
const { sendBookingConfirmationSms } = require('../utils/smsNotifications');
const { sendBookingNotification } = require('../utils/whatsappNotifications');
const { formatAppointmentDateTime } = require('../utils/dateTimeFormat');
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

function normalizeFulfilment(value) {
    return String(value || '').toLowerCase() === 'delivery' ? 'delivery' : 'pickup';
}

function buildPickupMerchantOptions(cart = []) {
    const optionMap = new Map();

    (cart || []).forEach((item) => {
        if (item.merchantId && item.merchantName) {
            optionMap.set(String(item.merchantId), {
                id: String(item.merchantId),
                name: item.merchantName
            });
        }
    });

    Merchant.getAll().forEach((merchant) => {
        if (merchant?.id && merchant?.name) {
            optionMap.set(String(merchant.id), {
                id: String(merchant.id),
                name: merchant.name
            });
        }
    });

    return Array.from(optionMap.values()).sort((left, right) => left.name.localeCompare(right.name));
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
    const deliveryUnit = String(body.deliveryUnit || '').trim().replace(/\s+/g, ' ');
    const deliveryPostal = String(body.deliveryPostal || '').trim();
    const normalizedPhone = String(body.deliveryPhone || '').replace(/[\s-]/g, '').replace(/^\+65/, '');
    const errors = [];

    if (deliveryAddress.length < 8) {
        errors.push('Enter a complete delivery address.');
    }

    if (!deliveryUnit || !/^[A-Za-z0-9#\-/\s]+$/.test(deliveryUnit)) {
        errors.push('Enter a valid unit number.');
    }

    if (!/^\d{6}$/.test(deliveryPostal)) {
        errors.push('Enter a valid 6-digit postal code.');
    }

    if (!/^[689]\d{7}$/.test(normalizedPhone)) {
        errors.push('Enter a valid Singapore contact number.');
    }

    return {
        details: {
            deliveryAddress,
            deliveryUnit,
            deliveryPostal,
            deliveryPhone: normalizedPhone
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

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getGiftCardExpiryDate() {
    const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
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
    const deliveryDateOption = String(body.deliveryDateOption || 'now') === 'schedule' ? 'schedule' : 'now';
    const scheduledSendDate = deliveryDateOption === 'schedule'
        ? String(body.scheduledDate || '').trim()
        : null;

    return {
        amount,
        deliveryOption,
        recipientEmail,
        recipientName,
        senderName,
        message,
        deliveryDateOption,
        scheduledSendDate
    };
}

async function persistGiftCardVouchers(req, payment) {
    const giftCardItems = (payment.items || []).filter((item) => String(item.type) === 'Gift Card' && item.giftCard);

    if (!giftCardItems.length) {
        return [];
    }

    const saved = [];

    for (const item of giftCardItems) {
        const giftCard = item.giftCard || {};
        const recipientEmail = giftCard.deliveryOption === 'recipient'
            ? giftCard.recipientEmail
            : String(req.session.user?.email || '').trim();
        const payload = {
            code: GiftCardVoucher.generateCode('VANI'),
            amount: Number(item.price || 0),
            balance: Number(item.price || 0),
            senderUserId: Number(req.session.user?.id || null) || null,
            senderName: String(giftCard.senderName || req.session.user?.name || '').trim(),
            recipientName: String(giftCard.recipientName || '').trim(),
            recipientEmail: recipientEmail || null,
            message: String(giftCard.message || '').trim(),
            deliveryOption: giftCard.deliveryOption || 'self',
            scheduledSendDate: giftCard.scheduledSendDate || null,
            expiryDate: getGiftCardExpiryDate(),
            status: 'active'
        };

        try {
            const result = await new Promise((resolve, reject) => {
                GiftCardVoucher.create(payload, (error, resultData) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve({ id: resultData.insertId, voucherCode: payload.code, ...payload });
                });
            });

            saved.push(result);
        } catch (error) {
            console.error('Gift card voucher persistence failed:', error.message);
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

    const respondWithFallbackSlots = () => {
        const merchant = Merchant.findById(merchantId);
        const service = getSelectedService(merchant, serviceId) || getServiceByOptionId(merchant, serviceId);
        const selection = getBookableSelection(service, serviceId);
        const bookableItem = selection.selectedOption || service;
        const fallbackSlots = Array.isArray(bookableItem?.slots) ? bookableItem.slots.map(normalizeBookingTime).filter(Boolean) : [];
        const dateFilteredSlots = Booking.filterSlotsForBookingDate(fallbackSlots, bookingDate).slots;
        const availableSlots = dateFilteredSlots.filter((slot) => {
            return !Booking.hasExistingBooking(merchantId, service?.id, bookingDate, slot);
        });

        return res.json({
            success: true,
            slots: availableSlots,
            message: availableSlots.length ? '' : 'No available slots for this date.',
            meta: { source: 'fallback' }
        });
    };

    return Booking.getAvailableSlots(merchantId, serviceId, bookingDate, (error, slots = [], meta = {}) => {
        if (error) {
            console.error(error);

            if (Merchant.findById(merchantId)) {
                return respondWithFallbackSlots();
            }

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

function rejectInvalidQrToken(req, res, merchant) {
    if (!req.params.qrToken || Merchant.hasValidQrToken(merchant, req.params.qrToken)) {
        return false;
    }

    res.status(404).render('error', {
        title: 'Invalid Booking QR',
        message: 'This QR booking link does not belong to the selected merchant.'
    });

    return true;
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
    const backLink = backLinks[source] || backLinks.services;

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
                const merchantProducts = (productError ? [] : products).filter((product) => {
                    return String(product.salonId || '') === String(merchant.id || '');
                });

                return res.status(options.status || 200).render('merchant-detail', {
                    title: merchant.name,
                    merchant,
                    products: merchantProducts,
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

    if (normalizedBookingTime && service) {
        const configuredSlots = (serviceSelection.bookableItem?.slots || service.slots || [])
            .map(normalizeBookingTime)
            .filter(Boolean);
        const currentlyBookableSlots = Booking.filterSlotsForBookingDate(configuredSlots, form.bookingDate).slots;

        if (!currentlyBookableSlots.includes(normalizedBookingTime)) {
            errors.push('This time slot is no longer available. Please choose another time.');
        }
    }

    if (service && Booking.hasExistingBooking(merchant.id, service.id, form.bookingDate, normalizedBookingTime)) {
        errors.push('This slot is already booked. Please choose another time.');
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
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const serviceCatalog = Merchant.getServiceCatalog(search).map((service) => ({
        ...service,
        serviceBookingUrl: `${baseUrl}${service.serviceBookingPath}`
    }));

    res.render('home', {
        title: 'Vaniday',
        merchants: Merchant.getAll(search),
        favouriteIds,
        serviceCatalog,
        portalStats: Merchant.getPortalStats(search),
        search,
        success: req.session.success,
        showChatbot: true
    });
    req.session.success = null;
}

function showServices(req, res) {
    const search = req.query.search || '';
    const favouriteIds = req.session.favouriteMerchantIds || [];
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return MerchantService.getAllServices((serviceError, databaseServices = []) => {
        if (serviceError) {
            console.error(serviceError);
        }

        const sourceServices = serviceError || databaseServices.length === 0
            ? Merchant.getServiceCatalog(search)
            : databaseServices.map((service) => ({
                ...service,
                merchantId: service.salonId,
                merchantName: service.salonName,
                merchantLocation: service.salonAddress || '',
                merchantCategory: service.category || 'Service',
                merchantRating: 'New',
                serviceBookingPath: `/booking/${service.salonId}?serviceId=${service.id}`
            }));
        const serviceCatalog = sourceServices
            .filter((service) => !service.inventoryBlocked)
            .map((service) => ({
            ...service,
            serviceBookingUrl: `${baseUrl}${service.serviceBookingPath}`
        }));
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
        const prices = serviceCatalog.map((service) => Number(service.price)).filter((price) => !Number.isNaN(price));
        const merchantIds = new Set(serviceCatalogWithCashback.map((service) => service.merchantId).filter(Boolean));

        return res.render('services', {
            title: 'Services',
            merchants: Merchant.getAll(search),
            favouriteIds,
            serviceCatalog: serviceCatalogWithCashback,
            portalStats: serviceError || databaseServices.length === 0
                ? Merchant.getPortalStats(search)
                : {
                    merchantCount: merchantIds.size,
                    serviceCount: serviceCatalogWithCashback.length,
                    promotionCount: 0,
                    slotCount: serviceCatalogWithCashback.reduce((total, service) => total + (service.slots || []).length, 0),
                    startingPrice: prices.length > 0 ? Math.min(...prices) : 0
                },
            search,
            showChatbot: true
        });
        });
    });
}

function buildPromotionOffers() {
    const discountPattern = [25, 20, 15, 10, 5];
    const cashbackPattern = [10, 9, 8, 7, 6, 5];

    return Merchant.getAll().flatMap((merchant) => {
        return merchant.services.flatMap((service) => {
            const options = getServiceOptions(service);
            const items = options.length > 0 ? options : [service];

            return items.map((item, index) => {
                const basePrice = Number(item.price);
                const campaignLabel = index === 0 ? 'First Trial' : index === 1 ? 'Happy Hour' : '1 For 1';
                const discountIndex = (merchant.id + service.id + index) % discountPattern.length;
                const cashbackIndex = (merchant.id + service.id + index) % cashbackPattern.length;
                const discountPercent = discountPattern[discountIndex];
                const cashbackPercent = cashbackPattern[cashbackIndex];
                const originalPrice = basePrice;
                const price = Math.max(1, Math.round((basePrice * (100 - discountPercent))) / 100);

                return {
                    id: `${merchant.id}-${service.id}-${item.id || index}`,
                    merchantId: merchant.id,
                    merchantName: merchant.name,
                    merchantLocation: merchant.location,
                    merchantCategory: merchant.category,
                    merchantRating: merchant.rating,
                    merchantPromotion: merchant.promotion,
                    name: options.length > 0 ? `${service.name} - ${item.name}` : service.name,
                    serviceCategory: service.name,
                    duration: item.duration || service.duration,
                    price,
                    originalPrice,
                    discountPercent,
                    cashbackPercent,
                    campaignLabel,
                    priceTier: price < 30 ? '$' : price < 55 ? '$$' : price < 80 ? '$$$' : '$$$$',
                    regions: [merchant.location, merchant.category],
                    serviceBookingPath: appendQueryParams(
                        `/booking/${merchant.id}/${merchant.qrToken}?serviceId=${encodeURIComponent(service.id)}`,
                        {
                            source: 'promotions',
                            serviceOptionId: options.length > 0 ? item.id : '',
                            promoCampaign: campaignLabel,
                            promoTitle: options.length > 0 ? `${service.name} - ${item.name}` : service.name,
                            promoPrice: price,
                            promoOriginalPrice: originalPrice,
                            promoDiscountPercent: discountPercent
                        }
                    )
                };
            });
        });
    }).sort((left, right) => right.discountPercent - left.discountPercent);
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
    return Promotion.getActivePublic((promotionError, promotions) => {
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

    res.render('merchants', {
        title: 'Merchants',
        merchants: Merchant.getAll(search),
        favouriteIds,
        search
    });
}

function showMerchant(req, res) {
    const merchant = Merchant.findById(req.params.id);

    if (!merchant) {
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

        if (!merchant) {
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
    const tokenMerchant = Merchant.findById(req.params.merchantId);

    if (!tokenMerchant) {
        return MerchantService.getMerchantBySalonId(req.params.merchantId, (error, databaseMerchant) => {
            if (error) {
                console.error(error);
                return res.status(500).render('error', {
                    title: 'Merchant Not Found',
                    message: 'The merchant booking page could not be loaded.'
                });
            }

            if (!databaseMerchant) {
                return res.status(404).render('error', {
                    title: 'Merchant Not Found',
                    message: 'The merchant booking page could not be found.'
                });
            }

            return res.redirect(appendQueryParams(getMerchantStorefrontPath(databaseMerchant), {
                serviceId: req.query.serviceId || ''
            }));
        });
    }

    if (rejectInvalidQrToken(req, res, tokenMerchant)) {
        return null;
    }

    if (!req.params.qrToken && tokenMerchant.qrToken) {
        return res.redirect(getBookingPath(tokenMerchant, getSelectedService(tokenMerchant, req.query.serviceId)));
    }

    return MerchantService.getMerchantBySalonId(req.params.merchantId, (error, databaseMerchant) => {
        if (error) {
            console.error(error);
            return renderBookingPage(req, res, tokenMerchant);
        }

        const merchant = databaseMerchant
            ? { ...tokenMerchant, ...databaseMerchant, qrToken: tokenMerchant.qrToken }
            : tokenMerchant;

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

        if (!merchant) {
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

        if (!merchant) {
            return res.status(404).render('error', {
                title: 'Merchant Not Found',
                message: 'The merchant booking page could not be found.'
            });
        }

        return renderBookingPage(req, res, merchant, { secureQr: true });
    });
}

function saveQrBooking(req, res) {
    const tokenMerchant = Merchant.findById(req.params.merchantId);

    if (!tokenMerchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant booking page could not be found.'
        });
    }

    if (rejectInvalidQrToken(req, res, tokenMerchant)) {
        return null;
    }

    if (!req.params.qrToken) {
        return res.status(400).render('error', {
            title: 'Invalid Booking QR',
            message: 'Booking requests must use this merchant-specific QR booking link.'
        });
    }

    return MerchantService.getMerchantBySalonId(req.params.merchantId, (merchantLookupError, databaseMerchant) => {
        if (merchantLookupError) {
            console.error(merchantLookupError);
        }

        const merchant = databaseMerchant
            ? { ...tokenMerchant, ...databaseMerchant, qrToken: tokenMerchant.qrToken }
            : tokenMerchant;
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
    const merchant = Merchant.findById(req.params.id);

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

    const booking = Booking.create({
        merchantId: merchant.id,
        merchantName: merchant.name,
        serviceId: validation.service.id,
        serviceName: validation.serviceName,
        customerName: validation.customerName,
        email: validation.email,
        phone: validation.phone,
        bookingDate: req.body.bookingDate,
        bookingTime: validation.bookingTime,
        status: 'Confirmed'
    });

    notifyBookingCreated(req, merchant, validation, booking.id || null);
    req.session.success = `Booking confirmed for ${validation.serviceName} at ${merchant.name} on ${req.body.bookingDate}, ${validation.bookingTime}.`;
    return res.redirect('/');
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
    const merchant = Merchant.findById(req.params.merchantId);
    const service = Merchant.findService(req.params.merchantId, req.body.serviceId);

    if (!merchant || !service) {
        return res.status(404).render('error', {
            title: 'Service Not Found',
            message: 'The service you selected could not be found.'
        });
    }

    req.session.cart = req.session.cart || [];
    const cartItem = {
        id: Date.now(),
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantQrToken: merchant.qrToken,
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: service.price
    };
    req.session.cart.push(cartItem);

    return respondCartAdded(req, res, `${service.name} was added to your cart.`, cartItem);
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

        req.session.cart = req.session.cart || [];
        const existingProduct = req.session.cart.find((item) => item.type === 'Product' && String(item.serviceId) === String(product.id));

        if (existingProduct) {
            existingProduct.quantity = Math.min(Number(existingProduct.quantity || 1) + 1, 99);
        } else {
            req.session.cart.push({
                id: Date.now(),
                type: 'Product',
                merchantId: product.salonId || null,
                merchantName: product.salonName || product.category,
                serviceId: product.id,
                serviceName: product.name,
                duration: product.description,
                price: product.price,
                quantity: 1
            });
        }

        return respondCartAdded(req, res, `${product.name} was added to your cart.`, existingProduct || req.session.cart[req.session.cart.length - 1]);
    });
}

function addGiftCardToCart(req, res) {
    const giftCard = parseGiftCardForm(req.body, req.session.user);
    const minAmount = 10;
    const maxAmount = 500;

    if (!Number.isFinite(giftCard.amount) || giftCard.amount < minAmount || giftCard.amount > maxAmount) {
        req.session.success = `Please enter a valid gift card amount between $${minAmount} and $${maxAmount}.`;
        return res.redirect('/giftcards');
    }

    if (giftCard.deliveryOption === 'recipient' && !isValidEmail(giftCard.recipientEmail)) {
        req.session.success = 'Please enter a valid recipient email address.';
        return res.redirect('/giftcards');
    }

    if (giftCard.deliveryDateOption === 'schedule' && !giftCard.scheduledSendDate) {
        req.session.success = 'Please select a delivery date for your gift card.';
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
        duration: 'Digital gift card for beauty, salon, spa, and grooming appointments.',
        price: giftCard.amount,
        quantity: 1,
        giftCard
    });

    req.session.success = `$${giftCard.amount} gift card was added to your cart.`;
    return res.redirect('/cart');
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

        const merchant = Merchant.findById(item.merchantId);

        return {
            ...item,
            merchantQrToken: merchant ? merchant.qrToken : null,
            quantity,
            lineTotal
        };
    });
    const total = cart.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const itemCount = getCartItemCount(cart);
    const success = req.session.success;
    const pickupMerchants = buildPickupMerchantOptions(cart);
    req.session.success = null;

    return Loyalty.getWalletView(req.session.user.id, async (walletError, loyalty) => {
        if (walletError) {
            console.error(walletError);
        }

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
            campaignCashback
        });
    });
}

function checkout(req, res) {
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

    const fulfilment = normalizeFulfilment(req.body.fulfilment);
    const pickupMerchantId = req.body.pickupMerchantId || '';
    const deliveryValidation = validateDeliveryDetails(req.body);
    const shippingFee = fulfilment === 'delivery' ? CART_DELIVERY_FEE : 0;
    const amount = Math.round((itemSubtotal + shippingFee) * 100) / 100;
    const useCashback = req.body.redeemCashback === 'on' || req.session.applyCashback === true;
    const checkoutId = `ORD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const userName = req.session.profile?.name || req.session.user?.name || 'Customer';
    const pickupMerchants = buildPickupMerchantOptions(selectedItems);
    const pickupMerchantMap = new Map(pickupMerchants.map((merchant) => [String(merchant.id), merchant.name]));

    if (fulfilment === 'delivery' && deliveryValidation.errors.length > 0) {
        req.session.success = deliveryValidation.errors.join(' ');
        return res.redirect('/cart');
    }

    if (fulfilment === 'pickup' && pickupMerchantId && pickupMerchantId !== 'any' && !pickupMerchantMap.has(String(pickupMerchantId))) {
        req.session.success = 'Please select a valid pickup merchant.';
        return res.redirect('/cart');
    }

    const selectedPickupName = pickupMerchantId && pickupMerchantId !== 'any'
        ? (pickupMerchantMap.get(String(pickupMerchantId)) || pickupMerchantId)
        : null;
    const fulfilmentMerchantName = fulfilment === 'pickup'
        ? (selectedPickupName || 'Any merchant')
        : 'Delivery';
    const deliveryDetails = fulfilment === 'delivery'
        ? deliveryValidation.details
        : {
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
        useCashback,
        fulfilment,
        pickupMerchantId,
        pickupMerchantName: selectedPickupName || '',
        ...deliveryDetails
    };
    req.session.applyCashback = false;

    return Loyalty.getWalletView(req.session.user.id, async (walletError, loyalty) => {
        if (walletError) {
            console.error(walletError);
        }

        const campaignCashback = await getCampaignCashbackEstimate(req.session.pendingPayments[checkoutId]);

        return res.render('payment', getPaymentViewModel({
            title: 'Payment',
            amount,
            itemSubtotal,
            shippingFee,
            merchantName: fulfilmentMerchantName,
            serviceName: 'Cart checkout',
            cartItemId: '',
            cartCheckout: true,
            checkoutId,
            bookingId: '',
            selectedItemIds: selectedIds,
            useCashback,
            fulfilment,
            pickupMerchantId,
            ...deliveryDetails,
            selectedVoucherId: '',
            availableVouchers: [],
            birthdayPromotion: null,
            rewardRedemption: null,
            campaignCashback,
            redeemPointsRequested: 0,
            loyalty: walletError ? null : loyalty,
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
    const merchant = Merchant.findById(req.params.merchantId);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    req.session.favouriteMerchantIds = req.session.favouriteMerchantIds || [];
    const merchantId = merchant.id;

    if (req.session.favouriteMerchantIds.includes(merchantId)) {
        req.session.favouriteMerchantIds = req.session.favouriteMerchantIds.filter((id) => id !== merchantId);
    } else {
        req.session.favouriteMerchantIds.push(merchantId);
    }

    return res.redirect(req.get('referer') || '/merchants');
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
            birthdayPromotion,
            loyalty,
            rewardRedemption,
            campaignCashback,
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
    return {
        amount: Number(body.amount || 0),
        itemSubtotal: Number(body.itemSubtotal || 0),
        shippingFee: Number(body.shippingFee || 0),
        merchantName: body.merchantName || 'Vaniday',
        serviceName: body.serviceName || 'Booking',
        cartItemId: body.cartItemId || '',
        cartCheckout: body.cartCheckout === 'true',
        checkoutId: body.checkoutId || '',
        bookingId: body.bookingId || '',
        selectedVoucherId: body.selectedVoucherId || '',
        selectedItemIds: String(body.selectedItemIds || ''),
        redeemPoints: Math.max(0, Math.floor(Number(body.redeemPoints || 0))),
        useCashback: body.redeemCashback === 'on' || body.useCashback === 'true'
    };
}

function getPaymentMethodLabel(method) {
    const labels = {
        apple_pay: 'Apple Pay',
        paypal: 'PayPal',
        nets: 'NETS QR',
        stripe: 'Stripe',
        card: 'Card payment'
    };

    return labels[method] || labels.card;
}

function getPaymentViewModel(payment) {
    return {
        paypalClientId: paypal.getClientId(),
        paypalEnabled: paypal.isConfigured(),
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
        const receiptId = await completeTrustedPayment(req, {
            ...pendingPayment,
            hitpayRequestId: requestId,
            hitpayStatus: 'redirect_completed'
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

    const receiptId = await completeTrustedPayment(req, {
        ...pendingPayment,
        hitpayRequestId: requestId,
        hitpayStatus: actualStatus
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
        const pending = req.session.pendingPayments?.[payment.checkoutId];

        if (!pending || String(pending.userId) !== String(req.session.user.id)) {
            throw new Error('Order payment session is invalid or expired.');
        }

        return pending;
    }

    throw new Error('Payment session is invalid or expired.');
}

function renderPaymentForm(res, payment, error = null) {
    return res.status(error ? 400 : 200).render('payment', getPaymentViewModel({
        title: 'Payment',
        amount: Number(payment.amount || 0),
        itemSubtotal: Number(payment.itemSubtotal || payment.amount || 0),
        shippingFee: Number(payment.shippingFee || 0),
        merchantName: payment.merchantName || 'Vaniday',
        serviceName: payment.serviceName || 'Payment',
        cartItemId: payment.cartItemId || '',
        cartCheckout: payment.cartCheckout === true,
        checkoutId: payment.checkoutId || '',
        bookingId: payment.bookingId || '',
        selectedItemIds: [],
        fulfilment: '',
        pickupMerchantId: '',
        deliveryAddress: '',
        deliveryUnit: '',
        deliveryPostal: '',
        deliveryPhone: '',
        useCashback: payment.useCashback === true,
        selectedVoucherId: payment.selectedVoucherId || '',
        availableVouchers: payment.availableVouchers || [],
        birthdayPromotion: payment.birthdayPromotion || null,
        loyalty: null,
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

                resolve(vouchers.filter((voucher) => voucher.bookingOnly));
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

async function applyVoucherRedemption(req, payment) {
    const selectedVoucherId = Number(req.body.selectedVoucherId || payment.selectedVoucherId || 0);

    if (!selectedVoucherId) {
        return payment;
    }

    const voucher = await new Promise((resolve, reject) => {
        UserVoucher.findByIdForUser(selectedVoucherId, req.session.user.id, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(row);
        });
    });

    await new Promise((resolve, reject) => {
        UserVoucher.validateForBooking(voucher, payment, (error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });

    const voucherDiscount = calculateVoucherDiscount(voucher, payment.amount);

    if (voucherDiscount <= 0) {
        return payment;
    }

    return {
        ...payment,
        selectedVoucherId,
        voucherId: voucher.id,
        voucherCode: voucher.code,
        voucherTitle: voucher.title,
        voucherDiscountType: voucher.discountType || 'fixed',
        voucherDiscountPercent: Number(voucher.discountPercent || 0),
        originalAmount: Number(payment.originalAmount || payment.amount || 0),
        voucherDiscount,
        amount: Math.max(0, Math.round((Number(payment.amount || 0) - voucherDiscount) * 100) / 100)
    };
}

async function applyPointRedemption(req, payment) {
    const requestedPoints = Math.max(0, Math.floor(Number(req.body.redeemPoints || payment.redeemPointsRequested || 0)));

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
    if (req.body.redeemCashback !== 'on' && payment.useCashback !== true) {
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
        trustedPayment.loyalty = await getLoyaltyView(req.session.user.id);
        trustedPayment.rewardRedemption = await getRewardRedemptionView(
            req.session.user.id,
            trustedPayment.merchantId,
            trustedPayment.serviceId,
            trustedPayment.amount
        );
    }

    trustedPayment = await applyVoucherRedemption(req, trustedPayment);
    trustedPayment = await applyPointRedemption(req, trustedPayment);
    trustedPayment = await applyCashbackRedemption(req, trustedPayment);
    trustedPayment.campaignCashback = await getCampaignCashbackEstimate(trustedPayment);

    return trustedPayment;
}

function persistPaidTransaction(payment, paymentMethod) {
    return new Promise((resolve, reject) => {
        Transaction.createPaidTransaction(payment.userId, payment.amount, paymentMethod, payment.items || [], {
            originalAmount: Number(payment.originalAmount || payment.amount || 0),
            cashbackUsed: Number(payment.cashbackRedeemed || 0)
        }, (error, result) => {
            if (error) {
                reject(error);
                return;
            }

            const transactionId = result?.insertId || null;

            if (payment.kind !== 'booking' || !transactionId) {
                resolve(transactionId);
                return;
            }

            Booking.attachTransaction(payment.receiptId, transactionId, (bookingError) => {
                if (bookingError) {
                    reject(bookingError);
                    return;
                }

                resolve(transactionId);
            });
        });
    });
}

function applyPaymentSideEffects(req, payment) {
    if (payment.kind === 'order') {
        const selectedIds = String(payment.selectedItemIds || '').split(',').map((id) => id.trim()).filter(Boolean);

        req.session.cart = selectedIds.length
            ? (req.session.cart || []).filter((item) => !selectedIds.includes(String(item.id)))
            : [];
    }
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

    req.session.receipts = req.session.receipts || {};
    const receipt = {
        id: receiptId,
        displayId: payment.displayId,
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
        paymentMethod,
        paymentStatus: 'paid',
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

async function completeTrustedPayment(req, payment, paymentMethod) {
    const pendingPaymentId = payment.receiptId;
    const transactionId = await persistPaidTransaction(payment, paymentMethod);
    const paidPayment = { ...payment, pendingPaymentId };

    if (payment.kind === 'order' && transactionId) {
        paidPayment.receiptId = `order-${transactionId}`;
        paidPayment.displayId = transactionId;
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
                    if (error || result?.duplicate) {
                        reject(error || new Error('Reward points were already redeemed for this receipt.'));
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
                (error) => error ? reject(error) : resolve()
            );
        });
    }

    if (Number(paidPayment.voucherId || 0) > 0) {
        await new Promise((resolve, reject) => {
            UserVoucher.markRedeemed(paidPayment.voucherId, (error) => error ? reject(error) : resolve());
        });
    }

    applyPaymentSideEffects(req, payment);
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

    await notifyPaymentCompleted(req, paidPayment, transactionId);

    return paidPayment.receiptId;
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

    req.session.pendingNetsPayment = {
        ...trustedPayment,
        txnRetrievalRef,
        netsQrData: qrData,
        isPrototypeQr,
        netsConfirmed: isPrototypeQr
    };

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
        const fallbackRewardRedemption = trustedPayment?.kind === 'booking'
            ? await getRewardRedemptionView(req.session.user.id, trustedPayment.merchantId, trustedPayment.serviceId, trustedPayment.amount)
            : null;
        const fallbackPayment = trustedPayment ? {
            ...trustedPayment,
            rewardRedemption: trustedPayment.rewardRedemption || fallbackRewardRedemption,
            redeemPointsRequested: payment.redeemPoints || trustedPayment.redeemPointsRequested || 0
        } : {
            ...payment,
            availableVouchers: fallbackVouchers,
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
            const receiptId = await completeTrustedPayment(req, trustedPayment, trustedPayment.pointsRedeemed ? 'Rewards' : 'Cashback');
            return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
        } catch (error) {
            console.error(error);
            return renderPaymentForm(res, payment, 'Rewards could not be redeemed. Please try again.');
        }
    }

    const selectedPaymentMethod = req.body.paymentMethod || 'card';

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
        const receiptId = await completeTrustedPayment(req, trustedPayment, getPaymentMethodLabel(selectedPaymentMethod));
        return res.redirect(`/receipt/${encodeURIComponent(receiptId)}`);
    } catch (error) {
        console.error(error);
        return renderPaymentForm(res, payment, 'Payment could not be recorded. Please try again.');
    }
}

async function completeNetsPayment(req, res) {
    const payment = req.session.pendingNetsPayment;

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
        req.session.pendingPayPalOrders[order.id] = {
            ...trustedPayment,
            paypalOrderId: order.id,
            paypalStatus: order.status || 'CREATED'
        };

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
    const pendingPayment = req.session.pendingPayPalOrders?.[orderId];

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

        const receiptId = await completeTrustedPayment(req, {
            ...pendingPayment,
            paypalOrderId: details.orderId,
            paypalCaptureId: details.captureId,
            paypalPayerEmail: details.payerEmail,
            paypalPayerId: details.payerId
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
        req.session.pendingHitPayPayments[request.id] = {
            ...trustedPayment,
            hitpayRequestId: request.id
        };
        storePendingHitPayPayment(request.id, {
            ...trustedPayment,
            hitpayRequestId: request.id
        });
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
    const pendingPayment = getPendingHitPayPayment(req, requestId);
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
    const pendingPayment = getPendingHitPayPayment(req, requestId);
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
    const pendingPayment = getPendingHitPayPayment(req, requestId);

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
        req.session.pendingStripePayments[session.id] = {
            ...trustedPayment,
            stripeSessionId: session.id
        };
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

    const pendingPayment = req.session.pendingStripePayments?.[sessionId];

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

        // Payment succeeded - complete the transaction
        const receiptId = await completeTrustedPayment(req, pendingPayment, 'Stripe');
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

function streamNetsPaymentStatus(req, res) {
    const txn = req.params.txnRetrievalRef;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const pendingPayment = req.session.pendingNetsPayment;
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
