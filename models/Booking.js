const db = require('../db');

const bookings = [];
const BOOKING_REVIEW_STATUSES = ['pending'];
const BOOKING_CONFIRMED_STATUSES = ['confirmed', 'paid', 'checked_in', 'completed'];
const BOOKING_UNAVAILABLE_STATUSES = [...BOOKING_REVIEW_STATUSES, ...BOOKING_CONFIRMED_STATUSES];
const SINGAPORE_TIME_ZONE = 'Asia/Singapore';
const SAME_DAY_MIN_LEAD_MINUTES = 30;
const MAX_BOOKING_ADVANCE_MONTHS = 2;
let bookingManagementSchemaReady = false;
let bookingManagementSchemaPending = false;
let bookingManagementSchemaQueue = [];
let whatsappReminderSchemaReady = false;
let whatsappReminderSchemaPending = false;
let whatsappReminderSchemaQueue = [];
let rescheduleAutomationSchemaReady = false;
let rescheduleAutomationSchemaPending = false;
let rescheduleAutomationSchemaQueue = [];
let serviceInventoryUsageSchemaReady = false;

function ensureServiceInventoryUsageSchema(callback) {
    if (serviceInventoryUsageSchemaReady) {
        callback(null);
        return;
    }

    const sql = `
        CREATE TABLE IF NOT EXISTS service_inventory_usage (
            usage_id INT NOT NULL AUTO_INCREMENT,
            booking_id INT NOT NULL,
            service_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity_used INT NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (usage_id),
            UNIQUE KEY uq_service_inventory_usage_booking (booking_id),
            KEY idx_service_inventory_usage_service (service_id),
            KEY idx_service_inventory_usage_product (product_id),
            CONSTRAINT fk_service_inventory_usage_booking
                FOREIGN KEY (booking_id) REFERENCES bookings (booking_id) ON DELETE CASCADE,
            CONSTRAINT fk_service_inventory_usage_service
                FOREIGN KEY (service_id) REFERENCES services (service_id),
            CONSTRAINT fk_service_inventory_usage_product
                FOREIGN KEY (product_id) REFERENCES products (product_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(sql, (error) => {
        if (!error) {
            serviceInventoryUsageSchemaReady = true;
        }

        callback(error);
    });
}

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
        const userIdColumn = columns.find((column) => column.Field === 'user_id');
        const statusColumn = columns.find((column) => column.Field === 'status');
        const alters = [];

        if (userIdColumn && String(userIdColumn.Null || '').toUpperCase() === 'NO') {
            alters.push('MODIFY COLUMN user_id INT DEFAULT NULL');
        }

        if (!fields.has('guest_customer_name')) {
            alters.push('ADD COLUMN guest_customer_name VARCHAR(100) DEFAULT NULL AFTER user_id');
        }

        if (!fields.has('guest_email')) {
            alters.push('ADD COLUMN guest_email VARCHAR(100) DEFAULT NULL AFTER guest_customer_name');
        }

        if (!fields.has('guest_phone')) {
            alters.push('ADD COLUMN guest_phone VARCHAR(20) DEFAULT NULL AFTER guest_email');
        }

        if (statusColumn && !['paid', 'checked_in', 'no_show'].every((status) => String(statusColumn.Type || '').includes(status))) {
            alters.push("MODIFY COLUMN status ENUM('pending','confirmed','paid','checked_in','completed','cancelled','no_show') DEFAULT 'pending'");
        }

        if (!fields.has('cancellation_reason')) {
            alters.push('ADD COLUMN cancellation_reason VARCHAR(180) DEFAULT NULL');
        }

        if (!fields.has('refund_status')) {
            alters.push("ADD COLUMN refund_status VARCHAR(40) NOT NULL DEFAULT 'not_requested'");
        }

        if (!fields.has('cancelled_at')) {
            alters.push('ADD COLUMN cancelled_at DATETIME DEFAULT NULL');
        }

        if (!fields.has('checked_in_at')) {
            alters.push('ADD COLUMN checked_in_at DATETIME DEFAULT NULL');
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

function flushRescheduleAutomationSchema(error) {
    const queue = rescheduleAutomationSchemaQueue;
    rescheduleAutomationSchemaQueue = [];
    rescheduleAutomationSchemaPending = false;
    queue.forEach((callback) => callback(error));
}

function ensureRescheduleAutomationSchema(callback) {
    if (rescheduleAutomationSchemaReady) {
        callback(null);
        return;
    }

    rescheduleAutomationSchemaQueue.push(callback);

    if (rescheduleAutomationSchemaPending) {
        return;
    }

    rescheduleAutomationSchemaPending = true;

    const settingsSql = `
        CREATE TABLE IF NOT EXISTS merchant_reschedule_settings (
            salon_id INT NOT NULL,
            auto_approve_enabled TINYINT(1) NOT NULL DEFAULT 1,
            auto_approve_bookings TINYINT(1) NOT NULL DEFAULT 1,
            minimum_notice_hours INT NOT NULL DEFAULT 24,
            max_reschedules_allowed INT NOT NULL DEFAULT 2,
            blocked_times TEXT,
            peak_hour_restrictions TINYINT(1) NOT NULL DEFAULT 1,
            business_start TIME NOT NULL DEFAULT '09:00:00',
            business_end TIME NOT NULL DEFAULT '20:00:00',
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (salon_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;
    const requestsSql = `
        CREATE TABLE IF NOT EXISTS booking_reschedule_requests (
            request_id INT NOT NULL AUTO_INCREMENT,
            booking_id INT NOT NULL,
            user_id INT NOT NULL,
            merchant_id INT NOT NULL,
            service_id INT NOT NULL,
            old_booking_date DATE NOT NULL,
            old_timeslot TIME DEFAULT NULL,
            requested_booking_date DATE NOT NULL,
            requested_timeslot TIME NOT NULL,
            status ENUM('auto_approved','pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
            confidence_level ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
            confidence_score INT NOT NULL DEFAULT 0,
            decision_reason VARCHAR(255) DEFAULT NULL,
            review_notes TEXT,
            reviewed_by INT DEFAULT NULL,
            reviewed_at DATETIME DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (request_id),
            KEY idx_reschedule_merchant_status (merchant_id, status, created_at),
            KEY idx_reschedule_booking (booking_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    db.query(settingsSql, (settingsError) => {
        if (settingsError) {
            flushRescheduleAutomationSchema(settingsError);
            return;
        }

        db.query('SHOW COLUMNS FROM merchant_reschedule_settings', (columnsError, columns = []) => {
            if (columnsError) {
                flushRescheduleAutomationSchema(columnsError);
                return;
            }

            const fields = new Set(columns.map((column) => column.Field));
            const alters = [];

            if (!fields.has('auto_approve_bookings')) {
                alters.push('ADD COLUMN auto_approve_bookings TINYINT(1) NOT NULL DEFAULT 1 AFTER auto_approve_enabled');
            }

            const createRequests = () => {
                db.query(requestsSql, (requestsError) => {
                    if (!requestsError) {
                        rescheduleAutomationSchemaReady = true;
                    }

                    flushRescheduleAutomationSchema(requestsError);
                });
            };

            if (!alters.length) {
                createRequests();
                return;
            }

            db.query(`ALTER TABLE merchant_reschedule_settings ${alters.join(', ')}`, (alterError) => {
                if (alterError) {
                    flushRescheduleAutomationSchema(alterError);
                    return;
                }

                createRequests();
            });
        });
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

function getDateKey(value) {
    if (!value) {
        return '';
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            return '';
        }

        return [
            value.getFullYear(),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    }

    const rawValue = String(value).trim();
    const match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);

    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseDateKey(dateKey) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        Number.isNaN(date.getTime())
        || date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day, date };
}

function getSingaporeNowParts(now = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-SG', {
        timeZone: SINGAPORE_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(now).reduce((map, part) => {
        map[part.type] = part.value;
        return map;
    }, {});
    const hour = Number(parts.hour || 0);
    const minute = Number(parts.minute || 0);

    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        minutes: (hour * 60) + minute
    };
}

function getSingaporeTodayKey(now = new Date()) {
    return getSingaporeNowParts(now).dateKey;
}

function addMonthsToDateKey(dateKey, monthOffset) {
    const parsed = parseDateKey(dateKey);

    if (!parsed) {
        return '';
    }

    const targetFirst = new Date(Date.UTC(parsed.year, parsed.month - 1 + Number(monthOffset || 0), 1));
    const targetLast = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0));
    const clampedDay = Math.min(parsed.day, targetLast.getUTCDate());

    return [
        targetFirst.getUTCFullYear(),
        String(targetFirst.getUTCMonth() + 1).padStart(2, '0'),
        String(clampedDay).padStart(2, '0')
    ].join('-');
}

function getBookingMaxDateKey(now = new Date()) {
    return addMonthsToDateKey(getSingaporeTodayKey(now), MAX_BOOKING_ADVANCE_MONTHS);
}

function addDaysToDateKey(dateKey, dayOffset) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return '';
    }

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(dayOffset || 0)));
    return date.toISOString().slice(0, 10);
}

function getBookingDateState(bookingDate, now = new Date()) {
    const dateKey = getDateKey(bookingDate);
    const singaporeNow = getSingaporeNowParts(now);
    const maxDateKey = getBookingMaxDateKey(now);

    if (!dateKey || !parseDateKey(dateKey)) {
        return {
            valid: false,
            dateKey: '',
            timing: 'invalid',
            singaporeNow,
            maxDateKey
        };
    }

    if (dateKey < singaporeNow.dateKey) {
        return {
            valid: true,
            dateKey,
            timing: 'past',
            singaporeNow,
            maxDateKey
        };
    }

    if (dateKey > maxDateKey) {
        return {
            valid: true,
            dateKey,
            timing: 'too_future',
            singaporeNow,
            maxDateKey
        };
    }

    if (dateKey === singaporeNow.dateKey) {
        return {
            valid: true,
            dateKey,
            timing: 'today',
            singaporeNow,
            maxDateKey
        };
    }

    return {
        valid: true,
        dateKey,
        timing: 'future',
        singaporeNow,
        maxDateKey
    };
}

function filterSlotsForBookingDate(slots, bookingDate, now = new Date()) {
    const dateState = getBookingDateState(bookingDate, now);

    if (!dateState.valid || dateState.timing === 'past' || dateState.timing === 'too_future') {
        return {
            slots: [],
            dateState
        };
    }

    if (dateState.timing !== 'today') {
        return {
            slots,
            dateState
        };
    }

    return {
        slots: slots.filter((slot) => {
            const minutes = normalizeTimeMinutes(slot);
            return minutes !== null && minutes > dateState.singaporeNow.minutes + SAME_DAY_MIN_LEAD_MINUTES;
        }),
        dateState
    };
}

function normalizeTimeMinutes(value) {
    const normalized = normalizeTimeForDatabase(value);
    const match = String(normalized || '').match(/^(\d{2}):(\d{2})/);

    if (!match) {
        return null;
    }

    return (Number(match[1]) * 60) + Number(match[2]);
}

function formatMinutesAsTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseBlockedTimes(value) {
    return String(value || '')
        .split(',')
        .map((item) => {
            const minutes = normalizeTimeMinutes(item.trim());
            return minutes === null ? '' : formatMinutesAsTime(minutes);
        })
        .filter(Boolean);
}

function uniqueSortedSlots(slots = []) {
    return Array.from(new Set(slots.filter(Boolean))).sort((left, right) => {
        return normalizeTimeMinutes(left) - normalizeTimeMinutes(right);
    });
}

function makeStatusInClause(statuses = BOOKING_UNAVAILABLE_STATUSES) {
    const safeStatuses = (Array.isArray(statuses) ? statuses : [])
        .map((status) => String(status || '').trim().toLowerCase())
        .filter(Boolean);

    return safeStatuses.length ? safeStatuses : BOOKING_UNAVAILABLE_STATUSES;
}

function isPeakHour(bookingTime) {
    const minutes = normalizeTimeMinutes(bookingTime);

    if (minutes === null) {
        return false;
    }

    return (minutes >= 12 * 60 && minutes < 14 * 60) || minutes >= 17 * 60;
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
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            COALESCE(users.email, bookings.guest_email) AS email,
            COALESCE(users.phone, bookings.guest_phone) AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
            users.postal_code AS customer_postal_code,
            users.preferred_contact_method AS customer_preferred_contact_method,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
            services.service_name,
            services.duration_mins,
            services.price AS service_price
        FROM bookings
        LEFT JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        ORDER BY bookings.booking_id DESC
    `;

    db.query(sql, callback);
}

function getByMerchantUserId(userId, callback) {
    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.transaction_id,
            bookings.qr_code_token,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            bookings.refund_status,
            bookings.checked_in_at,
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            COALESCE(users.email, bookings.guest_email) AS email,
            COALESCE(users.phone, bookings.guest_phone) AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
            users.postal_code AS customer_postal_code,
            users.preferred_contact_method AS customer_preferred_contact_method,
            salons.salon_id AS merchant_id,
            salons.salon_name AS merchant_name,
            services.service_id,
            services.service_name,
            services.price AS service_price,
            COALESCE(transactions.payment_status, CASE WHEN bookings.transaction_id IS NOT NULL OR bookings.status = 'paid' THEN 'paid' ELSE 'pending' END) AS payment_status
        FROM bookings
        LEFT JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
        WHERE salons.merchant_id = ?
        ORDER BY bookings.booking_id DESC
    `;

        db.query(sql, [userId], callback);
    });
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

function getNextManageableByUserId(userId, callback) {
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
                salons.merchant_id AS merchant_user_id,
                salons.salon_name AS merchant_name,
                services.service_name,
                services.price AS service_price
            FROM bookings
            INNER JOIN services ON services.service_id = bookings.service_id
            INNER JOIN salons ON salons.salon_id = services.salon_id
            WHERE bookings.user_id = ?
                AND bookings.booking_date >= CURDATE()
                AND bookings.status NOT IN ('cancelled', 'completed', 'checked_in')
            ORDER BY bookings.booking_date ASC, bookings.timeslot ASC
            LIMIT 1
        `;

        db.query(sql, [userId], (error, rows = []) => {
            if (error) {
                callback(error);
                return;
            }

            callback(null, rows[0] || null);
        });
    });
}

