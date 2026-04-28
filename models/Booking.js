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
        SELECT id
        FROM bookings
        WHERE merchant_id = ?
            AND service_id = ?
            AND booking_date = ?
            AND booking_time = ?
            AND status <> 'Cancelled'
        LIMIT 1
    `;

    db.query(sql, [merchantId, serviceId, bookingDate, bookingTime], (error, results) => {
        if (error) {
            callback(error);
            return;
        }

        callback(null, results.length > 0);
    });
}

function createInDatabase(bookingData, callback) {
    const sql = `
        INSERT INTO bookings
            (merchant_id, merchant_name, service_id, service_name, customer_name, email, phone, booking_date, booking_time, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        bookingData.merchantId,
        bookingData.merchantName,
        bookingData.serviceId,
        bookingData.serviceName,
        bookingData.customerName,
        bookingData.email,
        bookingData.phone,
        bookingData.bookingDate,
        bookingData.bookingTime,
        bookingData.status || 'Pending'
    ];

    db.query(sql, values, callback);
}

module.exports = {
    create,
    createInDatabase,
    getAll,
    hasExistingBooking,
    hasExistingBookingInDatabase
};
