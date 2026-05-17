const { promisify } = require('util');
const Booking = require('../models/Booking');
const {
    sendBookingCancellationSms,
    sendBookingReminderSms,
    sendBookingRescheduleSms
} = require('../utils/smsNotifications');

const getReminderCandidates = promisify(Booking.getWhatsAppReminderCandidates);
const markReminderSent = promisify(Booking.markWhatsAppReminderSent);
const getNotificationDetailsById = promisify(Booking.getNotificationDetailsById);

let reminderTimer = null;
let reminderRunning = false;

function pad(value) {
    return String(value).padStart(2, '0');
}

function toMysqlDateTime(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDateOnly(value) {
    if (!value) {
        return '';
    }

    if (value instanceof Date) {
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }

    return String(value).slice(0, 10);
}

function normalizeBooking(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
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
    return String(process.env.SMS_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true';
}

async function sendDueSmsReminders() {
    if (!isEnabled() || reminderRunning) {
        return;
    }

    reminderRunning = true;

    try {
        const now = new Date();
        const reminderHours = Number(process.env.SMS_REMINDER_HOURS || 24);
        const windowMinutes = Number(process.env.SMS_REMINDER_WINDOW_MINUTES || 20);
        const startAt = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + windowMinutes * 60 * 1000);
        const reminderType = `sms-${reminderHours}h`;
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
                const result = await sendBookingReminderSms(normalized);

                if (!result?.skipped) {
                    await markReminderSent(normalized.id, reminderType);
                }
            } catch (error) {
                console.error(`SMS reminder failed for booking ${normalized.id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('SMS reminder job failed:', error);
    } finally {
        reminderRunning = false;
    }
}

function startSmsReminderScheduler() {
    if (!isEnabled() || reminderTimer) {
        return;
    }

    const intervalMinutes = Number(process.env.SMS_REMINDER_INTERVAL_MINUTES || 15);
    const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

    reminderTimer = setInterval(sendDueSmsReminders, intervalMs);
    reminderTimer.unref?.();
    sendDueSmsReminders();
}

async function sendSmsRescheduleForBooking(bookingId) {
    const booking = normalizeBooking(await getNotificationDetailsById(bookingId));

    if (!booking?.phone) {
        return { skipped: true };
    }

    return sendBookingRescheduleSms(booking);
}

async function sendSmsCancellationForBooking(bookingId, reason = '') {
    const booking = normalizeBooking(await getNotificationDetailsById(bookingId));

    if (!booking?.phone) {
        return { skipped: true };
    }

    return sendBookingCancellationSms({
        ...booking,
        reason
    });
}

module.exports = {
    sendDueSmsReminders,
    sendSmsCancellationForBooking,
    sendSmsRescheduleForBooking,
    startSmsReminderScheduler
};
