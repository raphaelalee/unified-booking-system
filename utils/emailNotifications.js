const nodemailer = require('nodemailer');

function getEmailConfig() {
    return {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
    };
}

function isConfigured(config) {
    return Boolean(config.host && config.user && config.pass && config.from);
}

function buildBookingEmailText(booking) {
    return [
        `Hi ${booking.customerName},`,
        '',
        'Your Vaniday booking request has been received.',
        '',
        `Merchant: ${booking.merchantName}`,
        `Service: ${booking.serviceName}`,
        `Date: ${booking.bookingDate}`,
        `Time: ${booking.bookingTime}`,
        '',
        'Please contact the merchant if you need to reschedule or cancel.',
        '',
        'Thank you,',
        'Vaniday'
    ].join('\n');
}

function buildBookingEmailHtml(booking) {
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    return `
        <div style="font-family: Arial, sans-serif; color: #241f1a; line-height: 1.5;">
            <h2>Your Vaniday booking request has been received.</h2>
            <p>Hi ${escapeHtml(booking.customerName)},</p>
            <table style="border-collapse: collapse;">
                <tr><td style="padding: 4px 16px 4px 0;"><strong>Merchant</strong></td><td>${escapeHtml(booking.merchantName)}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0;"><strong>Service</strong></td><td>${escapeHtml(booking.serviceName)}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0;"><strong>Date</strong></td><td>${escapeHtml(booking.bookingDate)}</td></tr>
                <tr><td style="padding: 4px 16px 4px 0;"><strong>Time</strong></td><td>${escapeHtml(booking.bookingTime)}</td></tr>
            </table>
            <p>Please contact the merchant if you need to reschedule or cancel.</p>
            <p>Thank you,<br>Vaniday</p>
        </div>
    `;
}

async function sendBookingConfirmationEmail(booking) {
    const config = getEmailConfig();

    if (!isConfigured(config) || !booking.email) {
        return { skipped: true };
    }

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        },
        tls: {
            rejectUnauthorized: config.rejectUnauthorized
        }
    });

    return transporter.sendMail({
        from: config.from,
        to: booking.email,
        subject: `Vaniday booking request: ${booking.serviceName}`,
        text: buildBookingEmailText(booking),
        html: buildBookingEmailHtml(booking)
    });
}

module.exports = {
    sendBookingConfirmationEmail
};
