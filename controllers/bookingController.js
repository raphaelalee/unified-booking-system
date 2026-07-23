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
    sendBookingCancellationSms,
    sendBookingConfirmationSms,
    sendBookingRescheduleSms
} = require('../utils/smsNotifications');
const {
    sendBookingCancellationNotification,
    sendBookingNotification,
    sendBookingRescheduleNotification
} = require('../utils/whatsappNotifications');
const {
    getBookingCheckInUrl,
    getGuestReceiptPath,
    getGuestReceiptUrl,
    signBookingCheckInToken,
    verifyBookingCheckInToken
} = require('../utils/qrToken');
const {
    formatAppointmentDateTime
} = require('../utils/dateTimeFormat');
const { buildBookingReference } = require('../utils/bookingReference');
const { sendDemoImmediateReminder } = require('../services/whatsappAutomation');
const { moderateReviewImage, moderateReviewText } = require('../services/groqService');

function isValidBookingDate(value) {
    const state = Booking.getBookingDateState(value);
    return state.valid && state.timing !== 'past' && state.timing !== 'too_future';
}

function getBookingDateErrorMessage(value) {
    const state = Booking.getBookingDateState(value);

    if (!state.valid || state.timing === 'past') {
        return 'Please choose today or a future booking date.';
    }

    if (state.timing === 'too_future') {
        return 'Please choose a booking date within 2 months.';
    }

    return '';
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
    const state = Booking.getBookingDateState(value);
    return !state.valid || state.timing === 'past';
}

function isPastBookingDateTime(dateValue, timeValue) {
    const state = Booking.getBookingDateState(dateValue);

    if (!state.valid || state.timing === 'past') {
        return true;
    }

    if (state.timing !== 'today') {
        return false;
    }

    const bookingTime = normalizeBookingTime(timeValue);

    if (!bookingTime) {
        return false;
    }

    const minutes = (Number(bookingTime.slice(0, 2)) * 60) + Number(bookingTime.slice(3, 5));
    return minutes <= state.singaporeNow.minutes;
}

function setProfileError(req, message) {
    req.session.profileError = message;
}

function setProfileSuccess(req, message) {
    req.session.profileSuccess = message;
}

