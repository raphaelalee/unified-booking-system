const { promisify } = require('util');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Notification = require('../models/Notification');
const User = require('../models/User');
const WhatsAppSession = require('../models/WhatsAppSession');
const { sendBookingNotification, sendWhatsAppText } = require('../utils/whatsappNotifications');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

const getAllServices = promisify(MerchantService.getAllServices);
const findServiceById = promisify(MerchantService.findServiceById);
const findCustomerByPhone = promisify(User.findCustomerByPhone);
const getAvailableSlots = promisify(Booking.getAvailableSlots);
const autoConfirmBooking = promisify(Booking.autoConfirmBooking);
const cancelForCustomer = promisify(Booking.cancelForCustomer);
const createRescheduleRequest = promisify(Booking.createRescheduleRequest);
const getNextManageableByUserId = promisify(Booking.getNextManageableByUserId);
const markConfirmedForCustomer = promisify(Booking.markConfirmedForCustomer);
const updateScheduleForCustomer = promisify(Booking.updateScheduleForCustomer);

function cleanupSessions() {
    const now = Date.now();

    sessions.forEach((session, key) => {
        if (now - session.updatedAt > SESSION_TTL_MS) {
            sessions.delete(key);
        }
    });
}

function normalizePhone(value) {
    return String(value || '').replace(/[^\d]/g, '');
}

function normalizeDate(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return '';
    }

    const state = Booking.getBookingDateState(raw);

    return state.valid && state.timing !== 'past' && state.timing !== 'too_future' ? raw : '';
}

function normalizeTime(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

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

function formatServiceList(services) {
    const lines = services.slice(0, 9).map((service) => {
        const price = Number(service.price || 0).toFixed(2);
        return `${service.id}. ${service.name} at ${service.salonName} - $${price}`;
    });

    return [
        'Reply with a service number to start booking:',
        ...lines,
        '',
        'Example: 12'
    ].join('\n');
}

function formatSlotList(service) {
    const slots = (service.slots || []).slice(0, 12);

    if (slots.length === 0) {
        return 'This service has no published slots. Please choose another service.';
    }

    return [
        `Selected: ${service.name} at ${service.salonName}.`,
        'Reply with your preferred date in YYYY-MM-DD format.',
        `Available times later: ${slots.join(', ')}`
    ].join('\n');
}

function toDateOnly(value) {
    if (!value) {
        return '';
    }

    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    return String(value).slice(0, 10);
}

function formatBookingSummary(booking) {
    if (!booking) {
        return '';
    }

    return [
        `${booking.service_name} at ${booking.merchant_name}`,
        `${toDateOnly(booking.booking_date)} at ${booking.booking_time}`,
        `Status: ${String(booking.status || '').replace(/_/g, ' ')}`,
        `Booking ID: ${booking.id}`
    ].join('\n');
}

async function getSession(phone) {
    cleanupSessions();

    const key = normalizePhone(phone);
    let session = sessions.get(key);

    if (!session) {
        session = await new Promise((resolve) => {
            WhatsAppSession.load(key, (error, storedSession) => {
                if (error) console.error('WhatsApp session could not be loaded:', error);
                resolve(storedSession || { step: 'start' });
            });
        });
    }

    session.updatedAt = Date.now();
    sessions.set(key, session);
    return session;
}

function resetSession(phone) {
    const key = normalizePhone(phone);
    sessions.delete(key);
    WhatsAppSession.remove(key, (error) => {
        if (error) console.error('WhatsApp session could not be cleared:', error);
    });
}

function persistSession(phone, session) {
    return new Promise((resolve) => {
        WhatsAppSession.save(normalizePhone(phone), session, (error) => {
            if (error) console.error('WhatsApp session could not be saved:', error);
            resolve();
        });
    });
}

function extractIncomingMessages(body = {}) {
    if (body.From && body.Body !== undefined) {
        return [{
            from: body.From,
            text: body.Body,
            type: body.MessageType || 'text'
        }];
    }

    const entries = Array.isArray(body.entry) ? body.entry : [];
    return entries.flatMap((entry) => {
        return (entry.changes || []).flatMap((change) => {
            const value = change.value || {};
            return (value.messages || []).map((message) => ({
                from: message.from,
                text: message.text?.body || message.button?.text || '',
                type: message.type
            }));
        });
    });
}

function isStatusCallback(body = {}) {
    return Boolean(body.MessageStatus || body.SmsStatus || body.MessageSid || body.SmsSid)
        && body.Body === undefined
        && !Array.isArray(body.entry);
}

function getWebhookBodyKeys(body = {}) {
    return Object.keys(body || {}).slice(0, 12).join(', ') || 'none';
}

function getWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }

    return res.status(200).send('Twilio WhatsApp webhook is ready.');
}

