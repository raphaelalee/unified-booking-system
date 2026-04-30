const QRCode = require('qrcode');
const MerchantService = require('../models/MerchantService');
const Booking = require('../models/Booking');
const Product = require('../models/Product');
const Promotion = require('../models/Promotion');
const { getMerchantScanUrl } = require('../utils/qrToken');

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

function formatDateTimeLocalValue(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const pad = (part) => String(part).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function getProductForm(body = {}) {
    return {
        name: String(body.name || '').trim(),
        price: String(body.price || '').trim(),
        stockQuantity: String(body.stockQuantity || body.stock_quantity || '').trim(),
        imageUrl: String(body.imageUrl || body.image_url || '').trim()
    };
}

function getPromotionForm(body = {}) {
    return {
        title: String(body.title || '').trim(),
        serviceId: String(body.serviceId || '').trim(),
        type: String(body.type || '').trim(),
        discountType: String(body.discountType || '').trim(),
        discountValue: String(body.discountValue || '').trim(),
        startDate: String(body.startDate || '').trim(),
        endDate: String(body.endDate || '').trim(),
        status: String(body.status || '').trim(),
        description: String(body.description || '').trim(),
        terms: String(body.terms || '').trim()
    };
}

function validatePromotionForm(form, merchant) {
    const errors = [];
    const serviceId = form.serviceId ? Number(form.serviceId) : null;
    const discountValue = form.discountValue === '' ? null : Number(form.discountValue);
    const startDate = form.startDate ? new Date(form.startDate) : null;
    const endDate = form.endDate ? new Date(form.endDate) : null;
    const merchantServiceIds = new Set((merchant.services || []).map((service) => Number(service.id)));

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

    if (!Promotion.PROMOTION_STATUSES.includes(form.status)) {
        errors.push('Please choose a valid promotion status.');
    }

    return errors;
}

function buildPromotionPayload(form) {
    return {
        title: form.title,
        serviceId: form.serviceId ? Number(form.serviceId) : null,
        type: form.type,
        discountType: form.discountType,
        discountValue: form.discountType === 'tag_only' || form.discountValue === '' ? null : Number(form.discountValue),
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
        description: form.description,
        terms: form.terms
    };
}

function validateProductForm(form) {
    const errors = [];
    const price = Number(form.price);
    const stockQuantity = Number(form.stockQuantity);

    if (form.name.length < 2) {
        errors.push('Product name must be at least 2 characters.');
    }

    if (!Number.isFinite(price) || price < 0) {
        errors.push('Please enter a valid product price.');
    }

    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        errors.push('Please enter a valid stock quantity.');
    }

    if (form.imageUrl && !/^https?:\/\/.+/i.test(form.imageUrl)) {
        errors.push('Image URL must start with http:// or https://.');
    }

    return errors;
}

function buildMerchantReports(merchant, bookings = [], hadError = false) {
    return {
        totalBookings: bookings.length,
        recentBookings: Array.isArray(bookings) ? bookings.slice(0, 5) : [],
        hasError: Boolean(hadError)
    };
}

