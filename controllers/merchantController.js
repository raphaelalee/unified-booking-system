const Merchant = require('../models/Merchant');
const Booking = require('../models/Booking');
const Product = require('../models/Product');

function getTodayInputValue() {
    return new Date().toISOString().slice(0, 10);
}

function getBookingPath(merchant, service = null) {
    const serviceQuery = service ? `?serviceId=${encodeURIComponent(service.id)}` : '';
    return `/booking/${merchant.id}/${merchant.qrToken}${serviceQuery}`;
}

function getBookingUrl(req, merchant, service = null) {
    return `${req.protocol}://${req.get('host')}${getBookingPath(merchant, service)}`;
}

function getSelectedService(merchant, serviceId) {
    return serviceId ? Merchant.findService(merchant.id, serviceId) : null;
}

function getBookingServices(merchant, selectedService = null) {
    const services = Array.isArray(merchant.services) && merchant.services.length > 0
        ? merchant.services
        : [];

    return selectedService ? [selectedService] : services;
}

function renderBookingPage(req, res, merchant, options = {}) {
    const requestedServiceId = options.form?.serviceId || req.query.serviceId;
    const selectedService = getSelectedService(merchant, requestedServiceId);

    if (requestedServiceId && !selectedService) {
        return res.status(404).render('error', {
            title: 'Service Not Found',
            message: 'This service does not belong to the selected merchant.'
        });
    }

    const form = {
        ...(options.form || {}),
        ...(selectedService ? { serviceId: selectedService.id } : {})
    };
    const scopedServices = getBookingServices(merchant, selectedService);
    const bookingUrl = getBookingUrl(req, merchant, selectedService);

    return res.status(options.status || 200).render('booking', {
        title: `Book ${merchant.name}`,
        merchant,
        scopedServices,
        errors: options.errors || [],
        form,
        selectedServiceId: selectedService ? selectedService.id : null,
        bookingPath: getBookingPath(merchant, selectedService),
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
        errors: options.errors || [],
        form: options.form || {},
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
    const service = Merchant.findService(merchant.id, form.serviceId);
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

    if (!form.bookingDate || Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
        errors.push('Please choose today or a future booking date.');
    }

    if (!form.bookingTime || !service || !service.slots.includes(form.bookingTime)) {
        errors.push('Please select an available time slot for the selected service.');
    }

    if (service && Booking.hasExistingBooking(merchant.id, service.id, form.bookingDate, form.bookingTime)) {
        errors.push('This slot is already booked. Please choose another time.');
    }

    return { errors, service, customerName, email, phone };
}

function showHome(req, res) {
    res.render('home', {
        title: 'Vaniday',
        merchants: Merchant.getAll(),
        success: req.session.success
    });
    req.session.success = null;
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

    return renderMerchantDetail(req, res, merchant);
}

function showMerchantQr(req, res) {
    const merchant = Merchant.findById(req.params.merchantId);

    if (!merchant) {
        return res.status(404).render('error', {
            title: 'Merchant Not Found',
            message: 'The merchant you selected could not be found.'
        });
    }

    const bookingUrl = getBookingUrl(req, merchant);

    return res.render('merchant-qr', {
        title: `${merchant.name} QR Code`,
        merchant,
        bookingUrl,
        encodedBookingUrl: encodeURIComponent(bookingUrl)
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

    const bookingData = {
        merchantId: merchant.id,
        merchantName: merchant.name,
        serviceId: validation.service.id,
        serviceName: validation.service.name,
        customerName: validation.customerName,
        email: validation.email,
        phone: validation.phone,
        bookingDate: req.body.bookingDate,
        bookingTime: req.body.bookingTime
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
                service: validation.service,
                bookingDate: req.body.bookingDate,
                bookingTime: req.body.bookingTime
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
        serviceName: validation.service.name,
        customerName: validation.customerName,
        email: validation.email,
        phone: validation.phone,
        bookingDate: req.body.bookingDate,
        bookingTime: req.body.bookingTime
    });

    req.session.success = `Booking request received for ${validation.service.name} at ${merchant.name} on ${req.body.bookingDate}, ${req.body.bookingTime}.`;
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
    const product = Product.findById(req.params.productId);

    if (!product) {
        return res.status(404).render('error', {
            title: 'Product Not Found',
            message: 'The product you selected could not be found.'
        });
    }

    req.session.cart = req.session.cart || [];
    req.session.cart.push({
        id: Date.now(),
        type: 'Product',
        merchantId: null,
        merchantName: product.category,
        serviceId: product.id,
        serviceName: product.name,
        duration: product.description,
        price: product.price
    });

    return res.redirect('/cart');
}

function showCart(req, res) {
    const cart = (req.session.cart || []).map((item) => {
        if (!item.merchantId || item.merchantQrToken) {
            return item;
        }

        const merchant = Merchant.findById(item.merchantId);

        return {
            ...item,
            merchantQrToken: merchant ? merchant.qrToken : null
        };
    });
    const total = cart.reduce((sum, item) => sum + Number(item.price), 0);

    return res.render('cart', {
        title: 'Cart',
        cart,
        total
    });
}

function removeFromCart(req, res) {
    const cart = req.session.cart || [];
    req.session.cart = cart.filter((item) => String(item.id) !== String(req.params.itemId));

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

function showProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const favouriteIds = req.session.favouriteMerchantIds || [];
    const favourites = favouriteIds
        .map((merchantId) => Merchant.findById(merchantId))
        .filter(Boolean);
    const cart = req.session.cart || [];
    const profile = req.session.profile || {
        name: 'Guest User',
        email: '',
        phone: ''
    };
    const rewardPoints = favourites.length * 50 + cart.length * 20;
    const cashbackBalance = (rewardPoints / 100).toFixed(2);

    const success = req.session.profileSuccess;
    req.session.profileSuccess = null;

    return res.render('profile', {
        title: 'Profile',
        profile,
        favourites,
        cartCount: cart.length,
        rewardPoints,
        cashbackBalance,
        success
    });
}

function updateProfile(req, res) {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim();

    req.session.profile = {
        name: name || 'Guest User',
        email,
        phone
    };
    req.session.user = {
        name: name || 'Guest User',
        email
    };
    req.session.profileSuccess = 'Profile updated successfully.';

    return res.redirect('/profile');
}

function showLogin(req, res) {
    if (req.session.user) {
        return res.redirect('/profile');
    }

    const error = req.session.loginError;
    req.session.loginError = null;

    return res.render('login', {
        title: 'Log In',
        error,
        form: {}
    });
}

function loginUser(req, res) {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim();
    const password = (req.body.password || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[689]\d{7}$/.test(phone) || password.length < 4) {
        req.session.loginError = 'Please enter a valid name, email, 8-digit Singapore handphone number, and password.';
        return res.redirect('/login');
    }

    req.session.user = { name, email };
    req.session.profile = { name, email, phone };
    req.session.profileSuccess = 'You are logged in.';

    return res.redirect('/profile');
}

function showSignup(req, res) {
    if (req.session.user) {
        return res.redirect('/profile');
    }

    const error = req.session.signupError;
    const form = req.session.signupForm || {};
    req.session.signupError = null;
    req.session.signupForm = null;

    return res.render('signup', {
        title: 'Sign Up',
        error,
        form
    });
}

function signupUser(req, res) {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim();
    const password = (req.body.password || '').trim();
    const confirmPassword = (req.body.confirmPassword || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[689]\d{7}$/.test(phone)) {
        req.session.signupError = 'Please enter a valid name, email, and 8-digit Singapore handphone number.';
        req.session.signupForm = { name, email, phone };
        return res.redirect('/signup');
    }

    if (password.length < 4 || password !== confirmPassword) {
        req.session.signupError = 'Password must be at least 4 characters and match the confirmation.';
        req.session.signupForm = { name, email, phone };
        return res.redirect('/signup');
    }

    req.session.user = { name, email };
    req.session.profile = { name, email, phone };
    req.session.profileSuccess = 'Account created successfully.';

    return res.redirect('/profile');
}

function logoutUser(req, res) {
    req.session.user = null;
    req.session.profileSuccess = null;

    return res.redirect('/login');
}

function showPayment(req, res) {
    const amount = Number(req.query.amount || 0);
    const merchantName = req.query.merchant || 'Vaniday';
    const serviceName = req.query.service || 'Booking';

    return res.render('payment', {
        title: 'Payment',
        amount,
        merchantName,
        serviceName
    });
}

function confirmPayment(req, res) {
    return res.render('payment-success', {
        title: 'Payment Successful',
        amount: req.body.amount,
        merchantName: req.body.merchantName,
        serviceName: req.body.serviceName
    });
}

module.exports = {
    showHome,
    listMerchants,
    showMerchant,
    showMerchantQr,
    showBookingPage,
    saveQrBooking,
    createBooking,
    addToCart,
    addProductToCart,
    showCart,
    removeFromCart,
    toggleFavouriteMerchant,
    showProfile,
    updateProfile,
    showLogin,
    loginUser,
    showSignup,
    signupUser,
    logoutUser,
    showPayment,
    confirmPayment
};
