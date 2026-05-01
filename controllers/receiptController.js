const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer');
const Booking = require('../models/Booking');

function getTokenSecret() {
    return process.env.RECEIPT_TOKEN_SECRET
        || process.env.QR_TOKEN_SECRET
        || process.env.SESSION_SECRET
        || 'vaniday_secret_key';
}

function getPublicBaseUrl(req) {
    return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function signCheckinToken(receipt) {
    return jwt.sign(
        {
            receiptId: String(receipt.id),
            receiptType: receipt.type
        },
        getTokenSecret(),
        { expiresIn: '30d' }
    );
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

    if (req.session.user && String(receipt.userId) !== String(req.session.user.id)) {
        return null;
    }

    return receipt;
}

function mapBookingReceipt(row, req) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        type: 'booking',
        userId: row.user_id,
        userName: row.customer_name,
        merchantName: row.merchant_name,
        items: [
            {
                name: row.service_name,
                type: 'Service',
                quantity: 1,
                unitPrice: Number(row.service_price || 0),
                lineTotal: Number(row.service_price || 0),
                detail: `${row.booking_date} at ${row.booking_time}`
            }
        ],
        totalAmount: Number(row.service_price || 0),
        paymentMethod: 'Recorded payment',
        paidAt: new Date().toISOString(),
        bookingDate: row.booking_date,
        bookingTime: row.booking_time,
        status: row.status
    };
}

function loadReceipt(req, id) {
    const sessionReceipt = getSessionReceipt(req, id);

    if (sessionReceipt) {
        return Promise.resolve(sessionReceipt);
    }

    return new Promise((resolve, reject) => {
        Booking.getReceiptById(id, (error, booking) => {
            if (error) {
                reject(error);
                return;
            }

            if (booking && req.session.user && String(booking.user_id) !== String(req.session.user.id)) {
                resolve(null);
                return;
            }

            resolve(mapBookingReceipt(booking, req));
        });
    });
}

async function buildReceiptViewModel(req, id) {
    const receipt = await loadReceipt(req, id);

    if (!receipt) {
        return null;
    }

    const token = signCheckinToken(receipt);
    const checkinUrl = `${getPublicBaseUrl(req)}/checkin/${encodeURIComponent(receipt.id)}?token=${encodeURIComponent(token)}`;
    const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 260
    });

    return {
        title: `Receipt ${receipt.id}`,
        receipt,
        checkinUrl,
        qrCodeDataUrl,
        paidAtLabel: new Date(receipt.paidAt).toLocaleString('en-SG', {
            dateStyle: 'medium',
            timeStyle: 'short'
        })
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

        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setContent(htmlWithBase, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '18mm',
                right: '14mm',
                bottom: '18mm',
                left: '14mm'
            }
        });

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

function checkIn(req, res) {
    const payload = verifyCheckinToken(req.params.id, req.query.token);

    if (!payload) {
        return res.status(403).render('error', {
            title: 'Invalid Check-In',
            message: 'This check-in link is invalid or expired.'
        });
    }

    return res.render('checkin-success', {
        title: 'Check-In Successful',
        receiptId: req.params.id,
        receiptType: payload.receiptType || 'receipt'
    });
}

module.exports = {
    showReceipt,
    downloadReceiptPdf,
    checkIn
};
