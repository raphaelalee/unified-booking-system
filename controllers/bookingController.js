const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Loyalty = require('../models/Loyalty');
const Notification = require('../models/Notification');
const Review = require('../models/Review');
const { sendBookingConfirmationEmail } = require('../utils/emailNotifications');
const { getPublicHolidayName } = require('../utils/publicHolidays');
const {
    getBookingCheckInUrl,
    signBookingCheckInToken,
    verifyBookingCheckInToken
} = require('../utils/qrToken');

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

function isCheckInExpired(booking) {
    const rawDate = booking.booking_date instanceof Date
        ? booking.booking_date.toISOString().slice(0, 10)
        : String(booking.booking_date || '').slice(0, 10);
    const bookingDate = new Date(`${rawDate}T23:59:59`);

    if (Number.isNaN(bookingDate.getTime())) {
        return false;
    }

    const expiry = new Date(bookingDate);
    expiry.setDate(expiry.getDate() + 1);
    return new Date() > expiry;
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

function notifyUser(recipientUserId, role, notification) {
    Notification.create({
        ...notification,
        recipientUserId,
        recipientRole: role
    }, (error) => {
        if (error) {
            console.error('Notification error:', error.message || error);
        }
    });
}

function isPeakHour(bookingTime) {
    const minutes = Number(String(bookingTime || '').slice(0, 2)) * 60 + Number(String(bookingTime || '').slice(3, 5));
    return (minutes >= 12 * 60 && minutes < 14 * 60) || minutes >= 17 * 60;
}

function evaluateRescheduleAutomation({ booking, bookingDate, bookingTime, settings, allowedSlots, overlaps, rescheduleCount }) {
    const issues = [];
    let score = 100;
    const targetStart = new Date(`${bookingDate}T${bookingTime}:00`);
    const hoursUntilTarget = (targetStart.getTime() - Date.now()) / 3600000;
    const businessStart = String(settings.businessStart || '09:00').slice(0, 5);
    const businessEnd = String(settings.businessEnd || '20:00').slice(0, 5);
    const duration = Math.max(15, Number(booking.duration_mins || 60));
    const slotMinutes = (Number(bookingTime.slice(0, 2)) * 60) + Number(bookingTime.slice(3, 5));
    const businessStartMinutes = (Number(businessStart.slice(0, 2)) * 60) + Number(businessStart.slice(3, 5));
    const businessEndMinutes = (Number(businessEnd.slice(0, 2)) * 60) + Number(businessEnd.slice(3, 5));
    const blockedTimes = String(settings.blockedTimes || '')
        .split(',')
        .map((slot) => slot.trim().slice(0, 5))
        .filter(Boolean);

    if (!settings.autoApproveEnabled) {
        score -= 40;
        issues.push('Merchant auto-approval is disabled.');
    }

    if (!allowedSlots.includes(bookingTime)) {
        score -= 45;
        issues.push('Requested time is not configured for this service.');
    }

    if (slotMinutes < businessStartMinutes || slotMinutes + duration > businessEndMinutes) {
        score -= 45;
        issues.push('Requested time is outside merchant business hours.');
    }

    if (blockedTimes.includes(bookingTime)) {
        score -= 50;
        issues.push('Requested time is blocked by the merchant.');
    }

    if (overlaps.length > 0) {
        score -= 55;
        issues.push('Requested time overlaps another appointment.');
    }

    if (hoursUntilTarget < Number(settings.minimumNoticeHours || 24)) {
        score -= 30;
        issues.push(`Less than ${settings.minimumNoticeHours || 24} hours notice.`);
    }

    if (bookingDate === getDayKey(new Date())) {
        score -= 25;
        issues.push('Same-day reschedule.');
    }

    if (rescheduleCount >= Number(settings.maxReschedulesAllowed || 2)) {
        score -= 50;
        issues.push('Customer has reached the merchant reschedule limit.');
    }

    if (settings.peakHourRestrictions && isPeakHour(bookingTime)) {
        score -= 20;
        issues.push('Peak-hour request.');
    }

    if (/vip|bridal|wedding|package|special/i.test(`${booking.service_name || ''} ${booking.serviceName || ''}`)) {
        score -= 20;
        issues.push('Special service review recommended.');
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const confidenceLevel = normalizedScore >= 80 ? 'high' : normalizedScore >= 50 ? 'medium' : 'low';

    return {
        confidenceLevel,
        confidenceScore: normalizedScore,
        autoApprove: confidenceLevel === 'high' && issues.length === 0,
        issues,
        decisionReason: issues.length ? issues.join(' ') : 'All automated scheduling checks passed.'
    };
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
                const checkinUrl = getBookingCheckInUrl(req, bookingId);
                const checkinToken = signBookingCheckInToken(bookingId);
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
                        checkinToken,
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
                        checkinToken,
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

function showCheckIn(req, res) {
    const bookingId = verifyBookingCheckInToken(req.params.signedToken);

    if (!bookingId) {
        return res.status(403).render('error', {
            title: 'Invalid Check-In QR',
            message: 'This booking check-in QR is invalid.'
        });
    }

    return Booking.getReceiptById(bookingId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Check-In Error',
                message: 'The booking could not be loaded.'
            });
        }

        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'This booking could not be found.'
            });
        }

        if (isCheckInExpired(booking)) {
            return res.status(410).render('error', {
                title: 'Check-In Expired',
                message: 'This booking check-in QR has expired after the appointment window.'
            });
        }

        return res.render('booking-checkin', {
            title: 'Scan to Check In',
            booking,
            checkinUrl: getBookingCheckInUrl(req, bookingId),
            qrDebug: {
                system: 'booking-check-in',
                label: 'Scan to Check In',
                token: req.params.signedToken,
                routeTarget: `/checkin/${req.params.signedToken}`,
                url: getBookingCheckInUrl(req, bookingId)
            }
        });
    });
}

