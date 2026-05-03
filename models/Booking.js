const db = require('../db');

const bookings = [];

function normalizeTimeForDatabase(value) {
    if (!value) {
        return value;
    }

    const rawValue = String(value).trim().toUpperCase();
    const match = rawValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/);

    if (!match) {
        return value;
    }

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    const meridiem = match[4];

    if (
        !Number.isInteger(hours)
        || !Number.isInteger(minutes)
        || !Number.isInteger(seconds)
        || hours < 0
        || hours > 23
        || minutes < 0
        || minutes > 59
        || seconds < 0
        || seconds > 59
    ) {
        return value;
    }

    if (meridiem === 'PM' && hours < 12) {
        hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
        hours = 0;
    }

    return [
        String(hours).padStart(2, '0'),
        String(minutes).padStart(2, '0'),
        String(seconds).padStart(2, '0')
    ].join(':');
}

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

function getUpcomingByUserId(userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            salons.salon_name AS merchant_name,
            salons.address AS merchant_address,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.user_id = ?
            AND bookings.booking_date >= CURDATE()
            AND bookings.status <> 'cancelled'
        ORDER BY bookings.booking_date ASC, bookings.timeslot ASC
    `;

    db.query(sql, [userId], callback);
}

function getCheckInDetails(bookingId, merchantUserId, callback) {
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
        WHERE bookings.booking_id = ?
            AND salons.merchant_id = ?
        LIMIT 1
    `;

    db.query(sql, [bookingId, merchantUserId], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results[0] || null);
    });
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

    db.query(sql, [serviceId, merchantId, bookingDate, normalizeTimeForDatabase(bookingTime)], (error, results) => {
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
        normalizeTimeForDatabase(bookingData.bookingTime),
        bookingData.status || 'pending',
        bookingData.qrCodeToken || null
    ];

    db.query(sql, values, callback);
}

function createCustomerBooking(bookingData, callback) {
    createInDatabase(bookingData, callback);
}

function getByUserId(userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            salons.salon_name AS merchant_name,
            salons.address AS merchant_address,
            services.service_name,
            services.price AS service_price,
            CASE
                WHEN bookings.status IN ('completed', 'checked_in', 'paid') THEN 'completed'
                WHEN bookings.booking_date < CURDATE() THEN 'completed'
                ELSE 'upcoming'
            END AS booking_group
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.user_id = ?
        ORDER BY bookings.booking_date DESC, bookings.timeslot DESC
    `;

    db.query(sql, [userId], (error, rows) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows.map((row) => ({
            ...row,
            status: row.booking_group
        })));
    });
}

function getReceiptById(bookingId, callback) {
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

    db.query(sql, [bookingId], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results[0] || null);
    });
}

function attachTransaction(bookingId, transactionId, callback) {
    const sql = `
        UPDATE bookings
        SET transaction_id = ?, status = 'paid'
        WHERE booking_id = ?
    `;

    db.query(sql, [transactionId, bookingId], (error, result) => {
        if (!error) {
            callback(null, result);
            return;
        }

        if (error.code !== 'ER_BAD_FIELD_ERROR') {
            callback(error);
            return;
        }

        db.query(
            `UPDATE bookings SET status = 'paid' WHERE booking_id = ?`,
            [bookingId],
            callback
        );
    });
}

function markCompleted(bookingId, callback) {
    const sql = `
        UPDATE bookings
        SET status = 'completed'
        WHERE booking_id = ?
    `;

    db.query(sql, [bookingId], callback);
}

function markCheckedIn(bookingId, merchantUserId, callback) {
    const sql = `
        UPDATE bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        SET bookings.status = 'checked_in'
        WHERE bookings.booking_id = ?
            AND salons.merchant_id = ?
    `;

    db.query(sql, [bookingId, merchantUserId], callback);
}

module.exports = {
    attachTransaction,
    create,
    createCustomerBooking,
    createInDatabase,
    getByUserId,
    getReceiptById,
    getAll,
    getAllInDatabase,
    getByMerchantUserId,
    getCheckInDetails,
    getUpcomingByUserId,
    hasExistingBooking,
    hasExistingBookingInDatabase,
    markCompleted,
    markCheckedIn
};
