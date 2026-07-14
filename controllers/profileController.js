const db = require('../db');
const PurchaseHistory = require('../models/PurchaseHistory');
const Review = require('../models/Review');
const {
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');

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

    return deliveryStatus === 'delivered' || ['picked_up', 'collected', 'delivered'].includes(pickupStatus);
}

function setProfileError(req, message) {
    req.session.profileError = message;
}

function setProfileSuccess(req, message) {
    req.session.profileSuccess = message;
}

function parseProductHistoryItems(value) {
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
                merchantId: Number(merchantId || 0)
            };
        });
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
            'product' AS type,
            GROUP_CONCAT(CONCAT(products.name, ' x', order_items.quantity) ORDER BY order_items.order_item_id SEPARATOR ', ') AS item_names,
            GROUP_CONCAT(CONCAT(order_items.product_id, '::', products.name, '::', order_items.quantity, '::', COALESCE(products.salon_id, '')) ORDER BY order_items.order_item_id SEPARATOR '||') AS item_payload,
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_provider,
            transactions.paid_amount,
            transactions.refund_status,
            transactions.refunded_amount,
            transactions.payment_status,
            transactions.delivery_status,
            transactions.pickup_status,
            transactions.created_at
        FROM transactions
        INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
        INNER JOIN products ON products.product_id = order_items.product_id
        WHERE transactions.user_id = ?
        GROUP BY
            transactions.transaction_id,
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_provider,
            transactions.paid_amount,
            transactions.refund_status,
            transactions.refunded_amount,
            transactions.payment_status,
            transactions.delivery_status,
            transactions.pickup_status,
            transactions.created_at
        ORDER BY transactions.created_at DESC, transactions.transaction_id DESC
    `;

    const rows = await queryRows(sql, [userId]);

    return rows.map((row) => ({
        id: row.id,
        receiptId: `order-${row.id}`,
        type: 'product',
        itemNames: row.item_names || 'Product order',
        items: parseProductHistoryItems(row.item_payload),
        totalAmount: Number(row.total_amount || 0),
        ...buildPaymentHistoryFields(row),
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
                id: row.receipt_id.replace(/^order-/, ''),
                receiptId: row.receipt_id,
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
        req.session.profileSuccess = null;
        req.session.profileError = null;

        return res.render('history', {
            title: 'Purchase History',
            history,
            activeFilter: filter,
            success,
            error,
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
                setProfileError(req, 'You have already submitted a review for this product in this order.');
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
                    setProfileError(req, 'Your product review could not be saved.');
                    return res.redirect('/profile#history');
                }

                setProfileSuccess(req, `Review submitted successfully for ${item.name || 'this product'}.`);
                return res.redirect('/profile#history');
            });
        });
    });
}

module.exports = {
    showHistory,
    submitProductReview
};
