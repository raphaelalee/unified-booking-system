function isSmsEnabled() {
    return String(process.env.SMS_NOTIFICATIONS_ENABLED || '').toLowerCase() === 'true';
}

function formatSmsPhone(phone) {
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

function getSmsConfig() {
    return {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_PHONE_NUMBER
    };
}

function getSmsSkipReason(config, to, body) {
    if (!isSmsEnabled()) return 'sms_disabled';
    if (!config.accountSid) return 'missing_twilio_account_sid';
    if (!config.authToken) return 'missing_twilio_auth_token';
    if (!config.from) return 'missing_twilio_phone_number';
    if (!to) return 'invalid_phone';
    if (!String(body || '').trim()) return 'empty_message';
    return '';
}

function buildBookingConfirmationSms(booking) {
    return [
        'Vaniday booking confirmed.',
        `${booking.serviceName} at ${booking.merchantName}`,
        `${booking.bookingDate} ${booking.bookingTime}`,
        booking.checkInUrl ? `Check-in: ${booking.checkInUrl}` : ''
    ].filter(Boolean).join('\n');
}

function buildBookingReminderSms(booking) {
    return [
        'Vaniday reminder.',
        `${booking.serviceName} at ${booking.merchantName}`,
        `${booking.bookingDate} ${booking.bookingTime}`
    ].join('\n');
}

function buildBookingRescheduleSms(booking) {
    return [
        'Vaniday booking rescheduled.',
        `${booking.serviceName} at ${booking.merchantName}`,
        `New slot: ${booking.bookingDate} ${booking.bookingTime}`
    ].join('\n');
}

function buildBookingCancellationSms(booking) {
    return [
        'Vaniday booking cancelled.',
        `${booking.serviceName} at ${booking.merchantName}`,
        booking.reason ? `Reason: ${booking.reason}` : ''
    ].filter(Boolean).join('\n');
}

async function sendSms(phone, body) {
    const config = getSmsConfig();
    const to = formatSmsPhone(phone);
    const reason = getSmsSkipReason(config, to, body);

    if (reason) {
        return { skipped: true, reason };
    }

    const params = new URLSearchParams({
        To: to,
        From: config.from,
        Body: String(body || '').trim().slice(0, 1500)
    });
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
            reason: 'twilio_sms_send_failed',
            status: response.status,
            code: data.code || null,
            errorMessage: data.message || `Twilio SMS failed with status ${response.status}`
        };
    }

    return data;
}

function sendBookingConfirmationSms(booking) {
    return sendSms(booking.phone, buildBookingConfirmationSms(booking));
}

function sendBookingReminderSms(booking) {
    return sendSms(booking.phone, buildBookingReminderSms(booking));
}

function sendBookingRescheduleSms(booking) {
    return sendSms(booking.phone, buildBookingRescheduleSms(booking));
}

function sendBookingCancellationSms(booking) {
    return sendSms(booking.phone, buildBookingCancellationSms(booking));
}

module.exports = {
    formatSmsPhone,
    sendBookingCancellationSms,
    sendBookingConfirmationSms,
    sendBookingReminderSms,
    sendBookingRescheduleSms,
    sendSms
};
