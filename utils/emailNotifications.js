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
        <div style="margin:0;padding:0;background:#f5efe5;font-family:Arial,Helvetica,sans-serif;color:#241f1a;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f5efe5;padding:24px 0;">
                <tr>
                    <td align="center" style="padding:24px 12px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:collapse;background:#fffaf3;border:1px solid #ded2c3;border-radius:14px;overflow:hidden;">
                            <tr>
                                <td style="padding:28px 32px;background:#1f1812;color:#fffaf3;">
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                                        <tr>
                                            <td style="font-size:24px;font-weight:700;letter-spacing:0;">Vaniday</td>
                                            <td align="right" style="font-size:12px;text-transform:uppercase;font-weight:700;color:#d8c7b2;">Booking received</td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:32px;">
                                    <p style="margin:0 0 10px;font-size:13px;text-transform:uppercase;font-weight:700;color:#7b6a56;">Appointment request</p>
                                    <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.12;color:#241f1a;">Your booking request has been received.</h1>
                                    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#5f5448;">Hi ${escapeHtml(booking.customerName)}, we have recorded your Vaniday booking request. Here are the details.</p>

                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8f1e8;border:1px solid #e5d8c8;border-radius:10px;">
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:13px;text-transform:uppercase;font-weight:700;color:#7b6a56;">Merchant</td>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:15px;font-weight:700;color:#241f1a;">${escapeHtml(booking.merchantName)}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:13px;text-transform:uppercase;font-weight:700;color:#7b6a56;">Service</td>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:15px;font-weight:700;color:#241f1a;">${escapeHtml(booking.serviceName)}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:13px;text-transform:uppercase;font-weight:700;color:#7b6a56;">Date</td>
                                            <td style="padding:18px 20px;border-bottom:1px solid #e5d8c8;font-size:15px;font-weight:700;color:#241f1a;">${escapeHtml(booking.bookingDate)}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:18px 20px;font-size:13px;text-transform:uppercase;font-weight:700;color:#7b6a56;">Time</td>
                                            <td style="padding:18px 20px;font-size:15px;font-weight:700;color:#241f1a;">${escapeHtml(booking.bookingTime)}</td>
                                        </tr>
                                    </table>

                                    <div style="margin-top:24px;padding:18px 20px;background:#ecf4ef;border:1px solid #cfe3d7;border-radius:10px;">
                                        <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#213f32;">Next step</p>
                                        <p style="margin:0;font-size:14px;line-height:1.6;color:#496356;">Please contact the merchant if you need to reschedule or cancel. Keep this email for your appointment reference.</p>
                                    </div>

                                    <p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#5f5448;">Thank you,<br><strong>Vaniday</strong></p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:18px 32px;background:#efe4d5;color:#7b6a56;font-size:12px;line-height:1.5;text-align:center;">
                                    Beauty, wellness, rewards, and refined bookings.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
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
