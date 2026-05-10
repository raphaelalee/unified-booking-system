const QRCode = require('qrcode');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const { sendBookingConfirmationEmail } = require('../utils/emailNotifications');
const { getPublicHolidayName } = require('../utils/publicHolidays');

function getPublicBaseUrl(req) {
    return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function isValidBookingDate(value) {
    if (!value) {
        return false;
    }

    const selectedDate = new Date(`${value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return !Number.isNaN(selectedDate.getTime()) && selectedDate >= today;
}

function normalizeBookingTime(value) {
    const rawValue = String(value || '').trim();
    const match = rawValue.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) {
        return '';
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return '';
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getDayKey(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function isPastBookingDate(value) {
    const bookingKey = getDayKey(value);

    if (!bookingKey) {
        return true;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bookingKey < today.toISOString().slice(0, 10);
}

function setProfileError(req, message) {
    req.session.profileError = message;
}

function setProfileSuccess(req, message) {
    req.session.profileSuccess = message;
}

function createBooking(req, res) {
    const serviceId = req.body.serviceId || req.params.serviceId;
    const bookingDate = req.body.bookingDate;
    const bookingTime = req.body.bookingTime || null;

    if (!serviceId || serviceId === 'select') {
        req.session.profileError = 'Please select a service before confirming your booking.';
        return res.redirect('/services');
    }

    if (!isValidBookingDate(bookingDate)) {
        req.session.profileError = 'Please choose today or a future booking date.';
        return res.redirect(req.get('Referrer') || '/services');
    }

    const holidayName = getPublicHolidayName(bookingDate);

    if (holidayName) {
        req.session.profileError = `Bookings are unavailable on ${holidayName}. Please choose another date.`;
        return res.redirect(req.get('Referrer') || '/services');
    }

    return MerchantService.findServiceById(serviceId, (serviceError, service) => {
        if (serviceError) {
            console.error(serviceError);
            return res.status(500).render('error', {
                title: 'Booking Error',
                message: 'The selected service could not be loaded.'
            });
        }

        if (!service) {
            return res.status(404).render('error', {
                title: 'Service Not Found',
                message: 'The selected service does not exist.'
            });
        }

        const purchaseType = req.body.purchaseType === 'package' && service.packageEnabled ? 'package' : 'single';
        const bookedServiceName = purchaseType === 'package'
            ? `${service.name} (${service.packageSessions}-session package)`
            : service.name;
        const bookedServicePrice = purchaseType === 'package'
            ? Number(service.packagePrice || service.price)
            : Number(service.price || 0);

        return Booking.createCustomerBooking({
            userId: req.session.user.id,
            serviceId: service.id,
            merchantId: service.salonId,
            bookingDate,
            bookingTime
        }, async (bookingError, result) => {
            if (bookingError) {
                console.error(bookingError);
                return res.status(500).render('error', {
                    title: 'Booking Error',
                    message: 'Your booking could not be created.'
                });
            }

            try {
                const bookingId = result.insertId;
                const checkinUrl = `${getPublicBaseUrl(req)}/booking/confirm/${encodeURIComponent(bookingId)}`;
                const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    width: 220
                });
                const email = (req.body.email || req.session.user.email || '').trim();
                const customerName = (req.body.customerName || req.session.user.name || 'Customer').trim();
                let emailSkipped = false;

                try {
                    const emailResult = await sendBookingConfirmationEmail({
                        bookingId,
                        customerName,
                        email,
                        merchantName: service.salonName || 'Vaniday merchant',
                        serviceName: bookedServiceName,
                        bookingDate,
                        bookingTime,
                        checkinUrl,
                        qrCodeDataUrl
                    });
                    emailSkipped = Boolean(emailResult?.skipped);
                } catch (emailError) {
                    emailSkipped = true;
                    console.error('Booking confirmation email failed:', emailError.message);
                }

                return res.render('booking-email-sent', {
                    title: 'Booking Confirmed',
                    booking: {
                        id: bookingId,
                        customerName,
                        email,
                        merchantName: service.salonName || 'Vaniday merchant',
                        serviceName: bookedServiceName,
                        servicePrice: bookedServicePrice,
                        purchaseType,
                        bookingDate,
                        bookingTime,
                        checkinUrl,
                        qrCodeDataUrl
                    },
                    emailSkipped
                });
            } catch (confirmationError) {
                console.error('Booking confirmation page failed:', confirmationError.message);
                return res.redirect('/profile');
            }
        });
    });
}

function showBookFallback(req, res) {
    return res.redirect('/services');
}

function confirmBooking(req, res) {
    return Booking.getReceiptById(req.params.bookingId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Booking Error',
                message: 'The booking could not be loaded.'
            });
        }

        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'This booking could not be found.'
            });
        }

        return Booking.markCompleted(req.params.bookingId, (updateError) => {
            if (updateError) {
                console.error(updateError);
                return res.status(500).render('error', {
                    title: 'Booking Error',
                    message: 'The booking could not be confirmed.'
                });
            }

            return res.render('booking-confirmed', {
                title: 'Booking Confirmed',
                booking: {
                    ...booking,
                    status: 'completed'
                }
            });
        });
    });
}

function cancelBooking(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;

    if (!bookingId || !userId) {
        setProfileError(req, 'The selected booking could not be found.');
        return res.redirect('/profile#bookings');
    }

    return Booking.getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            setProfileError(req, 'That booking could not be loaded.');
            return res.redirect('/profile#bookings');
        }

        if (!booking) {
            setProfileError(req, 'That booking could not be found on your account.');
            return res.redirect('/profile#bookings');
        }

        if (booking.status === 'cancelled') {
            setProfileError(req, 'This booking is already cancelled.');
            return res.redirect('/profile#bookings');
        }

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDate(booking.booking_date)) {
            setProfileError(req, 'Past or completed bookings cannot be cancelled.');
            return res.redirect('/profile#bookings');
        }

        return Booking.cancelForCustomer(bookingId, userId, (updateError, result) => {
            if (updateError) {
                console.error(updateError);
                setProfileError(req, 'This booking could not be cancelled.');
                return res.redirect('/profile#bookings');
            }

            if (!result?.affectedRows) {
                setProfileError(req, 'This booking could not be cancelled.');
                return res.redirect('/profile#bookings');
            }

            setProfileSuccess(req, 'Booking cancelled successfully.');
            return res.redirect('/profile#bookings');
        });
    });
}

function rescheduleBooking(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;
    const bookingDate = String(req.body.bookingDate || '').trim();
    const bookingTime = normalizeBookingTime(req.body.bookingTime);

    if (!bookingId || !userId) {
        setProfileError(req, 'The selected booking could not be found.');
        return res.redirect('/profile#bookings');
    }

    if (!isValidBookingDate(bookingDate)) {
        setProfileError(req, 'Please choose today or a future booking date.');
        return res.redirect('/profile#bookings');
    }

    if (!bookingTime) {
        setProfileError(req, 'Please choose a valid booking time.');
        return res.redirect('/profile#bookings');
    }

    const holidayName = getPublicHolidayName(bookingDate);

    if (holidayName) {
        setProfileError(req, `Bookings are unavailable on ${holidayName}. Please choose another date.`);
        return res.redirect('/profile#bookings');
    }

    return Booking.getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            setProfileError(req, 'That booking could not be loaded.');
            return res.redirect('/profile#bookings');
        }

        if (!booking) {
            setProfileError(req, 'That booking could not be found on your account.');
            return res.redirect('/profile#bookings');
        }

        if (booking.status === 'cancelled') {
            setProfileError(req, 'Cancelled bookings cannot be rescheduled.');
            return res.redirect('/profile#bookings');
        }

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDate(booking.booking_date)) {
            setProfileError(req, 'Past or completed bookings cannot be rescheduled.');
            return res.redirect('/profile#bookings');
        }

        const currentDate = getDayKey(booking.booking_date);
        const currentTime = normalizeBookingTime(booking.booking_time);
        const isSameSlot = currentDate === bookingDate && currentTime === bookingTime;

        const finishUpdate = () => {
            return Booking.updateScheduleForCustomer(bookingId, userId, bookingDate, bookingTime, (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    setProfileError(req, 'This booking could not be rescheduled.');
                    return res.redirect('/profile#bookings');
                }

                if (!result?.affectedRows) {
                    setProfileError(req, 'This booking could not be rescheduled.');
                    return res.redirect('/profile#bookings');
                }

                setProfileSuccess(req, `Booking moved to ${bookingDate} at ${bookingTime}.`);
                return res.redirect('/profile#bookings');
            });
        };

        if (isSameSlot) {
            setProfileSuccess(req, 'Your booking already uses that date and time.');
            return res.redirect('/profile#bookings');
        }

        return Booking.hasExistingBookingInDatabase(
            booking.salon_id,
            booking.service_id,
            bookingDate,
            bookingTime,
            (slotError, slotTaken) => {
                if (slotError) {
                    console.error(slotError);
                    setProfileError(req, 'That booking slot could not be checked.');
                    return res.redirect('/profile#bookings');
                }

                if (slotTaken) {
                    setProfileError(req, 'That date and time is already booked. Please choose another slot.');
                    return res.redirect('/profile#bookings');
                }

                return finishUpdate();
            }
        );
    });
}

module.exports = {
    cancelBooking,
    confirmBooking,
    createBooking,
    rescheduleBooking,
    showBookFallback
};
