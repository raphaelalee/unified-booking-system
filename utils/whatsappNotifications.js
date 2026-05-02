function getConfig() {
    return {
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
        templateName: process.env.WHATSAPP_TEMPLATE_NAME,
        templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US'
    };
}

function formatRecipientPhone(phone) {
    const digits = String(phone || '').replace(/[^\d]/g, '');

    if (!digits) {
        return '';
    }

    if (digits.startsWith('65') && digits.length === 10) {
        return digits;
    }

    if (/^[689]\d{7}$/.test(digits)) {
        return `65${digits}`;
    }

    return digits;
}

function buildBookingMessage(booking) {
    return [
        `Hi ${booking.customerName}, your Vaniday booking request has been received.`,
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        `Date: ${booking.bookingDate}`,
        `Time: ${booking.bookingTime}`,
        'Please contact the merchant if you need to reschedule or cancel.'
    ].join('\n');
}

function buildTemplatePayload(to, booking, config) {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
            name: config.templateName,
            language: {
                code: config.templateLanguage
            },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: booking.customerName },
                        { type: 'text', text: booking.serviceName },
                        { type: 'text', text: booking.merchantName },
                        { type: 'text', text: booking.bookingDate },
                        { type: 'text', text: booking.bookingTime }
                    ]
                }
            ]
        }
    };
}

function buildTextPayload(to, booking) {
    return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
            preview_url: false,
            body: buildBookingMessage(booking)
        }
    };
}

async function sendBookingNotification(booking) {
    const config = getConfig();
    const to = formatRecipientPhone(booking.phone);

    if (!config.accessToken || !config.phoneNumberId || !to) {
        return { skipped: true };
    }

    const payload = config.templateName
        ? buildTemplatePayload(to, booking, config)
        : buildTextPayload(to, booking);

    const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = data?.error?.message || `WhatsApp API returned ${response.status}`;
        throw new Error(message);
    }

    return data;
}

module.exports = {
    sendBookingNotification
};
