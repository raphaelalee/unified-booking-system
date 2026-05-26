const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const PurchaseHistory = require('../models/PurchaseHistory');
const MerchantService = require('../models/MerchantService');
const {
    getBookingCheckInUrl,
    getPublicBaseUrl,
    signBookingCheckInToken,
    verifyGuestReceiptToken
} = require('../utils/qrToken');
const {
    formatAppointmentDateTime,
    formatDateTime
} = require('../utils/dateTimeFormat');

function getTokenSecret() {
    return process.env.RECEIPT_TOKEN_SECRET
        || process.env.QR_TOKEN_SECRET
        || process.env.SESSION_SECRET
        || 'vaniday_secret_key';
}

function signCheckinToken(receipt) {
    const isPickup = receipt.type !== 'booking';

    return jwt.sign(
        {
            receiptId: String(receipt.id),
            receiptType: receipt.type,
            ...(isPickup ? {
                orderId: getOrderId(receipt),
                purpose: 'pickup'
            } : {})
        },
        getTokenSecret(),
        { expiresIn: '30d' }
    );
}

function getOrderId(receipt) {
    const match = String(receipt?.id || '').match(/^order-(\d+)$/);
    return match ? match[1] : String(receipt?.displayId || receipt?.id || '').replace(/^order-/, '');
}

function isBookingReceipt(receipt) {
    if (!receipt) {
        return false;
    }

    return receipt.type === 'booking'
        || Boolean(receipt.bookingDate || receipt.bookingTime);
}

function getPickupStatusLabel(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const labels = {
        pending_pickup: 'Pending Pickup',
        processing: 'Pending Pickup',
        packed: 'Pending Pickup',
        ready: 'Pending Pickup',
        picked_up: 'Picked Up',
        delivered: 'Picked Up',
        cancelled: 'Cancelled'
    };

    return labels[normalized] || 'Pending Pickup';
}

function isCollectedStatus(value) {
    return ['picked_up', 'collected', 'delivered'].includes(String(value || '').trim().toLowerCase());
}

function getFulfilmentLabel(value) {
    return String(value || '').toLowerCase() === 'delivery' ? 'Delivery' : 'Merchant Pickup';
}

function formatStatusLabel(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeIcsText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line) {
    const chunks = [];
    let remaining = String(line || '');

    while (remaining.length > 74) {
        chunks.push(remaining.slice(0, 74));
        remaining = ` ${remaining.slice(74)}`;
    }

    chunks.push(remaining);
    return chunks.join('\r\n');
}

function getDateKey(value) {
    if (!value) {
        return '';
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    }

    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseTimeParts(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);

    return match
        ? { hours: Number(match[1]), minutes: Number(match[2]) }
        : { hours: 0, minutes: 0 };
}

function addMinutesToLocalParts(dateKey, timeValue, durationMins) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const time = parseTimeParts(timeValue);
    const duration = Math.max(15, Number(durationMins || 60));

    if (!match) {
        return null;
    }

    const date = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        time.hours,
        time.minutes + duration
    ));

    return {
        dateKey: date.toISOString().slice(0, 10),
        time: date.toISOString().slice(11, 16)
    };
}

function formatIcsLocalDateTime(dateKey, timeValue) {
    const cleanDate = String(dateKey || '').replace(/-/g, '');
    const time = parseTimeParts(timeValue);

    if (!cleanDate || cleanDate.length !== 8) {
        return '';
    }

    return `${cleanDate}T${String(time.hours).padStart(2, '0')}${String(time.minutes).padStart(2, '0')}00`;
}

