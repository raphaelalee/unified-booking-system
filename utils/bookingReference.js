function formatDatePart(value) {
    if (!value) {
        return '00000000';
    }

    const date = new Date(value || 0);

    if (Number.isNaN(date.getTime())) {
        return '00000000';
    }

    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('');
}

function buildBookingReference(bookingId, dateValue) {
    const id = Number(bookingId || 0);

    if (!Number.isFinite(id) || id <= 0) {
        return '';
    }

    return `BKG-${formatDatePart(dateValue)}-${String(id).padStart(6, '0')}`;
}

module.exports = {
    buildBookingReference
};
