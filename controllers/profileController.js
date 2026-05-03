const db = require('../db');
const Booking = require('../models/Booking');
const PurchaseHistory = require('../models/PurchaseHistory');

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

function normalizeFilter(filter) {
    if (filter === 'bookings' || filter === 'products') {
        return filter;
    }

    return 'all';
}

function getSessionHistory(req) {
    const receipts = Object.values(req.session.receipts || {});
    const userId = req.session.user?.id;

    return receipts
        .filter((receipt) => String(receipt.userId) === String(userId))
        .map((receipt) => {
            const isBooking = receipt.type === 'booking';
            const createdAt = receipt.paidAt || new Date().toISOString();

            return {
                id: receipt.displayId || receipt.id,
                receiptId: receipt.id,
                type: isBooking ? 'booking' : 'product',
                itemNames: (receipt.items || [])
                    .map((item) => {
                        const quantity = Number(item.quantity || 1);
                        return quantity > 1 ? `${item.name} x${quantity}` : item.name;
                    })
                    .join(', ') || (isBooking ? 'Service booking' : 'Product order'),
                totalAmount: Number(receipt.totalAmount || 0),
                paymentMethod: receipt.paymentMethod || 'paid',
                paymentStatus: receipt.paymentStatus || 'paid',
                createdAt,
                createdAtLabel: formatHistoryDate(createdAt),
                source: 'session'
            };
        });
}

function getMemoryBookingHistory(req) {
    const user = req.session.user || {};

    return Booking.getAll()
        .filter((booking) => {
            return booking.email && user.email
                ? String(booking.email).toLowerCase() === String(user.email).toLowerCase()
                : booking.customerName && user.name && booking.customerName === user.name;
        })
        .map((booking) => {
            const createdAt = booking.createdAt || booking.bookingDate || new Date().toISOString();

            return {
                id: booking.id,
                receiptId: booking.id,
                type: 'booking',
                itemNames: booking.serviceName || 'Service booking',
                totalAmount: Number(booking.price || booking.servicePrice || 0),
                paymentMethod: 'Not paid',
                paymentStatus: booking.status || 'pending',
                createdAt,
                createdAtLabel: formatHistoryDate(createdAt),
                source: 'memory'
            };
        });
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
        paymentMethod: row.payment_method || 'Not paid',
        paymentStatus: row.payment_status || 'pending',
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
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_status,
            transactions.created_at
        FROM transactions
        INNER JOIN order_items ON order_items.transaction_id = transactions.transaction_id
        INNER JOIN products ON products.product_id = order_items.product_id
        WHERE transactions.user_id = ?
        GROUP BY
            transactions.transaction_id,
            transactions.total_amount,
            transactions.payment_method,
            transactions.payment_status,
            transactions.created_at
        ORDER BY transactions.created_at DESC, transactions.transaction_id DESC
    `;

    const rows = await queryRows(sql, [userId]);

    return rows.map((row) => ({
        id: row.id,
        receiptId: `order-${row.id}`,
        type: 'product',
        itemNames: row.item_names || 'Product order',
        totalAmount: Number(row.total_amount || 0),
        paymentMethod: row.payment_method || 'card',
        paymentStatus: row.payment_status || 'paid',
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
                totalAmount: Number(row.total_amount || 0),
                paymentMethod: row.payment_method || 'paid',
                paymentStatus: row.payment_status || 'paid',
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
        const sessionHistory = getSessionHistory(req);
        const memoryBookings = getMemoryBookingHistory(req);
        const mergedBookings = mergeHistoryRows(
            bookings,
            [...persistentHistory, ...sessionHistory, ...memoryBookings].filter((row) => row.type === 'booking')
        );
        const mergedProducts = mergeHistoryRows(
            products,
            [...persistentHistory, ...sessionHistory].filter((row) => row.type === 'product')
        );
        const allHistory = [...mergedBookings, ...mergedProducts].sort((left, right) => {
            return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
        });
        const history = filter === 'bookings'
            ? mergedBookings
            : filter === 'products'
                ? mergedProducts
                : allHistory;

        return res.render('history', {
            title: 'Purchase History',
            history,
            activeFilter: filter,
            counts: {
                all: allHistory.length,
                bookings: mergedBookings.length,
                products: mergedProducts.length
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

module.exports = {
    showHistory
};
