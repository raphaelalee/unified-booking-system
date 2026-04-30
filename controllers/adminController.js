const bcrypt = require('bcrypt');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');

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

        const serviceCount = merchants.reduce((total, merchant) => {
            return total + Number(merchant.service_count || 0);
        }, 0);

        return Booking.getAllInDatabase((bookingError, bookings) => {
            if (bookingError) {
                console.error(bookingError);
            }

            const success = req.session.adminSuccess;
            const error = req.session.adminError;
            req.session.adminSuccess = null;
            req.session.adminError = null;

            return res.render('admin-dashboard', {
                title: 'Admin Dashboard',
                merchants,
                bookings: bookingError ? Booking.getAll() : bookings,
                stats: {
                    merchantCount: merchants.length,
                    serviceCount,
                    bookingCount: bookingError ? Booking.getAll().length : bookings.length
                },
                databaseError: Boolean(bookingError),
                success,
                error
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

module.exports = {
    showDashboard,
    showNewMerchant,
    createMerchant,
    listServices,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService
};
