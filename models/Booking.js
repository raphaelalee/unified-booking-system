const db = require('../db');

const bookings = [];
let whatsappReminderSchemaReady = false;
let whatsappReminderSchemaPending = false;
let whatsappReminderSchemaQueue = [];

function flushWhatsAppReminderSchema(error) {
    const queue = whatsappReminderSchemaQueue;
    whatsappReminderSchemaQueue = [];
    whatsappReminderSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureWhatsAppReminderSchema(callback) {
    if (whatsappReminderSchemaReady) {
        callback(null);
        return;
    }

    whatsappReminderSchemaQueue.push(callback);

    if (whatsappReminderSchemaPending) {
        return;
    }

    whatsappReminderSchemaPending = true;

    const sql = `
        CREATE TABLE IF NOT EXISTS whatsapp_reminder_logs (
            log_id INT NOT NULL AUTO_INCREMENT,
            booking_id INT NOT NULL,
            reminder_type VARCHAR(40) NOT NULL,
            sent_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (log_id),
            UNIQUE KEY uq_whatsapp_reminder_booking_type (booking_id, reminder_type),
            KEY idx_whatsapp_reminder_sent_at (sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) {
            whatsappReminderSchemaReady = true;
        }

        flushWhatsAppReminderSchema(error);
    });
}

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
            salons.merchant_id AS merchant_user_id,
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
            services.service_id,
            services.service_name,
            services.price AS service_price,
            CASE
                WHEN bookings.status = 'cancelled' THEN 'past'
                WHEN bookings.status IN ('completed', 'checked_in') THEN 'past'
                WHEN bookings.booking_date < CURDATE() THEN 'past'
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

        callback(null, rows);
    });
}

function getSupportBookingsByUserId(userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.user_id = ?
        ORDER BY bookings.booking_date DESC, bookings.timeslot DESC
        LIMIT 60
    `;

    db.query(sql, [userId], callback);
}

function findSupportBookingForCustomer(bookingId, userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.booking_id = ?
            AND bookings.user_id = ?
        LIMIT 1
    `;

    db.query(sql, [bookingId, userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] || null);
    });
}

function getManageableByIdForCustomer(bookingId, userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            services.service_id,
            salons.salon_id,
            salons.salon_name AS merchant_name,
            services.service_name,
            services.price AS service_price
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        WHERE bookings.booking_id = ?
            AND bookings.user_id = ?
        LIMIT 1
    `;

    db.query(sql, [bookingId, userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, rows[0] || null);
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
            salons.salon_id AS merchant_id,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
            services.service_id,
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

function getNotificationDetailsById(bookingId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            users.name AS customer_name,
            users.email,
            users.phone,
            services.service_id,
            salons.salon_id,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
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

function mapNotificationBooking(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        userId: row.user_id,
        customerName: row.customer_name,
        email: row.email,
        phone: row.phone,
        merchantName: row.merchant_name,
        merchantUserId: row.merchant_user_id,
        serviceId: row.service_id,
        salonId: row.salon_id,
        serviceName: row.service_name,
        bookingDate: row.booking_date,
        bookingTime: row.booking_time,
        status: row.status
    };
}

function getWhatsAppReminderCandidates(startAt, endAt, reminderType, callback) {
    ensureWhatsAppReminderSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                bookings.booking_id AS id,
                bookings.user_id,
                bookings.booking_date,
                TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
                bookings.status,
                users.name AS customer_name,
                users.email,
                users.phone,
                salons.salon_name AS merchant_name,
                salons.merchant_id AS merchant_user_id,
                services.service_name,
                services.price AS service_price
            FROM bookings
            INNER JOIN users ON users.user_id = bookings.user_id
            INNER JOIN services ON services.service_id = bookings.service_id
            INNER JOIN salons ON salons.salon_id = services.salon_id
            LEFT JOIN whatsapp_reminder_logs ON whatsapp_reminder_logs.booking_id = bookings.booking_id
                AND whatsapp_reminder_logs.reminder_type = ?
            WHERE users.phone IS NOT NULL
                AND users.phone <> ''
                AND bookings.status NOT IN ('cancelled', 'completed', 'checked_in')
                AND TIMESTAMP(bookings.booking_date, bookings.timeslot) BETWEEN ? AND ?
                AND whatsapp_reminder_logs.log_id IS NULL
            ORDER BY bookings.booking_date ASC, bookings.timeslot ASC
            LIMIT 50
        `;

        db.query(sql, [reminderType, startAt, endAt], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows.map(mapNotificationBooking).filter(Boolean));
        });
    });
}

function markWhatsAppReminderSent(bookingId, reminderType, callback) {
    ensureWhatsAppReminderSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `INSERT IGNORE INTO whatsapp_reminder_logs (booking_id, reminder_type) VALUES (?, ?)`,
            [bookingId, reminderType],
            callback
        );
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

function markCancelled(bookingId, callback) {
    const sql = `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE booking_id = ?
    `;

    db.query(sql, [bookingId], callback);
}

function cancelForCustomer(bookingId, userId, callback) {
    const sql = `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE booking_id = ?
            AND user_id = ?
            AND status NOT IN ('cancelled', 'completed', 'checked_in')
    `;

    db.query(sql, [bookingId, userId], callback);
}

function updateSchedule(bookingId, bookingDate, bookingTime, callback) {
    const sql = `
        UPDATE bookings
        SET booking_date = ?, timeslot = ?
        WHERE booking_id = ?
            AND status <> 'cancelled'
    `;

    db.query(sql, [bookingDate, normalizeTimeForDatabase(bookingTime), bookingId], callback);
}

function updateScheduleForCustomer(bookingId, userId, bookingDate, bookingTime, callback) {
    const sql = `
        UPDATE bookings
        SET booking_date = ?, timeslot = ?
        WHERE booking_id = ?
            AND user_id = ?
            AND status NOT IN ('cancelled', 'completed', 'checked_in')
    `;

    db.query(sql, [bookingDate, normalizeTimeForDatabase(bookingTime), bookingId, userId], callback);
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
    cancelForCustomer,
    findSupportBookingForCustomer,
    getManageableByIdForCustomer,
    getByUserId,
    getReceiptById,
    getAll,
    getAllInDatabase,
    getByMerchantUserId,
    getCheckInDetails,
    getNotificationDetailsById,
    getSupportBookingsByUserId,
    getUpcomingByUserId,
    getWhatsAppReminderCandidates,
    hasExistingBooking,
    hasExistingBookingInDatabase,
    markWhatsAppReminderSent,
    markCancelled,
    markCompleted,
    markCheckedIn,
    updateSchedule,
    updateScheduleForCustomer
};
