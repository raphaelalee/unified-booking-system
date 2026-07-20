const { fromCents, toCents } = require('./refundCalculation');

const TIMEZONE = 'Asia/Singapore';

const POLICY = {
    productDeliveryReturnDays: 7,
    productPickupReturnDays: 7,
    completedServiceComplaintDays: 3,
    bookingCancellationCutoffHours: 24,
    evidenceDeadlineDays: 3,
    merchantResponseDays: 3
};

const REASONS = {
    cancellation: [
        { code: 'customer_cancellation', label: 'Customer-requested cancellation', responsibility: 'customer', evidenceRequired: false, returnRequired: false },
        { code: 'merchant_cancellation', label: 'Merchant asked me to cancel', responsibility: 'merchant', evidenceRequired: false, returnRequired: false },
        { code: 'incorrect_charge', label: 'Incorrect charge', responsibility: 'merchant', evidenceRequired: false, returnRequired: false },
        { code: 'duplicate_charge', label: 'Duplicate charge', responsibility: 'payment_error', evidenceRequired: false, returnRequired: false }
    ],
    return_refund: [
        { code: 'damaged_item', label: 'Product damaged on arrival', responsibility: 'merchant', evidenceRequired: true, returnRequired: true },
        { code: 'defective_item', label: 'Product defective or not working', responsibility: 'merchant', evidenceRequired: true, returnRequired: true },
        { code: 'wrong_item', label: 'Wrong product received', responsibility: 'merchant', evidenceRequired: true, returnRequired: true },
        { code: 'different_description', label: 'Product significantly different from description', responsibility: 'merchant', evidenceRequired: true, returnRequired: true },
        { code: 'expired_or_unsafe', label: 'Product expired or unsafe', responsibility: 'merchant', evidenceRequired: true, returnRequired: true },
        { code: 'change_of_mind_unopened', label: 'Eligible unopened return', responsibility: 'customer', evidenceRequired: false, returnRequired: true },
        { code: 'other', label: 'Other return reason requiring review', responsibility: 'merchant', evidenceRequired: false, returnRequired: true }
    ],
    refund_only: [
        { code: 'parcel_not_received', label: 'Order never arrived', responsibility: 'merchant', evidenceRequired: false, returnRequired: false },
        { code: 'missing_item', label: 'Missing item or quantity', responsibility: 'merchant', evidenceRequired: true, returnRequired: false },
        { code: 'service_not_provided', label: 'Service was not provided', responsibility: 'merchant', evidenceRequired: true, returnRequired: false },
        { code: 'service_quality', label: 'Service quality issue', responsibility: 'merchant', evidenceRequired: true, returnRequired: false },
        { code: 'platform_error', label: 'Platform or payment-system error', responsibility: 'platform', evidenceRequired: false, returnRequired: false },
        { code: 'goodwill_partial', label: 'Goodwill or partial compensation', responsibility: 'merchant', evidenceRequired: false, returnRequired: false },
        { code: 'other', label: 'Other merchant-reviewed reason', responsibility: 'merchant', evidenceRequired: false, returnRequired: false }
    ]
};

const PAYMENT_BLOCKED = new Set(['pending', 'processing', 'failed', 'cancelled', 'unpaid', 'payment_failed']);
const FULLY_REFUNDED = new Set(['refunded', 'fully_refunded']);

function addDays(date, days) {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
}

function parseDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
    const date = parseDate(value);
    if (!date) return null;
    return new Intl.DateTimeFormat('en-SG', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    }).format(date);
}

function getMoney(value) {
    return fromCents(Math.max(toCents(value), 0));
}

function reasonSet(type) {
    return REASONS[type] || [];
}

function success(base) {
    const reasons = reasonSet(base.actionType);
    return {
        eligible: true,
        blockedReason: null,
        eligibleReasons: reasons,
        evidenceRequired: reasons.some((reason) => reason.evidenceRequired),
        returnRequired: reasons.some((reason) => reason.returnRequired),
        policy,
        ...base
    };
}

function blocked(base, blockedReason, statusCode) {
    return {
        eligible: false,
        actionType: base.actionType || 'contact_support',
        eligibleReasons: [],
        blockedReason,
        refundableAmount: getMoney(base.refundableAmount),
        remainingRefundableAmount: getMoney(base.remainingRefundableAmount || base.refundableAmount),
        returnRequired: false,
        evidenceRequired: false,
        deadline: base.deadline || null,
        deadlineLabel: formatDate(base.deadline),
        statusCode,
        policy
    };
}

function getOrderStatus(order = {}) {
    const fulfilmentType = getFulfilmentType(order);
    if (fulfilmentType === 'pickup') {
        return String(order.pickupStatus || order.pickup_status || order.deliveryStatus || order.orderStatus || '').trim().toLowerCase();
    }
    return String(order.deliveryStatus || order.delivery_status || order.orderStatus || order.status || '').trim().toLowerCase();
}

