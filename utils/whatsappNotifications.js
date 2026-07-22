const db = require('../db');
const { sendWhatsAppWebText } = require('../services/whatsappWebClient');

const recentOutboundMessages = new Map();
const OUTBOUND_DEDUPE_TTL_MS = 2 * 60 * 1000;
let notificationLogSchemaReady = false;
let notificationLogSchemaPending = false;
let notificationLogSchemaQueue = [];

function isWhatsAppEnabled() {
    return String(process.env.WHATSAPP_NOTIFICATIONS_ENABLED || process.env.WHATSAPP_AUTOMATION_ENABLED || 'true').toLowerCase() !== 'false';
}

function getProvider() {
    return String(process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
}

function getConfig() {
    return {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_WHATSAPP_FROM,
        statusCallback: process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL
    };
}

function formatRecipientPhone(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');

    if (!digits) {
        return '';
    }

    if (digits.startsWith('65') && digits.length === 10) {
        return `+${digits}`;
    }

    if (/^[689]\d{7}$/.test(digits)) {
        return `+65${digits}`;
    }

    return phone.startsWith('+') ? phone : `+${digits}`;
}

function formatWhatsAppAddress(phone) {
    const formatted = String(phone || '').startsWith('whatsapp:')
        ? String(phone || '').replace(/^whatsapp:/, '')
        : formatRecipientPhone(phone);

    return formatted ? `whatsapp:${formatted}` : '';
}

function buildBookingMessage(booking) {
    return [
        `Hi ${booking.customerName}, your Vaniday booking request has been received.`,
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        `Date: ${booking.bookingDate}`,
        `Time: ${booking.bookingTime}`,
        booking.checkInUrl ? `Check-in: ${booking.checkInUrl}` : '',
        '',
        'WhatsApp actions:',
        'Reply MY BOOKING to view your next booking.',
        'Reply CONFIRM to confirm a pending booking.',
        'Reply RESCHEDULE to change your appointment slot.',
        'Reply CANCEL to cancel your booking.'
    ].filter(Boolean).join('\n');
}

function buildReminderMessage(booking) {
    return [
        `Hi ${booking.customerName}, reminder for your Vaniday booking.`,
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        `Date: ${booking.bookingDate}`,
        `Time: ${booking.bookingTime}`,
        booking.checkInUrl ? `Check-in QR: ${booking.checkInUrl}` : '',
        '',
        'Reply CONFIRM to confirm, RESCHEDULE to change your slot, or CANCEL to cancel.'
    ].filter(Boolean).join('\n');
}

function buildRescheduleMessage(booking) {
    return [
        `Hi ${booking.customerName}, your Vaniday booking has been rescheduled.`,
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        `New date: ${booking.bookingDate}`,
        `New time: ${booking.bookingTime}`,
        'Please check your Help Center updates for details.'
    ].join('\n');
}

function buildCancellationMessage(booking) {
    return [
        `Hi ${booking.customerName}, your Vaniday booking has been cancelled.`,
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        booking.bookingDate ? `Original date: ${booking.bookingDate}` : '',
        booking.bookingTime ? `Original time: ${booking.bookingTime}` : '',
        booking.reason ? `Reason: ${booking.reason}` : '',
        'You can make a new booking from Vaniday when ready.'
    ].filter(Boolean).join('\n');
}

function flushNotificationLogSchema(error) {
    const queue = notificationLogSchemaQueue;
    notificationLogSchemaQueue = [];
    notificationLogSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureNotificationLogSchema(callback) {
    if (notificationLogSchemaReady) {
        callback(null);
        return;
    }

    notificationLogSchemaQueue.push(callback);

    if (notificationLogSchemaPending) {
        return;
    }

    notificationLogSchemaPending = true;

    const sql = `
        CREATE TABLE IF NOT EXISTS whatsapp_notification_logs (
            log_id INT NOT NULL AUTO_INCREMENT,
            booking_id INT NOT NULL,
            notification_type VARCHAR(40) NOT NULL,
            sent_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (log_id),
            UNIQUE KEY uq_whatsapp_notification_booking_type (booking_id, notification_type),
            KEY idx_whatsapp_notification_sent_at (sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) {
            notificationLogSchemaReady = true;
        }

        flushNotificationLogSchema(error);
    });
}

function claimBookingNotification(bookingId, notificationType) {
    const normalizedBookingId = Number(bookingId);
    const normalizedType = String(notificationType || '').trim().slice(0, 40);

    if (!Number.isInteger(normalizedBookingId) || normalizedBookingId <= 0 || !normalizedType) {
        return Promise.resolve({ claimed: true });
    }

    return new Promise((resolve, reject) => {
        ensureNotificationLogSchema((schemaError) => {
            if (schemaError) {
                reject(schemaError);
                return;
            }

            db.query(
                'INSERT IGNORE INTO whatsapp_notification_logs (booking_id, notification_type) VALUES (?, ?)',
                [normalizedBookingId, normalizedType],
                (insertError, result = {}) => {
                    if (insertError) {
                        reject(insertError);
                        return;
                    }

                    resolve({
                        claimed: Number(result.affectedRows || 0) > 0
                    });
                }
            );
        });
    });
}

function releaseBookingNotification(bookingId, notificationType) {
    const normalizedBookingId = Number(bookingId);
    const normalizedType = String(notificationType || '').trim().slice(0, 40);

    if (!Number.isInteger(normalizedBookingId) || normalizedBookingId <= 0 || !normalizedType) {
        return Promise.resolve({ released: false });
    }

    return new Promise((resolve) => {
        ensureNotificationLogSchema((schemaError) => {
            if (schemaError) {
                console.error('WhatsApp notification claim release failed:', schemaError.message || schemaError);
                resolve({ released: false });
                return;
            }

            db.query(
                'DELETE FROM whatsapp_notification_logs WHERE booking_id = ? AND notification_type = ?',
                [normalizedBookingId, normalizedType],
                (deleteError, result = {}) => {
                    if (deleteError) {
                        console.error('WhatsApp notification claim release failed:', deleteError.message || deleteError);
                        resolve({ released: false });
                        return;
                    }

                    resolve({
                        released: Number(result.affectedRows || 0) > 0
                    });
                }
            );
        });
    });
}

function getBookingNotificationId(booking = {}) {
    const directId = Number(booking.bookingId || booking.id);

    if (Number.isInteger(directId) && directId > 0) {
        return directId;
    }

    const tokenMatch = String(booking.checkInUrl || '').match(/\/check(?:ing|in)\/(\d+)\./i);
    const tokenId = Number(tokenMatch?.[1]);

    return Number.isInteger(tokenId) && tokenId > 0 ? tokenId : 0;
}

function cleanupRecentOutboundMessages(now = Date.now()) {
    recentOutboundMessages.forEach((sentAt, key) => {
        if (now - sentAt > OUTBOUND_DEDUPE_TTL_MS) {
            recentOutboundMessages.delete(key);
        }
    });
}

function claimOutboundMessage(phone, body) {
    const to = formatWhatsAppAddress(phone);
    const normalizedBody = String(body || '').trim();

    if (!to || !normalizedBody) {
        return { claimed: true };
    }

    const now = Date.now();
    cleanupRecentOutboundMessages(now);

    const key = `${to}:${normalizedBody}`;
    if (recentOutboundMessages.has(key)) {
        return {
            claimed: false,
            reason: 'duplicate_outbound_message'
        };
    }

    recentOutboundMessages.set(key, now);
    return { claimed: true, key };
}

function releaseOutboundMessageClaim(claim = {}) {
    if (claim.key) {
        recentOutboundMessages.delete(claim.key);
    }
}

async function sendWhatsAppViaTwilio(phone, body) {
    const config = getConfig();
    const to = formatWhatsAppAddress(phone);
    const from = formatWhatsAppAddress(config.from);

    if (!isWhatsAppEnabled() || !config.accountSid || !config.authToken || !from || !to || !body) {
        return { skipped: true, reason: 'twilio_not_configured' };
    }

    const params = new URLSearchParams({
        To: to,
        From: from,
        Body: body.slice(0, 4000)
    });

    if (config.statusCallback) {
        params.set('StatusCallback', config.statusCallback);
    }

    const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        return {
            skipped: true,
            reason: 'twilio_send_failed',
            errorMessage: data.message || `Twilio WhatsApp failed with status ${response.status}`
        };
    }

    return data;
}

async function sendWhatsAppText(phone, message) {
    const provider = getProvider();
    const body = String(message || '').trim();
    const outboundClaim = claimOutboundMessage(phone, body);

    if (!outboundClaim.claimed) {
        return {
            skipped: true,
            reason: outboundClaim.reason
        };
    }

    if (provider === 'whatsapp_web' || provider === 'whatsapp-web' || provider === 'web') {
        const webResult = await sendWhatsAppWebText(phone, body);

        if (!webResult?.skipped) {
            return webResult;
        }

        if ([
            'whatsapp_send_no_lid',
            'whatsapp_number_not_found',
            'whatsapp_web_client_not_ready',
            'whatsapp_web_client_stale'
        ].includes(String(webResult.reason || ''))) {
            const twilioResult = await sendWhatsAppViaTwilio(phone, body);
            if (!twilioResult?.skipped) {
                return twilioResult;
            }

            releaseOutboundMessageClaim(outboundClaim);
            return {
                skipped: true,
                reason: webResult.reason,
                fallbackReason: twilioResult.reason || null,
                errorMessage: twilioResult.errorMessage || null
            };
        }

        if (webResult?.skipped) {
            releaseOutboundMessageClaim(outboundClaim);
        }

        return webResult;
    }

    const twilioResult = await sendWhatsAppViaTwilio(phone, body);
    if (twilioResult?.skipped) {
        releaseOutboundMessageClaim(outboundClaim);
    }

    return twilioResult;
}

async function sendBookingNotification(booking) {
    const bookingId = getBookingNotificationId(booking);
    const notificationType = 'booking_confirmation';
    const claim = await claimBookingNotification(bookingId, 'booking_confirmation');

    if (!claim.claimed) {
        console.log(`WhatsApp booking confirmation skipped as duplicate for booking ${bookingId || 'unknown'}.`);
        return {
            skipped: true,
            reason: 'duplicate_booking_notification'
        };
    }

    console.log(`WhatsApp booking confirmation claimed for booking ${bookingId || 'unknown'}.`);
    try {
        const result = await sendWhatsAppText(booking.phone, buildBookingMessage(booking));

        if (result?.skipped && ![
            'duplicate_outbound_message',
            'invalid_phone',
            'empty_message',
            'whatsapp_disabled',
            'whatsapp_web_provider_disabled'
        ].includes(String(result.reason || ''))) {
            await releaseBookingNotification(bookingId, notificationType);
        }

        return result;
    } catch (error) {
        await releaseBookingNotification(bookingId, notificationType);
        throw error;
    }
}

function sendBookingReminder(booking) {
    return sendWhatsAppText(booking.phone, buildReminderMessage(booking));
}

function sendBookingRescheduleNotification(booking) {
    return sendWhatsAppText(booking.phone, buildRescheduleMessage(booking));
}

function sendBookingCancellationNotification(booking) {
    return sendWhatsAppText(booking.phone, buildCancellationMessage(booking));
}

module.exports = {
    formatRecipientPhone,
    formatWhatsAppAddress,
    sendBookingCancellationNotification,
    sendBookingNotification,
    sendBookingReminder,
    sendBookingRescheduleNotification,
    sendWhatsAppText
};