function confirmCheckIn(req, res) {
    const bookingId = verifyBookingCheckInToken(req.params.signedToken);

    if (!bookingId) {
        return res.status(403).render('error', {
            title: 'Invalid Check-In QR',
            message: 'This booking check-in QR is invalid.'
        });
    }

    return Booking.getReceiptById(bookingId, (lookupError, booking) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Check-In Error',
                message: 'The booking could not be loaded.'
            });
        }

        if (!booking) {
            return res.status(404).render('error', {
                title: 'Booking Not Found',
                message: 'This booking could not be found.'
            });
        }

        if (isCheckInExpired(booking)) {
            return res.status(410).render('error', {
                title: 'Check-In Expired',
                message: 'This booking check-in QR has expired after the appointment window.'
            });
        }

        return Booking.markCheckedInByToken(bookingId, (updateError) => {
            if (updateError) {
                console.error(updateError);
                return res.status(500).render('error', {
                    title: 'Check-In Error',
                    message: 'The booking could not be checked in.'
                });
            }

            return res.render('booking-checkin', {
                title: 'Checked In',
                booking: { ...booking, status: 'checked_in' },
                success: 'You are checked in for this appointment.',
                checkinUrl: getBookingCheckInUrl(req, bookingId),
                qrDebug: {
                    system: 'booking-check-in',
                    label: 'Scan to Check In',
                    token: req.params.signedToken,
                    routeTarget: `/checkin/${req.params.signedToken}`,
                    url: getBookingCheckInUrl(req, bookingId)
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

        const finishUpdate = (automation) => {
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

                Booking.createRescheduleRequest({
                    bookingId,
                    userId,
                    merchantId: booking.salon_id,
                    serviceId: booking.service_id,
                    oldBookingDate: currentDate,
                    oldBookingTime: currentTime,
                    requestedBookingDate: bookingDate,
                    requestedBookingTime: bookingTime,
                    status: 'auto_approved',
                    confidenceLevel: automation.confidenceLevel,
                    confidenceScore: automation.confidenceScore,
                    decisionReason: automation.decisionReason
                }, (requestError) => {
                    if (requestError) {
                        console.error(requestError);
                    }
                });

                notifyUser(booking.merchant_user_id, 'merchant', {
                    actorUserId: userId,
                    type: 'booking_reschedule_auto_approved',
                    title: 'Reschedule auto-approved',
                    message: `${booking.service_name} for ${req.session.user.name || 'a customer'} moved to ${bookingDate} at ${bookingTime}.`,
                    linkUrl: '/merchant/bookings',
                    dedupeKey: `reschedule-auto-${bookingId}-${bookingDate}-${bookingTime}`
                });
                notifyUser(userId, 'customer', {
                    actorUserId: userId,
                    type: 'booking_reschedule_auto_approved',
                    title: 'Booking rescheduled',
                    message: `Your ${booking.service_name} booking was moved to ${bookingDate} at ${bookingTime}.`,
                    linkUrl: '/profile#bookings',
                    dedupeKey: `reschedule-customer-auto-${bookingId}-${bookingDate}-${bookingTime}`
                });

                return respondProfileAction(req, res, {
                    success: true,
                    message: `Booking moved to ${bookingDate} at ${bookingTime}.`,
                    confidence: automation.confidenceLevel,
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

        return Booking.getRescheduleSettings(booking.salon_id, (settingsError, settings) => {
            if (settingsError) {
                console.error(settingsError);
                return respondProfileAction(req, res, {
                    success: false,
                    message: 'Merchant reschedule rules could not be loaded.'
                });
            }

            return Booking.getAllowedSlotsForBooking(bookingId, userId, (slotError, allowedSlots = []) => {
                if (slotError) {
                    console.error(slotError);
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'That booking slot could not be checked.'
                    });
                }

                return Booking.findOverlappingBookings(
                    booking.salon_id,
                    booking.id,
                    bookingDate,
                    bookingTime,
                    booking.duration_mins,
                    (overlapError, overlaps = []) => {
                        if (overlapError) {
                            console.error(overlapError);
                            return respondProfileAction(req, res, {
                                success: false,
                                message: 'That booking slot could not be checked.'
                            });
                        }

                        return Booking.countReschedulesForBooking(bookingId, (countError, rescheduleCount = 0) => {
                            if (countError) {
                                console.error(countError);
                                return respondProfileAction(req, res, {
                                    success: false,
                                    message: 'Reschedule history could not be checked.'
                                });
                            }

                            const automation = evaluateRescheduleAutomation({
                                booking,
                                bookingDate,
                                bookingTime,
                                settings: settings || {},
                                allowedSlots,
                                overlaps,
                                rescheduleCount
                            });

                            if (automation.autoApprove) {
                                return finishUpdate(automation);
                            }

                            const reviewStatus = automation.confidenceLevel === 'low' ? 'manual review' : 'merchant review';
                            return Booking.createRescheduleRequest({
                                bookingId,
                                userId,
                                merchantId: booking.salon_id,
                                serviceId: booking.service_id,
                                oldBookingDate: currentDate,
                                oldBookingTime: currentTime,
                                requestedBookingDate: bookingDate,
                                requestedBookingTime: bookingTime,
                                status: 'pending_review',
                                confidenceLevel: automation.confidenceLevel,
                                confidenceScore: automation.confidenceScore,
                                decisionReason: automation.decisionReason,
                                reviewNotes: automation.issues.join('\n')
                            }, (requestError, requestResult) => {
                                if (requestError) {
                                    console.error(requestError);
                                    return respondProfileAction(req, res, {
                                        success: false,
                                        message: 'This reschedule request could not be submitted.'
                                    });
                                }

                                notifyUser(booking.merchant_user_id, 'merchant', {
                                    actorUserId: userId,
                                    type: 'booking_reschedule_review',
                                    title: 'Reschedule needs review',
                                    message: `${booking.service_name} request for ${bookingDate} at ${bookingTime} needs ${reviewStatus}: ${automation.decisionReason}`,
                                    linkUrl: '/merchant/bookings',
                                    dedupeKey: `reschedule-review-${requestResult?.insertId || bookingId}`
                                });
                                notifyUser(userId, 'customer', {
                                    actorUserId: userId,
                                    type: 'booking_reschedule_review',
                                    title: 'Reschedule sent for review',
                                    message: `Your ${booking.service_name} request for ${bookingDate} at ${bookingTime} was sent to the merchant.`,
                                    linkUrl: '/profile#bookings',
                                    dedupeKey: `reschedule-customer-review-${requestResult?.insertId || bookingId}`
                                });

                                return respondProfileAction(req, res, {
                                    success: true,
                                    pendingReview: true,
                                    confidence: automation.confidenceLevel,
                                    message: `This request needs ${reviewStatus}. The merchant has been notified.`,
                                    booking: {
                                        id: bookingId,
                                        bookingDate: currentDate,
                                        bookingTime: currentTime,
                                        status: booking.status
                                    }
                                });
                            });
                        });
                    }
                );
            });
        });
    });
}

function getRescheduleSuggestions(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;

    if (!bookingId || !userId) {
        return res.status(404).json({
            success: false,
            message: 'The selected booking could not be found.'
        });
    }

    return Booking.getRescheduleSuggestionCandidates(bookingId, userId, (error, booking, suggestions = []) => {
        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: 'Reschedule suggestions could not be loaded.'
            });
        }

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'That booking could not be found on your account.'
            });
        }

        return res.json({
            success: true,
            suggestions,
            booking: {
                id: bookingId,
                serviceName: booking.service_name,
                durationMins: booking.duration_mins
            }
        });
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
    confirmCheckIn,
    confirmBooking,
    createBooking,
    getRescheduleSuggestions,
    rescheduleBooking,
    showCheckIn,
    submitReview,
    showBookFallback
};