function showServices(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return Booking.getByMerchantUserId(req.session.user.id, (bookingError, bookings) => {
            if (bookingError) {
                console.error(bookingError);
            }

            return Promotion.getByMerchantUserId(req.session.user.id, (promotionError, promotions) => {
                if (promotionError) {
                    console.error(promotionError);
                }

                const safeBookings = bookingError ? [] : bookings || [];
                const safePromotions = promotionError ? [] : promotions || [];
                const serviceCount = Array.isArray(merchant.services) ? merchant.services.length : 0;
                const slotCount = Array.isArray(merchant.services)
                    ? merchant.services.reduce((total, svc) => total + ((Array.isArray(svc.slots) ? svc.slots.length : 0)), 0)
                    : 0;
                const bookingRevenue = safeBookings.reduce((total, booking) => {
                    return total + Number(booking.service_price || booking.price || 0);
                }, 0);
                const uniqueCustomers = new Set(safeBookings.map((booking) => booking.customer_email || booking.email || booking.customerName || booking.customer_name)).size;
                const averagePrice = serviceCount > 0
                    ? merchant.services.reduce((total, service) => total + Number(service.price || 0), 0) / serviceCount
                    : 0;
                const topService = Array.isArray(merchant.services)
                    ? merchant.services.reduce((top, service) => {
                        const servicePrice = Number(service.price || 0);
                        return servicePrice > Number(top?.price || 0) ? service : top;
                    }, null)
                    : null;
                const validationIssues = [];

                if (!merchant.location && !merchant.address) {
                    validationIssues.push('Merchant location is not configured yet.');
                }
                if (serviceCount === 0) {
                    validationIssues.push('No services are active. Add a service to start booking customers.');
                }
                if (bookingError) {
                    validationIssues.push('Booking records could not be loaded, so customer reporting is temporarily limited.');
                }
                if (promotionError) {
                    validationIssues.push('Promotion records could not be loaded, so promotion reporting is temporarily limited.');
                }

                const reports = {
                    stats: {
                        serviceCount,
                        slotCount,
                        bookingCount: safeBookings.length,
                        customerCount: uniqueCustomers,
                        bookingRevenue,
                        averagePrice,
                        promotionCount: safePromotions.length
                    },
                    customerReport: {
                        totalCustomers: uniqueCustomers,
                        recentBookings: safeBookings.slice(0, 5)
                    },
                    merchantReport: {
                        categoryCount: Array.isArray(merchant.services)
                            ? new Set(merchant.services.map((service) => service.category || '')).size
                            : 0,
                        slotCount,
                        serviceCount,
                        topService
                    },
                    validationReport: {
                        issues: validationIssues,
                        status: validationIssues.length === 0 ? 'Healthy' : 'Needs Review'
                    }
                };

                const success = req.session.merchantSuccess;
                const error = req.session.merchantError;
                req.session.merchantSuccess = null;
                req.session.merchantError = null;

                return res.render('merchant-dashboard', {
                    title: 'Merchant Services',
                    merchant,
                    promotions: safePromotions,
                    success,
                    error,
                    databaseError: Boolean(bookingError || promotionError),
                    stats: reports.stats,
                    customerReport: reports.customerReport,
                    merchantReport: reports.merchantReport,
                    validationReport: reports.validationReport,
                    qrCodeDataUrl: null,
                    qrBookingUrl: null
                });
            });
        });
    });
}

function generateQr(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const qrBookingUrl = getMerchantScanUrl(req, merchant.id);

        return QRCode.toDataURL(qrBookingUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 280
        }, (qrError, qrCodeDataUrl) => {
            if (qrError) {
                console.error(qrError);
                return res.status(500).render('merchant-dashboard', {
                    title: 'Merchant Services',
                    merchant,
                    success: null,
                    error: 'QR code could not be generated. Please try again.',
                    qrCodeDataUrl: null,
                    qrBookingUrl: null
                });
            }

            return res.render('merchant-dashboard', {
                title: 'Merchant Services',
                merchant,
                success: 'Merchant QR code generated.',
                error: null,
                qrCodeDataUrl,
                qrBookingUrl
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

            return res.render('merchant-products', {
                title: 'Merchant Products',
                merchant,
                products,
                success,
                error
            });
        });
    });
}

function showNewProduct(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        return res.render('merchant-product-form', {
            title: 'Add Product',
            merchant,
            product: null,
            form: getProductForm(),
            errors: []
        });
    });
}

function createProduct(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const form = getProductForm(req.body);
        const errors = validateProductForm(form);

        if (errors.length > 0) {
            return res.status(400).render('merchant-product-form', {
                title: 'Add Product',
                merchant,
                product: null,
                form,
                errors
            });
        }

        return Product.createForMerchant(req.session.user.id, {
            name: form.name,
            price: Number(form.price),
            stockQuantity: Number(form.stockQuantity),
            imageUrl: form.imageUrl
        }, (createError, result) => {
            if (createError) {
                console.error(createError);
                return res.status(500).render('merchant-product-form', {
                    title: 'Add Product',
                    merchant,
                    product: null,
                    form,
                    errors: ['Product could not be created. Please try again.']
                });
            }

            if (!result || result.affectedRows === 0) {
                return res.status(403).render('error', {
                    title: 'Merchant Not Assigned',
                    message: 'Your merchant account needs an admin-created salon before products can be listed.'
                });
            }

            req.session.merchantSuccess = 'Product created successfully.';
            return res.redirect('/merchant/products');
        });
    });
}