async function sendReply(phone, message) {
    try {
        await sendWhatsAppText(phone, message);
    } catch (error) {
        console.error('WhatsApp reply failed:', error.message);
    }
}

async function handleStart(phone) {
    const user = await findCustomerByPhone(phone);

    if (!user) {
        resetSession(phone);
        return sendReply(phone, [
            'Hi, this WhatsApp booking flow is available for registered Vaniday customers.',
            'Please sign up or add this WhatsApp number to your Vaniday profile first.'
        ].join('\n'));
    }

    const services = await getAllServices();
    const session = await getSession(phone);
    session.step = 'service';
    session.user = user;
    session.services = services.slice(0, 9);
    await persistSession(phone, session);

    return sendReply(phone, formatServiceList(session.services));
}

async function findRegisteredCustomerOrReply(phone) {
    const user = await findCustomerByPhone(phone);

    if (!user) {
        await sendReply(phone, [
            'I could not find a Vaniday customer account linked to this WhatsApp number.',
            'Please add this phone number to your profile, then reply BOOK to start.'
        ].join('\n'));
        return null;
    }

    return user;
}

async function handleMyBooking(phone) {
    const user = await findRegisteredCustomerOrReply(phone);

    if (!user) {
        return;
    }

    const booking = await getNextManageableByUserId(user.user_id);

    if (!booking) {
        return sendReply(phone, 'You have no upcoming manageable bookings. Reply BOOK to make a new booking.');
    }

    return sendReply(phone, [
        'Your next Vaniday booking:',
        formatBookingSummary(booking),
        '',
        'Reply CONFIRM to confirm, RESCHEDULE to change the slot, or CANCEL to cancel.'
    ].join('\n'));
}