function getCheckInDetails(bookingId, merchantUserId, callback) {
    ensureBookingManagementSchema((schemaError) => {
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
            bookings.checked_in_at,
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            COALESCE(users.email, bookings.guest_email) AS email,
            COALESCE(users.phone, bookings.guest_phone) AS customer_phone,
            users.age AS customer_age,
            users.birthday AS customer_birthday,
            users.gender AS customer_gender,
            users.postal_code AS customer_postal_code,
            users.preferred_contact_method AS customer_preferred_contact_method,
            salons.salon_name AS merchant_name,
            services.service_name,
            services.price AS service_price
        FROM bookings
        LEFT JOIN users ON users.user_id = bookings.user_id
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
    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO bookings
                (user_id, guest_customer_name, guest_email, guest_phone, merchant_id, service_id, booking_date, timeslot, status, qr_code_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            bookingData.userId || null,
            bookingData.guestCustomerName || bookingData.customerName || null,
            bookingData.guestEmail || bookingData.email || null,
            bookingData.guestPhone || bookingData.phone || null,
            bookingData.merchantId,
            bookingData.serviceId,
            bookingData.bookingDate,
            normalizeTimeForDatabase(bookingData.bookingTime),
            bookingData.status || 'pending',
            bookingData.qrCodeToken || null
        ];

        db.query(sql, values, callback);
    });
}

