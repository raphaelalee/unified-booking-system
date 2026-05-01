const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const PurchaseHistory = require('../models/PurchaseHistory');

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

function mapOrderReceipt(order) {
    if (!order) {
        return null;
    }

    return {
        id: `order-${order.id}`,
        displayId: order.id,
        type: 'order',
        userId: order.userId,
        userName: order.userName,
        merchantName: 'Vaniday',
        items: order.items,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paidAt: order.createdAt || new Date().toISOString()
    };
}

function loadReceipt(req, id) {
    const sessionReceipt = getSessionReceipt(req, id);

    if (sessionReceipt) {
        return Promise.resolve(sessionReceipt);
    }

    const persistentReceipt = new Promise((resolve, reject) => {
        PurchaseHistory.getByReceiptId(id, req.session.user.id, (error, row) => {
            if (error) {
                reject(error);
                return;
            }

            const receipt = PurchaseHistory.mapReceipt(row);
            if (receipt) {
                receipt.userName = req.session.user.name || receipt.userName || 'Customer';
            }
            resolve(receipt);
        });
    });

    return persistentReceipt.then((receipt) => {
        if (receipt) {
            return receipt;
        }

        const orderMatch = String(id).match(/^order-(\d+)$/);

        if (orderMatch) {
            return new Promise((resolve, reject) => {
                Transaction.getOrderReceiptById(orderMatch[1], req.session.user.id, (error, order) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve(mapOrderReceipt(order));
                });
            });
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
            const qrBuffer = await QRCode.toBuffer(data.checkinUrl, {
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
                ['Status', receipt.paymentStatus || receipt.status || 'paid']
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
            doc.fillColor(ink).font('Times-Bold').fontSize(20).text('Check-in QR', left + 24, qrTop + 24);
            doc.fillColor(muted).font('Helvetica').fontSize(10).text(
                'Present this QR code at the merchant counter for receipt verification.',
                left + 24,
                qrTop + 52,
                { width: 270 }
            );
            doc.fillColor(muted).font('Helvetica').fontSize(8).text(
                `Check-in link: ${data.checkinUrl}`,
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
