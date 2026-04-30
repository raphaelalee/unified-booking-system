const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');

function getBookingAmount(booking) {
    return Number(booking.service_price || booking.price || 0);
}

function getUniqueCount(items, getValue) {
    return new Set(items.map(getValue).filter(Boolean)).size;
}

function buildMerchantReports(merchant, bookings, bookingError) {
    const services = merchant.services || [];
    const slotCount = services.reduce((total, service) => total + (service.slots || []).length, 0);
    const prices = services.map((service) => Number(service.price)).filter(Number.isFinite);
    const validationIssues = [];

    if (bookingError) {
        validationIssues.push('Booking records could not be loaded from the database. Service reporting is still available.');
    }

    if (services.length === 0) {
        validationIssues.push('No services have been created for this merchant yet.');
    }

    services.forEach((service) => {
        if (!service.description) {
            validationIssues.push(`${service.name} is missing a customer-facing description.`);
        }

        if (!Array.isArray(service.slots) || service.slots.length === 0) {
            validationIssues.push(`${service.name} has no available slots.`);
        }

        if (!Number.isFinite(Number(service.price)) || Number(service.price) <= 0) {
            validationIssues.push(`${service.name} needs a valid price above $0.`);
        }
    });

    return {
        stats: {
            serviceCount: services.length,
            slotCount,
            bookingCount: bookings.length,
            customerCount: getUniqueCount(bookings, (booking) => booking.email),
            bookingRevenue: bookings.reduce((sum, booking) => sum + getBookingAmount(booking), 0),
            averagePrice: prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0
        },
        customerReport: {
            totalCustomers: getUniqueCount(bookings, (booking) => booking.email),
            recentBookings: bookings.slice(0, 6)
        },
        merchantReport: {
            serviceCount: services.length,
            slotCount,
            categoryCount: getUniqueCount(services, (service) => service.category),
            topService: services.reduce((top, service) => {
                return Number(service.price || 0) > Number(top?.price || 0) ? service : top;
            }, null)
        },
        validationReport: {
            issues: validationIssues,
            status: validationIssues.length === 0 ? 'Healthy' : 'Needs Review'
        },
        databaseError: Boolean(bookingError)
    };
}

function renderMerchantLookupError(res, error, merchant) {
    if (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Merchant Portal Error',
            message: 'Merchant data could not be loaded from the database.'
        });
    }

    if (!merchant) {
        return res.status(403).render('error', {
            title: 'Merchant Not Assigned',
            message: 'Your merchant account is not assigned to a salon in the database yet.'
        });
    }

    return null;
}

function getServiceForm(body = {}) {
    return {
        name: String(body.name || '').trim(),
        description: String(body.description || '').trim(),
        categoryId: String(body.categoryId || '').trim(),
        durationMins: String(body.durationMins || '').trim(),
        price: String(body.price || '').trim(),
        slots: String(body.slots || '').trim()
    };
}

function validateServiceForm(form) {
    const errors = [];
    const categoryId = Number(form.categoryId);
    const durationMins = Number(form.durationMins);
    const price = Number(form.price);
    const slots = form.slots.split(',').map((slot) => slot.trim()).filter(Boolean);

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

function showDashboard(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Booking.getByMerchantUserId(req.session.user.id, (bookingError, bookings) => {
            if (bookingError) {
                console.error(bookingError);
            }

            const reports = buildMerchantReports(merchant, bookingError ? [] : bookings, Boolean(bookingError));
            const success = req.session.merchantSuccess;
            const error = req.session.merchantError;
            req.session.merchantSuccess = null;
            req.session.merchantError = null;

            return res.render('merchant-dashboard', {
                title: 'Merchant Dashboard',
                merchant,
                bookings: bookingError ? [] : bookings,
                success,
                error,
                ...reports
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

            return res.render('merchant-service-form', {
                title: 'Add Service',
                merchant,
                categories,
                service: null,
                form: getServiceForm(),
                errors: []
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
        const errors = validateServiceForm(form);

        return MerchantService.getCategories((categoryError, categories) => {
            if (categoryError) {
                console.error(categoryError);
                return res.status(500).render('error', {
                    title: 'Categories Not Found',
                    message: 'Service categories could not be loaded.'
                });
            }

            if (errors.length > 0) {
                return res.status(400).render('merchant-service-form', {
                    title: 'Add Service',
                    merchant,
                    categories,
                    service: null,
                    form,
                    errors
                });
            }

            return MerchantService.createService(req.session.user.id, {
                name: form.name,
                description: form.description,
                categoryId: Number(form.categoryId),
                durationMins: Number(form.durationMins),
                price: Number(form.price),
                slots: form.slots
            }, (createError) => {
                if (createError) {
                    console.error(createError);
                    return res.status(500).render('merchant-service-form', {
                        title: 'Add Service',
                        merchant,
                        categories,
                        service: null,
                        form,
                        errors: ['Service could not be created. Please check the category and timeslots.']
                    });
                }

                req.session.merchantSuccess = 'Service created successfully.';
                return res.redirect('/merchant/services');
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

                return res.render('merchant-service-form', {
                    title: 'Edit Service',
                    merchant,
                    categories,
                    service,
                    form: {
                        name: service.name,
                        description: service.description,
                        categoryId: String(service.categoryId),
                        durationMins: String(service.durationMins),
                        price: String(service.price),
                        slots: (service.slots || []).join(', ')
                    },
                    errors: []
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
            const errors = validateServiceForm(form);

            return MerchantService.getCategories((categoryError, categories) => {
                if (categoryError) {
                    console.error(categoryError);
                    return res.status(500).render('error', {
                        title: 'Categories Not Found',
                        message: 'Service categories could not be loaded.'
                    });
                }

                if (errors.length > 0) {
                    return res.status(400).render('merchant-service-form', {
                        title: 'Edit Service',
                        merchant,
                        categories,
                        service,
                        form,
                        errors
                    });
                }

                return MerchantService.updateService(req.session.user.id, service.id, {
                    name: form.name,
                    description: form.description,
                    categoryId: Number(form.categoryId),
                    durationMins: Number(form.durationMins),
                    price: Number(form.price),
                    slots: form.slots
                }, (updateError) => {
                    if (updateError) {
                        console.error(updateError);
                        return res.status(500).render('merchant-service-form', {
                            title: 'Edit Service',
                            merchant,
                            categories,
                            service,
                            form,
                            errors: ['Service could not be updated. Please check the category and timeslots.']
                        });
                    }

                    req.session.merchantSuccess = 'Service updated successfully.';
                    return res.redirect('/merchant/services');
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

module.exports = {
    showDashboard,
    showServices: showDashboard,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService
};