function createCustomerBooking(bookingData, callback) {
    createInDatabase(bookingData, callback);
}

function getServiceAvailabilityContext(merchantId, serviceId, callback) {
    const sql = `
        SELECT
            services.service_id,
            services.salon_id,
            services.duration_mins,
            TIME_FORMAT(service_slots.timeslot, '%H:%i') AS slot_time
        FROM services
        LEFT JOIN service_slots ON service_slots.service_id = services.service_id
        WHERE services.service_id = ?
            AND services.salon_id = ?
        ORDER BY service_slots.timeslot ASC
    `;

    db.query(sql, [serviceId, merchantId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        if (!rows.length) {
            callback(null, null);
            return;
        }

        callback(null, {
            serviceId: rows[0].service_id,
            merchantId: rows[0].salon_id,
            durationMins: Math.max(15, Number(rows[0].duration_mins || 60)),
            configuredSlots: uniqueSortedSlots(rows.map((row) => row.slot_time).filter(Boolean))
        });
    });
}

function getAvailabilitySettings(merchantId, callback) {
    getRescheduleSettings(merchantId, (error, settings = {}) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, {
            autoApproveBookings: Number(settings.autoApproveBookings ?? settings.autoApproveEnabled ?? 1) === 1,
            businessStart: String(settings.businessStart || '09:00').slice(0, 5),
            businessEnd: String(settings.businessEnd || '20:00').slice(0, 5),
            blockedTimes: parseBlockedTimes(settings.blockedTimes || ''),
            peakHourRestrictions: Number(settings.peakHourRestrictions ?? 1) === 1,
            bufferMinutes: Math.max(0, Number(settings.bufferMinutes || 0))
        });
    });
}

function generateCandidateSlots(settings, durationMins) {
    const start = normalizeTimeMinutes(settings.businessStart);
    const end = normalizeTimeMinutes(settings.businessEnd);
    const duration = Math.max(15, Number(durationMins || 60));
    const totalDuration = duration + Math.max(0, Number(settings.bufferMinutes || 0));
    const step = duration;

    if (start === null || end === null || end <= start) {
        return [];
    }

    const slots = [];

    for (let cursor = start; cursor + totalDuration <= end; cursor += step) {
        const slot = formatMinutesAsTime(cursor);
        if (!settings.blockedTimes.includes(slot)) {
            slots.push(slot);
        }
    }

    return slots;
}

