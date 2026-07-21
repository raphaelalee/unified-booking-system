const { promisify } = require('util');
const Booking = require('../models/Booking');
const {
    sendBookingCancellationNotification,
    sendBookingReminder,
    sendBookingRescheduleNotification
} = require('../utils/whatsappNotifications');

const getReminderCandidates = promisify(Booking.getWhatsAppReminderCandidates);
const markReminderSent = promisify(Booking.markWhatsAppReminderSent);
const getNotificationDetailsById = promisify(Booking.getNotificationDetailsById);

let reminderTimer = null;
let reminderRunning = false;

function toMysqlDateTime(date) {
    const pad = (value) => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ' ' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join(':');
}

function toDateOnly(value) {
    if (!value) {
        return '';
    }

    if (value instanceof Date) {
        const pad = (part) => String(part).padStart(2, '0');
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }

    return String(value).slice(0, 10);
}

function normalizeBooking(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id || row.bookingId || row.booking_id,
        userId: row.userId || row.user_id,
        customerName: row.customerName || row.customer_name,
        email: row.email,
        phone: row.phone,
        merchantName: row.merchantName || row.merchant_name,
        merchantUserId: row.merchantUserId || row.merchant_user_id,
        serviceName: row.serviceName || row.service_name,
        bookingDate: toDateOnly(row.bookingDate || row.booking_date),
        bookingTime: row.bookingTime || row.booking_time,
        status: row.status
    };
}

function isEnabled() {
    return String(process.env.WHATSAPP_AUTOMATION_ENABLED || 'true').toLowerCase() !== 'false';
}

function isDemoImmediateReminderEnabled() {
    const configured = process.env.WHATSAPP_DEMO_IMMEDIATE_REMINDER;

    if (configured !== undefined) {
        return String(configured).toLowerCase() === 'true';
    }

    return String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
}

function isTomorrowBooking(bookingDate) {
    const dateKey = toDateOnly(bookingDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateKey === toDateOnly(tomorrow);
}

async function sendDemoImmediateReminder(booking) {
    const normalized = normalizeBooking(booking);

    if (!isEnabled() || !isDemoImmediateReminderEnabled()) {
        return { skipped: true, reason: 'demo_immediate_reminder_disabled' };
    }

    if (!normalized?.id || !normalized.phone) {
        return { skipped: true, reason: 'missing_booking_or_phone' };
    }

    if (!isTomorrowBooking(normalized.bookingDate)) {
        return { skipped: true, reason: 'not_tomorrow_booking' };
    }

    const reminderType = 'demo_immediate';
    const result = await sendBookingReminder({
        ...normalized,
        checkInUrl: booking.checkInUrl || booking.checkinUrl || ''
    });

    if (!result?.skipped) {
        await markReminderSent(normalized.id, reminderType);
        console.log(`WhatsApp demo reminder sent immediately for booking ${normalized.id}.`);
    }

    return result;
}

async function sendDueReminders() {
    if (!isEnabled() || reminderRunning) {
        return;
    }

    reminderRunning = true;

    try {
        const now = new Date();
        const reminderHours = Number(process.env.WHATSAPP_REMINDER_HOURS || 24);
        const windowMinutes = Number(process.env.WHATSAPP_REMINDER_WINDOW_MINUTES || 20);
        const startAt = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + windowMinutes * 60 * 1000);
        const reminderType = `${reminderHours}h`;
        const bookings = await getReminderCandidates(
            toMysqlDateTime(startAt),
            toMysqlDateTime(endAt),
            reminderType
        );

        for (const booking of bookings) {
            const normalized = normalizeBooking(booking);

            if (!normalized?.phone) {
                continue;
            }

            try {
                const result = await sendBookingReminder(normalized);

                if (!result?.skipped) {
                    await markReminderSent(normalized.id, reminderType);
                }
            } catch (error) {
                console.error(`WhatsApp reminder failed for booking ${normalized.id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('WhatsApp reminder job failed:', error);
    } finally {
        reminderRunning = false;
    }
}

function startWhatsAppReminderScheduler() {
    if (!isEnabled() || reminderTimer) {
        return;
    }

    const intervalMinutes = Number(process.env.WHATSAPP_REMINDER_INTERVAL_MINUTES || 15);
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

    reminderTimer = setInterval(sendDueReminders, intervalMs);
    reminderTimer.unref?.();
    sendDueReminders();
}

async function sendRescheduleForBooking(bookingId) {
    const booking = normalizeBooking(await getNotificationDetailsById(bookingId));

    if (!booking?.phone) {
        return { skipped: true };
    }

    return sendBookingRescheduleNotification(booking);
}

async function sendCancellationForBooking(bookingId, reason = '') {
    const booking = normalizeBooking(await getNotificationDetailsById(bookingId));

    if (!booking?.phone) {
        return { skipped: true };
    }

    return sendBookingCancellationNotification({
        ...booking,
        reason
    });
}

module.exports = {
    sendCancellationForBooking,
    sendDemoImmediateReminder,
    sendDueReminders,
    sendRescheduleForBooking,
    startWhatsAppReminderScheduler
};
