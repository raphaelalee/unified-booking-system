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

module.exports = {
    create,
    getAll,
    hasExistingBooking
};
