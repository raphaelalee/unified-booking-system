function normalizeMeridiem(value) {
    return String(value || '').replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());
}

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
        return {
            hours: 0,
            minutes: 0
        };
    }

    return {
        hours: Number(match[1]),
        minutes: Number(match[2])
    };
}

function formatDateTime(value) {
    if (!value) {
        return '';
    }

    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return normalizeMeridiem(date.toLocaleString('en-SG', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }));
}

function formatAppointmentDateTime(dateValue, timeValue) {
    const dateParts = parseDateParts(dateValue);

    if (!dateParts) {
        return timeValue ? String(timeValue).slice(0, 5) : '';
    }

    const timeParts = parseTimeParts(timeValue);
    const date = new Date(
        dateParts.year,
        dateParts.month,
        dateParts.day,
        timeParts.hours,
        timeParts.minutes
    );

    return formatDateTime(date);
}

module.exports = {
    formatAppointmentDateTime,
    formatDateTime
};