function setReviewModerationPopup(req, message) {
    req.session.reviewModerationPopup = message;
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

function respondBookingCreateError(req, res, statusCode, message, redirectPath = '/services') {
    if (wantsJson(req)) {
        return res.status(statusCode).json({
            success: false,
            message
        });
    }

    req.session.profileError = message;
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

function notifyRole(role, notification) {
    Notification.createForRole(role, notification, (error) => {
        if (error) {
            console.error('Notification error:', error.message || error);
        }
    });
}

function notifyBookingCreated(bookingId) {
    Booking.getNotificationDetailsById(bookingId, (error, booking) => {
        if (error || !booking) {
            if (error) {
                console.error('Booking notification lookup failed:', error.message || error);
            }
            return;
        }

        const appointmentLabel = `${String(booking.booking_date).slice(0, 10)} at ${booking.booking_time}`;

        if (booking.user_id) {
            notifyUser(booking.user_id, 'customer', {
                actorUserId: booking.merchant_user_id || null,
                type: 'booking_confirmed',
                title: 'Booking request submitted',
                message: `${booking.service_name} at ${booking.merchant_name} is booked for ${appointmentLabel}.`,
                linkUrl: `/receipt/${booking.id}`,
                dedupeKey: `web-booking-customer-${booking.id}`
            });
        }

        notifyUser(booking.merchant_user_id, 'merchant', {
            actorUserId: booking.user_id || null,
            type: 'booking',
            title: 'New booking received',
            message: `${booking.customer_name || 'A customer'} booked ${booking.service_name} for ${appointmentLabel}.`,
            linkUrl: '/merchant/bookings',
            dedupeKey: `web-booking-merchant-${booking.id}`
        });

        notifyRole('admin', {
            actorUserId: booking.user_id || null,
            type: 'booking',
            title: 'New customer booking',
            message: `${booking.customer_name || 'A customer'} booked ${booking.service_name} at ${booking.merchant_name}.`,
            linkUrl: '/admin/bookings',
            dedupeKey: `web-booking-admin-${booking.id}`
        });
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

function getRequestedBookingRedeemPoints(body = {}) {
    const wantsRedemption = body.redeemRewards === '1' || body.redeemRewards === 'on';

    if (!wantsRedemption) {
        return 0;
    }

    const raw = String(body.redeemPoints || '').trim();

    if (!/^\d+$/.test(raw)) {
        return NaN;
    }

    return Math.floor(Number(raw));
}

function prepareBookingLoyaltyRedemption(req, service, amount, callback) {
    const requestedPoints = getRequestedBookingRedeemPoints(req.body);
    const originalServicePrice = Number(amount || service.price || 0);

    if (Number.isNaN(requestedPoints)) {
        callback(new Error('Points to redeem must be a positive whole number.'));
        return;
    }

    if (requestedPoints === 0) {
        callback(null, {
            requestedPoints: 0,
            points: 0,
            discount: 0,
            originalServicePrice,
            finalAmountPayable: originalServicePrice
        });
        return;
    }

    if (!req.session.user?.id) {
        callback(new Error('Please log in before redeeming loyalty points.'));
        return;
    }

    if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) {
        callback(new Error('Points to redeem must be a positive whole number.'));
        return;
    }

    Loyalty.calculatePointRedemption({
        userId: req.session.user.id,
        merchantId: service.salonId,
        serviceId: service.id,
        amount: originalServicePrice,
        requestedPoints
    }, (error, redemption = {}) => {
        if (error) {
            callback(error);
            return;
        }

        const points = Math.max(0, Math.floor(Number(redemption.points || 0)));
        const discount = Math.min(originalServicePrice, Math.round(Number(redemption.discount || 0) * 100) / 100);

        if (points <= 0 || discount <= 0) {
            callback(new Error('No loyalty discount could be applied for the selected points.'));
            return;
        }

        callback(null, {
            ...redemption,
            requestedPoints,
            points,
            discount,
            originalServicePrice,
            finalAmountPayable: Math.max(0, Math.round((originalServicePrice - discount) * 100) / 100)
        });
    });
}

function removeUploadedReviewMedia(...mediaPaths) {
    mediaPaths.filter(Boolean).forEach((mediaPath) => {
        const normalized = String(mediaPath).replace(/^\/+/, '');
        const absolutePath = path.join(__dirname, '..', 'public', normalized.replace(/\//g, path.sep));
        fs.unlink(absolutePath, () => {});
    });
}

function getReviewImageDataUrl(upload) {
    if (!upload?.path) {
        return '';
    }

    const mimeType = String(upload.mimetype || 'image/jpeg').toLowerCase();
    const buffer = fs.readFileSync(upload.path);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function getHardProfanityModeration(comment = '') {
    const text = String(comment || '').toLowerCase();
    const compactText = text.replace(/[^a-z0-9]/g, '');
    const hasHardProfanity = [
        /f+u+c+k+/i,
        /f+u+k+/i,
        /s+h+i+t+/i,
        /b+i+t+c+h+/i,
        /c+u+n+t+/i,
        /a+s+s+h+o+l+e+/i,
        /d+i+c+k+/i
    ].some((pattern) => pattern.test(compactText));

    if (!hasHardProfanity) {
        return null;
    }

    return {
        recommendedAction: 'reject',
        reason: 'Review contains profanity or vulgar language.'
    };
}

function getReviewModerationFailureMessage(error) {
    const code = String(error?.code || '');

    if (code === 'GROQ_NOT_CONFIGURED') {
        return 'Review moderation is not configured. Please contact support.';
    }

    return 'Review could not be verified right now. Please edit the review content or try again after checking your connection.';
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
    const bookingTime = normalizeBookingTime(req.body.bookingTime);
    const isGuestBooking = !req.session.user;
    const customerName = (req.body.customerName || req.session.user?.name || '').trim();
    const email = (req.body.email || req.session.user?.email || '').trim();
    const phone = (req.body.phone || req.session.user?.phone || '').trim();

    if (!serviceId || serviceId === 'select') {
        return respondBookingCreateError(req, res, 400, 'Please select a service before confirming your booking.');
    }

    const dateErrorMessage = getBookingDateErrorMessage(bookingDate);

    if (dateErrorMessage) {
        return respondBookingCreateError(req, res, 400, dateErrorMessage, req.get('Referrer') || '/services');
    }

    if (!bookingTime) {
        return respondBookingCreateError(req, res, 400, 'Please choose a valid booking time.', req.get('Referrer') || '/services');
    }

    if (isGuestBooking) {
        if (customerName.length < 2) {
            return respondBookingCreateError(req, res, 400, 'Please enter your full name to continue as guest.', req.get('Referrer') || '/services');
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return respondBookingCreateError(req, res, 400, 'Please enter a valid email address to continue as guest.', req.get('Referrer') || '/services');
        }

        if (!/^[689]\d{7}$/.test(phone)) {
            return respondBookingCreateError(req, res, 400, 'Please enter a valid 8-digit Singapore phone number to continue as guest.', req.get('Referrer') || '/services');
        }
    }

    const holidayName = getPublicHolidayName(bookingDate);

    if (holidayName) {
        return respondBookingCreateError(req, res, 400, `Bookings are unavailable on ${holidayName}. Please choose another date.`, req.get('Referrer') || '/services');
    }

    return MerchantService.findServiceById(serviceId, (serviceError, service) => {
        if (serviceError) {
            console.error(serviceError);
            if (wantsJson(req)) {
                return res.status(500).json({
                    success: false,
                    message: 'The selected service could not be loaded.'
                });
            }
            return res.status(500).render('error', {
                title: 'Booking Error',
                message: 'The selected service could not be loaded.'
            });
        }

        if (!service) {
            if (wantsJson(req)) {
                return res.status(404).json({
                    success: false,
                    message: 'The selected service does not exist.'
                });
            }
            return res.status(404).render('error', {
                title: 'Service Not Found',
                message: 'The selected service does not exist.'
            });
        }

        if (service.inventoryBlocked) {
            return respondBookingCreateError(req, res, 400, 'This service is temporarily unavailable because the required inventory is out of stock.', req.get('Referrer') || '/services');
        }

        const purchaseType = req.body.purchaseType === 'package' && service.packageEnabled ? 'package' : 'single';
        const bookedServiceName = purchaseType === 'package'
            ? `${service.name} (${service.packageSessions}-session package)`
            : service.name;
        const bookedServicePrice = purchaseType === 'package'
            ? Number(service.packagePrice || service.price)
            : Number(service.price || 0);

        return prepareBookingLoyaltyRedemption(req, service, bookedServicePrice, (redemptionError, loyaltyRedemption) => {
            if (redemptionError) {
                return respondBookingCreateError(req, res, 400, redemptionError.message || 'Reward redemption could not be applied.', req.get('Referrer') || '/services');
            }

            return Booking.autoConfirmBooking({
                userId: req.session.user?.id || null,
                serviceId: service.id,
                merchantId: service.salonId,
                merchantName: service.salonName || 'Vaniday merchant',
                customerName,
                email,
                phone,
                bookingDate,
                bookingTime,
                durationMins: service.durationMins,
                servicePrice: loyaltyRedemption.originalServicePrice,
                originalServicePrice: loyaltyRedemption.originalServicePrice,
                loyaltyRedemption
            }, async (bookingError, confirmation) => {
            if (bookingError) {
                console.error(bookingError);
                if (wantsJson(req)) {
                    return res.status(500).json({
                        success: false,
                        message: 'Your booking could not be created.'
                    });
                }
                return res.status(500).render('error', {
                    title: 'Booking Error',
                    message: 'Your booking could not be created.'
                });
            }

            if (!confirmation?.created) {
                return respondBookingCreateError(req, res, 400, confirmation?.message || 'That booking slot is unavailable. Please choose another time.', req.get('Referrer') || '/services');
            }

            try {
                const bookingId = confirmation.result.insertId;
                const bookingReference = buildBookingReference(bookingId, bookingDate);
                notifyBookingCreated(bookingId);

                if (!confirmation.confirmed) {
                    if (wantsJson(req)) {
                        return res.json({
                            success: true,
                            pendingReview: true,
                            message: 'Booking submitted and waiting for merchant approval.',
                            booking: {
                                id: bookingId,
                                displayReference: bookingReference,
                                merchantName: service.salonName || 'Vaniday merchant',
                            serviceName: bookedServiceName,
                            servicePrice: bookedServicePrice,
                            pointsRedeemed: Number(loyaltyRedemption.points || 0),
                            pointsDiscount: Number(loyaltyRedemption.discount || 0),
                            amountPayableAtMerchant: Number(loyaltyRedemption.finalAmountPayable ?? bookedServicePrice),
                            bookingDate,
                                bookingTime,
                                receiptPath: getGuestReceiptPath(bookingId),
                                receiptUrl: getGuestReceiptUrl(req, bookingId),
                                status: 'pending'
                            }
                        });
                    }

                    return res.render('booking-success', {
                        title: 'Booking Pending',
                        merchant: { id: service.salonId, name: service.salonName || 'Vaniday merchant' },
                        service: {
                            ...service,
                            name: bookedServiceName
                        },
                        bookingDate,
                        bookingTime,
                        bookingId,
                        bookingReference,
                        bookingStatus: 'pending',
                        anotherBookingPath: '/services'
                    });
                }

                const checkinUrl = getBookingCheckInUrl(req, bookingId);
                const checkinToken = signBookingCheckInToken(bookingId);
                const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    width: 220
                });
                let emailSkipped = false;

                try {
                    const emailResult = await sendBookingConfirmationEmail({
                        bookingId,
                        displayReference: bookingReference,
                        customerName: customerName || 'Customer',
                        email,
                        merchantName: service.salonName || 'Vaniday merchant',
                        serviceName: bookedServiceName,
                        bookingDate,
                        bookingTime,
                        checkinUrl,
                        checkinToken,
                        qrCodeDataUrl,
                        receiptUrl: getGuestReceiptUrl(req, bookingId)
                    });
                    emailSkipped = Boolean(emailResult?.skipped);
                } catch (emailError) {
                    emailSkipped = true;
                    console.error('Booking confirmation email failed:', emailError.message);
                }

                sendBookingConfirmationSms({
                    bookingId,
                    customerName: customerName || 'Customer',
                    phone,
                    merchantName: service.salonName || 'Vaniday merchant',
                    serviceName: bookedServiceName,
                    bookingDate,
                    bookingTime,
                    checkInUrl: checkinUrl
                }).then((smsResult) => {
                    if (smsResult?.skipped) {
                        console.log('SMS booking confirmation skipped: SMS is not configured or booking phone is missing.');
                    }
                }).catch((smsError) => {
                    console.error('SMS booking confirmation failed:', smsError.message);
                });

                sendBookingNotification({
                    bookingId,
                    customerName: customerName || 'Customer',
                    phone,
                    merchantName: service.salonName || 'Vaniday merchant',
                    serviceName: bookedServiceName,
                    bookingDate,
                    bookingTime,
                    checkInUrl: checkinUrl
                }).then((whatsappResult) => {
                    if (whatsappResult?.skipped) {
                        console.log('WhatsApp booking confirmation skipped: WhatsApp is not configured or booking phone is missing.');
                        return null;
                    }
                    return sendDemoImmediateReminder({
                        id: bookingId,
                        customerName: customerName || 'Customer',
                        phone,
                        merchantName: service.salonName || 'Vaniday merchant',
                        serviceName: bookedServiceName,
                        bookingDate,
                        bookingTime,
                        checkInUrl: checkinUrl
                    });
                }).catch((whatsappError) => {
                    console.error('WhatsApp booking confirmation failed:', whatsappError.message);
                });

                if (wantsJson(req)) {
                    return res.json({
                        success: true,
                        message: emailSkipped
                            ? 'Booking confirmed. Receipt and QR are ready, but the confirmation email was skipped.'
                            : 'Booking confirmed. Receipt, QR, and notifications have been sent.',
                        booking: {
                            id: bookingId,
                            displayReference: bookingReference,
                            customerName: customerName || 'Customer',
                            email,
                            merchantName: service.salonName || 'Vaniday merchant',
                            serviceName: bookedServiceName,
                            servicePrice: bookedServicePrice,
                            purchaseType,
                            pointsRedeemed: Number(loyaltyRedemption.points || 0),
                            pointsDiscount: Number(loyaltyRedemption.discount || 0),
                            amountPayableAtMerchant: Number(loyaltyRedemption.finalAmountPayable ?? bookedServicePrice),
                            bookingDate,
                            bookingTime,
                            appointmentLabel: formatAppointmentDateTime(bookingDate, bookingTime),
                            checkinUrl,
                            checkinToken,
                            receiptPath: getGuestReceiptPath(bookingId),
                            receiptUrl: getGuestReceiptUrl(req, bookingId),
                            status: 'confirmed'
                        },
                        emailSkipped
                    });
                }

                return res.render('booking-email-sent', {
                    title: 'Booking Confirmed',
                    booking: {
                        id: bookingId,
                        displayReference: bookingReference,
                        customerName: customerName || 'Customer',
                        email,
                        merchantName: service.salonName || 'Vaniday merchant',
                        serviceName: bookedServiceName,
                        servicePrice: bookedServicePrice,
                        purchaseType,
                        pointsRedeemed: Number(loyaltyRedemption.points || 0),
                        pointsDiscount: Number(loyaltyRedemption.discount || 0),
                        amountPayableAtMerchant: Number(loyaltyRedemption.finalAmountPayable ?? bookedServicePrice),
                        bookingDate,
                        bookingTime,
                        appointmentLabel: formatAppointmentDateTime(bookingDate, bookingTime),
                        checkinUrl,
                        checkinToken,
                        qrCodeDataUrl,
                        receiptPath: getGuestReceiptPath(bookingId),
                        receiptUrl: getGuestReceiptUrl(req, bookingId)
                    },
                    showQrDebug: process.env.NODE_ENV === 'development',
                    emailSkipped
                });
            } catch (confirmationError) {
                console.error('Booking confirmation page failed:', confirmationError.message);
                if (wantsJson(req)) {
                    return res.status(500).json({
                        success: false,
                        message: 'Booking was created, but the confirmation details could not be prepared.'
                    });
                }
                return res.redirect('/profile');
            }
            });
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

        return res.status(405).render('error', {
            title: 'Completion Requires Merchant Action',
            message: 'Appointments can only be completed from the merchant booking controls after QR check-in.'
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

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDateTime(booking.booking_date, booking.booking_time)) {
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

            if (String(booking.payment_status || booking.status || '').toLowerCase() === 'paid' || booking.transaction_id) {
                Loyalty.reverseCampaignCashbackForReceipt(String(bookingId), (reverseError) => {
                    if (reverseError) {
                        console.error('Campaign cashback reversal failed:', reverseError);
                    }
                });
            }

            if (refundStatus === 'eligible' && Number(booking.points_redeemed || 0) > 0) {
                Booking.refundRedeemedPointsForCancellation(bookingId, userId, (pointsRefundError, refundResult = {}) => {
                    if (pointsRefundError) {
                        console.error('Booking reward points refund failed:', pointsRefundError);
                        return;
                    }

                    if (refundResult.refunded) {
                        notifyUser(userId, 'customer', {
                            actorUserId: userId,
                            type: 'reward_update',
                            title: 'Points refunded',
                            message: `${refundResult.points} points were refunded from your cancelled booking.`,
                            linkUrl: '/profile#wallet',
                            dedupeKey: `booking-points-refunded-${bookingId}`
                        });
                    }
                });
            }

            notifyUser(userId, 'customer', {
                actorUserId: userId,
                type: 'booking_cancelled',
                title: 'Booking cancelled',
                message: `Your ${booking.service_name} booking was cancelled. Refund status: ${refundStatus.replace(/_/g, ' ')}.`,
                linkUrl: '/profile#bookings',
                dedupeKey: `booking-cancelled-customer-${bookingId}`
            });
            notifyUser(booking.merchant_user_id, 'merchant', {
                actorUserId: userId,
                type: 'booking_cancelled',
                title: 'Customer cancelled booking',
                message: `${req.session.user.name || 'A customer'} cancelled ${booking.service_name} for ${String(booking.booking_date).slice(0, 10)} at ${booking.booking_time}.`,
                linkUrl: '/merchant/bookings',
                dedupeKey: `booking-cancelled-merchant-${bookingId}`
            });

            if (refundStatus !== 'eligible') {
                notifyRole('admin', {
                    actorUserId: userId,
                    type: 'booking_cancelled',
                    title: 'Cancellation needs refund review',
                    message: `${req.session.user.name || 'A customer'} cancelled booking #${bookingId}; refund status is ${refundStatus.replace(/_/g, ' ')}.`,
                    linkUrl: '/help-center',
                    dedupeKey: `booking-cancelled-admin-${bookingId}`
                });
            }

            sendBookingCancellationSms({
                customerName: req.session.user.name || booking.customer_name || 'Customer',
                phone: req.session.user.phone || booking.phone,
                merchantName: booking.merchant_name || 'Vaniday merchant',
                serviceName: booking.service_name,
                bookingDate: String(booking.booking_date).slice(0, 10),
                bookingTime: booking.booking_time,
                reason
            }).then((smsResult) => {
                if (smsResult?.skipped) {
                    console.log('SMS cancellation notification skipped: SMS is not configured or customer phone is missing.');
                }
            }).catch((smsError) => {
                console.error('SMS cancellation notification failed:', smsError.message);
            });

            sendBookingCancellationNotification({
                customerName: req.session.user.name || booking.customer_name || 'Customer',
                phone: req.session.user.phone || booking.phone,
                merchantName: booking.merchant_name || 'Vaniday merchant',
                serviceName: booking.service_name,
                bookingDate: String(booking.booking_date).slice(0, 10),
                bookingTime: booking.booking_time,
                reason
            }).then((whatsappResult) => {
                if (whatsappResult?.skipped) {
                    console.log('WhatsApp cancellation notification skipped: WhatsApp is not configured or customer phone is missing.');
                }
            }).catch((whatsappError) => {
                console.error('WhatsApp cancellation notification failed:', whatsappError.message);
            });

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

        const routeTarget = `/checking/${req.params.signedToken}`;
        const bookingStatus = String(booking.status || '').toLowerCase();

        const pointsAwarded = Number(booking.booking_points_awarded || 0);
        const completedMessage = pointsAwarded > 0
            ? `Appointment completed. ${pointsAwarded} loyalty points have been added to your wallet.`
            : 'This appointment has already been completed.';

        return res.render('booking-checkin', {
            title: bookingStatus === 'completed' ? 'Appointment Completed' : 'Scan to Check In',
            booking,
            appointmentLabel: formatAppointmentDateTime(booking.booking_date, booking.booking_time),
            checkinAction: routeTarget,
            canConfirmCheckIn: ['confirmed', 'paid'].includes(bookingStatus) && !booking.checked_in_at,
            message: bookingStatus === 'completed'
                ? completedMessage
                : bookingStatus === 'checked_in'
                    ? 'This appointment has already been checked in. Loyalty points will be added after the merchant completes the service.'
                    : '',
            showQrDebug: process.env.NODE_ENV === 'development',
            checkinUrl: getBookingCheckInUrl(req, bookingId),
            qrDebug: {
                system: 'booking-check-in',
                label: 'Scan to Check In',
                token: req.params.signedToken,
                routeTarget,
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

        const bookingStatus = String(booking.status || '').toLowerCase();
        const routeTarget = `/checking/${req.params.signedToken}`;
        const renderCheckIn = (statusCode, payload) => res.status(statusCode).render('booking-checkin', {
            title: payload.title || 'Scan to Check In',
            booking,
            appointmentLabel: formatAppointmentDateTime(booking.booking_date, booking.booking_time),
            checkinAction: routeTarget,
            checkinUrl: getBookingCheckInUrl(req, bookingId),
            canConfirmCheckIn: false,
            showQrDebug: process.env.NODE_ENV === 'development',
            qrDebug: {
                system: 'booking-check-in',
                label: 'Scan to Check In',
                token: req.params.signedToken,
                routeTarget,
                url: getBookingCheckInUrl(req, bookingId)
            },
            ...payload
        });

        if (bookingStatus === 'checked_in' || booking.checked_in_at) {
            return renderCheckIn(409, {
                title: 'Already Checked In',
                message: 'This appointment has already been checked in. Loyalty points will be added after the merchant completes the service.'
            });
        }

        if (bookingStatus === 'completed') {
            const pointsAwarded = Number(booking.booking_points_awarded || 0);
            return renderCheckIn(200, {
                title: 'Appointment Completed',
                message: pointsAwarded > 0
                    ? `Appointment completed. ${pointsAwarded} loyalty points have been added to your wallet.`
                    : 'This appointment has already been completed.'
            });
        }

        if (!['confirmed', 'paid'].includes(bookingStatus)) {
            return renderCheckIn(409, {
                title: 'Check-In Not Available',
                message: 'Only confirmed bookings can be checked in.'
            });
        }

        return Booking.markCheckedInByToken(bookingId, null, (updateError, updateResult) => {
            if (updateError) {
                console.error(updateError);
                return res.status(500).render('error', {
                    title: 'Check-In Error',
                    message: 'The booking could not be checked in.'
                });
            }

            if (!updateResult?.affectedRows) {
                return renderCheckIn(409, {
                    title: 'Check-In Not Available',
                    message: 'This appointment could not be checked in. It may have already been completed.'
                });
            }

            notifyUser(booking.user_id, 'customer', {
                actorUserId: booking.merchant_user_id,
                type: 'booking_checked_in',
                title: 'Checked in',
                message: `You are checked in for ${booking.service_name} at ${booking.merchant_name}.`,
                linkUrl: '/profile#bookings',
                dedupeKey: `booking-checkin-customer-${booking.id}`
            });
            notifyUser(booking.merchant_user_id, 'merchant', {
                actorUserId: booking.user_id,
                type: 'booking_checked_in',
                title: 'Customer checked in',
                message: `${booking.customer_name || 'A customer'} checked in for ${booking.service_name}.`,
                linkUrl: '/merchant/bookings',
                dedupeKey: `booking-checkin-merchant-${booking.id}`
            });

            return res.render('booking-checkin', {
                title: 'Checked In',
                booking: { ...booking, status: 'checked_in' },
                appointmentLabel: formatAppointmentDateTime(booking.booking_date, booking.booking_time),
                success: 'You are checked in for this appointment. Loyalty points will be added after the merchant completes the service.',
                checkinAction: routeTarget,
                checkinUrl: getBookingCheckInUrl(req, bookingId),
                canConfirmCheckIn: false,
                showQrDebug: process.env.NODE_ENV === 'development',
                qrDebug: {
                    system: 'booking-check-in',
                    label: 'Scan to Check In',
                    token: req.params.signedToken,
                    routeTarget,
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

    const dateErrorMessage = getBookingDateErrorMessage(bookingDate);

    if (dateErrorMessage) {
        return respondProfileAction(req, res, {
            success: false,
            message: dateErrorMessage
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

        if (['completed', 'checked_in'].includes(booking.status) || isPastBookingDateTime(booking.booking_date, booking.booking_time)) {
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

                sendBookingRescheduleSms({
                    customerName: req.session.user.name || booking.customer_name || 'Customer',
                    phone: req.session.user.phone || booking.phone,
                    merchantName: booking.merchant_name || 'Vaniday merchant',
                    serviceName: booking.service_name,
                    bookingDate,
                    bookingTime
                }).then((smsResult) => {
                    if (smsResult?.skipped) {
                        console.log('SMS reschedule notification skipped: SMS is not configured or customer phone is missing.');
                    }
                }).catch((smsError) => {
                    console.error('SMS reschedule notification failed:', smsError.message);
                });

                sendBookingRescheduleNotification({
                    customerName: req.session.user.name || booking.customer_name || 'Customer',
                    phone: req.session.user.phone || booking.phone,
                    merchantName: booking.merchant_name || 'Vaniday merchant',
                    serviceName: booking.service_name,
                    bookingDate,
                    bookingTime
                }).then((whatsappResult) => {
                    if (whatsappResult?.skipped) {
                        console.log('WhatsApp reschedule notification skipped: WhatsApp is not configured or customer phone is missing.');
                    }
                }).catch((whatsappError) => {
                    console.error('WhatsApp reschedule notification failed:', whatsappError.message);
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

            return Booking.getAvailableSlots(
                booking.salon_id,
                booking.service_id,
                bookingDate,
                { excludeBookingId: bookingId, durationMins: booking.duration_mins },
                (slotError, allowedSlots = []) => {
                if (slotError) {
                    console.error(slotError);
                    return respondProfileAction(req, res, {
                        success: false,
                        message: 'That booking slot could not be checked.'
                    });
                }

                if (!allowedSlots.includes(bookingTime)) {
                    const suffix = allowedSlots.length
                        ? ` Suggested alternatives: ${allowedSlots.slice(0, 3).join(', ')}.`
                        : ' No available slots for this date.';
                    return respondProfileAction(req, res, {
                        success: false,
                        message: `The selected time is unavailable.${suffix}`,
                        alternatives: allowedSlots.slice(0, 6)
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
    const requestedDate = String(req.query.bookingDate || '').trim();

    if (!bookingId || !userId) {
        return res.status(404).json({
            success: false,
            message: 'The selected booking could not be found.'
        });
    }

    if (requestedDate) {
        const dateState = Booking.getBookingDateState(requestedDate);

        if (!dateState.valid || dateState.timing === 'past' || dateState.timing === 'too_future') {
            return res.status(400).json({
                success: false,
                message: dateState.timing === 'too_future'
                    ? 'Please choose a booking date within 2 months.'
                    : 'Please choose today or a future booking date.',
                slots: []
            });
        }

        return Booking.getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
            if (lookupError) {
                console.error(lookupError);
                return res.status(500).json({
                    success: false,
                    message: 'Reschedule availability could not be loaded.',
                    slots: []
                });
            }

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'That booking could not be found on your account.',
                    slots: []
                });
            }

            return Booking.getAvailableSlots(
                booking.salon_id,
                booking.service_id,
                requestedDate,
                { excludeBookingId: bookingId, durationMins: booking.duration_mins },
                (slotError, slots = [], meta = {}) => {
                    if (slotError) {
                        console.error(slotError);
                        return res.status(500).json({
                            success: false,
                            message: 'Reschedule availability could not be loaded.',
                            slots: []
                        });
                    }

                    return res.json({
                        success: true,
                        slots,
                        message: slots.length ? '' : 'No available slots for this date.',
                        meta
                    });
                }
            );
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

async function moderateReviewBeforeSave({
    comment,
    rating,
    merchantName,
    serviceName,
    productName,
    verifiedBooking,
    completedBooking,
    imageUpload
}) {
    let textResult = null;
    const hardProfanity = getHardProfanityModeration(comment);

    if (hardProfanity) {
        return {
            allowed: false,
            result: hardProfanity
        };
    }

    if (String(comment || '').trim()) {
        textResult = await moderateReviewText({
            reviewText: comment,
            rating,
            merchantName,
            serviceName,
            productName,
            verifiedBooking,
            completedBooking,
            previousReviewCount: 0,
            duplicateTextCount: 0
        });

        if (textResult.recommendedAction !== 'approve') {
            return {
                allowed: false,
                result: textResult
            };
        }
    }

    if (imageUpload) {
        try {
            const imageResult = await moderateReviewImage({
                imageBase64: getReviewImageDataUrl(imageUpload),
                merchantCategory: '',
                serviceName,
                productName,
                reviewText: comment
            });

            if (imageResult.recommendedAction !== 'approve') {
                return {
                    allowed: false,
                    result: imageResult
                };
            }
        } catch (imageError) {
            console.warn('Review image moderation skipped:', imageError.code || imageError.message);
        }
    }

    return {
        allowed: true,
        result: textResult
    };
}

function submitReview(req, res) {
    const bookingId = Number(req.params.bookingId);
    const userId = req.session.user?.id;
    const rating = normalizeReviewRating(req.body.rating);
    const comment = String(req.body.comment || '').trim().slice(0, 2000);

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

            return moderateReviewBeforeSave({
                comment,
                rating,
                merchantName: booking.merchant_name,
                serviceName: booking.service_name,
                verifiedBooking: true,
                completedBooking: true,
                imageUpload
            }).then((moderation) => {
                if (!moderation.allowed) {
                    removeUploadedReviewMedia(imagePath, videoPath);
                    const reason = moderation.result?.reason || 'Your review needs admin review before it can be posted.';
                    setProfileError(req, reason);
                    setReviewModerationPopup(req, reason);
                    return res.redirect('/profile#to-rate');
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

                notifyUser(booking.merchant_user_id, 'merchant', {
                    actorUserId: userId,
                    type: 'review_received',
                    title: 'New customer review',
                    message: `${req.session.user.name || 'A customer'} left a ${rating}-star review for ${booking.service_name}.`,
                    linkUrl: '/merchant/analytics',
                    dedupeKey: `review-merchant-${bookingId}`
                });

                const reviewReward = {
                    basePoints: 10,
                    mediaPoints: imagePath || videoPath ? 50 : 0,
                    detailPoints: comment.length >= 50 ? 10 : 0
                };

                return Loyalty.awardReviewBonus(userId, bookingId, reviewReward, (rewardError, rewardResult) => {
                    if (rewardError) {
                        console.error(rewardError);
                        setProfileSuccess(req, 'Review submitted successfully.');
                        return res.redirect('/profile#my-reviews');
                    }

                    const awardedPoints = Number(rewardResult?.points || 0);
                    const rewardMessage = awardedPoints > 0
                        ? ` Review reward: +${awardedPoints} points.`
                        : '';

                    if (awardedPoints > 0) {
                        notifyUser(userId, 'customer', {
                            actorUserId: null,
                            type: 'reward_update',
                            title: 'Review reward earned',
                            message: `You earned ${awardedPoints} points for reviewing ${booking.service_name}.`,
                            linkUrl: '/profile#my-reviews',
                            dedupeKey: `review-reward-customer-${bookingId}`
                        });
                    }

                    setProfileSuccess(req, `Review submitted successfully.${rewardMessage}`);
                    return res.redirect('/profile#my-reviews');
                });
                });
            }).catch((moderationError) => {
                console.error('Review moderation failed:', moderationError.code || moderationError.message);
                removeUploadedReviewMedia(imagePath, videoPath);
                const message = getReviewModerationFailureMessage(moderationError);
                setProfileError(req, message);
                setReviewModerationPopup(req, message);
                return res.redirect('/profile#to-rate');
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
