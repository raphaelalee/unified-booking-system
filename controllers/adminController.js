const bcrypt = require('bcrypt');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Promotion = require('../models/Promotion');
const RewardShop = require('../models/RewardShop');
const RewardVoucher = require('../models/RewardVoucher');
const User = require('../models/User');

function getBookingAmount(booking) {
    return Number(booking.service_price || booking.price || 0);
}

function getUniqueCount(items, getValue) {
    return new Set(items.map(getValue).filter(Boolean)).size;
}

function buildValidationReport({ merchants, bookings, bookingError, userError }) {
    const issues = [];
    const merchantsWithoutServices = merchants.filter((merchant) => Number(merchant.service_count || 0) === 0);
    const merchantsMissingAddress = merchants.filter((merchant) => !merchant.address);
    const merchantsMissingDescription = merchants.filter((merchant) => !merchant.description);

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
            topMerchant
        },
        validationReport: buildValidationReport({ merchants, bookings, bookingError, userError })
    };
}

function getMerchantForm(body = {}) {
    return {
        ownerName: String(body.ownerName || '').trim(),
        email: String(body.email || '').trim().toLowerCase(),
        password: String(body.password || ''),
        salonName: String(body.salonName || '').trim(),
        address: String(body.address || '').trim(),
        description: String(body.description || '').trim(),
        imageUrl: String(body.imageUrl || '').trim()
    };
}

function validateMerchantForm(form) {
    const errors = [];

    if (form.ownerName.length < 2) {
        errors.push('Merchant owner name must be at least 2 characters.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        errors.push('Please enter a valid merchant email.');
    }

    if (form.password.length < 4) {
        errors.push('Password must be at least 4 characters.');
    }

    if (form.salonName.length < 2) {
        errors.push('Salon name must be at least 2 characters.');
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
    return {
        title: String(body.title || '').trim(),
        detail: String(body.detail || '').trim(),
        glintsCost: String(body.glintsCost || '').trim(),
        voucherValue: String(body.voucherValue || '').trim(),
        status: String(body.status || 'active').trim(),
        sortOrder: String(body.sortOrder || '0').trim()
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

    return errors;
}

function buildRewardVoucherPayload(form) {
    return {
        title: form.title,
        detail: form.detail,
        glintsCost: Number(form.glintsCost),
        voucherValue: Number(form.voucherValue),
        status: form.status,
        sortOrder: Number(form.sortOrder)
    };
}

function renderRewardVoucherForm(res, options) {
    return res.status(options.status || 200).render('admin-reward-voucher-form', {
        title: options.title,
        voucher: options.voucher || null,
        form: options.form,
        statuses: RewardVoucher.STATUSES,
        errors: options.errors || []
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

function showDashboard(req, res) {
    return MerchantService.getAdminOverview((merchantError, merchants) => {
        if (merchantError) {
            console.error(merchantError);
            return res.status(500).render('error', {
                title: 'Admin Dashboard Error',
                message: 'Merchant data could not be loaded from the database.'
            });
        }

        return Booking.getAllInDatabase((bookingError, bookings) => {
            if (bookingError) {
                console.error(bookingError);
            }

            return User.getDashboardSummary((userError, userSummary) => {
                if (userError) {
                    console.error(userError);
                }

                const dashboardBookings = bookingError ? Booking.getAll() : bookings;
                const reports = buildAdminReports(
                    merchants,
                    dashboardBookings,
                    userError ? { roleCounts: {}, totalGlints: 0, recentCustomers: [] } : userSummary,
                    Boolean(bookingError),
                    Boolean(userError)
                );
                const success = req.session.adminSuccess;
                const error = req.session.adminError;
                req.session.adminSuccess = null;
                req.session.adminError = null;

                return res.render('admin-dashboard', {
                    title: 'Admin Dashboard',
                    merchants,
                    bookings: dashboardBookings,
                    databaseError: Boolean(bookingError || userError),
                    success,
                    error,
                    ...reports
                });
            });
        });
    });
}

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

    return bcrypt.hash(form.password, 10, (hashError, passwordHash) => {
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
        }, (createError) => {
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
            return res.redirect('/admin');
        });
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
            sortOrder: '0'
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

    return RewardVoucher.create(buildRewardVoucherPayload(form), (createError) => {
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
        return res.redirect('/admin/reward-shop');
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
                sortOrder: String(voucher.sortOrder)
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

        return RewardVoucher.update(voucher.id, buildRewardVoucherPayload(form), (updateError) => {
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
        return res.redirect('/admin/reward-shop');
    });
}

module.exports = {
    showDashboard,
    showNewMerchant,
    createMerchant,
    listServices,
    showNewPromotion,
    createPromotion,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService,
    listPromotions,
    showEditPromotion,
    updatePromotion,
    deletePromotion,
    listRewardVouchers,
    showNewRewardVoucher,
    createRewardVoucher,
    showEditRewardVoucher,
    updateRewardVoucher,
    deleteRewardVoucher,
    updateDailyRewards
};