async function handleConfirmBooking(phone) {
    const user = await findRegisteredCustomerOrReply(phone);

    if (!user) {
        return;
    }

    const booking = await getNextManageableByUserId(user.user_id);

    if (!booking) {
        return sendReply(phone, 'There is no upcoming booking to confirm. Reply BOOK to make a new booking.');
    }

    if (String(booking.status || '').toLowerCase() !== 'pending') {
        return sendReply(phone, [
            'This booking is already active in Vaniday:',
            formatBookingSummary(booking)
        ].join('\n'));
    }

    await markConfirmedForCustomer(booking.id, user.user_id);

    Notification.create({
        recipientUserId: user.user_id,
        recipientRole: 'customer',
        type: 'booking_confirmed',
        title: 'Booking confirmed via WhatsApp',
        message: `${booking.service_name} at ${booking.merchant_name} is confirmed for ${toDateOnly(booking.booking_date)} at ${booking.booking_time}.`,
        linkUrl: '/profile#bookings',
        dedupeKey: `whatsapp-confirm-customer-${booking.id}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    Notification.create({
        recipientUserId: booking.merchant_user_id,
        recipientRole: 'merchant',
        actorUserId: user.user_id,
        type: 'booking_confirmed',
        title: 'Customer confirmed via WhatsApp',
        message: `${user.name || 'A customer'} confirmed ${booking.service_name} for ${toDateOnly(booking.booking_date)} at ${booking.booking_time}.`,
        linkUrl: '/merchant/bookings',
        dedupeKey: `whatsapp-confirm-merchant-${booking.id}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    return sendReply(phone, [
        'Booking confirmed. Thank you.',
        formatBookingSummary({ ...booking, status: 'confirmed' })
    ].join('\n'));
}

async function handleCancelBooking(phone) {
    const user = await findRegisteredCustomerOrReply(phone);

    if (!user) {
        return;
    }

    const booking = await getNextManageableByUserId(user.user_id);

    if (!booking) {
        return sendReply(phone, 'There is no upcoming booking to cancel. Reply BOOK to make a new booking.');
    }

    const result = await cancelForCustomer(booking.id, user.user_id, 'Cancelled by WhatsApp reply', 'customer_cancelled_review');

    if (!result?.affectedRows) {
        return sendReply(phone, 'This booking could not be cancelled. It may have already changed or been completed.');
    }

    Notification.create({
        recipientUserId: user.user_id,
        recipientRole: 'customer',
        type: 'booking_cancelled',
        title: 'Booking cancelled via WhatsApp',
        message: `${booking.service_name} at ${booking.merchant_name} was cancelled from WhatsApp.`,
        linkUrl: '/profile#bookings',
        dedupeKey: `whatsapp-cancel-customer-${booking.id}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    Notification.create({
        recipientUserId: booking.merchant_user_id,
        recipientRole: 'merchant',
        actorUserId: user.user_id,
        type: 'booking_cancelled',
        title: 'Customer cancelled via WhatsApp',
        message: `${user.name || 'A customer'} cancelled ${booking.service_name} for ${toDateOnly(booking.booking_date)} at ${booking.booking_time}.`,
        linkUrl: '/merchant/bookings',
        dedupeKey: `whatsapp-cancel-merchant-${booking.id}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    return sendReply(phone, [
        'Your booking has been cancelled in Vaniday.',
        formatBookingSummary({ ...booking, status: 'cancelled' }),
        'Refund eligibility can be reviewed from your profile or Help Center.'
    ].join('\n'));
}

async function handleRescheduleBooking(phone) {
    const user = await findRegisteredCustomerOrReply(phone);

    if (!user) {
        return;
    }

    const booking = await getNextManageableByUserId(user.user_id);

    if (!booking) {
        return sendReply(phone, 'There is no upcoming booking to reschedule. Reply BOOK to make a new booking.');
    }

    const session = await getSession(phone);
    session.step = 'reschedule_date';
    session.user = user;
    session.booking = booking;
    session.availableSlots = [];
    await persistSession(phone, session);

    return sendReply(phone, [
        'Reschedule request started.',
        formatBookingSummary(booking),
        '',
        'Reply with your new date in YYYY-MM-DD format.'
    ].join('\n'));
}

async function handleRescheduleDateStep(phone, text, session) {
    const bookingDate = normalizeDate(text);

    if (!bookingDate) {
        return sendReply(phone, 'Please enter a valid new date in YYYY-MM-DD format, from today up to 2 months ahead.');
    }

    const booking = session.booking;
    const slots = await getAvailableSlots(
        booking.salon_id,
        booking.service_id,
        bookingDate,
        { excludeBookingId: booking.id, durationMins: booking.duration_mins }
    );

    if (!slots.length) {
        return sendReply(phone, 'No available slots for that date. Please reply with another date.');
    }

    session.step = 'reschedule_time';
    session.bookingDate = bookingDate;
    session.availableSlots = slots;
    await persistSession(phone, session);

    return sendReply(phone, [
        `Date selected: ${bookingDate}.`,
        `Reply with one of these times: ${slots.join(', ')}`
    ].join('\n'));
}

async function handleRescheduleTimeStep(phone, text, session) {
    const bookingTime = normalizeTime(text);
    const slots = (session.availableSlots || []).map(normalizeTime).filter(Boolean);

    if (!bookingTime || !slots.includes(bookingTime)) {
        return sendReply(phone, slots.length
            ? `Please choose an available time: ${(session.availableSlots || []).join(', ')}`
            : 'No available slots are currently selected. Reply RESCHEDULE to start again.');
    }

    const booking = session.booking;
    const result = await updateScheduleForCustomer(
        booking.id,
        session.user.user_id,
        session.bookingDate,
        bookingTime
    );

    if (!result?.affectedRows) {
        resetSession(phone);
        return sendReply(phone, 'This booking could not be rescheduled. It may have already changed or been cancelled.');
    }

    await createRescheduleRequest({
        bookingId: booking.id,
        userId: session.user.user_id,
        merchantId: booking.salon_id,
        serviceId: booking.service_id,
        oldBookingDate: toDateOnly(booking.booking_date),
        oldBookingTime: booking.booking_time,
        requestedBookingDate: session.bookingDate,
        requestedBookingTime: bookingTime,
        status: 'auto_approved',
        confidenceLevel: 'high',
        confidenceScore: 100,
        decisionReason: 'Customer rescheduled through WhatsApp after choosing an available slot.',
        reviewNotes: 'Saved by WhatsApp automation.'
    }).catch((error) => {
        console.error('WhatsApp reschedule history could not be saved:', error);
    });

    Notification.create({
        recipientUserId: session.user.user_id,
        recipientRole: 'customer',
        type: 'booking_reschedule_auto_approved',
        title: 'Booking rescheduled via WhatsApp',
        message: `${booking.service_name} at ${booking.merchant_name} was moved to ${session.bookingDate} at ${bookingTime}.`,
        linkUrl: '/profile#bookings',
        dedupeKey: `whatsapp-reschedule-customer-${booking.id}-${session.bookingDate}-${bookingTime}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    Notification.create({
        recipientUserId: booking.merchant_user_id,
        recipientRole: 'merchant',
        actorUserId: session.user.user_id,
        type: 'booking_reschedule_auto_approved',
        title: 'Customer rescheduled via WhatsApp',
        message: `${session.user.name || 'A customer'} moved ${booking.service_name} to ${session.bookingDate} at ${bookingTime}.`,
        linkUrl: '/merchant/bookings',
        dedupeKey: `whatsapp-reschedule-merchant-${booking.id}-${session.bookingDate}-${bookingTime}`,
        metadata: { bookingId: booking.id }
    }, (error) => {
        if (error) console.error(error);
    });

    resetSession(phone);

    return sendReply(phone, [
        'Your booking has been rescheduled in Vaniday.',
        `${booking.service_name} at ${booking.merchant_name}`,
        `${session.bookingDate} at ${bookingTime}`,
        `Booking ID: ${booking.id}`
    ].join('\n'));
}

async function handleServiceStep(phone, text, session) {
    const serviceId = Number(text);
    const service = (session.services || []).find((item) => Number(item.id) === serviceId)
        || await findServiceById(serviceId);

    if (!service) {
        return sendReply(phone, 'Please reply with a valid service number from the list, or type RESET to restart.');
    }

    session.step = 'date';
    session.service = service;
    await persistSession(phone, session);
    return sendReply(phone, formatSlotList(service));
}

async function handleDateStep(phone, text, session) {
    const bookingDate = normalizeDate(text);

    if (!bookingDate) {
        return sendReply(phone, 'Please enter a valid date in YYYY-MM-DD format, from today up to 2 months ahead.');
    }

    session.step = 'time';
    session.bookingDate = bookingDate;
    session.availableSlots = await getAvailableSlots(session.service.salonId, session.service.id, bookingDate);

    if (!session.availableSlots.length) {
        session.step = 'date';
    }
    await persistSession(phone, session);

    return sendReply(phone, [
        `Date selected: ${bookingDate}.`,
        session.availableSlots.length
            ? `Reply with one of these times: ${session.availableSlots.join(', ')}`
            : 'No available slots for this date. Please reply with another date.'
    ].join('\n'));
}

async function handleTimeStep(phone, text, session) {
    const bookingTime = normalizeTime(text);
    const slots = (session.availableSlots || []).map(normalizeTime).filter(Boolean);

    if (!bookingTime || !slots.includes(bookingTime)) {
        return sendReply(phone, slots.length
            ? `Please choose an available time: ${(session.availableSlots || []).join(', ')}`
            : 'No available slots for this date. Please reply with another date.');
    }

    const confirmation = await autoConfirmBooking({
        userId: session.user.user_id,
        merchantId: session.service.salonId,
        serviceId: session.service.id,
        bookingDate: session.bookingDate,
        bookingTime,
        durationMins: session.service.durationMins
    });

    if (!confirmation?.created) {
        return sendReply(phone, confirmation?.message || 'That slot is unavailable. Please reply with another time.');
    }

    const bookingId = confirmation.result.insertId;
    const booking = {
        customerName: session.user.name,
        email: session.user.email,
        phone: session.user.phone || phone,
        merchantName: session.service.salonName,
        serviceName: session.service.name,
        bookingDate: session.bookingDate,
        bookingTime
    };

    if (!confirmation.confirmed) {
        Notification.create({
            recipientUserId: session.user.user_id,
            recipientRole: 'customer',
            type: 'booking',
            title: 'WhatsApp booking pending review',
            message: `${booking.serviceName} at ${booking.merchantName} was saved for ${booking.bookingDate} at ${booking.bookingTime} and is waiting for merchant review.`,
            linkUrl: '/profile#bookings',
            dedupeKey: `whatsapp-booking-pending-customer-${bookingId}`,
            metadata: { bookingId }
        }, (error) => {
            if (error) console.error(error);
        });

        resetSession(phone);

        return sendReply(phone, [
            'Your booking request has been saved in Vaniday and is pending merchant review.',
            `${booking.serviceName} at ${booking.merchantName}`,
            `${booking.bookingDate} at ${booking.bookingTime}`,
            `Booking ID: ${bookingId}`
        ].join('\n'));
    }

    Notification.create({
        recipientUserId: session.user.user_id,
        recipientRole: 'customer',
        type: 'booking_confirmed',
        title: 'WhatsApp booking confirmed',
        message: `${booking.serviceName} at ${booking.merchantName} is booked for ${booking.bookingDate} at ${booking.bookingTime}.`,
        linkUrl: '/profile#bookings',
        dedupeKey: `whatsapp-booking-customer-${bookingId}`,
        metadata: { bookingId }
    }, (error) => {
        if (error) {
            console.error(error);
        }
    });

    Booking.getNotificationDetailsById(bookingId, (error, notificationBooking) => {
        if (error || !notificationBooking) {
            if (error) {
                console.error('WhatsApp booking notification lookup failed:', error.message || error);
            }
            return;
        }

        Notification.create({
            recipientUserId: notificationBooking.merchant_user_id,
            recipientRole: 'merchant',
            actorUserId: session.user.user_id,
            type: 'booking',
            title: 'New WhatsApp booking received',
            message: `${session.user.name || 'A customer'} booked ${booking.serviceName} for ${booking.bookingDate} at ${booking.bookingTime}.`,
            linkUrl: '/merchant/bookings',
            dedupeKey: `whatsapp-booking-merchant-${bookingId}`,
            metadata: { bookingId }
        }, (notificationError) => {
            if (notificationError) {
                console.error(notificationError);
            }
        });

        Notification.createForRole('admin', {
            actorUserId: session.user.user_id,
            type: 'booking',
            title: 'New WhatsApp booking',
            message: `${session.user.name || 'A customer'} booked ${booking.serviceName} at ${booking.merchantName}.`,
            linkUrl: '/admin/bookings',
            dedupeKey: `whatsapp-booking-admin-${bookingId}`,
            metadata: { bookingId }
        }, (notificationError) => {
            if (notificationError) {
                console.error(notificationError);
            }
        });
    });

    await sendBookingNotification(booking).catch((error) => {
        console.error('WhatsApp booking confirmation failed:', error.message);
    });
    resetSession(phone);

    return sendReply(phone, [
        'Your booking is confirmed.',
        `${booking.serviceName} at ${booking.merchantName}`,
        `${booking.bookingDate} at ${booking.bookingTime}`,
        `Booking ID: ${bookingId}`
    ].join('\n'));
}

async function handleIncomingMessage(message) {
    const phone = normalizePhone(message.from);
    const text = String(message.text || '').trim();

    if (!phone || !text) {
        return;
    }

    console.log(`WhatsApp inbound message from ${phone}: ${text}`);

    if (/^(hi|hello|book|booking|start)$/i.test(text)) {
        resetSession(phone);
        await handleStart(phone);
        return;
    }

    if (/^reset$/i.test(text)) {
        resetSession(phone);
        await sendReply(phone, 'Booking flow reset. Reply BOOK to start again.');
        return;
    }

    if (/^(my booking|status|appointment)$/i.test(text)) {
        resetSession(phone);
        await handleMyBooking(phone);
        return;
    }

    if (/^(confirm|yes)$/i.test(text)) {
        resetSession(phone);
        await handleConfirmBooking(phone);
        return;
    }

    if (/^(reschedule|change)$/i.test(text)) {
        resetSession(phone);
        await handleRescheduleBooking(phone);
        return;
    }

    if (/^(cancel|cancel booking)$/i.test(text)) {
        resetSession(phone);
        await handleCancelBooking(phone);
        return;
    }

    const session = await getSession(phone);

    if (session.step === 'service') {
        await handleServiceStep(phone, text, session);
        return;
    }

    if (session.step === 'date') {
        await handleDateStep(phone, text, session);
        return;
    }

    if (session.step === 'time') {
        await handleTimeStep(phone, text, session);
        return;
    }

    if (session.step === 'reschedule_date') {
        await handleRescheduleDateStep(phone, text, session);
        return;
    }

    if (session.step === 'reschedule_time') {
        await handleRescheduleTimeStep(phone, text, session);
        return;
    }

    await sendReply(phone, 'Reply BOOK to start a Vaniday booking.');
}

function postWebhook(req, res) {
    const messages = extractIncomingMessages(req.body);
    res.sendStatus(200);

    if (!messages.length) {
        if (isStatusCallback(req.body)) {
            console.log(`WhatsApp status callback received: ${req.body.MessageStatus || req.body.SmsStatus || 'unknown'}`);
            return;
        }

        console.warn(`WhatsApp webhook received no inbound message. Body keys: ${getWebhookBodyKeys(req.body)}`);
        return;
    }

    messages.forEach((message) => {
        handleIncomingMessage(message).catch((error) => {
            console.error('WhatsApp webhook handling failed:', error);
            sendReply(message.from, 'Sorry, the WhatsApp booking flow could not process that. Reply RESET and try again.');
        });
    });
}

module.exports = {
    handleIncomingMessage,
    getWebhook,
    postWebhook
};
