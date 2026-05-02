const QRCode = require('qrcode');
const Merchant = require('../models/Merchant');
const MerchantService = require('../models/MerchantService');
const Promotion = require('../models/Promotion');
const Booking = require('../models/Booking');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const { getCartItemCount, getCartLineTotal, getCartQuantity } = require('../utils/cart');
const {
    getMerchantScanPath,
    getMerchantScanUrl,
    verifyMerchantToken
} = require('../utils/qrToken');

function getTodayInputValue() {
    return new Date().toISOString().slice(0, 10);
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

function getBookingPath(merchant, service = null) {
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';
    return `/booking/${merchant.id}/${merchant.qrToken}${serviceQuery}`;
}

function getSecureBookingPath(merchant, service = null) {
    const path = getMerchantScanPath(merchant.id);
    const serviceQuery = service ? `&serviceId=${encodeURIComponent(service.id)}` : '';

    return `${path}${serviceQuery}`;
}

function getBookingUrl(req, merchant, service = null) {
    return `${req.protocol}://${req.get('host')}${getBookingPath(merchant, service)}`;
}

function getSecureBookingUrl(req, merchant, service = null) {
    const serviceQuery = service ? `&serviceId=${encodeURIComponent(service.id)}` : '';

    return `${getMerchantScanUrl(req, merchant.id)}${serviceQuery}`;
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
    const selectedOption = getSelectedServiceOption(service, serviceOptionId);

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

function renderBookingPage(req, res, merchant, options = {}) {
    const selectedPromotion = options.selectedPromotion || getPromotionSelection(req.query);
    const bookingMerchant = applyPromotionAvailability(merchant, selectedPromotion);
    const requestedServiceId = options.form?.serviceId || req.query.serviceId;
    const requestedServiceOptionId = options.form?.serviceOptionId || req.query.serviceOptionId;
    const selectedService = getSelectedService(bookingMerchant, requestedServiceId);
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
        ...(selectedServiceOption ? { serviceOptionId: selectedServiceOption.id } : {})
    };
    const scopedServices = getBookingServices(bookingMerchant, selectedService);
    const useSecureQr = options.secureQr || Boolean(req.params.token || req.query.token);
    const bookingPath = appendQueryParams(
        useSecureQr
            ? getSecureBookingPath(merchant, selectedService)
            : getBookingPath(merchant, selectedService),
        getPromotionQueryParams(selectedPromotion)
    );
    const bookingUrl = appendQueryParams(
        useSecureQr
            ? getSecureBookingUrl(req, merchant, selectedService)
            : getBookingUrl(req, merchant, selectedService),
        getPromotionQueryParams(selectedPromotion)
    );

    return res.status(options.status || 200).render('booking', {
        title: `Book ${merchant.name}`,
        merchant: bookingMerchant,
        scopedServices,
        errors: options.errors || [],
        form: sanitizedForm,
        selectedPromotion,
        selectedServiceId: selectedService ? selectedService.id : null,
        bookingPath,
        bookingUrl,
        encodedBookingUrl: encodeURIComponent(bookingUrl),
        whatsappEnquiryUrl: getWhatsAppEnquiryUrl(merchant, selectedService, bookingUrl),
        todayDate: getTodayInputValue()
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

    return res.status(options.status || 200).render('merchant-detail', {
        title: merchant.name,
        merchant,
        isFavourite: favouriteIds.includes(merchant.id),
        canGenerateQr: Boolean(options.canGenerateQr),
        errors: options.errors || [],
        form: getPrefilledBookingForm(req, options.form || {}),
        todayDate: getTodayInputValue(),
        bookingUrl,
        encodedBookingUrl: encodeURIComponent(bookingUrl),
        whatsappEnquiryUrl: getWhatsAppEnquiryUrl(merchant, null, bookingUrl)
    });
}

function validateBooking(merchant, form) {
    const errors = [];
    const customerName = (form.customerName || '').trim();
    const email = (form.email || '').trim();
    const phone = (form.phone || '').trim();
    const service = getSelectedService(merchant, form.serviceId);
    const serviceSelection = getBookableSelection(service, form.serviceOptionId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = form.bookingDate ? new Date(form.bookingDate) : null;

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

    if (serviceSelection.requiresOption && !serviceSelection.selectedOption) {
        errors.push('Please select a valid service option.');
    }

    if (!form.bookingDate || Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
        errors.push('Please choose today or a future booking date.');
    }

    if (!form.bookingTime || !service || !serviceSelection.bookableItem.slots.includes(form.bookingTime)) {
        errors.push('Please select an available time slot for the selected service.');
    }

    if (service && Booking.hasExistingBooking(merchant.id, service.id, form.bookingDate, form.bookingTime)) {
        errors.push('This slot is already booked. Please choose another time.');
    }

    const serviceName = serviceSelection.selectedOption
        ? `${service.name} - ${serviceSelection.selectedOption.name}`
        : service?.name;

    return {
        errors,
        service,
        selectedOption: serviceSelection.selectedOption,
        bookableItem: serviceSelection.bookableItem,
        serviceName,
        customerName,
        email,
        phone
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
    res.render('home', {
        title: 'Vaniday',
        merchants: Merchant.getAll(),
        success: req.session.success,
        showChatbot: true
    });
    req.session.success = null;
}

function showServices(req, res) {
    const search = req.query.search || '';
    const favouriteIds = req.session.favouriteMerchantIds || [];
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const serviceCatalog = Merchant.getServiceCatalog(search).map((service) => ({
        ...service,
        serviceBookingUrl: `${baseUrl}${service.serviceBookingPath}`
    }));

    res.render('services', {
        title: 'Services',
        merchants: Merchant.getAll(search),
        favouriteIds,
        serviceCatalog,
        portalStats: Merchant.getPortalStats(search),
        search,
        showChatbot: true
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
            getMerchantScanPath(promotion.salonId),
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

            callback(null, offers);
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

        const bookingUrl = getMerchantScanUrl(req, merchant.id);

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
                qrCodeDataUrl
            });
        });
    });
}

function showBookingPage(req, res) {
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

        if (!req.session.user) {
            return renderBookingPage(req, res, merchant, {
                status: 401,
                errors: ['Please log in before confirming a booking.'],
                form: req.body
            });
        }

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
            userId: req.session.user.id,
            merchantId: merchant.id,
            merchantName: merchant.name,
            serviceId: validation.service.id,
            serviceName: validation.serviceName,
            customerName: validation.customerName,
            email: validation.email,
            phone: validation.phone,
            bookingDate: req.body.bookingDate,
            bookingTime: req.body.bookingTime,
            qrCodeToken: req.params.qrToken
        };

        return Booking.hasExistingBookingInDatabase(merchant.id, validation.service.id, req.body.bookingDate, req.body.bookingTime, (lookupError, exists) => {
            if (lookupError) {
                console.error(lookupError);
                return renderBookingPage(req, res, merchant, {
                    status: 500,
                    errors: ['Booking availability could not be checked. Please try again.'],
                    form: req.body
                });
            }

            if (exists) {
                return renderBookingPage(req, res, merchant, {
                    status: 400,
                    errors: ['This slot is already booked. Please choose another time.'],
                    form: req.body
                });
            }

            return Booking.createInDatabase(bookingData, (error, result) => {
                if (error) {
                    console.error(error);
                    return renderBookingPage(req, res, merchant, {
                        status: 500,
                        errors: ['Booking could not be saved. Please try again.'],
                        form: req.body
                    });
                }

                const finishSuccess = () => res.render('booking-success', {
                    title: 'Booking Confirmed',
                    merchant,
                    service: {
                        ...validation.service,
                        name: validation.serviceName,
                        duration: validation.bookableItem.duration,
                        price: validation.bookableItem.price
                    },
                    bookingDate: req.body.bookingDate,
                    bookingTime: req.body.bookingTime,
                    whatsappConfirmationUrl: getWhatsAppUrl(buildWhatsAppBookingMessage({
                        merchant,
                        service: { name: validation.serviceName },
                        bookingDate: req.body.bookingDate,
                        bookingTime: req.body.bookingTime,
                        customerName: validation.customerName,
                        phone: validation.phone,
                        bookingUrl: getBookingUrl(req, merchant, validation.service)
                    }))
                });

                if (promotionRecord?.id) {
                    return Promotion.createRedemption({
                        promotionId: promotionRecord.id,
                        userId: req.session.user.id,
                        bookingId: result?.insertId || null,
                        status: 'used'
                    }, (redemptionError) => {
                        if (redemptionError) {
                            console.error(redemptionError);
                        }

                        return finishSuccess();
                    });
                }

                return finishSuccess();
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

        if (!req.session.user) {
            return renderBookingPage(req, res, merchant, {
                status: 401,
                errors: ['Please log in before confirming a booking.'],
                form: req.body,
                secureQr: true
            });
        }

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
                userId: req.session.user.id,
                merchantId: merchant.id,
                merchantName: merchant.name,
                serviceId: validation.service.id,
                serviceName: validation.serviceName,
                customerName: validation.customerName,
                email: validation.email,
                phone: validation.phone,
                bookingDate: req.body.bookingDate,
                bookingTime: req.body.bookingTime,
                qrCodeToken: req.query.token
            };

            return Booking.hasExistingBookingInDatabase(merchant.id, validation.service.id, req.body.bookingDate, req.body.bookingTime, (bookingError, exists) => {
                if (bookingError) {
                    console.error(bookingError);
                    return renderBookingPage(req, res, merchant, {
                        status: 500,
                        errors: ['Booking availability could not be checked. Please try again.'],
                        form: req.body,
                        secureQr: true
                    });
                }

                if (exists) {
                    return renderBookingPage(req, res, merchant, {
                        status: 400,
                        errors: ['This slot is already booked. Please choose another time.'],
                        form: req.body,
                        secureQr: true
                    });
                }

                return Booking.createInDatabase(bookingData, (error, result) => {
                    if (error) {
                        console.error(error);
                        return renderBookingPage(req, res, merchant, {
                            status: 500,
                            errors: ['Booking could not be saved. Please try again.'],
                            form: req.body,
                            secureQr: true
                        });
                    }

                    const finishSuccess = () => res.render('booking-success', {
                        title: 'Booking Confirmed',
                        merchant,
                        service: {
                            ...validation.service,
                            name: validation.serviceName,
                            duration: validation.bookableItem.duration,
                            price: validation.bookableItem.price
                        },
                        bookingDate: req.body.bookingDate,
                        bookingTime: req.body.bookingTime,
                        anotherBookingPath: getSecureBookingPath(merchant),
                        whatsappConfirmationUrl: getWhatsAppUrl(buildWhatsAppBookingMessage({
                            merchant,
                            service: { name: validation.serviceName },
                            bookingDate: req.body.bookingDate,
                            bookingTime: req.body.bookingTime,
                            customerName: validation.customerName,
                            phone: validation.phone,
                            bookingUrl: getSecureBookingUrl(req, merchant, validation.service)
                        }))
                    });

                    if (promotionRecord?.id) {
                        return Promotion.createRedemption({
                            promotionId: promotionRecord.id,
                            userId: req.session.user.id,
                            bookingId: result?.insertId || null,
                            status: 'used'
                        }, (redemptionError) => {
                            if (redemptionError) {
                                console.error(redemptionError);
                            }

                            return finishSuccess();
                        });
                    }

                    return finishSuccess();
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

    Booking.create({
        merchantId: merchant.id,
        merchantName: merchant.name,
        serviceId: validation.service.id,
        serviceName: validation.serviceName,
        customerName: validation.customerName,
        email: validation.email,
        phone: validation.phone,
        bookingDate: req.body.bookingDate,
        bookingTime: req.body.bookingTime
    });

    req.session.success = `Booking request received for ${validation.serviceName} at ${merchant.name} on ${req.body.bookingDate}, ${req.body.bookingTime}.`;
    return res.redirect('/');
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
    req.session.cart.push({
        id: Date.now(),
        merchantId: merchant.id,
        merchantName: merchant.name,
        merchantQrToken: merchant.qrToken,
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: service.price
    });

    req.session.success = `${service.name} was added to your cart.`;
    return res.redirect('/cart');
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
                merchantName: product.category,
                serviceId: product.id,
                serviceName: product.name,
                duration: product.description,
                price: product.price,
                quantity: 1
            });
        }

        req.session.success = `${product.name} was added to your cart.`;
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
    req.session.success = null;

    return res.render('cart', {
        title: 'Cart',
        cart,
        total,
        itemCount,
        success
    });
}

function checkout(req, res) {
    const selectedIds = Array.isArray(req.body.selectedItemIds)
        ? req.body.selectedItemIds
        : (req.body.selectedItemIds || '').toString().split(',').filter(Boolean);

    const cart = (req.session.cart || []).map((item) => {
        const quantity = getCartQuantity(item);
        const lineTotal = getCartLineTotal(item);
        return { ...item, quantity, lineTotal };
    });

    const selectedItems = cart.filter((item) => selectedIds.length === 0 || selectedIds.includes(String(item.id)));
    const amount = selectedItems.reduce((sum, i) => sum + Number(i.lineTotal || 0), 0);

    const fulfilment = req.body.fulfilment || 'pickup';
    const pickupMerchantId = req.body.pickupMerchantId || '';
    const deliveryAddress = req.body.deliveryAddress || '';
    const deliveryUnit = req.body.deliveryUnit || '';
    const deliveryPostal = req.body.deliveryPostal || '';
    const deliveryPhone = req.body.deliveryPhone || '';

    return res.render('payment', {
        title: 'Payment',
        amount,
        merchantName: fulfilment === 'pickup' ? (pickupMerchantId || 'Vaniday') : 'Delivery',
        serviceName: 'Cart checkout',
        cartItemId: '',
        cartCheckout: true,
        selectedItemIds: selectedIds,
        fulfilment,
        pickupMerchantId,
        deliveryAddress,
        deliveryUnit,
        deliveryPostal,
        deliveryPhone
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

function showPayment(req, res) {
    const amount = Number(req.query.amount || 0);
    const merchantName = req.query.merchant || 'Vaniday';
    const serviceName = req.query.service || 'Booking';
    const cartItemId = req.query.cartItemId || '';
    const cartCheckout = req.query.cartCheckout === 'true';

    return res.render('payment', {
        title: 'Payment',
        amount,
        merchantName,
        serviceName,
        cartItemId,
        cartCheckout,
        selectedItemIds: [],
        fulfilment: '',
        pickupMerchantId: '',
        deliveryAddress: '',
        deliveryUnit: '',
        deliveryPostal: '',
        deliveryPhone: ''
    });
}

function confirmPayment(req, res) {
    const amount = Number(req.body.amount || 0);
    const selectedIds = (req.body.selectedItemIds || '').toString().split(',').filter(Boolean);
    const cart = req.session.cart || [];
    const paidItems = req.body.cartCheckout === 'true'
        ? cart.filter((item) => selectedIds.length === 0 || selectedIds.includes(String(item.id)))
        : cart.filter((item) => String(item.id) === String(req.body.cartItemId));

    if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).render('error', {
            title: 'Payment Error',
            message: 'Payment amount must be greater than zero.'
        });
    }

    return Transaction.createPaidTransaction(req.session.user.id, amount, 'card', paidItems, (transactionError) => {
        if (transactionError) {
            console.error(transactionError);
            return res.status(500).render('error', {
                title: 'Payment Error',
                message: 'Payment could not be recorded. Please try again.'
            });
        }

        if (req.body.cartCheckout === 'true') {
            req.session.cart = selectedIds.length === 0
                ? []
                : cart.filter((item) => !selectedIds.includes(String(item.id)));
        } else if (req.body.cartItemId) {
            req.session.cart = cart.filter((item) => String(item.id) !== String(req.body.cartItemId));
        }

        return res.render('payment-success', {
            title: 'Payment Successful',
            amount: req.body.amount,
            merchantName: req.body.merchantName,
            serviceName: req.body.serviceName
        });
    });
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
    showBookingPage,
    showPublicMerchantBooking,
    showSecureScanBooking,
    saveQrBooking,
    saveSecureScanBooking,
    createBooking,
    addToCart,
    addProductToCart,
    showCart,
    checkout,
    deleteSelectedCartItems,
    removeFromCart,
    updateCartItem,
    toggleFavouriteMerchant,
    showPayment,
    confirmPayment
};
