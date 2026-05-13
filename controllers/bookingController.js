const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Loyalty = require('../models/Loyalty');
const Review = require('../models/Review');
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

function wantsJson(req) {
    return req.xhr
        || (req.get('accept') || '').includes('application/json')
        || String(req.body.responseType || '').toLowerCase() === 'json';
}

function respondProfileAction(req, res, payload, redirectPath = '/profile#bookings') {
    if (wantsJson(req)) {
        return res.status(payload.success ? 200 : 400).json(payload);
    }

    if (payload.success) {
        setProfileSuccess(req, payload.message);
    } else {
        setProfileError(req, payload.message);
    }

    return res.redirect(redirectPath);
}

function getRefundStatusForCancellation(booking) {
    const dateKey = getDayKey(booking.booking_date);
    const bookingTime = normalizeBookingTime(booking.booking_time) || '23:59';
    const appointmentDate = new Date(`${dateKey}T${bookingTime}:00`);
    const hoursUntilBooking = (appointmentDate.getTime() - Date.now()) / (1000 * 60 * 60);

    if (!dateKey || Number.isNaN(appointmentDate.getTime())) {
        return 'review_required';
    }

    return hoursUntilBooking >= 24 ? 'eligible' : 'late_cancellation_review';
}

function removeUploadedReviewMedia(...mediaPaths) {
    mediaPaths.filter(Boolean).forEach((mediaPath) => {
        const normalized = String(mediaPath).replace(/^\/+/, '');
        const absolutePath = path.join(__dirname, '..', 'public', normalized.replace(/\//g, path.sep));
        fs.unlink(absolutePath, () => {});
    });
}

function normalizeReviewRating(value) {
    const rating = Number(value);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return 0;
    }

    return rating;
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

        if (service.inventoryBlocked) {
            req.session.profileError = 'This service is temporarily unavailable because the required inventory is out of stock.';
            return res.redirect(req.get('Referrer') || '/services');
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
    const reason = String(req.body.reason || req.body.cancellationReason || '').trim().slice(0, 180);

    if (!bookingId || !userId) {
        return respondProfileAction(req, res, {
            success: false,
            message: 'The selected booking could not be found.'
        });
    }

    if (!reason) {
        return respondProfileAction(req, res, {
            success: false,
            message: 'Please choose a cancellation reason.'
        });
    }

    return Booking.getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            return respondProfileAction(req, res, {
                success: false,
                message: 'That booking could not be loaded.'
            });
        }

        if (!booking) {
            return respondProfileAction(req, res, {
                success: false,
                message: 'That booking could not be found on your account.'
            });
        }

        if (booking.status === 'cancelled') {
            return respondProfileAction(req, res, {
                success: false,
                message: 'This booking is already cancelled.'
            });
        }

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDate(booking.booking_date)) {
            return respondProfileAction(req, res, {
                success: false,
                message: 'Past or completed bookings cannot be cancelled.'
            });
        }

        const refundStatus = getRefundStatusForCancellation(booking);

        return Booking.cancelForCustomer(bookingId, userId, reason, refundStatus, (updateError, result) => {
            if (updateError) {
                console.error(updateError);
                return respondProfileAction(req, res, {
                    success: false,
                    message: 'This booking could not be cancelled.'
                });
            }

            if (!result?.affectedRows) {
                return respondProfileAction(req, res, {
                    success: false,
                    message: 'This booking could not be cancelled.'
                });
            }

            return respondProfileAction(req, res, {
                success: true,
                message: 'Booking cancelled successfully.',
                booking: {
                    id: bookingId,
                    status: 'cancelled',
                    cancellationReason: reason,
                    refundStatus,
                    cancelledAt: new Date().toISOString()
                }
            });
        });
    });
}

