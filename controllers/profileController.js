const fs = require('fs');
const path = require('path');
const db = require('../db');
const PurchaseHistory = require('../models/PurchaseHistory');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { moderateReviewText } = require('../services/groqService');
const { moderateUploadedReviewImage } = require('../services/reviewImageModerationService');
const {
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');
const { buildBookingReference } = require('../utils/bookingReference');

function removeUploadedReviewMedia(...mediaPaths) {
    mediaPaths.filter(Boolean).forEach((mediaPath) => {
        const absolutePath = path.join(__dirname, '..', 'public', mediaPath.replace(/^\/+/, ''));
        fs.unlink(absolutePath, () => {});
    });
}

function getReviewImageDataUrl(upload) {
    if (!upload?.path) {
        return '';
    }

    const mimeType = String(upload.mimetype || 'image/jpeg').toLowerCase();
    const buffer = fs.readFileSync(upload.path);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function getHardProfanityModeration(comment = '') {
    const text = String(comment || '').toLowerCase();
    const compactText = text.replace(/[^a-z0-9]/g, '');
    const hasHardProfanity = [
        /f+u+c+k+/i,
        /f+u+k+/i,
        /s+h+i+t+/i,
        /b+i+t+c+h+/i,
        /c+u+n+t+/i,
        /a+s+s+h+o+l+e+/i,
        /d+i+c+k+/i
    ].some((pattern) => pattern.test(compactText));

    if (!hasHardProfanity) {
        return null;
    }

    return {
        recommendedAction: 'reject',
        reason: 'Review contains profanity or vulgar language.'
    };
}

function getReviewModerationFailureMessage(error) {
    const code = String(error?.code || '');

    if (code === 'GROQ_NOT_CONFIGURED') {
        return 'Review moderation is not configured. Please contact support.';
    }

    return 'Review could not be verified right now. Please edit the review content or try again after checking your connection.';
}

async function moderateReviewBeforeSave({
    comment,
    rating,
    merchantName,
    serviceName,
    productName,
    verifiedBooking,
    completedBooking,
    imageUpload
}) {
    let textResult = null;
    const hardProfanity = getHardProfanityModeration(comment);

    if (hardProfanity) {
        return {
            allowed: false,
            result: hardProfanity
        };
    }

    if (String(comment || '').trim()) {
        textResult = await moderateReviewText({
            reviewText: comment,
            rating,
            merchantName,
            serviceName,
            productName,
            verifiedBooking,
            completedBooking,
            previousReviewCount: 0,
            duplicateTextCount: 0
        });

        if (textResult.recommendedAction !== 'approve') {
            return {
                allowed: false,
                result: textResult
            };
        }
    }

    if (imageUpload) {
        const imageModeration = await moderateUploadedReviewImage({
            imageBase64: getReviewImageDataUrl(imageUpload),
            merchantCategory: '',
            serviceName,
            productName,
            reviewText: comment
        });

        if (!imageModeration.allowed) {
            return imageModeration;
        }
    }

    return {
        allowed: true,
        result: textResult
    };
}

function queryRows(sql, values = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, values, (error, rows) => {
            if (error) {
                if (error.code === 'ER_NO_SUCH_TABLE') {
                    resolve([]);
                    return;
                }

                reject(error);
                return;
            }

            resolve(rows || []);
        });
    });
}

