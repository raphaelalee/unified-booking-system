const db = require('../db');

const bookings = [];
let bookingManagementSchemaReady = false;
let bookingManagementSchemaPending = false;
let bookingManagementSchemaQueue = [];
let whatsappReminderSchemaReady = false;
let whatsappReminderSchemaPending = false;
let whatsappReminderSchemaQueue = [];

function flushBookingManagementSchema(error) {
    const queue = bookingManagementSchemaQueue;
    bookingManagementSchemaQueue = [];
    bookingManagementSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureBookingManagementSchema(callback) {
    if (bookingManagementSchemaReady) {
        callback(null);
        return;
    }

    bookingManagementSchemaQueue.push(callback);

    if (bookingManagementSchemaPending) {
        return;
    }

    bookingManagementSchemaPending = true;

    db.query('SHOW COLUMNS FROM bookings', (columnError, columns = []) => {
        if (columnError) {
            flushBookingManagementSchema(columnError);
            return;
        }

        const fields = new Set(columns.map((column) => column.Field));
        const alters = [];

        if (!fields.has('cancellation_reason')) {
            alters.push('ADD COLUMN cancellation_reason VARCHAR(180) DEFAULT NULL');
        }

        if (!fields.has('refund_status')) {
            alters.push("ADD COLUMN refund_status VARCHAR(40) NOT NULL DEFAULT 'not_requested'");
        }

        if (!fields.has('cancelled_at')) {
            alters.push('ADD COLUMN cancelled_at DATETIME DEFAULT NULL');
        }

        if (alters.length === 0) {
            bookingManagementSchemaReady = true;
            flushBookingManagementSchema(null);
            return;
        }

        db.query(`ALTER TABLE bookings ${alters.join(', ')}`, (alterError) => {
            if (!alterError) {
                bookingManagementSchemaReady = true;
            }

            flushBookingManagementSchema(alterError);
        });
    });
}

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
            users.phone AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
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
            users.phone AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
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
            users.phone AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
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
    return ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            bookings.cancellation_reason,
            bookings.refund_status,
            bookings.cancelled_at,
            salons.salon_name AS merchant_name,
            salons.address AS merchant_address,
            salons.salon_id AS merchant_id,
            salons.image_url AS service_image_url,
            services.service_id,
            services.service_name,
            services.duration_mins,
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
    });
}

function getAvailabilityByBookingIds(userId, bookingIds, callback) {
    const ids = (Array.isArray(bookingIds) ? bookingIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0);

    if (!ids.length) {
        callback(null, {});
        return;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const slotSql = `
        SELECT
            managed.booking_id AS booking_id,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS slot_time
        FROM bookings AS managed
        INNER JOIN service_slots ON service_slots.service_id = managed.service_id
        WHERE managed.user_id = ?
            AND managed.booking_id IN (${placeholders})
        ORDER BY service_slots.timeslot ASC
    `;
    const takenSql = `
        SELECT
            managed.booking_id AS booking_id,
            taken.booking_date,
            TIME_FORMAT(taken.timeslot, '%H:%i') AS slot_time
        FROM bookings AS managed
        INNER JOIN bookings AS taken ON taken.service_id = managed.service_id
            AND taken.merchant_id = managed.merchant_id
            AND taken.booking_id <> managed.booking_id
        WHERE managed.user_id = ?
            AND managed.booking_id IN (${placeholders})
            AND taken.status <> 'cancelled'
            AND taken.booking_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 14 DAY)
        ORDER BY taken.booking_date ASC, taken.timeslot ASC
    `;

    db.query(slotSql, [userId, ...ids], (slotError, slotRows = []) => {
        if (slotError) {
            callback(slotError);
            return;
        }

        db.query(takenSql, [userId, ...ids], (takenError, takenRows = []) => {
            if (takenError) {
                callback(takenError);
                return;
            }

            const availability = ids.reduce((map, id) => {
                map[String(id)] = {
                    slots: [],
                    taken: []
                };
                return map;
            }, {});

            slotRows.forEach((row) => {
                const key = String(row.booking_id);
                if (availability[key] && row.slot_time && !availability[key].slots.includes(row.slot_time)) {
                    availability[key].slots.push(row.slot_time);
                }
            });

            takenRows.forEach((row) => {
                const key = String(row.booking_id);
                if (!availability[key] || !row.booking_date || !row.slot_time) {
                    return;
                }

                const date = row.booking_date instanceof Date
                    ? row.booking_date.toISOString().slice(0, 10)
                    : String(row.booking_date).slice(0, 10);
                availability[key].taken.push(`${date}|${row.slot_time}`);
            });

            callback(null, availability);
        });
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
    return ensureBookingManagementSchema((schemaError) => {
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
            bookings.cancellation_reason,
            bookings.refund_status,
            bookings.cancelled_at,
            services.service_id,
            services.duration_mins,
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

function cancelForCustomer(bookingId, userId, reason, refundStatus, callback) {
    const sql = `
        UPDATE bookings
        SET
            status = 'cancelled',
            cancellation_reason = ?,
            refund_status = ?,
            cancelled_at = CURRENT_TIMESTAMP
        WHERE booking_id = ?
            AND user_id = ?
            AND status NOT IN ('cancelled', 'completed', 'checked_in')
    `;

    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(sql, [reason || null, refundStatus || 'not_requested', bookingId, userId], callback);
    });
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

function updateStatusForMerchant(bookingId, merchantUserId, status, callback) {
    const allowedStatuses = new Set(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
    const nextStatus = String(status || '').trim().toLowerCase();

    if (!allowedStatuses.has(nextStatus)) {
        callback(new Error('Invalid booking status.'));
        return;
    }

    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            UPDATE bookings
            INNER JOIN services ON services.service_id = bookings.service_id
            INNER JOIN salons ON salons.salon_id = services.salon_id
            SET
                bookings.status = ?,
                bookings.cancelled_at = CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE bookings.cancelled_at END,
                bookings.cancellation_reason = CASE WHEN ? = 'cancelled' THEN COALESCE(bookings.cancellation_reason, 'Cancelled by merchant') ELSE bookings.cancellation_reason END,
                bookings.refund_status = CASE WHEN ? = 'cancelled' THEN 'merchant_cancelled_review' ELSE bookings.refund_status END
            WHERE bookings.booking_id = ?
                AND salons.merchant_id = ?
        `;

        db.query(sql, [nextStatus, nextStatus, nextStatus, nextStatus, bookingId, merchantUserId], callback);
    });
}

module.exports = {
    attachTransaction,
    create,
    createCustomerBooking,
    createInDatabase,
    cancelForCustomer,
    getAvailabilityByBookingIds,
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
    updateScheduleForCustomer,
    updateStatusForMerchant
};
