const QRCode = require('qrcode');
const Merchant = require('../models/Merchant');
const MerchantService = require('../models/MerchantService');
const Promotion = require('../models/Promotion');
const Booking = require('../models/Booking');
const Product = require('../models/Product');
const { requestNetsQr, createPrototypeNetsQr, createSandboxTxnId, isQrSuccess, checkStatus } = require('../services/nets');
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
        promoCampaign: promotion.campaignLabel,
        promoTitle: promotion.title || promotion.name,
        promoPrice: promotion.price,
        promoOriginalPrice: promotion.originalPrice,
        promoDiscountPercent: promotion.discountPercent
    };
}

function getPromotionSelection(query = {}) {
    if (query.source !== 'promotions') {
        return null;
    }

    const campaignLabel = (query.promoCampaign || '').trim();
    const title = (query.promoTitle || '').trim();
    const price = Number(query.promoPrice);
    const originalPrice = Number(query.promoOriginalPrice);
    const discountPercent = Number(query.promoDiscountPercent);

    if (!campaignLabel && !title) {
        return null;
    }

    return {
        campaignLabel,
        title,
        price: Number.isFinite(price) ? price : null,
        originalPrice: Number.isFinite(originalPrice) ? originalPrice : null,
        discountPercent: Number.isFinite(discountPercent) ? discountPercent : null
    };
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

function renderBookingPage(req, res, merchant, options = {}) {
    const requestedServiceId = options.form?.serviceId || req.query.serviceId;
    const requestedServiceOptionId = options.form?.serviceOptionId || req.query.serviceOptionId;
    const selectedService = getSelectedService(merchant, requestedServiceId);
    const selectedServiceOption = selectedService
        ? getSelectedServiceOption(selectedService, requestedServiceOptionId)
        : null;
    const selectedPromotion = options.selectedPromotion || getPromotionSelection(req.query);

    if (requestedServiceId && !selectedService) {
        return res.status(404).render('error', {
            title: 'Service Not Found',
            message: 'This service does not belong to the selected merchant.'
        });
    }

    if (requestedServiceOptionId && selectedService && !selectedServiceOption) {
        return res.status(404).render('error', {
            title: 'Service Option Not Found',
            message: 'This service option does not belong to the selected service.'
        });
    }

    const form = {
        ...getPrefilledBookingForm(req, options.form || {}),
        ...(selectedService ? { serviceId: selectedService.id } : {}),
        ...(selectedServiceOption ? { serviceOptionId: selectedServiceOption.id } : {})
    };
    const scopedServices = getBookingServices(merchant, selectedService);
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
        merchant,
        scopedServices,
        errors: options.errors || [],
        form,
        selectedPromotion,
        selectedServiceId: selectedService ? selectedService.id : null,
        bookingPath,
        bookingUrl,
        encodedBookingUrl: encodeURIComponent(bookingUrl),
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
        encodedBookingUrl: encodeURIComponent(bookingUrl)
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
                serviceId: service.id,
                promoCampaign: getPromotionLabel(promotion.type),
                promoTitle: promotion.title,
                promoPrice: pricing.price,
                promoOriginalPrice: pricing.originalPrice,
                promoDiscountPercent: pricing.discountPercent
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
    const merchant = Merchant.findById(req.params.merchantId);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant booking page could not be found.'
        });
    }

    if (rejectInvalidQrToken(req, res, merchant)) {
        return null;
    }

    if (!req.params.qrToken) {
        return res.redirect(getBookingPath(merchant, getSelectedService(merchant, req.query.serviceId)));
    }

    return renderBookingPage(req, res, merchant);
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
    const merchant = Merchant.findById(req.params.merchantId);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant booking page could not be found.'
        });
    }

    if (rejectInvalidQrToken(req, res, merchant)) {
        return null;
    }

    if (!req.params.qrToken) {
        return res.status(400).render('error', {
            title: 'Invalid Booking QR',
            message: 'Booking requests must use this merchant-specific QR booking link.'
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

    if (!req.session.user) {
        return renderBookingPage(req, res, merchant, {
            status: 401,
            errors: ['Please log in before confirming a booking.'],
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

    Booking.hasExistingBookingInDatabase(merchant.id, validation.service.id, req.body.bookingDate, req.body.bookingTime, (lookupError, exists) => {
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

        return Booking.createInDatabase(bookingData, (error) => {
            if (error) {
                console.error(error);
                return renderBookingPage(req, res, merchant, {
                    status: 500,
                    errors: ['Booking could not be saved. Please try again.'],
                    form: req.body
                });
            }

            return res.render('booking-success', {
                title: 'Booking Confirmed',
                merchant,
                service: {
                    ...validation.service,
                    name: validation.serviceName,
                    duration: validation.bookableItem.duration,
                    price: validation.bookableItem.price
                },
                bookingDate: req.body.bookingDate,
                bookingTime: req.body.bookingTime
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

            return Booking.createInDatabase(bookingData, (error) => {
                if (error) {
                    console.error(error);
                    return renderBookingPage(req, res, merchant, {
                        status: 500,
                        errors: ['Booking could not be saved. Please try again.'],
                        form: req.body,
                        secureQr: true
                    });
                }

                return res.render('booking-success', {
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
                    anotherBookingPath: getSecureBookingPath(merchant)
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
        merchantName: fulfilment === 'pickup'
            ? (pickupMerchantId === 'any' ? 'Any merchant' : pickupMerchantId || 'Vaniday')
            : 'Delivery',
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
        deliveryPhone: '',
        error: null
    });
}

function getPaymentPayload(body = {}) {
    return {
        amount: Number(body.amount || 0),
        merchantName: body.merchantName || 'Vaniday',
        serviceName: body.serviceName || 'Booking',
        cartItemId: body.cartItemId || '',
        cartCheckout: body.cartCheckout === 'true',
        selectedItemIds: String(body.selectedItemIds || ''),
        fulfilment: body.fulfilment || '',
        pickupMerchantId: body.pickupMerchantId || '',
        deliveryAddress: body.deliveryAddress || '',
        deliveryUnit: body.deliveryUnit || '',
        deliveryPostal: body.deliveryPostal || '',
        deliveryPhone: body.deliveryPhone || ''
    };
}

function applyPaymentSideEffects(req, payment) {
    if (payment.cartCheckout) {
        if (payment.selectedItemIds) {
            const selectedIds = payment.selectedItemIds.split(',').map((id) => id.trim()).filter(Boolean);
            req.session.cart = (req.session.cart || []).filter((item) => !selectedIds.includes(String(item.id)));
        } else {
            req.session.cart = [];
        }
    } else if (payment.cartItemId) {
        req.session.cart = (req.session.cart || []).filter((item) => String(item.id) !== String(payment.cartItemId));
    }
}

function renderPaymentForm(res, payment, error = null) {
    return res.status(error ? 400 : 200).render('payment', {
        title: 'Payment',
        ...payment,
        error
    });
}

async function getNetsQrImage(qrCode) {
    if (!qrCode) {
        return '';
    }

    if (/^data:image\//i.test(qrCode) || /^https?:\/\//i.test(qrCode)) {
        return qrCode;
    }

    if (/^iVBOR/i.test(qrCode)) {
        return `data:image/png;base64,${qrCode}`;
    }

    return QRCode.toDataURL(qrCode, { errorCorrectionLevel: 'M', margin: 2, width: 280 });
}

async function confirmPayment(req, res) {
    const payment = getPaymentPayload(req.body);

    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        return renderPaymentForm(res, payment, 'Payment amount is invalid.');
    }

    if (req.body.paymentMethod === 'nets') {
        let qrData;
        let netsError = null;

        try {
            const txnId = createSandboxTxnId();
            try {
                qrData = await requestNetsQr(payment.amount, txnId);
            } catch (error) {
                netsError = error;
                console.error(error);
                qrData = createPrototypeNetsQr(payment.amount, txnId);
            }

            if (!isQrSuccess(qrData)) {
                throw new Error(`NETS QR was not accepted: ${JSON.stringify(qrData)}`);
            }

            req.session.pendingNetsPayment = {
                ...payment,
                txnId,
                txnRetrievalRef: qrData.txn_retrieval_ref
            };

            return res.render('netsQR', {
                title: 'NETS QR Payment',
                total: payment.amount,
                qrCodeUrl: await getNetsQrImage(qrData.qr_code),
                txnRetrievalRef: qrData.txn_retrieval_ref,
                isPrototypeQr: Boolean(qrData.prototype),
                netsErrorMessage: netsError ? netsError.message : null,
                completeUrl: '/nets/complete',
                failCompleteUrl: '/nets/complete-fail',
                successRedirect: '/payment/success',
                failRedirect: '/nets-qr/fail',
                backPrimaryUrl: '/cart',
                backPrimaryLabel: 'Back to cart',
                backSecondaryUrl: '/services',
                backSecondaryLabel: 'Browse services'
            });
        } catch (error) {
            console.error(error);
            return res.status(500).render('netsQRfail', {
                title: 'NETS Payment Failed',
                errorMsg: 'NETS QR code could not be generated. Please try again.'
            });
        }
    }

    applyPaymentSideEffects(req, payment);

    return res.render('payment-success', {
        title: 'Payment Successful',
        amount: payment.amount,
        merchantName: payment.merchantName,
        serviceName: payment.serviceName
    });
}

function completeNetsPayment(req, res) {
    const payment = req.session.pendingNetsPayment;

    if (!payment) {
        return res.status(400).json({ ok: false });
    }

    applyPaymentSideEffects(req, payment);
    req.session.lastPayment = payment;
    req.session.pendingNetsPayment = null;

    return res.json({ ok: true });
}

function failNetsPayment(req, res) {
    req.session.pendingNetsPayment = null;
    return res.json({ ok: true });
}

function showNetsFail(req, res) {
    return res.render('netsQRfail', {
        title: 'NETS Payment Failed',
        errorMsg: 'NETS payment failed or expired. Please try again.'
    });
}

function showPaymentSuccess(req, res) {
    const payment = req.session.lastPayment;

    if (!payment) {
        return res.redirect('/cart');
    }

    req.session.lastPayment = null;

    return res.render('payment-success', {
        title: 'Payment Successful',
        amount: payment.amount,
        merchantName: payment.merchantName,
        serviceName: payment.serviceName
    });
}

function streamNetsPaymentStatus(req, res) {
    const txnRetrievalRef = req.params.txnRetrievalRef;
    let checks = 0;

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    });
    res.flushHeaders?.();

    const send = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    if (String(txnRetrievalRef).startsWith('PROTO-')) {
        setTimeout(() => {
            send({ success: true, prototype: true });
            res.end();
        }, 2500);
        return;
    }

    const interval = setInterval(async () => {
        checks += 1;

        try {
            const result = await checkStatus(txnRetrievalRef);

            if (result.status === 'SUCCESS') {
                send({ success: true });
                clearInterval(interval);
                res.end();
                return;
            }

            if (result.status === 'FAIL') {
                send({ fail: true });
                clearInterval(interval);
                res.end();
                return;
            }

            send({ pending: true });
        } catch (error) {
            console.error(error);
            send({ pending: true });
        }

        if (checks >= 40) {
            send({ pending: true, timeout: true });
            clearInterval(interval);
            res.end();
        }
    }, 3000);

    req.on('close', () => {
        clearInterval(interval);
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
    confirmPayment,
    completeNetsPayment,
    failNetsPayment,
    showNetsFail,
    showPaymentSuccess,
    streamNetsPaymentStatus
};