function isSlotWithinBusinessHours(slot, settings, durationMins) {
    const start = normalizeTimeMinutes(slot);
    const businessStart = normalizeTimeMinutes(settings.businessStart);
    const businessEnd = normalizeTimeMinutes(settings.businessEnd);
    const duration = Math.max(15, Number(durationMins || 60));
    const totalDuration = duration + Math.max(0, Number(settings.bufferMinutes || 0));

    if (start === null || businessStart === null || businessEnd === null) {
        return false;
    }

    return start >= businessStart && start + totalDuration <= businessEnd;
}

function hasBookingClash(merchantId, bookingDate, startTime, endTime, options, callback) {
    const done = typeof options === 'function' ? options : callback;
    const config = typeof options === 'function' ? {} : (options || {});
    const startMinutes = normalizeTimeMinutes(startTime);
    const endMinutes = normalizeTimeMinutes(endTime);
    const excludeBookingId = Number(config.excludeBookingId || 0);
    const statuses = makeStatusInClause(config.statuses);
    const placeholders = statuses.map(() => '?').join(', ');

    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        done(null, false, []);
        return;
    }

    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.status,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            services.duration_mins,
            services.service_id,
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            services.service_name
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        LEFT JOIN users ON users.user_id = bookings.user_id
        WHERE bookings.merchant_id = ?
            AND bookings.booking_id <> ?
            AND bookings.booking_date = ?
            AND bookings.status IN (${placeholders})
    `;

    db.query(sql, [merchantId, excludeBookingId || 0, bookingDate, ...statuses], (error, rows = []) => {
        if (error) {
            done(error);
            return;
        }

        const overlaps = rows.filter((row) => {
            const rowStart = normalizeTimeMinutes(row.booking_time);
            const rowEnd = rowStart === null ? null : rowStart + Math.max(15, Number(row.duration_mins || 60));
            return rowStart !== null && rowEnd !== null && startMinutes < rowEnd && endMinutes > rowStart;
        });

        done(null, overlaps.length > 0, overlaps);
    });
}

function getAvailableSlots(merchantId, serviceId, bookingDate, options, callback) {
    const done = typeof options === 'function' ? options : callback;
    const config = typeof options === 'function' ? {} : (options || {});
    const emptyMeta = (dateState = getBookingDateState(bookingDate, config.now)) => ({
        durationMins: 0,
        businessStart: '',
        businessEnd: '',
        autoApproveBookings: true,
        peakHourRestrictions: true,
        dateState: dateState.timing,
        currentSingaporeDate: dateState.singaporeNow.dateKey,
        currentSingaporeTime: dateState.singaporeNow.time
    });
    const initialDateState = getBookingDateState(bookingDate, config.now);

    if (!initialDateState.valid || initialDateState.timing === 'past' || initialDateState.timing === 'too_future') {
        done(null, [], emptyMeta(initialDateState));
        return;
    }

    getServiceAvailabilityContext(merchantId, serviceId, (contextError, context) => {
        if (contextError || !context) {
            done(contextError, []);
            return;
        }

        getAvailabilitySettings(merchantId, (settingsError, settings) => {
            if (settingsError) {
                done(settingsError, []);
                return;
            }

            const duration = Math.max(15, Number(config.durationMins || context.durationMins || 60));
            const candidateSlots = context.configuredSlots.length
                ? context.configuredSlots.filter((slot) => {
                    return isSlotWithinBusinessHours(slot, settings, duration)
                        && !settings.blockedTimes.includes(slot);
                })
                : generateCandidateSlots(settings, duration);
            const filtered = filterSlotsForBookingDate(candidateSlots, bookingDate, config.now);
            const dateState = filtered.dateState;
            const dateFilteredSlots = filtered.slots;
            const availableSlots = [];
            let pending = dateFilteredSlots.length;
            let failed = false;

            if (!pending) {
                done(null, [], {
                    durationMins: duration,
                    businessStart: settings.businessStart,
                    businessEnd: settings.businessEnd,
                    autoApproveBookings: settings.autoApproveBookings,
                    peakHourRestrictions: settings.peakHourRestrictions,
                    dateState: dateState.timing,
                    currentSingaporeDate: dateState.singaporeNow.dateKey,
                    currentSingaporeTime: dateState.singaporeNow.time
                });
                return;
            }

            dateFilteredSlots.forEach((slot) => {
                const start = normalizeTimeMinutes(slot);
                const end = formatMinutesAsTime(start + duration + Number(settings.bufferMinutes || 0));

                hasBookingClash(
                    merchantId,
                    bookingDate,
                    slot,
                    end,
                    { excludeBookingId: config.excludeBookingId },
                    (clashError, hasClash) => {
                        if (failed) {
                            return;
                        }

                        if (clashError) {
                            failed = true;
                            done(clashError, []);
                            return;
                        }

                        if (!hasClash) {
                            availableSlots.push(slot);
                        }

                        pending -= 1;
                        if (!pending) {
                            done(null, uniqueSortedSlots(availableSlots), {
                                durationMins: duration,
                                businessStart: settings.businessStart,
                                businessEnd: settings.businessEnd,
                                autoApproveBookings: settings.autoApproveBookings,
                                peakHourRestrictions: settings.peakHourRestrictions,
                                dateState: dateState.timing,
                                currentSingaporeDate: dateState.singaporeNow.dateKey,
                                currentSingaporeTime: dateState.singaporeNow.time
                            });
                        }
                    }
                );
            });
        });
    });
}

function autoConfirmBookingUnlocked(bookingData, callback) {
    getServiceAvailabilityContext(bookingData.merchantId, bookingData.serviceId, (contextError, context) => {
        if (contextError || !context) {
            callback(contextError || new Error('Selected service could not be found.'), null);
            return;
        }

        const duration = Math.max(15, Number(bookingData.durationMins || context.durationMins || 60));
        const startMinutes = normalizeTimeMinutes(bookingData.bookingTime);
        const bookingTime = startMinutes === null ? '' : formatMinutesAsTime(startMinutes);

        if (startMinutes === null) {
            callback(null, {
                created: false,
                confirmed: false,
                reason: 'invalid_time',
                message: 'Please choose a valid booking time.',
                alternatives: []
            });
            return;
        }

        getAvailableSlots(
            bookingData.merchantId,
            bookingData.serviceId,
            bookingData.bookingDate,
            { durationMins: duration },
            (availabilityError, slots = []) => {
                if (availabilityError) {
                    callback(availabilityError);
                    return;
                }

                if (!slots.includes(bookingTime)) {
                    callback(null, {
                        created: false,
                        confirmed: false,
                        reason: 'unavailable',
                        message: slots.length
                            ? `The selected time is unavailable. Suggested alternatives: ${slots.slice(0, 3).join(', ')}.`
                            : 'No available slots for this date. Please choose another date.',
                        alternatives: slots.slice(0, 6)
                    });
                    return;
                }

                getAvailabilitySettings(bookingData.merchantId, (settingsError, settings) => {
                    if (settingsError) {
                        callback(settingsError);
                        return;
                    }

                    const pendingReasons = [];

                    if (settings.autoApproveBookings === false) {
                        pendingReasons.push('auto_approval_disabled');
                    }

                    const nextStatus = pendingReasons.length ? 'pending' : 'confirmed';

                    createInDatabase({
                        ...bookingData,
                        bookingTime,
                        status: nextStatus
                    }, (createError, result) => {
                        if (createError) {
                            callback(createError);
                            return;
                        }

                        callback(null, {
                            created: true,
                            confirmed: nextStatus === 'confirmed',
                            pending: nextStatus === 'pending',
                            status: nextStatus,
                            reason: pendingReasons[0] || 'available',
                            pendingReasons,
                            message: nextStatus === 'confirmed'
                                ? 'Booking confirmed.'
                                : 'Booking sent to the merchant for review.',
                            result,
                            alternatives: []
                        });
                    });
                });
            }
        );
    });
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
            AND (bookings.transaction_id IS NOT NULL OR bookings.status IN ('confirmed', 'paid', 'checked_in', 'completed'))
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
            managed.merchant_id,
            services.duration_mins
        FROM bookings AS managed
        INNER JOIN services ON services.service_id = managed.service_id
        WHERE managed.user_id = ?
            AND managed.booking_id IN (${placeholders})
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

            let pendingSettings = slotRows.length;
            let failed = false;

            if (!pendingSettings) {
                callback(null, availability);
                return;
            }

            slotRows.forEach((row) => {
                getAvailabilitySettings(row.merchant_id, (settingsError, settings) => {
                    if (failed) {
                        return;
                    }

                    if (settingsError) {
                        failed = true;
                        callback(settingsError);
                        return;
                    }

                    const key = String(row.booking_id);
                    if (availability[key]) {
                        availability[key].slots = generateCandidateSlots(settings, row.duration_mins);
                    }

                    pendingSettings -= 1;
                    if (!pendingSettings) {
                        callback(null, availability);
                    }
                });
            });
        });
    });
}

function getRescheduleSettings(salonId, callback) {
    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT IGNORE INTO merchant_reschedule_settings (salon_id)
            VALUES (?)
        `;

        db.query(sql, [salonId], (insertError) => {
            if (insertError) {
                callback(insertError);
                return;
            }

            db.query(
                `SELECT
                    salon_id AS salonId,
                    auto_approve_enabled AS autoApproveEnabled,
                    auto_approve_bookings AS autoApproveBookings,
                    minimum_notice_hours AS minimumNoticeHours,
                    max_reschedules_allowed AS maxReschedulesAllowed,
                    blocked_times AS blockedTimes,
                    peak_hour_restrictions AS peakHourRestrictions,
                    TIME_FORMAT(business_start, '%H:%i') AS businessStart,
                    TIME_FORMAT(business_end, '%H:%i') AS businessEnd
                 FROM merchant_reschedule_settings
                 WHERE salon_id = ?
                 LIMIT 1`,
                [salonId],
                (selectError, rows = []) => {
                    if (selectError) {
                        callback(selectError);
                        return;
                    }

                    callback(null, rows[0] || null);
                }
            );
        });
    });
}