function formatIcsUtcStamp(value = new Date()) {
    return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildBookingCalendarIcs(receipt) {
    const serviceName = receipt.items?.[0]?.name || 'Service booking';
    const dateKey = getDateKey(receipt.bookingDate);
    const bookingTime = receipt.bookingTime || '09:00';
    const endParts = addMinutesToLocalParts(dateKey, bookingTime, receipt.durationMins);
    const startValue = formatIcsLocalDateTime(dateKey, bookingTime);
    const endValue = endParts ? formatIcsLocalDateTime(endParts.dateKey, endParts.time) : '';
    const description = [
        `Booking ID: ${receipt.id}`,
        `Service: ${serviceName}`,
        `Merchant: ${receipt.merchantName || 'Vaniday merchant'}`,
        receipt.merchantAddress ? `Address: ${receipt.merchantAddress}` : '',
        receipt.durationMins ? `Duration: ${receipt.durationMins} minutes` : '',
        `Status: ${receipt.statusLabel || receipt.status || receipt.paymentStatus || 'confirmed'}`
    ].filter(Boolean).join('\n');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Vaniday//Booking Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:vaniday-booking-${receipt.id}@vaniday.local`,
        `DTSTAMP:${formatIcsUtcStamp()}`,
        `DTSTART;TZID=Asia/Singapore:${startValue}`,
        `DTEND;TZID=Asia/Singapore:${endValue}`,
        `SUMMARY:${escapeIcsText(`Vaniday Booking - ${serviceName}`)}`,
        `LOCATION:${escapeIcsText(receipt.merchantAddress || receipt.merchantName || 'Vaniday merchant')}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ];

    return lines.map(foldIcsLine).join('\r\n');
}

function buildGoogleCalendarUrl(receipt) {
    const serviceName = receipt.items?.[0]?.name || 'Service booking';
    const dateKey = getDateKey(receipt.bookingDate);
    const bookingTime = receipt.bookingTime || '09:00';
    const endParts = addMinutesToLocalParts(dateKey, bookingTime, receipt.durationMins);
    const startValue = formatIcsLocalDateTime(dateKey, bookingTime);
    const endValue = endParts ? formatIcsLocalDateTime(endParts.dateKey, endParts.time) : startValue;
    const description = [
        `Booking ID: ${receipt.id}`,
        `Service: ${serviceName}`,
        `Merchant: ${receipt.merchantName || 'Vaniday merchant'}`,
        receipt.merchantAddress ? `Address: ${receipt.merchantAddress}` : '',
        receipt.durationMins ? `Duration: ${receipt.durationMins} minutes` : '',
        `Status: ${receipt.statusLabel || receipt.status || receipt.paymentStatus || 'confirmed'}`
    ].filter(Boolean).join('\n');
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: `Vaniday Booking - ${serviceName}`,
        dates: `${startValue}/${endValue}`,
        ctz: 'Asia/Singapore',
        details: description,
        location: receipt.merchantAddress || receipt.merchantName || 'Vaniday merchant'
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function getPickupMerchantName(receipt) {
    if (receipt.pickupMerchantName) {
        return receipt.pickupMerchantName;
    }

    if (receipt.merchantName && receipt.merchantName !== 'Delivery') {
        return receipt.merchantName;
    }

    const merchantNames = (receipt.items || [])
        .map((item) => item.merchantName || item.detail)
        .filter(Boolean);

    return Array.from(new Set(merchantNames)).join(', ') || 'Vaniday merchant';
}

function getReceiptMode(receipt) {
    const isBooking = isBookingReceipt(receipt);
    const isProductPickup = !isBooking && (String(receipt.fulfilment || 'pickup').toLowerCase() === 'pickup');

    return {
        receiptType: isBooking ? 'booking' : 'product',
        isBooking,
        isProductPickup,
        fulfilmentLabel: isBooking ? '' : getFulfilmentLabel(receipt.fulfilment || 'pickup'),
        pickupMerchantName: isBooking ? '' : getPickupMerchantName(receipt),
        pickupStatusLabel: isBooking ? '' : getPickupStatusLabel(receipt.pickupStatus || receipt.deliveryStatus)
    };
}

function verifyCheckinToken(id, token) {
    try {
        const payload = jwt.verify(token, getTokenSecret());
        return String(payload.receiptId) === String(id) ? payload : null;
    } catch (error) {
        return null;
    }
}

function getSessionReceipt(req, id) {
    const receipt = req.session.receipts?.[String(id)];

    if (!receipt) {
        return null;
    }

    return receipt;
}

function getLastPaymentHighlight(req, receiptId) {
    const highlight = req.session.lastPayment;

    if (!highlight || String(highlight.receiptId || '') !== String(receiptId)) {
        return null;
    }

    req.session.lastPayment = null;
    return highlight;
}

function mapBookingReceipt(row, req) {
    if (!row) {
        return null;
    }

    const appointmentLabel = formatAppointmentDateTime(row.booking_date, row.booking_time);

    return {
        id: row.id,
        type: 'booking',
        userId: row.user_id,
        userName: row.customer_name,
        merchantName: row.merchant_name,
        merchantAddress: row.merchant_address || '',
        merchantUserId: row.merchant_user_id,
        durationMins: Number(row.duration_mins || 60),
        items: [
            {
                name: row.service_name,
                type: 'Service',
                quantity: 1,
                unitPrice: Number(row.service_price || 0),
                lineTotal: Number(row.service_price || 0),
                detail: appointmentLabel
            }
        ],
        totalAmount: Number(row.service_price || 0),
        paymentMethod: row.payment_status === 'paid' ? 'Paid booking' : 'No payment required',
        paymentStatus: row.payment_status || row.status,
        paidAt: row.paid_at || row.checked_in_at || null,
        bookingDate: row.booking_date,
        bookingTime: row.booking_time,
        status: row.status,
        transactionId: row.transaction_id || null,
        qrCodeToken: row.qr_code_token || '',
        checkedInAt: row.checked_in_at || null
    };
}

function mapOrderReceipt(order) {
    if (!order) {
        return null;
    }

    return {
        id: `order-${order.id}`,
        displayId: order.id,
        type: 'order',
        userId: order.userId,
        userName: order.userName || order.customerName || 'Customer',
        merchantName: order.merchantName || 'Vaniday merchant',
        items: order.items,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        deliveryStatus: order.deliveryStatus,
        merchantUserIds: order.merchantUserIds || [],
        fulfilment: 'pickup',
        pickupMerchantName: order.merchantName || 'Vaniday merchant',
        pickupStatus: getPickupStatusLabel(order.pickupStatus || order.deliveryStatus),
        pickupAt: order.collectedAt || null,
        paidAt: order.createdAt || new Date().toISOString()
    };
}

function getBookingReceiptById(id) {
    return new Promise((resolve, reject) => {
        Booking.getReceiptById(id, (error, booking) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(mapBookingReceipt(booking));
        });
    });
}

function getCustomerPurchaseHistoryReceipt(id, userId) {
    return new Promise((resolve, reject) => {
        PurchaseHistory.getByReceiptId(id, userId, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(PurchaseHistory.mapReceipt(row));
        });
    });
}

function getAnyPurchaseHistoryReceipt(id) {
    return new Promise((resolve, reject) => {
        PurchaseHistory.getByReceiptIdAny(id, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(PurchaseHistory.mapReceipt(row));
        });
    });
}

function getCustomerOrderReceipt(orderId, userId) {
    return new Promise((resolve, reject) => {
        Transaction.getOrderReceiptById(orderId, userId, (error, order) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(mapOrderReceipt(order));
        });
    });
}

function getAnyOrderReceipt(orderId) {
    return new Promise((resolve, reject) => {
        Transaction.getPickupVerificationById(orderId, (error, order) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(mapOrderReceipt(order));
        });
    });
}

function getMerchantForUser(userId) {
    if (!userId) {
        return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
        MerchantService.getMerchantByUserId(userId, (error, merchant) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(merchant || null);
        });
    });
}

function receiptItemsBelongToMerchant(receipt, merchant, merchantUserId) {
    const merchantId = merchant?.id ? String(merchant.id) : '';
    const userId = merchantUserId ? String(merchantUserId) : '';

    if (receipt?.merchantUserId && userId && String(receipt.merchantUserId) === userId) {
        return true;
    }

    if (Array.isArray(receipt?.merchantUserIds) && userId && receipt.merchantUserIds.some((id) => String(id) === userId)) {
        return true;
    }

    if (merchantId && receipt?.pickupMerchantId && String(receipt.pickupMerchantId) === merchantId) {
        return true;
    }

    return (receipt?.items || []).some((item) => {
        return (merchantId && String(item.merchantId || item.salonId || '') === merchantId)
            || (userId && String(item.merchantUserId || '') === userId);
    });
}

function canViewReceipt(req, receipt, merchant = null) {
    const user = req.session.user;

    if (!user && receipt?.type === 'booking') {
        const tokenBookingId = verifyGuestReceiptToken(req.query.receiptToken || req.query.token);
        return tokenBookingId && String(tokenBookingId) === String(receipt.id);
    }

    if (!user || !receipt) {
        return false;
    }

    if (user.role === 'admin') {
        return true;
    }

    if (user.role === 'customer') {
        return String(receipt.userId) === String(user.id);
    }

    if (user.role === 'merchant') {
        return receiptItemsBelongToMerchant(receipt, merchant, user.id);
    }

    return false;
}

function verifyPickupToken(orderId, token) {
    try {
        const payload = jwt.verify(token, getTokenSecret());
        const receiptId = `order-${orderId}`;

        if (payload.purpose !== 'pickup') {
            return null;
        }

        if (String(payload.orderId) !== String(orderId) || String(payload.receiptId) !== receiptId) {
            return null;
        }

        return payload;
    } catch (error) {
        return null;
    }
}

async function loadReceipt(req, id) {
    const user = req.session.user;
    const merchant = user?.role === 'merchant' ? await getMerchantForUser(user.id) : null;
    const sessionReceipt = getSessionReceipt(req, id);

    if (sessionReceipt && canViewReceipt(req, sessionReceipt, merchant)) {
        return sessionReceipt;
    }

    if (/^\d+$/.test(String(id))) {
        const bookingReceipt = await getBookingReceiptById(id);
        if (bookingReceipt) {
            return canViewReceipt(req, bookingReceipt, merchant) ? bookingReceipt : null;
        }
    }

    if (!user) {
        return null;
    }

    const orderMatch = String(id).match(/^order-(\d+)$/);

    if (orderMatch) {
        const orderReceipt = user.role === 'customer'
            ? await getCustomerOrderReceipt(orderMatch[1], user.id)
            : await getAnyOrderReceipt(orderMatch[1]);
        if (orderReceipt) {
            return canViewReceipt(req, orderReceipt, merchant) ? orderReceipt : null;
        }
    }

    const persistentReceipt = user.role === 'customer'
        ? await getCustomerPurchaseHistoryReceipt(id, user.id)
        : await getAnyPurchaseHistoryReceipt(id);

    if (persistentReceipt) {
        if (user.role === 'customer') {
            persistentReceipt.userName = user.name || persistentReceipt.userName || 'Customer';
        } else {
            persistentReceipt.userName = persistentReceipt.userName || 'Customer';
        }

        return canViewReceipt(req, persistentReceipt, merchant) ? persistentReceipt : null;
    }

    return null;
}

async function buildReceiptViewModel(req, id) {
    const loadedReceipt = await loadReceipt(req, id);

    if (!loadedReceipt) {
        return null;
    }

    const receiptMode = getReceiptMode(loadedReceipt);
    const appointmentLabel = receiptMode.isBooking
        ? formatAppointmentDateTime(loadedReceipt.bookingDate, loadedReceipt.bookingTime)
        : '';
    const receipt = receiptMode.isBooking
        ? {
            ...loadedReceipt,
            statusLabel: formatStatusLabel(loadedReceipt.status || 'confirmed'),
            appointmentLabel,
            items: (loadedReceipt.items || []).map((item) => ({
                ...item,
                detail: appointmentLabel || item.detail
            }))
        }
        : loadedReceipt;
    const token = receiptMode.isBooking ? signBookingCheckInToken(receipt.id) : signCheckinToken(receipt);
    const verificationUrl = receiptMode.isBooking
        ? getBookingCheckInUrl(req, receipt.id)
        : `${getPublicBaseUrl(req)}/pickup-verify/order/${encodeURIComponent(getOrderId(receipt))}?token=${encodeURIComponent(token)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 260
    });

    return {
        title: `Receipt ${receipt.id}`,
        receipt,
        lastPaymentHighlight: getLastPaymentHighlight(req, receipt.id),
        ...receiptMode,
        supportRequestPath: `/help-center?receiptId=${encodeURIComponent(receipt.id)}`,
        viewerRole: req.session.user?.role || '',
        checkinUrl: verificationUrl,
        verificationUrl,
        checkinToken: token,
        qrLabel: receiptMode.isBooking ? 'Appointment Check-In QR' : 'Pickup Verification QR',
        qrDescription: receiptMode.isBooking
            ? 'Scan this QR code at the merchant counter to check in for your appointment.'
            : 'Show this QR code to the merchant when collecting your item.',
        qrSystem: receiptMode.isBooking ? 'booking-check-in' : 'pickup-verification',
        qrRouteTarget: receiptMode.isBooking
            ? `/checking/${token}`
            : `/pickup-verify/order/${getOrderId(receipt)}?token=${token}`,
        qrCodeDataUrl,
        showQrDebug: process.env.NODE_ENV === 'development',
        appointmentLabel,
        paidAtLabel: formatDateTime(receipt.paidAt || receipt.checkedInAt || new Date()),
        checkedInAtLabel: formatDateTime(receipt.checkedInAt),
        pickupAtLabel: formatDateTime(receipt.pickupAt)
    };
}

