const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

function getEmailConfig() {
    const host = process.env.SMTP_HOST;
    const rawPass = process.env.SMTP_PASS || '';
    const pass = String(host || '').toLowerCase().includes('gmail.com')
        ? rawPass.replace(/\s+/g, '')
        : rawPass;

    return {
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        user: process.env.SMTP_USER,
        pass,
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false'
    };
}

function isConfigured(config) {
    return Boolean(config.host && config.user && config.pass && config.from);
}

function isSmtpAuthError(error) {
    const message = String(error?.message || '');

    return error?.code === 'EAUTH'
        || error?.responseCode === 534
        || error?.responseCode === 535
        || /Invalid login|WebLoginRequired|Username and Password not accepted/i.test(message);
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
        booking.receiptUrl ? `Receipt link: ${booking.receiptUrl}` : '',
        booking.checkinUrl ? `Check-in QR link: ${booking.checkinUrl}` : '',
        '',
        'Please contact the merchant if you need to reschedule or cancel.',
        '',
        'Thank you,',
        'Vaniday'
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

function buildBookingEmailHtml(booking, qrCid = '') {
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const qrBlock = booking.checkinUrl
        ? `
                                    <div style="margin-top:24px;padding:18px 20px;background:#f8fbf7;border:1px solid #cfe3d7;border-radius:10px;text-align:center;">
                                        <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#213f32;">Check-in QR</p>
                                        ${qrCid ? `<img src="cid:${qrCid}" alt="Booking check-in QR code" width="180" height="180" style="display:block;margin:0 auto 12px;width:180px;height:180px;border:0;">` : ''}
                                        <p style="margin:0;font-size:13px;line-height:1.5;color:#496356;">Show this QR code when you arrive.</p>
                                        <a href="${escapeHtml(booking.checkinUrl)}" style="display:inline-block;margin:10px 0 0;font-size:12px;line-height:1.5;color:#496356;word-break:break-all;">${escapeHtml(booking.checkinUrl)}</a>
                                    </div>`
        : '';
    const receiptBlock = booking.receiptUrl
        ? `
                                    <div style="margin-top:24px;padding:18px 20px;background:#fffaf3;border:1px solid #e5d8c8;border-radius:10px;">
                                        <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#241f1a;">Receipt</p>
                                        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#5f5448;">Use this link to view or download your booking receipt.</p>
                                        <a href="${escapeHtml(booking.receiptUrl)}" style="display:inline-block;padding:11px 16px;background:#3f513a;color:#fffdf7;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Open receipt</a>
                                    </div>`
        : '';

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
                                        <p style="margin:0;font-size:14px;line-height:1.6;color:#496356;">Keep this email for your appointment reference. Please contact the merchant if you need to reschedule or cancel.</p>
                                    </div>

                                    ${qrBlock}
                                    ${receiptBlock}

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

function normalizeBookingEmail(booking) {
    return {
        ...booking,
        checkinUrl: booking.checkinUrl || booking.checkInUrl || ''
    };
}

async function sendBookingConfirmationEmail(booking) {
    const normalizedBooking = normalizeBookingEmail(booking);
    const config = getEmailConfig();

    if (!isConfigured(config) || !normalizedBooking.email) {
        return { skipped: true };
    }

    const qrCid = normalizedBooking.checkinUrl ? 'booking-check-in-qr@vaniday' : '';
    const attachments = [];

    if (normalizedBooking.checkinUrl) {
        const qrDataUrl = await QRCode.toDataURL(normalizedBooking.checkinUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 280
        });
        const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');

        attachments.push({
            filename: 'booking-check-in-qr.png',
            content: Buffer.from(base64Data, 'base64'),
            contentType: 'image/png',
            cid: qrCid
        });
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

    try {
        return await transporter.sendMail({
            from: config.from,
            to: normalizedBooking.email,
            subject: `Vaniday booking request: ${normalizedBooking.serviceName}`,
            text: buildBookingEmailText(normalizedBooking),
            html: buildBookingEmailHtml(normalizedBooking, qrCid),
            attachments
        });
    } catch (error) {
        if (isSmtpAuthError(error)) {
            console.error('Email booking confirmation skipped: Gmail SMTP rejected the login. Use a Gmail app password in SMTP_PASS, not the normal account password.');
            return { skipped: true, reason: 'smtp_auth_failed' };
        }

        throw error;
    }
}

function buildGiftCardEmailText(entry) {
    return [
        `Hi ${entry.recipientName || 'there'},`,
        '',
        `${entry.senderName ? `${entry.senderName} has sent you` : 'You have received'} a Vaniday gift card.`,
        '',
        `Gift card amount: $${Number(entry.amount || 0).toFixed(2)}`,
        `Voucher code: ${entry.voucherCode}`,
        entry.recipientEmail ? `Recipient email: ${entry.recipientEmail}` : '',
        entry.message ? '' : '',
        entry.message ? 'Message:' : '',
        entry.message || '',
        '',
        `Expiry date: ${entry.expiryDate || 'Valid for 12 months from purchase date'}`,
        '',
        `Redeem your gift card at ${entry.redeemLink}`,
        '',
        'Thank you,',
        'Vaniday'
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

function buildGiftCardEmailHtml(entry) {
    const escapeHtml = (value) => String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    return `
        <div style="margin:0;padding:0;background:#eaf4ee;font-family:Arial,Helvetica,sans-serif;color:#26362f;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#eaf4ee;padding:24px 0;">
                <tr>
                    <td align="center" style="padding:0 12px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:collapse;background:#ffffff;border:1px solid #d9e5dc;border-radius:16px;overflow:hidden;">
                            <tr>
                                <td style="padding:28px 32px;background:linear-gradient(135deg,#235a3e 0%,#7abf88 100%);color:#ffffff;">
                                    <h1 style="margin:0;font-family:Georgia,serif;font-size:30px;line-height:1.1;">Vaniday Gift Card</h1>
                                    <p style="margin:8px 0 0;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#d5f0dd;">Beauty, salon, spa and grooming</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:28px 32px;">
                                    <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#2d3f34;">${escapeHtml(entry.senderName || 'A Vaniday gift card')}</p>
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f3fbf5;border:1px solid #d9e9db;border-radius:12px;">
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #d9e9db;font-size:14px;color:#667c70;">Gift card amount</td>
                                            <td align="right" style="padding:18px 20px;font-size:20px;font-weight:700;color:#214a34;">$${Number(entry.amount || 0).toFixed(2)}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #d9e9db;font-size:14px;color:#667c70;">Voucher code</td>
                                            <td align="right" style="padding:18px 20px;font-size:16px;font-weight:700;color:#214a34;">${escapeHtml(entry.voucherCode)}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding:18px 20px;border-bottom:1px solid #d9e9db;font-size:14px;color:#667c70;">Expires</td>
                                            <td align="right" style="padding:18px 20px;font-size:14px;color:#214a34;">${escapeHtml(entry.expiryDate || '12 months from purchase')}</td>
                                        </tr>
                                    </table>
                                    ${entry.message ? `<div style="margin:24px 0 0;padding:20px;background:#ffffff;border:1px solid #d9e9db;border-radius:12px;"><p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#4a6759;">Personalised message</p><p style="margin:0;font-size:15px;line-height:1.6;color:#2d3f34;">${escapeHtml(entry.message)}</p></div>` : ''}
                                    <div style="margin:24px 0 0;padding:20px;background:#f4fbf4;border:1px solid #dbe9dd;border-radius:12px;">
                                        <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#2e4f38;">Redeem your gift card</p>
                                        <p style="margin:0;font-size:15px;line-height:1.7;color:#3d5d4b;">Use the link below to book your Vaniday appointment and apply the gift card code at checkout.</p>
                                        <p style="margin:16px 0 0;"><a href="${escapeHtml(entry.redeemLink)}" style="display:inline-block;padding:12px 18px;background:#235a3e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;">Redeem on Vaniday</a></p>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:18px 32px;background:#f1f8f1;color:#5d7a66;font-size:12px;line-height:1.6;text-align:center;">
                                    ${escapeHtml(entry.deliveryOption === 'recipient' ? 'This gift card was sent to the recipient email address specified by the buyer.' : 'This gift card was sent to your email address.' )}
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    `;
}

async function sendGiftCardEmail(entry) {
    const normalized = {
        email: entry.email,
        recipientName: entry.recipientName,
        senderName: entry.senderName,
        amount: entry.amount,
        voucherCode: entry.voucherCode,
        message: entry.message,
        expiryDate: entry.expiryDate,
        redeemLink: entry.redeemLink || 'https://vaniday.sg',
        deliveryOption: entry.deliveryOption || 'self'
    };
    const config = getEmailConfig();

    if (!isConfigured(config) || !normalized.email) {
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

    try {
        return await transporter.sendMail({
            from: config.from,
            to: normalized.email,
            subject: `Your Vaniday gift card is ready`,
            text: buildGiftCardEmailText(normalized),
            html: buildGiftCardEmailHtml(normalized)
        });
    } catch (error) {
        if (isSmtpAuthError(error)) {
            console.error('Email gift card delivery skipped: Gmail SMTP rejected the login. Use a Gmail app password in SMTP_PASS, not the normal account password.');
            return { skipped: true, reason: 'smtp_auth_failed' };
        }
        throw error;
    }
}

module.exports = {
    sendBookingConfirmationEmail,
    sendGiftCardEmail
};