function showEditProduct(req, res) {
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

            return res.render('merchant-product-form', {
                title: 'Edit Product',
                merchant,
                product,
                form: {
                    name: product.name,
                    price: String(product.price),
                    stockQuantity: String(product.stockQuantity),
                    imageUrl: product.imageUrl || ''
                },
                errors: []
            });
        });
    });
}

function updateProduct(req, res) {
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

            const form = getProductForm(req.body);
            const errors = validateProductForm(form);

            if (errors.length > 0) {
                return res.status(400).render('merchant-product-form', {
                    title: 'Edit Product',
                    merchant,
                    product,
                    form,
                    errors
                });
            }

            return Product.updateForMerchant(req.session.user.id, product.id, {
                name: form.name,
                price: Number(form.price),
                stockQuantity: Number(form.stockQuantity),
                imageUrl: form.imageUrl
            }, (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
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
                return res.redirect('/merchant/products');
            });
        });
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

        return res.render('merchant-promotion-form', {
            title: 'Add Promotion',
            merchant,
            promotion: null,
            form: getPromotionForm({
                status: 'draft',
                discountType: 'percentage',
                type: 'first_trial'
            }),
            promotionTypes: Promotion.PROMOTION_TYPES,
            discountTypes: Promotion.DISCOUNT_TYPES,
            statuses: Promotion.PROMOTION_STATUSES,
            errors: []
        });
    });
}

function createPromotion(req, res) {
    return MerchantService.getMerchantByUserId(req.session.user.id, (lookupError, merchant) => {
        const handled = renderMerchantLookupError(res, lookupError, merchant);

        if (handled) {
            return handled;
        }

        const form = getPromotionForm(req.body);
        const errors = validatePromotionForm(form, merchant);

        if (errors.length > 0) {
            return res.status(400).render('merchant-promotion-form', {
                title: 'Add Promotion',
                merchant,
                promotion: null,
                form,
                promotionTypes: Promotion.PROMOTION_TYPES,
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
                    promotion: null,
                    form,
                    promotionTypes: Promotion.PROMOTION_TYPES,
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
            return res.redirect('/merchant/promotions');
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

            return res.render('merchant-promotion-form', {
                title: 'Edit Promotion',
                merchant,
                promotion,
                form: {
                    title: promotion.title,
                    serviceId: promotion.serviceId ? String(promotion.serviceId) : '',
                    type: promotion.type,
                    discountType: promotion.discountType,
                    discountValue: promotion.discountValue === null ? '' : String(promotion.discountValue),
                    startDate: formatDateTimeLocalValue(promotion.startDate),
                    endDate: formatDateTimeLocalValue(promotion.endDate),
                    status: promotion.status,
                    description: promotion.description || '',
                    terms: promotion.terms || ''
                },
                promotionTypes: Promotion.PROMOTION_TYPES,
                discountTypes: Promotion.DISCOUNT_TYPES,
                statuses: Promotion.PROMOTION_STATUSES,
                errors: []
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

            const form = getPromotionForm(req.body);
            const errors = validatePromotionForm(form, merchant);

            if (errors.length > 0) {
                return res.status(400).render('merchant-promotion-form', {
                    title: 'Edit Promotion',
                    merchant,
                    promotion,
                    form,
                    promotionTypes: Promotion.PROMOTION_TYPES,
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
                        promotion,
                        form,
                        promotionTypes: Promotion.PROMOTION_TYPES,
                        discountTypes: Promotion.DISCOUNT_TYPES,
                        statuses: Promotion.PROMOTION_STATUSES,
                        errors: ['Promotion could not be updated. Please try again.']
                    });
                }

                req.session.merchantSuccess = result.affectedRows > 0 ? 'Promotion updated successfully.' : null;
                req.session.merchantError = result.affectedRows > 0 ? null : 'Promotion could not be updated.';
                return res.redirect('/merchant/promotions');
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

module.exports = {
    showServices,
    generateQr,
    showNewService,
    createService,
    showEditService,
    updateService,
    deleteService,
    listProducts,
    showNewProduct,
    createProduct,
    showEditProduct,
    updateProduct,
    deleteProduct,
    listPromotions,
    showNewPromotion,
    createPromotion,
    showEditPromotion,
    updatePromotion,
    deletePromotion
};