async function showReceipt(req, res) {
    try {
        const data = await buildReceiptViewModel(req, req.params.id);

        if (!data) {
            return res.status(404).render('error', {
                title: 'Receipt Not Found',
                message: 'This receipt could not be found.'
            });
        }

        return res.render('receipt', {
            ...data,
            pdfMode: false
        });
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Receipt Error',
            message: 'The receipt could not be loaded.'
        });
    }
}

async function downloadReceiptPdf(req, res) {
    let browser;

    try {
        const data = await buildReceiptViewModel(req, req.params.id);

        if (!data) {
            return res.status(404).render('error', {
                title: 'Receipt Not Found',
                message: 'This receipt could not be found.'
            });
        }

        const html = await new Promise((resolve, reject) => {
            req.app.render('receipt', {
                ...data,
                pdfMode: true,
                currentUser: req.session.user || null,
                cartCount: res.locals.cartCount || 0
            }, (error, rendered) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(rendered);
            });
        });

        const htmlWithBase = html.replace('<head>', `<head><base href="${getPublicBaseUrl(req)}/">`);

        let pdf;

        try {
            browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();
            await page.setContent(htmlWithBase, { waitUntil: 'networkidle0' });
            pdf = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '18mm',
                    right: '14mm',
                    bottom: '18mm',
                    left: '14mm'
                }
            });
        } catch (puppeteerError) {
            console.error(puppeteerError);
            pdf = await buildFallbackPdf(data);
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${data.receipt.id}.pdf"`);
        return res.send(pdf);
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'PDF Error',
            message: 'The receipt PDF could not be generated.'
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function downloadBookingCalendar(req, res) {
    try {
        const data = await buildReceiptViewModel(req, req.params.id);

        if (!data || !data.isBooking) {
            return res.status(404).render('error', {
                title: 'Calendar Not Found',
                message: 'This booking calendar file could not be found.'
            });
        }

        const filename = `vaniday-booking-${data.receipt.id}.ics`;
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buildBookingCalendarIcs(data.receipt));
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Calendar Error',
            message: 'The calendar file could not be generated.'
        });
    }
}

