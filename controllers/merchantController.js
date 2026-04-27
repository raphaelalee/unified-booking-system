const Merchant = require('../models/Merchant');
const Booking = require('../models/Booking');

function getTodayInputValue() {
    return new Date().toISOString().slice(0, 10);
}

function renderMerchantDetail(res, merchant, options = {}) {
    return res.status(options.status || 200).render('merchant-detail', {
        title: merchant.name,
        merchant,
        errors: options.errors || [],
        form: options.form || {},
        todayDate: getTodayInputValue()
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

    res.render('merchants', {
        title: 'Merchants',
        merchants: Merchant.getAll(search),
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

    return renderMerchantDetail(res, merchant);
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
        return renderMerchantDetail(res, merchant, {
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

module.exports = {
    showHome,
    listMerchants,
    showMerchant,
    createBooking
};
