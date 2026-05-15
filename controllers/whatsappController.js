const { promisify } = require('util');
const Booking = require('../models/Booking');
const MerchantService = require('../models/MerchantService');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendBookingNotification, sendWhatsAppText } = require('../utils/whatsappNotifications');

const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

const getAllServices = promisify(MerchantService.getAllServices);
const findServiceById = promisify(MerchantService.findServiceById);
const findCustomerByPhone = promisify(User.findCustomerByPhone);
const hasExistingBooking = promisify(Booking.hasExistingBookingInDatabase);
const createBooking = promisify(Booking.createCustomerBooking);

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

    const date = new Date(`${raw}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Number.isNaN(date.getTime()) || date < today ? '' : raw;
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

function getSession(phone) {
    cleanupSessions();

    const key = normalizePhone(phone);
    const session = sessions.get(key) || { step: 'start' };
    session.updatedAt = Date.now();
    sessions.set(key, session);
    return session;
}

function resetSession(phone) {
    sessions.delete(normalizePhone(phone));
}

function extractIncomingMessages(body = {}) {
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

function getWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
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
    const session = getSession(phone);
    session.step = 'service';
    session.user = user;
    session.services = services.slice(0, 9);

    return sendReply(phone, formatServiceList(session.services));
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
    return sendReply(phone, formatSlotList(service));
}

async function handleDateStep(phone, text, session) {
    const bookingDate = normalizeDate(text);

    if (!bookingDate) {
        return sendReply(phone, 'Please enter a valid future date in YYYY-MM-DD format.');
    }

    session.step = 'time';
    session.bookingDate = bookingDate;

    return sendReply(phone, [
        `Date selected: ${bookingDate}.`,
        `Reply with one of these times: ${(session.service.slots || []).join(', ')}`
    ].join('\n'));
}

async function handleTimeStep(phone, text, session) {
    const bookingTime = normalizeTime(text);
    const slots = (session.service.slots || []).map(normalizeTime).filter(Boolean);

    if (!bookingTime || !slots.includes(bookingTime)) {
        return sendReply(phone, `Please choose an available time: ${(session.service.slots || []).join(', ')}`);
    }

    const exists = await hasExistingBooking(
        session.service.salonId,
        session.service.id,
        session.bookingDate,
        bookingTime
    );

    if (exists) {
        return sendReply(phone, 'That slot is already booked. Please reply with another available time.');
    }

    const result = await createBooking({
        userId: session.user.user_id,
        merchantId: session.service.salonId,
        serviceId: session.service.id,
        bookingDate: session.bookingDate,
        bookingTime,
        status: 'pending'
    });
    const bookingId = result.insertId;
    const booking = {
        customerName: session.user.name,
        email: session.user.email,
        phone: session.user.phone || phone,
        merchantName: session.service.salonName,
        serviceName: session.service.name,
        bookingDate: session.bookingDate,
        bookingTime
    };

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

    const session = getSession(phone);

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

    await sendReply(phone, 'Reply BOOK to start a Vaniday booking.');
}

function postWebhook(req, res) {
    const messages = extractIncomingMessages(req.body);
    res.sendStatus(200);

    messages.forEach((message) => {
        handleIncomingMessage(message).catch((error) => {
            console.error('WhatsApp webhook handling failed:', error);
            sendReply(message.from, 'Sorry, the WhatsApp booking flow could not process that. Reply RESET and try again.');
        });
    });
}

module.exports = {
    getWebhook,
    postWebhook
};