async function openBookingGoogleCalendar(req, res) {
    try {
        const data = await buildReceiptViewModel(req, req.params.id);

        if (!data || !data.isBooking) {
            return res.status(404).render('error', {
                title: 'Calendar Not Found',
                message: 'This booking calendar event could not be found.'
            });
        }

        return res.redirect(buildGoogleCalendarUrl(data.receipt));
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Calendar Error',
            message: 'The Google Calendar event could not be opened.'
        });
    }
}

function buildFallbackPdf(data) {
    return new Promise(async (resolve, reject) => {
        const buffers = [];
        const doc = new PDFDocument({ margin: 42, size: 'A4' });

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        try {
            const brandGreen = '#3f513a';
            const sage = '#dfe6dc';
            const paleSage = '#f3f6f1';
            const muted = '#667266';
            const ink = '#263126';
            const qrBuffer = await QRCode.toBuffer(data.verificationUrl || data.checkinUrl, {
                errorCorrectionLevel: 'M',
                margin: 2,
                width: 220
            });
            const receipt = data.receipt;
            const pageWidth = doc.page.width;
            const left = doc.page.margins.left;
            const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;

            doc.rect(0, 0, pageWidth, 132).fill(sage);
            doc.circle(left + 19, 42, 17).fill(brandGreen);
            doc.fillColor('#ffffff').font('Times-Bold').fontSize(22).text('V', left + 12, 30);
            doc.fillColor(brandGreen).font('Times-Bold').fontSize(26).text('Vaniday', left + 48, 26);
            doc.fillColor(muted).font('Helvetica').fontSize(9).text('Beauty and wellness booking system', left + 50, 56);
            doc.fillColor(ink).font('Times-Bold').fontSize(34).text('Receipt', left, 82);
            doc.fillColor(muted).font('Helvetica').fontSize(11).text(`#${receipt.displayId || receipt.id}`, left + 360, 92, {
                width: contentWidth - 360,
                align: 'right'
            });

            const metaTop = 156;
            const metaBoxWidth = (contentWidth - 18) / 2;
            const metaRows = [
                ['Customer', receipt.userName],
                ['Payment', receipt.paymentMethod],
                ['Date/time', data.paidAtLabel],
                ['Status', data.isProductPickup ? data.pickupStatusLabel : (receipt.statusLabel || receipt.paymentStatus || receipt.status || 'paid')]
            ];

            metaRows.forEach(([label, value], index) => {
                const x = left + (index % 2) * (metaBoxWidth + 18);
                const y = metaTop + Math.floor(index / 2) * 66;
                doc.roundedRect(x, y, metaBoxWidth, 52, 8).fill(paleSage);
                doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text(label.toUpperCase(), x + 14, y + 11);
                doc.fillColor(ink).font('Helvetica-Bold').fontSize(12).text(String(value || '-'), x + 14, y + 27, {
                    width: metaBoxWidth - 28,
                    ellipsis: true
                });
            });

            const itemsTop = 304;
            doc.fillColor(ink).font('Times-Bold').fontSize(20).text('Items and services', left, itemsTop);
            doc.roundedRect(left, itemsTop + 34, contentWidth, 34, 8).fill(brandGreen);
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
            doc.text('Description', left + 16, itemsTop + 47);
            doc.text('Qty', left + 330, itemsTop + 47, { width: 40, align: 'right' });
            doc.text('Amount', left + 410, itemsTop + 47, { width: contentWidth - 426, align: 'right' });

            let y = itemsTop + 82;
            (receipt.items || []).forEach((item, index) => {
                const quantity = Number(item.quantity || 1);
                const lineTotal = Number(item.lineTotal || item.unitPrice || 0);
                const rowHeight = item.detail ? 48 : 34;

                if (index % 2 === 0) {
                    doc.roundedRect(left, y - 9, contentWidth, rowHeight, 6).fill('#fbfcfa');
                }

                doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(item.name, left + 16, y, { width: 290 });
                doc.fillColor(muted).font('Helvetica').fontSize(9).text(item.type || 'Item', left + 16, y + 15, { width: 290 });
                doc.fillColor(ink).font('Helvetica').fontSize(11).text(String(quantity), left + 330, y + 5, {
                    width: 40,
                    align: 'right'
                });
                doc.font('Helvetica-Bold').text(`$${lineTotal.toFixed(2)}`, left + 410, y + 5, {
                    width: contentWidth - 426,
                    align: 'right'
                });

                if (item.detail) {
                    doc.fillColor(muted).font('Helvetica').fontSize(9).text(item.detail, left + 16, y + 29, { width: 380 });
                }

                y += rowHeight;
            });

            const totalY = Math.max(y + 18, 470);
            if (data.isProductPickup) {
                doc.fillColor(ink).font('Times-Bold').fontSize(16).text('Pickup details', left, totalY - 24);
                doc.fillColor(muted).font('Helvetica').fontSize(10).text(
                    `Fulfilment Method: ${data.fulfilmentLabel}\nPickup Merchant: ${data.pickupMerchantName}\nPickup Status: ${data.pickupStatusLabel}`,
                    left,
                    totalY,
                    { width: 260, lineGap: 4 }
                );
            }

            doc.roundedRect(left + contentWidth - 210, totalY, 210, 58, 8).fill(sage);
            doc.fillColor(muted).font('Helvetica-Bold').fontSize(9).text('TOTAL AMOUNT', left + contentWidth - 190, totalY + 13);
            doc.fillColor(brandGreen).font('Helvetica-Bold').fontSize(22).text(
                `$${Number(receipt.totalAmount || 0).toFixed(2)}`,
                left + contentWidth - 190,
                totalY + 28,
                { width: 170, align: 'right' }
            );

            const qrTop = totalY + 92;
            doc.roundedRect(left, qrTop, contentWidth, 188, 10).fill(paleSage);
            doc.fillColor(ink).font('Times-Bold').fontSize(20).text(data.qrLabel, left + 24, qrTop + 24);
            doc.fillColor(muted).font('Helvetica').fontSize(10).text(
                data.qrDescription,
                left + 24,
                qrTop + 52,
                { width: 270 }
            );
            doc.fillColor(muted).font('Helvetica').fontSize(8).text(
                `Verification link: ${data.verificationUrl || data.checkinUrl}`,
                left + 24,
                qrTop + 92,
                { width: 270, lineGap: 2 }
            );
            doc.roundedRect(left + contentWidth - 174, qrTop + 18, 150, 150, 8).fill('#ffffff');
            doc.image(qrBuffer, left + contentWidth - 162, qrTop + 30, { width: 126 });

            doc.fillColor(muted).font('Helvetica').fontSize(8).text(
                'Generated by Vaniday Booking System',
                left,
                doc.page.height - 58,
                { width: contentWidth, align: 'center' }
            );

            doc.end();
        } catch (error) {
            doc.destroy(error);
        }
    });
}