function updateRescheduleSettings(salonId, settings, callback) {
    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO merchant_reschedule_settings
                (salon_id, auto_approve_enabled, auto_approve_bookings, minimum_notice_hours, max_reschedules_allowed, blocked_times, peak_hour_restrictions, business_start, business_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                auto_approve_enabled = VALUES(auto_approve_enabled),
                auto_approve_bookings = VALUES(auto_approve_bookings),
                minimum_notice_hours = VALUES(minimum_notice_hours),
                max_reschedules_allowed = VALUES(max_reschedules_allowed),
                blocked_times = VALUES(blocked_times),
                peak_hour_restrictions = VALUES(peak_hour_restrictions),
                business_start = VALUES(business_start),
                business_end = VALUES(business_end)
        `;

        db.query(sql, [
            salonId,
            settings.autoApproveEnabled ? 1 : 0,
            settings.autoApproveBookings === undefined ? (settings.autoApproveEnabled ? 1 : 0) : (settings.autoApproveBookings ? 1 : 0),
            Math.max(0, Math.min(Number(settings.minimumNoticeHours || 24), 720)),
            Math.max(0, Math.min(Number(settings.maxReschedulesAllowed || 2), 20)),
            String(settings.blockedTimes || '').slice(0, 500),
            settings.peakHourRestrictions ? 1 : 0,
            normalizeTimeForDatabase(settings.businessStart || '09:00'),
            normalizeTimeForDatabase(settings.businessEnd || '20:00')
        ], callback);
    });
}

function countReschedulesForBooking(bookingId, callback) {
    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `SELECT COUNT(*) AS total
             FROM booking_reschedule_requests
             WHERE booking_id = ? AND status IN ('auto_approved', 'approved')`,
            [bookingId],
            (error, rows = []) => {
                if (error) {
                    callback(error);
                    return;
                }

                callback(null, Number(rows[0]?.total || 0));
            }
        );
    });
}

function getAllowedSlotsForBooking(bookingId, userId, callback) {
    const sql = `
        SELECT
            bookings.merchant_id,
            bookings.service_id,
            services.duration_mins
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        WHERE bookings.booking_id = ?
            AND bookings.user_id = ?
        LIMIT 1
    `;

    db.query(sql, [bookingId, userId], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        const booking = rows[0];

        if (!booking) {
            callback(null, []);
            return;
        }

        getAvailabilitySettings(booking.merchant_id, (settingsError, settings) => {
            if (settingsError) {
                callback(settingsError);
                return;
            }

            callback(null, generateCandidateSlots(settings, booking.duration_mins));
        });
    });
}

function findOverlappingBookings(merchantId, bookingId, bookingDate, bookingTime, durationMins, callback) {
    const startMinutes = normalizeTimeMinutes(bookingTime);
    const duration = Math.max(15, Number(durationMins || 60));

    if (startMinutes === null) {
        callback(null, []);
        return;
    }

    const endMinutes = startMinutes + duration;
    const sql = `
        SELECT
            bookings.booking_id AS id,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            services.duration_mins,
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            services.service_name
        FROM bookings
        INNER JOIN services ON services.service_id = bookings.service_id
        LEFT JOIN users ON users.user_id = bookings.user_id
        WHERE bookings.merchant_id = ?
            AND bookings.booking_id <> ?
            AND bookings.booking_date = ?
            AND bookings.status NOT IN ('cancelled', 'completed', 'no_show')
    `;

    db.query(sql, [merchantId, bookingId, bookingDate], (error, rows = []) => {
        if (error) {
            callback(error);
            return;
        }

        const overlaps = rows.filter((row) => {
            const rowStart = normalizeTimeMinutes(row.booking_time);
            const rowEnd = rowStart === null ? null : rowStart + Math.max(15, Number(row.duration_mins || 60));

            return rowStart !== null && rowEnd !== null && startMinutes < rowEnd && endMinutes > rowStart;
        });

        callback(null, overlaps);
    });
}

function createRescheduleRequest(data, callback) {
    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            INSERT INTO booking_reschedule_requests
                (booking_id, user_id, merchant_id, service_id, old_booking_date, old_timeslot, requested_booking_date, requested_timeslot, status, confidence_level, confidence_score, decision_reason, review_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            data.bookingId,
            data.userId,
            data.merchantId,
            data.serviceId,
            data.oldBookingDate,
            normalizeTimeForDatabase(data.oldBookingTime),
            data.requestedBookingDate,
            normalizeTimeForDatabase(data.requestedBookingTime),
            data.status,
            data.confidenceLevel,
            data.confidenceScore,
            String(data.decisionReason || '').slice(0, 255),
            data.reviewNotes || null
        ], callback);
    });
}

function listRescheduleRequestsForMerchant(merchantUserId, callback) {
    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
            SELECT
                booking_reschedule_requests.request_id AS id,
                booking_reschedule_requests.booking_id AS bookingId,
                booking_reschedule_requests.user_id AS userId,
                booking_reschedule_requests.merchant_id AS salonId,
                booking_reschedule_requests.service_id AS serviceId,
                booking_reschedule_requests.old_booking_date AS oldBookingDate,
                TIME_FORMAT(booking_reschedule_requests.old_timeslot, '%H:%i') AS oldBookingTime,
                booking_reschedule_requests.requested_booking_date AS requestedBookingDate,
                TIME_FORMAT(booking_reschedule_requests.requested_timeslot, '%H:%i') AS requestedBookingTime,
                booking_reschedule_requests.status,
                booking_reschedule_requests.confidence_level AS confidenceLevel,
                booking_reschedule_requests.confidence_score AS confidenceScore,
                booking_reschedule_requests.decision_reason AS decisionReason,
                booking_reschedule_requests.review_notes AS reviewNotes,
                booking_reschedule_requests.created_at AS createdAt,
                users.name AS customerName,
                users.email AS customerEmail,
                services.service_name AS serviceName
            FROM booking_reschedule_requests
            INNER JOIN salons ON salons.salon_id = booking_reschedule_requests.merchant_id
            INNER JOIN users ON users.user_id = booking_reschedule_requests.user_id
            INNER JOIN services ON services.service_id = booking_reschedule_requests.service_id
            WHERE salons.merchant_id = ?
            ORDER BY booking_reschedule_requests.created_at DESC, booking_reschedule_requests.request_id DESC
            LIMIT 80
        `;

        db.query(sql, [merchantUserId], callback);
    });
}

