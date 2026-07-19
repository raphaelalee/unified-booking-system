const { sendWhatsAppWebText } = require('../services/whatsappWebClient');

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

    if (provider === 'whatsapp_web' || provider === 'whatsapp-web' || provider === 'web') {
        const webResult = await sendWhatsAppWebText(phone, body);

        if (!webResult?.skipped) {
            return webResult;
        }

        if (['whatsapp_send_no_lid', 'whatsapp_number_not_found'].includes(String(webResult.reason || ''))) {
            const twilioResult = await sendWhatsAppViaTwilio(phone, body);
            if (!twilioResult?.skipped) {
                return twilioResult;
            }

            return {
                skipped: true,
                reason: webResult.reason,
                fallbackReason: twilioResult.reason || null,
                errorMessage: twilioResult.errorMessage || null
            };
        }

        return webResult;
    }

    return sendWhatsAppViaTwilio(phone, body);
}

function sendBookingNotification(booking) {
    return sendWhatsAppText(booking.phone, buildBookingMessage(booking));
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