function checkIn(req, res) {
    const payload = verifyCheckinToken(req.params.id, req.query.token);

    if (!payload) {
        return res.status(403).render('error', {
            title: 'Invalid Check-In',
            message: 'This check-in link is invalid or expired.'
        });
    }

    if (payload.receiptType === 'order') {
        return res.render('checkin-success', {
            title: 'Pickup Verified',
            receiptId: req.params.id,
            receiptType: 'product pickup'
        });
    }

    return res.render('checkin-success', {
        title: 'Check-In Successful',
        receiptId: req.params.id,
        receiptType: payload.receiptType || 'receipt'
    });
}

function verifyPickup(req, res) {
    const receiptId = `order-${req.params.id}`;
    const payload = verifyPickupToken(req.params.id, req.query.token);

    if (!payload) {
        return res.status(403).render('pickup-verification', {
            title: 'Pickup Verification',
            invalid: true,
            message: 'Invalid or expired pickup QR.',
            order: null,
            token: req.query.token || '',
            canConfirm: false,
            alreadyCollected: false,
            permissionMessage: '',
            currentUser: req.session.user || null,
            cartCount: res.locals.cartCount || 0
        });
    }

    return Transaction.getPickupVerificationById(req.params.id, (error, order) => {
        if (error) {
            console.error(error);
            return res.status(500).render('error', {
                title: 'Pickup Verification Error',
                message: 'Pickup details could not be loaded.'
            });
        }

        if (!order) {
            return res.status(404).render('error', {
                title: 'Order Not Found',
                message: 'This pickup order could not be found.'
            });
        }

        const currentUser = req.session.user || null;
        const alreadyCollected = isCollectedStatus(order.pickupStatus);
        const canConfirm = !alreadyCollected
            && String(order.paymentStatus || '').toLowerCase() === 'paid';
        const message = req.session.pickupVerificationMessage || '';
        req.session.pickupVerificationMessage = null;

        return res.render('pickup-verification', {
            title: 'Pickup Verification',
            invalid: false,
            message,
            order: {
                ...order,
                receiptId,
                pickupStatusLabel: getPickupStatusLabel(order.pickupStatus),
                paymentStatusLabel: formatStatusLabel(order.paymentStatus || 'paid'),
                createdAtLabel: formatDateTime(order.createdAt),
                collectedAtLabel: formatDateTime(order.collectedAt),
                quantityTotal: (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
            },
            token: req.query.token || '',
            canConfirm,
            alreadyCollected,
            permissionMessage: !alreadyCollected && !canConfirm ? 'This order is not paid, so pickup cannot be confirmed.' : '',
            currentUser,
            cartCount: res.locals.cartCount || 0
        });
    });
}

function confirmPickup(req, res) {
    const receiptId = `order-${req.params.id}`;
    const token = req.body.token || req.query.token || '';
    const payload = verifyPickupToken(req.params.id, token);
    const redirectPath = `/pickup-verify/order/${encodeURIComponent(req.params.id)}?token=${encodeURIComponent(token)}`;

    if (!payload) {
        return res.status(403).render('pickup-verification', {
            title: 'Pickup Verification',
            invalid: true,
            message: 'Invalid or expired pickup QR.',
            order: null,
            token,
            canConfirm: false,
            alreadyCollected: false,
            permissionMessage: '',
            currentUser: req.session.user || null,
            cartCount: res.locals.cartCount || 0
        });
    }

    return Transaction.getPickupVerificationById(req.params.id, (lookupError, order) => {
        if (lookupError) {
            console.error(lookupError);
            return res.status(500).render('error', {
                title: 'Pickup Verification Error',
                message: 'Pickup details could not be loaded.'
            });
        }

        if (!order) {
            return res.status(404).render('error', {
                title: 'Order Not Found',
                message: 'This pickup order could not be found.'
            });
        }

        if (String(order.paymentStatus || '').toLowerCase() !== 'paid') {
            req.session.pickupVerificationMessage = 'This order is not paid, so pickup cannot be confirmed.';
            return res.redirect(redirectPath);
        }

        if (isCollectedStatus(order.pickupStatus)) {
            req.session.pickupVerificationMessage = 'This item has already been collected.';
            return res.redirect(redirectPath);
        }

        return Transaction.markPickupCollected(req.params.id, (updateError, result) => {
            if (updateError) {
                console.error(updateError);
                return res.status(500).render('error', {
                    title: 'Pickup Confirmation Error',
                    message: 'Pickup could not be confirmed.'
                });
            }

            if (!result?.affectedRows) {
                req.session.pickupVerificationMessage = 'This item has already been collected.';
                return res.redirect(redirectPath);
            }

            PurchaseHistory.markPickupCollected(receiptId, (historyError) => {
                if (historyError) {
                    console.error(historyError);
                }

                req.session.pickupVerificationMessage = 'Pickup confirmed successfully.';
                return res.redirect(redirectPath);
            });
        });
    });
}

module.exports = {
    showReceipt,
    downloadReceiptPdf,
    downloadBookingCalendar,
    openBookingGoogleCalendar,
    checkIn,
    verifyPickup,
    confirmPickup
};