function rescheduleBooking(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;
    const bookingDate = String(req.body.bookingDate || '').trim();
    const bookingTime = normalizeBookingTime(req.body.bookingTime);

    if (!bookingId || !userId) {
        return respondProfileAction(req, res, {
            success: false,
            message: 'The selected booking could not be found.'
        });
    }

    if (!isValidBookingDate(bookingDate)) {
        return respondProfileAction(req, res, {
            success: false,
            message: 'Please choose today or a future booking date.'
        });
    }

    if (!bookingTime) {
        return respondProfileAction(req, res, {
            success: false,
            message: 'Please choose a valid booking time.'
        });
    }

    const holidayName = getPublicHolidayName(bookingDate);

    if (holidayName) {
        return respondProfileAction(req, res, {
            success: false,
            message: `Bookings are unavailable on ${holidayName}. Please choose another date.`
        });
    }

    return Booking.getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            return respondProfileAction(req, res, {
                success: false,
                message: 'That booking could not be loaded.'
            });
        }

        if (!booking) {
            return respondProfileAction(req, res, {
                success: false,
                message: 'That booking could not be found on your account.'
            });
        }

        if (booking.status === 'cancelled') {
            return respondProfileAction(req, res, {
                success: false,
                message: 'Cancelled bookings cannot be rescheduled.'
            });
        }

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDate(booking.booking_date)) {
            return respondProfileAction(req, res, {
                success: false,
                message: 'Past or completed bookings cannot be rescheduled.'
            });
        }

        const currentDate = getDayKey(booking.booking_date);
        const currentTime = normalizeBookingTime(booking.booking_time);
        const isSameSlot = currentDate === bookingDate && currentTime === bookingTime;

        const finishUpdate = () => {
            return Booking.updateScheduleForCustomer(bookingId, userId, bookingDate, bookingTime, (updateError, result) => {
                if (updateError) {
                    console.error(updateError);
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'This booking could not be rescheduled.'
                    });
                }

                if (!result?.affectedRows) {
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'This booking could not be rescheduled.'
                    });
                }

                return respondProfileAction(req, res, {
                    success: true,
                    message: `Booking moved to ${bookingDate} at ${bookingTime}.`,
                    booking: {
                        id: bookingId,
                        bookingDate,
                        bookingTime,
                        status: booking.status
                    }
                });
            });
        };

        if (isSameSlot) {
            return respondProfileAction(req, res, {
                success: true,
                message: 'Your booking already uses that date and time.',
                booking: {
                    id: bookingId,
                    bookingDate,
                    bookingTime,
                    status: booking.status
                }
            });
        }

        return Booking.hasExistingBookingInDatabase(
            booking.salon_id,
            booking.service_id,
            bookingDate,
            bookingTime,
            (slotError, slotTaken) => {
                if (slotError) {
                    console.error(slotError);
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'That booking slot could not be checked.'
                    });
                }

                if (slotTaken) {
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'That date and time is already booked. Please choose another slot.'
                    });
                }

                return finishUpdate();
            }
        );
    });
}

function submitReview(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;
    const rating = normalizeReviewRating(req.body.rating);
    const comment = String(req.body.comment || '').trim().slice(0, 800);

    if (!bookingId || !userId) {
        setProfileError(req, 'The selected booking could not be found.');
        return res.redirect('/profile#bookings');
    }

    if (!rating) {
        setProfileError(req, 'Please choose a rating from 1 to 5 stars.');
        return res.redirect('/profile#bookings');
    }

    const imageUpload = req.files?.reviewImage?.[0] || null;
    const videoUpload = req.files?.reviewVideo?.[0] || null;
    const imagePath = imageUpload ? `/uploads/reviews/${imageUpload.filename}` : '';
    const videoPath = videoUpload ? `/uploads/reviews/${videoUpload.filename}` : '';

    return Booking.getReceiptById(bookingId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            setProfileError(req, 'That booking could not be loaded.');
            return res.redirect('/profile#bookings');
        }

        if (!booking || Number(booking.user_id) !== Number(userId)) {
            setProfileError(req, 'That booking could not be found on your account.');
            return res.redirect('/profile#bookings');
        }

        if (!['completed', 'checked_in'].includes(String(booking.status || '').toLowerCase())) {
            setProfileError(req, 'Reviews can only be submitted after the service is completed.');
            return res.redirect('/profile#bookings');
        }

        return Review.findByBookingId(bookingId, (reviewLookupError, existingReview) => {
            if (reviewLookupError) {
                console.error(reviewLookupError);
                removeUploadedReviewMedia(imagePath, videoPath);
                setProfileError(req, 'Your review could not be checked.');
                return res.redirect('/profile#bookings');
            }

            if (existingReview) {
                removeUploadedReviewMedia(imagePath, videoPath);
                setProfileError(req, 'You have already submitted a review for this booking.');
                return res.redirect('/profile#bookings');
            }

            return Review.create({
                bookingId,
                userId,
                merchantId: booking.merchant_id,
                serviceId: booking.service_id,
                rating,
                comment,
                imagePath,
                videoPath
            }, (createError) => {
                if (createError) {
                    console.error(createError);
                    removeUploadedReviewMedia(imagePath, videoPath);
                    setProfileError(req, 'Your review could not be saved.');
                    return res.redirect('/profile#bookings');
                }

                const reviewReward = {
                    basePoints: 10,
                    mediaPoints: imagePath || videoPath ? 50 : 0,
                    detailPoints: comment.length >= 50 ? 10 : 0
                };

                return Loyalty.awardReviewBonus(userId, bookingId, reviewReward, (rewardError, rewardResult) => {
                    if (rewardError) {
                        console.error(rewardError);
                        setProfileSuccess(req, 'Review submitted successfully.');
                        return res.redirect('/profile#bookings');
                    }

                    const awardedPoints = Number(rewardResult?.points || 0);
                    const rewardMessage = awardedPoints > 0
                        ? ` Review reward: +${awardedPoints} points.`
                        : '';

                    setProfileSuccess(req, `Review submitted successfully.${rewardMessage}`);
                    return res.redirect('/profile#bookings');
                });
            });
        });
    });
}

module.exports = {
    cancelBooking,
    confirmBooking,
    createBooking,
    rescheduleBooking,
    submitReview,
    showBookFallback
};