function reviewRescheduleRequest(requestId, merchantUserId, action, callback) {
    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : '';

    if (!nextStatus) {
        callback(new Error('Invalid reschedule review action.'));
        return;
    }

    ensureRescheduleAutomationSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const lookupSql = `
            SELECT
                booking_reschedule_requests.*,
                salons.merchant_id AS merchant_user_id,
                services.duration_mins
            FROM booking_reschedule_requests
            INNER JOIN salons ON salons.salon_id = booking_reschedule_requests.merchant_id
            INNER JOIN services ON services.service_id = booking_reschedule_requests.service_id
            WHERE booking_reschedule_requests.request_id = ?
                AND salons.merchant_id = ?
                AND booking_reschedule_requests.status = 'pending_review'
            LIMIT 1
        `;

        db.query(lookupSql, [requestId, merchantUserId], (lookupError, rows = []) => {
            if (lookupError) {
                callback(lookupError);
                return;
            }

            const request = rows[0];

            if (!request) {
                callback(null, { affectedRows: 0 });
                return;
            }

            const updateRequest = (done) => {
                db.query(
                    `UPDATE booking_reschedule_requests
                     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
                     WHERE request_id = ?`,
                    [nextStatus, merchantUserId, requestId],
                    done
                );
            };

            if (nextStatus === 'rejected') {
                updateRequest((updateError, result) => callback(updateError, result, request));
                return;
            }

            const requestedDate = getDateKey(request.requested_booking_date);
            findOverlappingBookings(
                request.merchant_id,
                request.booking_id,
                requestedDate,
                request.requested_timeslot,
                request.duration_mins,
                (overlapError, overlaps = []) => {
                    if (overlapError || overlaps.length > 0) {
                        callback(overlapError || new Error('Requested slot now overlaps another booking.'));
                        return;
                    }

                    updateScheduleForCustomer(
                        request.booking_id,
                        request.user_id,
                        requestedDate,
                        request.requested_timeslot,
                        (scheduleError, scheduleResult) => {
                            if (scheduleError || !scheduleResult?.affectedRows) {
                                callback(scheduleError || new Error('Booking could not be updated for this request.'));
                                return;
                            }

                            updateRequest((updateError, result) => callback(updateError, result, request));
                        }
                    );
                }
            );
        });
    });
}