function getFulfilmentType(order = {}) {
    const type = String(order.fulfilmentType || order.fulfilment_type || order.fulfilment || '').trim().toLowerCase();
    if (type === 'delivery') return 'delivery';
    if (type === 'pickup') return 'pickup';
    const status = String(order.deliveryStatus || order.delivery_status || order.orderStatus || order.status || order.pickupStatus || order.pickup_status || '').trim().toLowerCase();
    if ([
        'ready_for_delivery',
        'delivery_arranged',
        'shipped',
        'out_for_delivery',
        'in_delivery',
        'delivery_failed',
        'returned_to_merchant',
        'delivered'
    ].includes(status)) {
        return 'delivery';
    }
    return 'pickup';
}

function evaluateOrder(order = {}, { activeRequest = false } = {}) {
    const paymentStatus = String(order.paymentStatus || '').toLowerCase();
    const refundStatus = String(order.refundStatus || '').toLowerCase();
    const status = getOrderStatus(order);
    const fulfilmentType = getFulfilmentType(order);
    const paidAmount = getMoney(order.paidAmount || order.totalAmount);
    const refundedAmount = getMoney(order.refundedAmount || 0);
    const remainingRefundableAmount = getMoney(order.remainingRefundableAmount != null ? order.remainingRefundableAmount : paidAmount - refundedAmount);
    const base = {
        subjectType: 'order',
        fulfilmentType,
        currentStatus: status || 'processing',
        refundableAmount: remainingRefundableAmount,
        remainingRefundableAmount,
        previousRefundedAmount: refundedAmount,
        deadline: null,
        statusCode: ''
    };

    if (PAYMENT_BLOCKED.has(paymentStatus) || paidAmount <= 0) {
        return blocked(base, 'There is no captured payment to refund for this order.', 'NO_CAPTURED_PAYMENT');
    }
    if (FULLY_REFUNDED.has(refundStatus) || remainingRefundableAmount <= 0) {
        return blocked(base, 'This order has already been fully refunded.', 'FULLY_REFUNDED');
    }
    if (activeRequest) {
        return blocked(base, 'This order already has an active refund request.', 'ACTIVE_REQUEST_EXISTS');
    }
    if (status === 'cancelled') {
        return blocked(base, 'This order is already cancelled.', 'ORDER_CANCELLED');
    }

    if (fulfilmentType === 'delivery') {
        if (['pending', 'paid', 'processing'].includes(status) || !status) {
            return success({ ...base, actionType: 'cancellation', statusCode: 'ELIGIBLE_DELIVERY_CANCELLATION', returnRequired: false });
        }
        if (['packed', 'ready_for_delivery', 'delivery_arranged'].includes(status)) {
            return blocked(base, 'This order can no longer be cancelled because delivery has already been arranged.', 'DELIVERY_ARRANGED');
        }
        if (['shipped', 'out_for_delivery', 'in_delivery'].includes(status)) {
            return blocked(base, 'Your order is currently in delivery. Please wait for the delivery outcome before requesting a return or refund.', 'DELIVERY_IN_PROGRESS');
        }
        if (['delivery_failed', 'returned_to_merchant'].includes(status)) {
            return success({ ...base, actionType: 'refund_only', statusCode: 'ELIGIBLE_DELIVERY_FAILED', returnRequired: false });
        }
        if (['delivered', 'completed'].includes(status)) {
            const deliveredAt = parseDate(order.deliveredAt || order.delivered_at);
            if (!deliveredAt) {
                return blocked(base, 'This delivered order is missing its delivery timestamp and needs manual review before the return window can be checked.', 'DELIVERED_AT_REQUIRED');
            }
            const deadline = addDays(deliveredAt, POLICY.productDeliveryReturnDays);
            if (Date.now() > deadline.getTime()) {
                return blocked({ ...base, deadline }, `The return window for this order ended on ${formatDate(deadline)}.`, 'RETURN_WINDOW_EXPIRED');
            }
            return success({ ...base, actionType: 'return_refund', deadline, deadlineLabel: formatDate(deadline), statusCode: 'ELIGIBLE_DELIVERED_PRODUCT', returnRequired: true });
        }
    }

    if (['pending_pickup', 'processing', 'paid'].includes(status) || !status) {
        return success({ ...base, actionType: 'cancellation', statusCode: 'ELIGIBLE_PICKUP_CANCELLATION', returnRequired: false });
    }
    if (['ready_for_pickup', 'delivered_to_pickup_location'].includes(status)) {
        return success({
            ...base,
            actionType: 'cancellation',
            statusCode: 'PICKUP_READY_MERCHANT_REVIEW',
            warning: 'The order is ready for pickup, so cancellation is no longer guaranteed.'
        });
    }
    if (['picked_up', 'collected', 'completed'].includes(status) || order.pickupQrUsed) {
        const collectedAt = parseDate(order.pickupVerifiedAt || order.pickup_verified_at || order.collectedAt || order.collected_at);
        if (!collectedAt) {
            return blocked(base, 'This pickup order is missing its collection timestamp and needs manual review before the return window can be checked.', 'PICKUP_VERIFIED_AT_REQUIRED');
        }
        const deadline = addDays(collectedAt, POLICY.productPickupReturnDays);
        if (Date.now() > deadline.getTime()) {
            return blocked({ ...base, deadline }, `The return window for this pickup order ended on ${formatDate(deadline)}.`, 'PICKUP_RETURN_WINDOW_EXPIRED');
        }
        return success({ ...base, actionType: 'return_refund', deadline, deadlineLabel: formatDate(deadline), statusCode: 'ELIGIBLE_COLLECTED_PRODUCT', returnRequired: true });
    }

    return success({ ...base, actionType: 'refund_only', statusCode: 'ELIGIBLE_MERCHANT_REVIEW' });
}

