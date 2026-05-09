const SINGAPORE_PUBLIC_HOLIDAYS = {
    '2026-01-01': "New Year's Day",
    '2026-02-17': 'Chinese New Year',
    '2026-02-18': 'Chinese New Year',
    '2026-03-21': 'Hari Raya Puasa',
    '2026-04-03': 'Good Friday',
    '2026-05-01': 'Labour Day',
    '2026-05-27': 'Hari Raya Haji',
    '2026-05-31': 'Vesak Day',
    '2026-06-01': 'Vesak Day holiday',
    '2026-08-09': 'National Day',
    '2026-08-10': 'National Day holiday',
    '2026-11-08': 'Deepavali',
    '2026-11-09': 'Deepavali holiday',
    '2026-12-25': 'Christmas Day'
};

function normalizeDateInput(value) {
    const rawValue = String(value || '').trim();

    return /^\d{4}-\d{2}-\d{2}$/.test(rawValue) ? rawValue : '';
}

function getPublicHolidayName(value) {
    return SINGAPORE_PUBLIC_HOLIDAYS[normalizeDateInput(value)] || '';
}

function isPublicHoliday(value) {
    return Boolean(getPublicHolidayName(value));
}

function getPublicHolidayDateMap() {
    return { ...SINGAPORE_PUBLIC_HOLIDAYS };
}

module.exports = {
    getPublicHolidayDateMap,
    getPublicHolidayName,
    isPublicHoliday
};