function getRescheduleSuggestionCandidates(bookingId, userId, callback) {
    getManageableByIdForCustomer(bookingId, userId, (lookupError, booking) => {
        if (lookupError || !booking) {
            callback(lookupError, booking, []);
            return;
        }

        const todayKey = getSingaporeTodayKey();
        const candidates = [];
        let pending = 14;
        let failed = false;

        for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
            const dateKey = addDaysToDateKey(todayKey, dayOffset);

            getAvailableSlots(
                booking.salon_id,
                booking.service_id,
                dateKey,
                { excludeBookingId: booking.id, durationMins: booking.duration_mins },
                (slotError, slots = []) => {
                    if (failed) {
                        return;
                    }

                    if (slotError) {
                        failed = true;
                        callback(slotError, booking, []);
                        return;
                    }

                    slots.forEach((slot) => {
                        candidates.push({
                            dateKey,
                            slot,
                            crowdScore: dayOffset,
                            label: dayOffset === 0 ? 'Nearest available' : dayOffset <= 3 ? 'Same-week opening' : 'Least crowded'
                        });
                    });

                    pending -= 1;
                    if (!pending) {
                        candidates.sort((left, right) => {
                            if (left.crowdScore === right.crowdScore) {
                                return `${left.dateKey} ${left.slot}`.localeCompare(`${right.dateKey} ${right.slot}`);
                            }

                            return left.crowdScore - right.crowdScore;
                        });
                        callback(null, booking, candidates.slice(0, 6));
                    }
                }
            );
        }
    });
}

function getSupportBookingsByUserId(userId, callback) {
    const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.transaction_id,
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
            bookings.transaction_id,
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
            salons.merchant_id AS merchant_user_id,
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
    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        const sql = `
        SELECT
            bookings.booking_id AS id,
            bookings.user_id,
            bookings.transaction_id,
            bookings.qr_code_token,
            bookings.booking_date,
            TIME_FORMAT(bookings.timeslot, '%H:%i') AS booking_time,
            bookings.status,
            bookings.checked_in_at,
            transactions.created_at AS paid_at,
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            COALESCE(users.email, bookings.guest_email) AS email,
            salons.salon_id AS merchant_id,
            salons.salon_name AS merchant_name,
            salons.address AS merchant_address,
            salons.merchant_id AS merchant_user_id,
            services.service_id,
            services.service_name,
            services.duration_mins,
            services.price AS service_price,
            COALESCE(transactions.payment_status, CASE WHEN bookings.transaction_id IS NOT NULL OR bookings.status = 'paid' THEN 'paid' ELSE 'pending' END) AS payment_status
        FROM bookings
        LEFT JOIN users ON users.user_id = bookings.user_id
        INNER JOIN services ON services.service_id = bookings.service_id
        INNER JOIN salons ON salons.salon_id = services.salon_id
        LEFT JOIN transactions ON transactions.transaction_id = bookings.transaction_id
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
            COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
            COALESCE(users.email, bookings.guest_email) AS email,
            COALESCE(users.phone, bookings.guest_phone) AS phone,
            services.service_id,
            salons.salon_id,
            salons.salon_name AS merchant_name,
            salons.merchant_id AS merchant_user_id,
            services.service_name,
            services.price AS service_price
        FROM bookings
        LEFT JOIN users ON users.user_id = bookings.user_id
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
    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

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
                    COALESCE(users.name, bookings.guest_customer_name) AS customer_name,
                    COALESCE(users.email, bookings.guest_email) AS email,
                    COALESCE(users.phone, bookings.guest_phone) AS phone,
                    salons.salon_name AS merchant_name,
                    salons.merchant_id AS merchant_user_id,
                    services.service_name,
                    services.price AS service_price
                FROM bookings
                LEFT JOIN users ON users.user_id = bookings.user_id
                INNER JOIN services ON services.service_id = bookings.service_id
                INNER JOIN salons ON salons.salon_id = services.salon_id
                LEFT JOIN whatsapp_reminder_logs ON whatsapp_reminder_logs.booking_id = bookings.booking_id
                    AND whatsapp_reminder_logs.reminder_type = ?
                WHERE COALESCE(users.phone, bookings.guest_phone) IS NOT NULL
                    AND COALESCE(users.phone, bookings.guest_phone) <> ''
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
    completeBookingWithInventory(bookingId, null, callback);
}

function autoConfirmBooking(bookingData, callback) {
    const merchantId = Number(bookingData.merchantId);
    const bookingDate = String(bookingData.bookingDate || '').slice(0, 10);
    const lockName = `booking:${merchantId}:${bookingDate}`.slice(0, 64);

    db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName], (lockError, rows = []) => {
            if (lockError || Number(rows[0]?.acquired) !== 1) {
                connection.release();
                callback(lockError || new Error('Booking creation is busy. Please try again.'));
                return;
            }

            autoConfirmBookingUnlocked(bookingData, (error, result) => {
                connection.query('SELECT RELEASE_LOCK(?)', [lockName], () => {
                    connection.release();
                    callback(error, result);
                });
            });
        });
    });
}

function completeBookingWithInventory(bookingId, merchantUserId, callback) {
    ensureServiceInventoryUsageSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.getConnection((connectionError, connection) => {
        if (connectionError) {
            callback(connectionError);
            return;
        }

        connection.beginTransaction((transactionError) => {
            if (transactionError) {
                connection.release();
                callback(transactionError);
                return;
            }

            const rollback = (error) => connection.rollback(() => {
                connection.release();
                callback(error);
            });
            const ownerJoin = merchantUserId
                ? 'INNER JOIN salons ON salons.salon_id = bookings.merchant_id'
                : '';
            const ownerWhere = merchantUserId ? 'AND salons.merchant_id = ?' : '';
            const params = merchantUserId ? [bookingId, merchantUserId] : [bookingId];
            const lookupSql = `
                SELECT
                    bookings.booking_id,
                    bookings.service_id,
                    service_inventory_links.product_id,
                    service_inventory_links.quantity_required,
                    products.stock_quantity
                FROM bookings
                ${ownerJoin}
                LEFT JOIN service_inventory_links ON service_inventory_links.service_id = bookings.service_id
                LEFT JOIN products ON products.product_id = service_inventory_links.product_id
                WHERE bookings.booking_id = ?
                    ${ownerWhere}
                FOR UPDATE
            `;

            connection.query(lookupSql, params, (lookupError, rows = []) => {
                if (lookupError) {
                    rollback(lookupError);
                    return;
                }

                if (!rows.length) {
                    rollback(new Error('Booking was not found.'));
                    return;
                }

                const booking = rows[0];
                const finish = () => {
                    connection.query(
                        `UPDATE bookings SET status = 'completed' WHERE booking_id = ?`,
                        [bookingId],
                        (updateError, result) => {
                            if (updateError) {
                                rollback(updateError);
                                return;
                            }

                            connection.commit((commitError) => {
                                connection.release();
                                callback(commitError, result);
                            });
                        }
                    );
                };

                if (!booking.product_id) {
                    finish();
                    return;
                }

                const quantity = Math.max(1, Number(booking.quantity_required || 1));
                const usageSql = `
                    INSERT IGNORE INTO service_inventory_usage
                        (booking_id, service_id, product_id, quantity_used)
                    VALUES (?, ?, ?, ?)
                `;

                connection.query(
                    usageSql,
                    [bookingId, booking.service_id, booking.product_id, quantity],
                    (usageError, usageResult) => {
                        if (usageError) {
                            rollback(usageError);
                            return;
                        }

                        if (usageResult.affectedRows === 0) {
                            finish();
                            return;
                        }

                        connection.query(
                            `UPDATE products
                             SET stock_quantity = stock_quantity - ?
                             WHERE product_id = ? AND stock_quantity >= ?`,
                            [quantity, booking.product_id, quantity],
                            (stockError, stockResult) => {
                                if (stockError) {
                                    rollback(stockError);
                                    return;
                                }

                                if (stockResult.affectedRows === 0) {
                                    rollback(new Error('The linked service inventory does not have enough stock.'));
                                    return;
                                }

                                finish();
                            }
                        );
                    }
                );
            });
        });
    });
    });
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

function markConfirmedForCustomer(bookingId, userId, callback) {
    return ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(
            `
                UPDATE bookings
                SET status = 'confirmed'
                WHERE booking_id = ?
                    AND user_id = ?
                    AND status = 'pending'
            `,
            [bookingId, userId],
            callback
        );
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
        SET
            bookings.status = 'checked_in',
            bookings.checked_in_at = COALESCE(bookings.checked_in_at, CURRENT_TIMESTAMP)
        WHERE bookings.booking_id = ?
            AND salons.merchant_id = ?
    `;

    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(sql, [bookingId, merchantUserId], callback);
    });
}