function evaluateBooking(booking = {}, { activeRequest = false } = {}) {
    const status = String(booking.status || '').toLowerCase();
    const refundStatus = String(booking.refund_status || booking.refundStatus || '').toLowerCase();
    const paidAmount = getMoney(booking.paid_amount || booking.service_price || booking.price);
    const refundedAmount = getMoney(booking.refunded_amount || booking.refundedAmount || 0);
    const remainingRefundableAmount = getMoney(booking.remainingRefundableAmount != null ? booking.remainingRefundableAmount : paidAmount - refundedAmount);
    const bookingDate = parseBookingDateTime(booking);
    const cutoff = bookingDate ? new Date(bookingDate.getTime() - (POLICY.bookingCancellationCutoffHours * 60 * 60 * 1000)) : null;
    const base = {
        subjectType: 'booking',
        fulfilmentType: 'service_booking',
        currentStatus: status || 'pending',
        refundableAmount: remainingRefundableAmount,
        remainingRefundableAmount,
        previousRefundedAmount: refundedAmount,
        deadline: cutoff,
        deadlineLabel: formatDate(cutoff)
    };

    if (activeRequest) {
        return blocked(base, 'This booking already has an active refund request.', 'ACTIVE_REQUEST_EXISTS');
    }
    if (FULLY_REFUNDED.has(refundStatus) || remainingRefundableAmount <= 0) {
        return blocked(base, 'This booking has already been fully refunded.', 'FULLY_REFUNDED');
    }
    if (status === 'cancelled') {
        return blocked(base, 'This booking is already cancelled.', 'BOOKING_CANCELLED');
    }
    if (['pending', 'confirmed', 'paid'].includes(status)) {
        if (cutoff && Date.now() > cutoff.getTime()) {
            return success({
                ...base,
                actionType: 'refund_only',
                statusCode: 'BOOKING_AFTER_CUTOFF_REVIEW',
                warning: 'This booking is past the standard cancellation cutoff, so a deduction may apply.'
            });
        }
        return success({ ...base, actionType: 'cancellation', statusCode: 'ELIGIBLE_BOOKING_CANCELLATION', returnRequired: false });
    }
    if (['checked_in', 'in_progress'].includes(status)) {
        return blocked(base, 'This booking has already started and is no longer eligible for ordinary cancellation.', 'SERVICE_IN_PROGRESS');
    }
    if (['completed', 'no_show'].includes(status)) {
        const completedDate = parseDate(booking.completed_at || booking.booking_date || booking.bookingDate) || new Date();
        const deadline = addDays(completedDate, POLICY.completedServiceComplaintDays);
        if (Date.now() > deadline.getTime()) {
            return blocked({ ...base, deadline }, `The service complaint window ended on ${formatDate(deadline)}.`, 'SERVICE_COMPLAINT_WINDOW_EXPIRED');
        }
        return success({ ...base, actionType: 'refund_only', deadline, deadlineLabel: formatDate(deadline), statusCode: 'ELIGIBLE_SERVICE_COMPLAINT' });
    }

    return success({ ...base, actionType: 'refund_only', statusCode: 'ELIGIBLE_BOOKING_REVIEW' });
}

function parseBookingDateTime(booking = {}) {
    const rawDate = booking.booking_date || booking.bookingDate;
    const rawTime = booking.booking_time || booking.bookingTime || booking.timeslot || booking.start_time || booking.startTime;
    if (!rawDate) return null;
    if (!rawTime) return parseDate(rawDate);

    const datePart = rawDate instanceof Date
        ? new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(rawDate)
        : String(rawDate).slice(0, 10);
    const timePart = String(rawTime).match(/\d{1,2}:\d{2}/)?.[0];
    if (!timePart) return parseDate(rawDate);

    return parseDate(`${datePart}T${timePart}:00+08:00`);
}

function validateReason(eligibility, reasonCode) {
    const normalized = String(reasonCode || '').trim();
    const reason = (eligibility.eligibleReasons || []).find((candidate) => candidate.code === normalized);
    if (!reason) {
        return {
            valid: false,
            reason: null,
            message: 'The selected reason is not valid for the current order or booking status.'
        };
    }
    return { valid: true, reason, message: '' };
}

const policy = { ...POLICY, timezone: TIMEZONE };

module.exports = {
    POLICY: policy,
    REASONS,
    evaluateBooking,
    evaluateOrder,
    formatDate,
    getFulfilmentType,
    getOrderStatus,
    validateReason
};