function formatHistoryDate(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString('en-SG', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function normalizeProductImageUrl(value) {
    const imageUrl = String(value || '').trim().replace(/\\/g, '/');

    if (!imageUrl || /^(?:https?:|data:)/i.test(imageUrl) || imageUrl.startsWith('/')) {
        return imageUrl;
    }

    if (imageUrl.startsWith('public/')) {
        return `/${imageUrl.slice('public/'.length)}`;
    }

    return `/${imageUrl}`;
}

function formatStatus(value) {
    return String(value || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildPaymentHistoryFields(row = {}) {
    const method = normalizePaymentMethod(row.payment_method || row.paymentMethod || 'card');
    const provider = normalizePaymentProvider(row.payment_provider || row.paymentProvider || '', method);
    const paidAmount = Number(row.paid_amount || row.total_amount || row.totalAmount || 0);
    const refundedAmount = Number(row.refunded_amount || row.refundedAmount || 0);

    return {
        paymentMethod: method,
        paymentProvider: provider,
        paymentMethodLabel: row.payment_method_label || formatPaymentMethod(method, provider),
        paymentStatus: row.payment_status || row.paymentStatus || (refundedAmount > 0 ? 'partially_refunded' : 'paid'),
        paymentStatusLabel: formatStatus(row.payment_status || row.paymentStatus || 'paid'),
        refundStatus: row.refund_status || row.refundStatus || (refundedAmount > 0 ? 'partially_refunded' : 'none'),
        refundStatusLabel: formatStatus(row.refund_status || row.refundStatus || 'none'),
        refundedAmount,
        remainingPaidAmount: Math.max(paidAmount - refundedAmount, 0)
    };
}

function normalizeReviewRating(value) {
    const rating = Number(value);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return null;
    }

    return rating;
}

function isCompletedProductOrder(entry = {}) {
    const deliveryStatus = String(entry.deliveryStatus || '').toLowerCase();
    const pickupStatus = String(entry.pickupStatus || '').toLowerCase();

    return ['delivered', 'completed'].includes(deliveryStatus) || ['picked_up', 'collected', 'delivered'].includes(pickupStatus);
}

function setProfileError(req, message) {
    req.session.profileError = message;
}

function setProfileSuccess(req, message) {
    req.session.profileSuccess = message;
}

function setReviewModerationPopup(req, message) {
    req.session.reviewModerationPopup = message;
}

function parseProductHistoryItems(value) {
    try {
        const parsed = JSON.parse(value || '[]');

        if (Array.isArray(parsed)) {
            return parsed.map((item) => ({
                productId: Number(item.productId || item.serviceId || 0),
                serviceId: Number(item.serviceId || item.productId || 0),
                name: item.name || 'Product',
                quantity: Number(item.quantity || 1),
                merchantId: Number(item.merchantId || 0),
                imageUrl: item.imageUrl || ''
            }));
        }
    } catch (error) {
        // Fall back to the legacy delimited payload while older in-memory rows still exist.
    }

    return String(value || '')
        .split('||')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const [productId, name, quantity, merchantId] = chunk.split('::');
            return {
                productId: Number(productId || 0),
                serviceId: Number(productId || 0),
                name: name || 'Product',
                quantity: Number(quantity || 1),
                merchantId: Number(merchantId || 0),
                imageUrl: ''
            };
        });
}

async function getProductImageMap(productIds = []) {
    const normalizedIds = Array.from(new Set(productIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));

    if (!normalizedIds.length) {
        return {};
    }

    const placeholders = normalizedIds.map(() => '?').join(', ');
    const rows = await queryRows(
        `
            SELECT
                products.product_id,
                products.name,
                products.description,
                products.image_url,
                categories.category_name AS category
            FROM products
            LEFT JOIN categories
                ON categories.category_id = products.category_id
            WHERE products.product_id IN (${placeholders})
        `,
        normalizedIds
    );

    return rows.reduce((map, row) => {
        map[Number(row.product_id)] = normalizeProductImageUrl(
            row.image_url || Product.getFallbackImageUrl(row)
        );
        return map;
    }, {});
}

function normalizeFilter(filter) {
    if (filter === 'bookings' || filter === 'products') {
        return filter;
    }

    return 'all';
}

function mergeHistoryRows(databaseRows, sessionRows) {
    const seen = new Set();
    const merged = [];

    [...sessionRows, ...databaseRows].forEach((row) => {
        const key = `${row.type}:${row.receiptId}`;

        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        merged.push(row);
    });

    return merged;
}

async function getBookingHistory(userId) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            'booking' AS type,
            services.service_name AS item_names,
            services.price AS total_amount,
            COALESCE(transactions.payment_method, 'Not paid') AS payment_method,
            COALESCE(transactions.payment_provider, '') AS payment_provider,
            COALESCE(transactions.paid_amount, transactions.total_amount, services.price) AS paid_amount,
            COALESCE(transactions.refund_status, bookings.refund_status, 'none') AS refund_status,
            COALESCE(transactions.refunded_amount, 0) AS refunded_amount,
            COALESCE(transactions.payment_status, bookings.status, 'pending') AS payment_status,
            COALESCE(transactions.created_at, bookings.booking_date) AS created_at
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
        WHERE bookings.user_id = ?
        ORDER BY created_at DESC, bookings.booking_id DESC
    `;

    let rows;

    try {
        rows = await queryRows(sql, [userId]);
    } catch (error) {
        if (error.code !== 'ER_BAD_FIELD_ERROR') {
            throw error;
        }

        rows = await queryRows(`
            SELECT
                bookings.booking_id AS id,
                'booking' AS type,
                services.service_name AS item_names,
                services.price AS total_amount,
                'Not paid' AS payment_method,
                COALESCE(bookings.status, 'pending') AS payment_status,
                bookings.booking_date AS created_at
            FROM bookings
            INNER JOIN services ON services.service_id = bookings.service_id
            WHERE bookings.user_id = ?
            ORDER BY bookings.booking_date DESC, bookings.booking_id DESC
        `, [userId]);
    }

    return rows.map((row) => ({
        id: row.id,
        receiptId: row.id,
        displayReference: buildBookingReference(row.id, row.created_at),
        type: 'booking',
        itemNames: row.item_names,
        totalAmount: Number(row.total_amount || 0),
        ...buildPaymentHistoryFields(row),
        createdAt: row.created_at,
        createdAtLabel: formatHistoryDate(row.created_at)
    }));
}

async function getProductHistory(userId) {
    const sql = `
        SELECT
            transactions.transaction_id AS id,
            orders.order_id,
            orders.order_number,
            'product' AS type,
            GROUP_CONCAT(CONCAT(products.name, ' x', order_items.quantity) ORDER BY order_items.order_item_id SEPARATOR ', ') AS item_names,
            JSON_ARRAYAGG(
                JSON_OBJECT(
                    'productId', order_items.product_id,
                    'serviceId', order_items.product_id,
                    'name', products.name,
                    'quantity', order_items.quantity,
                    'merchantId', COALESCE(products.salon_id, 0),
                    'imageUrl', COALESCE(products.image_url, '')
                )
            ) AS item_payload,
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_provider,
            transactions.paid_amount,
            transactions.refund_status,
            transactions.refunded_amount,
            transactions.payment_status,
            transactions.delivery_status,
            transactions.fulfilment_type,
            transactions.pickup_status,
            transactions.created_at
        FROM transactions
        LEFT JOIN orders ON orders.transaction_id = transactions.transaction_id
        INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
        INNER JOIN products ON products.product_id = order_items.product_id
        WHERE transactions.user_id = ?
        GROUP BY
            transactions.transaction_id,
            orders.order_id,
            orders.order_number,
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_provider,
            transactions.paid_amount,
            transactions.refund_status,
            transactions.refunded_amount,
            transactions.payment_status,
            transactions.delivery_status,
            transactions.fulfilment_type,
            transactions.pickup_status,
            transactions.created_at
        ORDER BY transactions.created_at DESC, transactions.transaction_id DESC
    `;

    const rows = await queryRows(sql, [userId]);

    return rows.map((row) => ({
        id: row.id,
        receiptId: row.order_number || String(row.id),
        orderId: row.order_id || null,
        order_number: row.order_number || '',
        orderNumber: row.order_number || '',
        type: 'product',
        itemNames: row.item_names || 'Product order',
        items: parseProductHistoryItems(row.item_payload),
        totalAmount: Number(row.total_amount || 0),
        ...buildPaymentHistoryFields(row),
        fulfilmentType: row.fulfilment_type || 'pickup',
        deliveryStatus: row.delivery_status || 'processing',
        pickupStatus: row.pickup_status || '',
        createdAt: row.created_at,
        createdAtLabel: formatHistoryDate(row.created_at)
    }));
}

function getPersistentHistory(userId) {
    return new Promise((resolve, reject) => {
        PurchaseHistory.getByUserId(userId, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }

            resolve((rows || []).map((row) => ({
                id: row.receipt_id,
                receiptId: row.receipt_id,
                orderId: row.order_id || null,
                order_number: row.order_number || '',
                orderNumber: row.order_number || '',
                type: row.purchase_type === 'booking' ? 'booking' : 'product',
                itemNames: row.item_names,
                items: PurchaseHistory.mapReceipt(row)?.items || [],
                totalAmount: Number(row.total_amount || 0),
                ...buildPaymentHistoryFields(row),
                fulfilment: row.fulfilment || '',
                deliveryStatus: row.delivery_status || 'processing',
                pickupStatus: row.pickup_status || '',
                createdAt: row.created_at,
                createdAtLabel: formatHistoryDate(row.created_at),
                displayReference: row.purchase_type === 'booking'
                    ? buildBookingReference(row.receipt_id, row.created_at)
                    : (row.order_number || ''),
                source: 'persistent'
            })));
        });
    });
}

function persistSessionReceipts(req) {
    const receipts = Object.values(req.session.receipts || {});

    return Promise.all(receipts.map((receipt) => {
        return new Promise((resolve) => {
            PurchaseHistory.save(receipt, (error) => {
                if (error) {
                    console.error(error);
                }

                resolve();
            });
        });
    }));
}

async function showHistory(req, res) {
    const filter = normalizeFilter(req.query.type);
    const userId = req.session.user.id;

    try {
        await persistSessionReceipts(req);

        const [bookings, products, persistentHistory] = await Promise.all([
            getBookingHistory(userId),
            getProductHistory(userId),
            getPersistentHistory(userId)
        ]);
        const mergedBookings = mergeHistoryRows(
            bookings,
            persistentHistory.filter((row) => row.type === 'booking')
        );
        const mergedProducts = mergeHistoryRows(
            products,
            persistentHistory.filter((row) => row.type === 'product')
        );
        const productReceiptIds = mergedProducts.map((row) => row.receiptId).filter(Boolean);
        const productReviews = await new Promise((resolve, reject) => {
            Review.getByReceiptIds(productReceiptIds, (reviewError, rows = []) => {
                if (reviewError) {
                    reject(reviewError);
                    return;
                }

                resolve(rows);
            });
        });
        const productReviewMap = productReviews.reduce((map, review) => {
            map[`${review.receiptId}:${review.productId}`] = review;
            return map;
        }, {});
        const productImageMap = await getProductImageMap(
            mergedProducts.flatMap((entry) => (Array.isArray(entry.items) ? entry.items : []).map((item) => Number(item.serviceId || item.productId || 0)))
        );
        const enrichedProducts = mergedProducts.map((entry) => {
            const items = Array.isArray(entry.items) ? entry.items : [];
            const reviewable = isCompletedProductOrder(entry);

            return {
                ...entry,
                reviewable,
                items: items.map((item) => {
                    const productId = Number(item.serviceId || item.productId || 0);
                    const reviewKey = `${entry.receiptId}:${productId}`;
                    return {
                        ...item,
                        productId,
                        // Use the current catalog image first so purchase history
                        // always matches the image shown on the Products page.
                        imageUrl: normalizeProductImageUrl(productImageMap[productId] || item.imageUrl || ''),
                        review: productReviewMap[reviewKey] || null
                    };
                })
            };
        });
        const allHistory = [...mergedBookings, ...enrichedProducts].sort((left, right) => {
            return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
        });
        const history = filter === 'bookings'
            ? mergedBookings
            : filter === 'products'
                ? enrichedProducts
                : allHistory;

        const success = req.session.profileSuccess || null;
        const error = req.session.profileError || null;
        const reviewModerationPopup = req.session.reviewModerationPopup || null;
        req.session.profileSuccess = null;
        req.session.profileError = null;
        req.session.reviewModerationPopup = null;

        return res.render('history', {
            title: 'Purchase History',
            history,
            activeFilter: filter,
            success,
            error,
            reviewModerationPopup,
            counts: {
                all: allHistory.length,
                bookings: mergedBookings.length,
                products: enrichedProducts.length
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Purchase History Error',
            message: 'Your purchase history could not be loaded.'
        });
    }
}

function submitProductReview(req, res) {
    const receiptId = String(req.params.receiptId || '').trim();
    const productId = Number(req.params.productId);
    const userId = req.session.user?.id;
    const rating = normalizeReviewRating(req.body.rating);
    const comment = String(req.body.comment || '').trim().slice(0, 2000);

    if (!receiptId || !userId || !Number.isInteger(productId) || productId <= 0) {
        setProfileError(req, 'The selected product purchase could not be found.');
        return res.redirect('/profile#history');
    }

    if (!rating) {
        setProfileError(req, 'Please choose a rating from 1 to 5 stars.');
        return res.redirect('/profile#history');
    }

    const imageUpload = req.files?.reviewImage?.[0] || null;
    const videoUpload = req.files?.reviewVideo?.[0] || null;
    const imagePath = imageUpload ? `/uploads/reviews/${imageUpload.filename}` : '';
    const videoPath = videoUpload ? `/uploads/reviews/${videoUpload.filename}` : '';

    return PurchaseHistory.getByReceiptId(receiptId, userId, (receiptError, row) => {
        if (receiptError) {
            console.error(receiptError);
            setProfileError(req, 'That purchase could not be loaded.');
            return res.redirect('/profile#history');
        }

        const receipt = PurchaseHistory.mapReceipt(row);

        if (!receipt || receipt.type !== 'order') {
            setProfileError(req, 'That purchase could not be found on your account.');
            return res.redirect('/profile#history');
        }

        if (!isCompletedProductOrder(receipt)) {
            setProfileError(req, 'Product reviews can only be submitted after delivery or pickup is completed.');
            return res.redirect('/profile#history');
        }

        const item = (receipt.items || []).find((entry) => Number(entry.serviceId || entry.productId) === productId);

        if (!item) {
            setProfileError(req, 'That product was not found in this order.');
            return res.redirect('/profile#history');
        }

        return Review.findByReceiptAndProduct(receiptId, productId, (reviewLookupError, existingReview) => {
            if (reviewLookupError) {
                console.error(reviewLookupError);
                setProfileError(req, 'Your review could not be checked.');
                return res.redirect('/profile#history');
            }

            if (existingReview) {
                removeUploadedReviewMedia(imagePath, videoPath);
                setProfileError(req, 'You have already submitted a review for this product in this order.');
                return res.redirect('/profile#history');
            }

            return moderateReviewBeforeSave({
                comment,
                rating,
                merchantName: item.merchantName || receipt.pickupMerchantName || '',
                productName: item.name,
                verifiedBooking: true,
                completedBooking: true,
                imageUpload
            }).then((moderation) => {
                if (!moderation.allowed) {
                    removeUploadedReviewMedia(imagePath, videoPath);
                    const reason = moderation.result?.reason || 'Your review needs admin review before it can be posted.';
                    setProfileError(req, reason);
                    setReviewModerationPopup(req, reason);
                    return res.redirect('/profile#history');
                }

                return Review.create({
                    reviewType: 'product',
                    receiptId,
                    userId,
                    merchantId: Number(item.merchantId || receipt.pickupMerchantId || 0),
                    productId,
                    rating,
                    comment,
                    imagePath,
                    videoPath
                }, (createError) => {
                if (createError) {
                    console.error(createError);
                    removeUploadedReviewMedia(imagePath, videoPath);
                    setProfileError(req, 'Your product review could not be saved.');
                    return res.redirect('/profile#history');
                }

                setProfileSuccess(req, `Review submitted successfully for ${item.name || 'this product'}.`);
                return res.redirect('/profile#history');
                });
            }).catch((moderationError) => {
                console.error('Product review moderation failed:', moderationError.code || moderationError.message);
                removeUploadedReviewMedia(imagePath, videoPath);
                const message = getReviewModerationFailureMessage(moderationError);
                setProfileError(req, message);
                setReviewModerationPopup(req, message);
                return res.redirect('/profile#history');
            });
        });
    });
}

module.exports = {
    showHistory,
    submitProductReview
};
