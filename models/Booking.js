const db = require('../db');

const bookings = [];

function create(bookingData) {
    const booking = {
        id: bookings.length + 1,
        status: 'Pending',
        createdAt: new Date(),
        ...bookingData
    };

    bookings.push(booking);
    return booking;
}

function getAll() {
    return bookings;
}

function getAllInDatabase(callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            COALESCE(bookings.merchant_id, salons.salon_id) AS merchant_id,
            users.name AS customer_name,
            users.email,
            salons.salon_name AS merchant_name,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        ORDER BY bookings.booking_id DESC
    `;

    db.query(sql, callback);
}

function getByMerchantUserId(userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            users.name AS customer_name,
            users.email,
            salons.salon_name AS merchant_name,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE salons.merchant_id = ?
        ORDER BY bookings.booking_id DESC
    `;

    db.query(sql, [userId], callback);
}

function hasExistingBooking(merchantId, serviceId, bookingDate, bookingTime) {
    return bookings.some((booking) => {
        return booking.merchantId === Number(merchantId)
            && booking.serviceId === Number(serviceId)
            && booking.bookingDate === bookingDate
            && booking.bookingTime === bookingTime
            && booking.status !== 'Cancelled';
    });
}

function hasExistingBookingInDatabase(merchantId, serviceId, bookingDate, bookingTime, callback) {
    const sql = `
        SELECT bookings.booking_id
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        WHERE bookings.service_id = ?
            AND services.salon_id = ?
            AND booking_date = ?
            AND timeslot = ?
            AND status <> 'cancelled'
        LIMIT 1
    `;

    db.query(sql, [serviceId, merchantId, bookingDate, bookingTime], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results.length > 0);
    });
}

function createInDatabase(bookingData, callback) {
    if (!bookingData.userId) {
        callback(new Error('A logged-in user is required to save this booking in the current database schema.'));
        return;
    }

    const sql = `
        INSERT INTO bookings
            (user_id, merchant_id, service_id, booking_date, timeslot, status, qr_code_token)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        bookingData.userId,
        bookingData.merchantId,
        bookingData.serviceId,
        bookingData.bookingDate,
        bookingData.bookingTime,
        bookingData.status || 'pending',
        bookingData.qrCodeToken || null
    ];

    db.query(sql, values, callback);
}

function getReceiptById(id, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            users.name AS customer_name,
            users.email,
            salons.salon_name AS merchant_name,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.booking_id = ?
        LIMIT 1
    `;

    db.query(sql, [id], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] || null);
    });
}

function attachTransaction(bookingId, transactionId, callback) {
    const sql = `
        UPDATE bookings
        SET transaction_id = ?
        WHERE booking_id = ?
    `;

    db.query(sql, [transactionId, bookingId], (error, result) => {
        if (error && (error.code === 'ER_BAD_FIELD_ERROR' || error.code === 'ER_NO_SUCH_TABLE')) {
            callback(null, result);
            return;
        }

        callback(error, result);
    });
}

module.exports = {
    attachTransaction,
    create,
    createInDatabase,
    getReceiptById,
    getAll,
    getAllInDatabase,
    getByMerchantUserId,
    hasExistingBooking,
    hasExistingBookingInDatabase
};
