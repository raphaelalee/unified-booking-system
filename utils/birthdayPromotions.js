function toDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthEnd(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
}

function formatDateKey(value) {
    const date = toDate(value);

    if (!date) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function getBirthdayPromotionContext(birthday, now = new Date()) {
    const birthdayDate = toDate(birthday);
    const referenceDate = toDate(now) || new Date();

    if (!birthdayDate) {
        return {
            hasBirthday: false,
            isBirthdayMonth: false,
            birthdayMonth: 0,
            rewardYear: referenceDate.getFullYear(),
            monthName: '',
            monthStart: null,
            monthEnd: null,
            monthEndKey: '',
            monthEndLabel: ''
        };
    }

    const birthdayMonth = birthdayDate.getMonth();
    const rewardYear = referenceDate.getFullYear();
    const monthStart = new Date(rewardYear, birthdayMonth, 1, 0, 0, 0, 0);
    const monthEnd = getMonthEnd(rewardYear, birthdayMonth);

    return {
        hasBirthday: true,
        isBirthdayMonth: referenceDate.getMonth() === birthdayMonth,
        birthdayMonth,
        rewardYear,
        monthName: monthStart.toLocaleString('en-SG', { month: 'long' }),
        monthStart,
        monthEnd,
        monthEndKey: formatDateKey(monthEnd),
        monthEndLabel: monthEnd.toLocaleDateString('en-SG', { month: 'long', day: 'numeric', year: 'numeric' })
    };
}

function getBirthdayVoucherSourceReference(year) {
    return `birthday-${Number(year)}`;
}

function isBirthdayMonthForDate(birthday, value) {
    return getBirthdayPromotionContext(birthday, value).isBirthdayMonth;
}

function buildBirthdayVoucherData(userId, birthday, now = new Date()) {
    const context = getBirthdayPromotionContext(birthday, now);

    if (!context.hasBirthday || !context.isBirthdayMonth) {
        return null;
    }

    return {
        userId,
        sourceType: 'birthday',
        sourceReference: getBirthdayVoucherSourceReference(context.rewardYear),
        title: '20% OFF Birthday Month Voucher',
        detail: `20% off eligible beauty and wellness service bookings. Valid until ${context.monthEndLabel}.`,
        bookingOnly: true,
        discountType: 'percentage',
        discountPercent: 20,
        expiresAt: context.monthEnd
    };
}

module.exports = {
    buildBirthdayVoucherData,
    formatDateKey,
    getBirthdayPromotionContext,
    getBirthdayVoucherSourceReference,
    isBirthdayMonthForDate
};