function markCheckedInByToken(bookingId, callback) {
    const sql = `
        UPDATE bookings
        SET
            status = 'checked_in',
            checked_in_at = COALESCE(checked_in_at, CURRENT_TIMESTAMP)
        WHERE booking_id = ?
            AND status = 'confirmed'
            AND checked_in_at IS NULL
    `;

    ensureBookingManagementSchema((schemaError) => {
        if (schemaError) {
            callback(schemaError);
            return;
        }

        db.query(sql, [bookingId], callback);
    });
}

function updateStatusForMerchant(bookingId, merchantUserId, status, callback) {
    const allowedStatuses = new Set(['pending', 'confirmed', 'completed', 'cancelled', 'no_show']);
    const nextStatus = String(status || '').trim().toLowerCase();

    if (!allowedStatuses.has(nextStatus)) {
        callback(new Error('Invalid booking status.'));
        return;
    }

    if (nextStatus === 'completed') {
        completeBookingWithInventory(bookingId, merchantUserId, callback);
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
    autoConfirmBooking,
    createCustomerBooking,
    createInDatabase,
    cancelForCustomer,
    getAvailabilityByBookingIds,
    getAvailableSlots,
    countReschedulesForBooking,
    createRescheduleRequest,
    findSupportBookingForCustomer,
    findOverlappingBookings,
    getManageableByIdForCustomer,
    getAllowedSlotsForBooking,
    getByUserId,
    getReceiptById,
    getRescheduleSettings,
    getRescheduleSuggestionCandidates,
    getAll,
    getAllInDatabase,
    getByMerchantUserId,
    getBookingDateState,
    getBookingMaxDateKey,
    getCheckInDetails,
    getNotificationDetailsById,
    getNextManageableByUserId,
    getSupportBookingsByUserId,
    getSingaporeTodayKey,
    getUpcomingByUserId,
    filterSlotsForBookingDate,
    getWhatsAppReminderCandidates,
    ensureBookingManagementSchema,
    hasExistingBooking,
    hasExistingBookingInDatabase,
    hasBookingClash,
    markWhatsAppReminderSent,
    markCancelled,
    markCompleted,
    markConfirmedForCustomer,
    markCheckedIn,
    markCheckedInByToken,
    listRescheduleRequestsForMerchant,
    reviewRescheduleRequest,
    updateRescheduleSettings,
    updateSchedule,
    updateScheduleForCustomer,
    updateStatusForMerchant
};
