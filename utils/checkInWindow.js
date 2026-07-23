const { formatDateTime } = require('./dateTimeFormat');

const CHECK_IN_OPEN_MINUTES = 120;

function parseDateParts(value) {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            return null;
        }

        return {
            year: value.getFullYear(),
            month: value.getMonth(),
            day: value.getDate()
        };
    }

    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
        return {
            year: Number(match[1]),
            month: Number(match[2]) - 1,
            day: Number(match[3])
        };
    }

    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate()
    };
}

function parseTimeParts(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);

    if (!match) {
        return { hours: 0, minutes: 0 };
    }

    return {
        hours: Number(match[1]),
        minutes: Number(match[2])
    };
}

function getAppointmentDateTime(dateValue, timeValue) {
    const dateParts = parseDateParts(dateValue);

    if (!dateParts) {
        return null;
    }

    const timeParts = parseTimeParts(timeValue);
    const appointmentAt = new Date(
        dateParts.year,
        dateParts.month,
        dateParts.day,
        timeParts.hours,
        timeParts.minutes
    );

    return Number.isNaN(appointmentAt.getTime()) ? null : appointmentAt;
}

function getBookingCheckInAvailability(booking, now = new Date()) {
    const appointmentAt = getAppointmentDateTime(booking?.booking_date, booking?.booking_time);

    if (!appointmentAt) {
        return {
            appointmentAt: null,
            opensAt: null,
            opensAtLabel: '',
            isTooEarly: false,
            minutesUntilOpen: 0
        };
    }

    const opensAt = new Date(appointmentAt.getTime() - (CHECK_IN_OPEN_MINUTES * 60 * 1000));
    const minutesUntilOpen = Math.max(0, Math.ceil((opensAt.getTime() - now.getTime()) / 60000));

    return {
        appointmentAt,
        opensAt,
        opensAtLabel: formatDateTime(opensAt),
        isTooEarly: now < opensAt,
        minutesUntilOpen
    };
}

module.exports = {
    CHECK_IN_OPEN_MINUTES,
    getBookingCheckInAvailability
};
