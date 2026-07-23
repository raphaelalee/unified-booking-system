const { promisify } = require('util');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const PurchaseHistory = require('../models/PurchaseHistory');
const PaymentRefund = require('../models/PaymentRefund');
const SupportRequest = require('../models/SupportRequest');
const Transaction = require('../models/Transaction');
const Loyalty = require('../models/Loyalty');
const {
    sendCancellationForBooking,
    sendRescheduleForBooking
} = require('../services/whatsappAutomation');
const { sendSupportNotificationEmail } = require('../utils/emailNotifications');
const { sendWhatsAppText } = require('../utils/whatsappNotifications');
const {
    sendSmsCancellationForBooking,
    sendSmsRescheduleForBooking
} = require('../services/smsAutomation');
const { refundTransaction } = require('../services/refundProcessor');
const {
    REFUND_ADMINISTRATION_FEE_AMOUNT,
    REFUND_TERMS_VERSION,
    calculateRefund,
    normalizeReasonCategory
} = require('../services/refundCalculation');
const {
    evaluateBooking,
    evaluateOrder,
    validateReason: validateEligibilityReason
} = require('../services/refundEligibility');
const { previewRefundRewardEffects } = require('../services/refundRewardAdjustments');

const ACTIVE_REQUEST_LIMIT = 5;
const SHIPPED_STATUSES = ['shipped', 'out_for_delivery', 'in_delivery'];
const ORDER_STATUSES = ['processing', 'packed', 'shipped', 'delivered', 'cancelled'];
const REFUND_REQUEST_TYPES = ['order_refund', 'booking_refund'];
const RESOLVED_REQUEST_STATUSES = ['partially_refunded', 'refunded', 'rejected', 'cancelled', 'closed'];
const MERCHANT_PARTIAL_REFUND_PERCENTAGES = new Set([25, 50, 75]);

const requestLabels = {
    order_refund: 'Order refund',
    booking_refund: 'Booking refund'
};

const statusLabels = {
    pending_merchant_review: 'Pending merchant review',
    under_review: 'Under review',
    more_information_required: 'More information required',
    approved: 'Approved',
    refund_processing: 'Refund processing',
    return_required: 'Return required',
    partially_refunded: 'Partially refunded',
    refunded: 'Refunded',
    rejected: 'Rejected',
    refund_failed: 'Refund failed',
    refund_reconciliation_required: 'Refund reconciliation required',
    cancelled: 'Cancelled',
    closed: 'Closed'
};

const getCustomerRequests = promisify(SupportRequest.getForCustomer);
const getMerchantRequests = promisify(SupportRequest.getForMerchant);
const getAdminRequests = promisify(SupportRequest.getForAdmin);
const getCustomerBookings = promisify(Booking.getSupportBookingsByUserId);
const findBookingForCustomer = promisify(Booking.findSupportBookingForCustomer);
const getBookingNotificationDetails = promisify(Booking.getNotificationDetailsById);
const getAvailableSlots = promisify(Booking.getAvailableSlots);
const markBookingCancelled = promisify(Booking.markCancelled);
const markBookingRefundStatus = promisify(Booking.markRefundStatus);
const updateBookingSchedule = promisify(Booking.updateSchedule);
const getCustomerOrders = promisify(Transaction.getCustomerOrders);
const getOrderForCustomer = promisify(Transaction.getOrderForCustomer);
const getOrderById = promisify(Transaction.getOrderById);
const getTransactionById = promisify(Transaction.getById);
const getCompletedRefundTotals = promisify(PaymentRefund.getCompletedTotalsForTransaction);
const getRefundsForTransaction = promisify(PaymentRefund.getForTransaction);
const getHistoryOrders = promisify(PurchaseHistory.getSupportOrdersByUserId);
const getHistoryOrderForCustomer = promisify(PurchaseHistory.getSupportOrderForCustomer);
const updateHistoryDeliveryStatus = promisify(PurchaseHistory.updateDeliveryStatus);
const recordHistoryRefund = promisify(PurchaseHistory.recordRefund);
const reverseCampaignCashback = promisify(Loyalty.reverseCampaignCashbackForReceipt);
const getMerchantOrders = promisify(Transaction.getMerchantOrderReport);
const updateDeliveryStatus = promisify(Transaction.updateDeliveryStatus);
const createSupportRequest = promisify(SupportRequest.create);
const findSupportRequest = promisify(SupportRequest.findById);
const hasActiveRequest = promisify(SupportRequest.hasActiveRequest);
const countOpenByCustomer = promisify(SupportRequest.countOpenByCustomer);
const markMerchantApproved = promisify(SupportRequest.markMerchantApproved);
const markMoreInformationRequired = promisify(SupportRequest.markMoreInformationRequired);
const markMoreInformationSubmitted = promisify(SupportRequest.markMoreInformationSubmitted);
const markReturnRequired = promisify(SupportRequest.markReturnRequired);
const markReturnSubmitted = promisify(SupportRequest.markReturnSubmitted);
const markRefundSucceeded = promisify(SupportRequest.markRefundSucceeded);
const markRefundFailed = promisify(SupportRequest.markRefundFailed);
const markRefundReconciliationRequired = promisify(SupportRequest.markRefundReconciliationRequired);
const merchantRejectRequest = promisify(SupportRequest.merchantReject);
const createSupportMessage = promisify(SupportRequest.createMessage);
const getSupportMessagesForRequests = promisify(SupportRequest.getMessagesForRequests);

function getFlash(req) {
    const flash = req.session.helpCenterFlash || null;
    req.session.helpCenterFlash = null;
    return flash;
}

function setFlash(req, type, message) {
    req.session.helpCenterFlash = { type, message };
}

function cleanText(value, maxLength = 1200) {
    return String(value || '').trim().slice(0, maxLength);
}

function wantsJson(req) {
    return req.xhr
        || (req.get('accept') || '').includes('application/json')
        || String(req.body.responseType || '').toLowerCase() === 'json';
}

function sendSupportResponse(req, res, payload) {
    if (wantsJson(req)) {
        return res.status(payload.success ? 200 : 400).json(payload);
    }

    setFlash(req, payload.success ? 'success' : 'error', payload.message);
    return res.redirect('/help-center');
}

function parseOrderTransactionId(value) {
    const match = String(value || '').trim().match(/^(\d+)$/);
    return match ? Number(match[1]) : null;
}

function formatOrderDisplayReference(source = {}) {
    const directReference = source.order_number || source.orderNumber;

    if (directReference) {
        return directReference;
    }

    const rawReference = source.receiptId || source.targetId || source.id || source;
    const transactionId = parseOrderTransactionId(rawReference);

    return transactionId ? `#${transactionId}` : String(rawReference || '');
}

function mergeCustomerOrders(transactionOrders = [], historyOrders = []) {
    const seenReceipts = new Set();
    const normalizedTransactionOrders = transactionOrders.map((order) => ({
        ...order,
        source: 'transaction',
        targetId: String(order.id)
    }));
    const merged = [];

    [...normalizedTransactionOrders, ...historyOrders].forEach((order) => {
        const key = String(order.receiptId || order.id);

        if (seenReceipts.has(key)) {
            return;
        }

        seenReceipts.add(key);
        merged.push(order);
    });

    return merged.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function getDayDifferenceFromToday(value) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const appointmentDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return Math.round((appointmentDay.getTime() - today.getTime()) / 86400000);
}

function calculateLateFee(amount) {
    const base = Number(amount || 0);
    if (base <= 0) {
        return 0;
    }

    return Math.round(Math.max(8, base * 0.2) * 100) / 100;
}

function getApprovedRefundAmount(request) {
    return Math.max(0, Math.round(Number(request.netRefundAmount || request.approvedRefundAmount || 0) * 100) / 100);
}

function parseRefundPercentage(value, { allowFull = true } = {}) {
    const text = String(value == null || value === '' ? '100' : value).trim();
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) {
        throw new Error('Refund percentage must be a number with up to two decimal places.');
    }
    const percentage = Number(text);
    if (!Number.isFinite(percentage) || percentage <= 0) {
        throw new Error('Refund percentage must be greater than 0.');
    }
    if (percentage > 100 || (!allowFull && percentage >= 100)) {
        throw new Error(allowFull ? 'Refund percentage cannot exceed 100.' : 'Partial refund percentage must be less than 100.');
    }
    return Math.round(percentage * 100) / 100;
}

function parseMerchantPartialRefundPercentage(value) {
    const percentage = parseRefundPercentage(value, { allowFull: false });
    if (!MERCHANT_PARTIAL_REFUND_PERCENTAGES.has(percentage)) {
        throw new Error('Please select a valid partial refund percentage: 25%, 50% or 75%.');
    }
    return percentage;
}

function normalizeMerchantRefundDecision(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['approved', 'full_refund', 'full'].includes(normalized)) return 'full_refund';
    if (['partial_refund', 'partial'].includes(normalized)) return 'partial_refund';
    if (['return_required', 'require_return', 'return'].includes(normalized)) return 'return_required';
    if (['request_more_information', 'more_information_required', 'more_information', 'info_required'].includes(normalized)) return 'request_more_information';
    if (['rejected', 'reject'].includes(normalized)) return 'rejected';
    return '';
}

function mapEligibilityReasonToRefundCategory(reason = {}) {
    if (reason.responsibility === 'customer') return 'customer_cancellation';
    if (reason.responsibility === 'platform') return 'platform_error';
    if (reason.responsibility === 'payment_error') return 'duplicate_charge';
    if (['duplicate_charge', 'incorrect_charge', 'merchant_cancellation', 'platform_error'].includes(reason.code)) {
        return reason.code;
    }
    return 'other';
}

function getSubmittedIssueCode(body = {}) {
    return cleanText(body.issueType || body.reasonCategory || body.reason, 80) || 'other';
}

function getUploadedSupportEvidence(req) {
    if (req.files && typeof req.files === 'object') {
        return Object.values(req.files).flat().filter(Boolean);
    }
    return req.file ? [req.file] : [];
}

function formatRewardEffectSummary(outcome = {}) {
    const parts = [];
    if (Number(outcome.externalRefundAmount || outcome.amount || 0) > 0) {
        parts.push(`S$${Number(outcome.externalRefundAmount || outcome.amount || 0).toFixed(2)} returned to the original payment method`);
    }
    if (Number(outcome.walletRestoredAmount || 0) > 0) {
        parts.push(`S$${Number(outcome.walletRestoredAmount || 0).toFixed(2)} wallet balance restored`);
    }
    if (Number(outcome.pointsRestored || 0) > 0) {
        parts.push(`${Number(outcome.pointsRestored || 0)} payment points restored`);
    }
    if (Number(outcome.pointsReversed || 0) > 0) {
        parts.push(`${Number(outcome.pointsReversed || 0)} earned points reversed`);
    }
    if (Number(outcome.cashbackRestoredAmount || 0) > 0) {
        parts.push(`S$${Number(outcome.cashbackRestoredAmount || 0).toFixed(2)} payment cashback restored`);
    }
    if (Number(outcome.cashbackReversedAmount || 0) > 0) {
        parts.push(`S$${Number(outcome.cashbackReversedAmount || 0).toFixed(2)} earned cashback reversed`);
    }
    return parts.length ? parts.join(', ') : `S$${Number(outcome.amount || 0).toFixed(2)} returned to the customer`;
}

function mapRefundRows(rows = []) {
    return rows.map((row) => ({
        refundReference: row.refund_reference || (row.refund_id ? `RF-${row.refund_id}` : ''),
        approvedRefundPercentage: Number(row.approved_refund_percentage || 100),
        grossRefundAmount: Number(row.gross_refund_amount || row.refund_amount || 0),
        netRefundAmount: Number(row.net_refund_amount || row.refund_amount || 0),
        refundStatus: row.refund_status || '',
        providerRefundId: row.provider_refund_id || '',
        createdAt: row.created_at,
        completedAt: row.completed_at || row.updated_at
    }));
}

function isRefundRequest(requestType) {
    return REFUND_REQUEST_TYPES.includes(requestType);
}

async function calculateTransactionRefundPreview(transactionId, {
    requestedGrossRefund,
    approvedPercentage = 100,
    reasonCategory,
    acknowledgementAccepted,
    lateFeeAmount = 0
} = {}) {
    const transaction = await getTransactionById(transactionId);

    if (!transaction) {
        throw new Error('The original payment transaction could not be found.');
    }

    if (!['paid', 'partially_refunded'].includes(String(transaction.paymentStatus || '').toLowerCase())) {
        throw new Error('Only paid transactions can be refunded.');
    }

    const totals = await getCompletedRefundTotals(transaction.transactionId);
    return calculateRefund({
        transaction,
        requestedGrossRefund,
        previousGrossRefunds: totals.grossRefundedTotal || transaction.refundedAmount || 0,
        previousFeeDeductions: totals.feeDeductionTotal || 0,
        approvedPercentage,
        reasonCategory,
        acknowledgementAccepted,
        lateFeeAmount
    });
}

function normalizeRequestDate(value) {
    const date = value instanceof Date ? value : new Date(`${String(value || '').slice(0, 10)}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toISOString().slice(0, 10);
}

function normalizeRequestTime(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);

    if (!match) {
        return '';
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return '';
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseRequestedBookingSlot(value) {
    const text = String(value || '');
    const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);

    return {
        bookingDate: dateMatch ? normalizeRequestDate(dateMatch[1]) : '',
        bookingTime: timeMatch ? normalizeRequestTime(`${timeMatch[1]}:${timeMatch[2]}`) : ''
    };
}

async function applyApprovedBookingChange(request) {
    const nextSlot = parseRequestedBookingSlot(request.requestedChange);

    if (!nextSlot.bookingDate || !nextSlot.bookingTime) {
        throw new Error('Approved booking changes must include a new date and time in YYYY-MM-DD HH:mm format.');
    }

    const booking = await getBookingNotificationDetails(request.targetId);

    if (!booking) {
        throw new Error('The booking could not be found.');
    }

    const currentDate = normalizeRequestDate(booking.booking_date);
    const currentTime = normalizeRequestTime(booking.booking_time);
    const isSameSlot = currentDate === nextSlot.bookingDate && currentTime === nextSlot.bookingTime;

    if (!isSameSlot) {
        const availableSlots = await getAvailableSlots(
            booking.salon_id,
            booking.service_id,
            nextSlot.bookingDate,
            {
                excludeBookingId: request.targetId,
                durationMins: booking.duration_mins
            }
        );

        if (!availableSlots.includes(nextSlot.bookingTime)) {
            throw new Error('The requested new slot is unavailable. Please ask the customer to choose another time.');
        }
    }

    const result = await updateBookingSchedule(request.targetId, nextSlot.bookingDate, nextSlot.bookingTime);

    if (!result.affectedRows) {
        throw new Error('The booking could not be rescheduled.');
    }

    await sendRescheduleForBooking(request.targetId).catch((error) => {
        console.error('WhatsApp reschedule notification failed:', error.message);
    });
    await sendSmsRescheduleForBooking(request.targetId).catch((error) => {
        console.error('SMS reschedule notification failed:', error.message);
    });
}

function notifyUser(user, notification) {
    if (!user?.id) {
        return;
    }

    Notification.create({
        recipientUserId: user.id,
        recipientRole: user.role || 'customer',
        ...notification
    }, (error) => {
        if (error) {
            console.error(error);
        }
    });
}

function notifyCustomer(userId, notification) {
    if (!userId) {
        return;
    }

    Notification.create({
        recipientUserId: userId,
        recipientRole: 'customer',
        ...notification
    }, (error) => {
        if (error) {
            console.error(error);
        }
    });
}

function notifyMerchant(merchantUserId, notification) {
    if (!merchantUserId) {
        return;
    }

    Notification.create({
        recipientUserId: merchantUserId,
        recipientRole: 'merchant',
        ...notification
    }, (error) => {
        if (error) {
            console.error(error);
        }
    });
}

function notifyAdmins(notification) {
    Notification.createForRole('admin', notification, (error) => {
        if (error) {
            console.error(error);
        }
    });
}

function absoluteHelpCenterUrl() {
    return process.env.APP_BASE_URL
        ? `${String(process.env.APP_BASE_URL).replace(/\/$/, '')}/help-center`
        : '/help-center';
}

function notifyCustomerMoreInformationChannels(request, message) {
    const title = `More information needed for refund request #${request.id}`;
    const linkUrl = '/help-center';

    notifyCustomer(request.customerUserId, {
        type: 'support_request',
        title,
        message,
        linkUrl,
        dedupeKey: `refund:${request.id}:more-information-required:v1`
    });

    sendSupportNotificationEmail({
        email: request.customerEmail,
        customerName: request.customerName,
        subject: title,
        message,
        linkUrl: absoluteHelpCenterUrl()
    }).catch((error) => {
        console.error('Support email notification failed:', error.message || error);
    });

    sendWhatsAppText(request.customerPhone, [
        `Vaniday update: ${title}`,
        message,
        'Open Profile or Refund History, then reply on the same Help Center ticket. No new request is needed.'
    ].join('\n')).catch((error) => {
        console.error('Support WhatsApp notification failed:', error.message || error);
    });
}

function getRoleCopy(role) {
    if (role === 'admin') {
        return {
            eyebrow: 'Vaniday admin support',
            heading: 'Refund monitoring',
            description: 'Monitor merchant refund decisions, failed refunds, disputes, and audit history across the platform.'
        };
    }

    if (role === 'merchant') {
        return {
            eyebrow: 'Merchant support',
            heading: 'Merchant refund review',
            description: 'Review refund requests sent directly to your business, then approve or reject with a clear decision.'
        };
    }

    return {
        eyebrow: 'Customer Help Center',
        heading: 'Refund requests',
        description: 'Submit refund requests for paid orders or bookings. Your request goes directly to the merchant linked to the purchase.'
    };
}

async function processMerchantApprovedRefund(request, merchantUserId, merchantNote, approval = {}) {
    const requestedRefundAmount = Number(request.refundAmount || request.grossRefundAmount || getApprovedRefundAmount(request) || 0);
    const approvedRefundAmount = Number(approval.grossRefundAmount || request.grossRefundAmount || request.refundAmount || getApprovedRefundAmount(request) || 0);

    if (requestedRefundAmount <= 0 || approvedRefundAmount <= 0) {
        throw new Error('Approved refund amount must be greater than zero.');
    }

    let refundOutcome = null;

    if (request.requestType === 'order_refund') {
        const transactionId = parseOrderTransactionId(request.targetId || request.paymentTransactionId);
        let order = transactionId ? await getOrderById(transactionId) : null;

        if (!order) {
            order = await getHistoryOrderForCustomer(
                request.customerUserId,
                request.receiptId || request.targetId
            );
        }

        if (!order) {
            throw new Error('The order could not be found.');
        }

        if (transactionId && !order.merchantUserIds.includes(Number(merchantUserId))) {
            throw new Error('This order does not belong to your merchant account.');
        }

        if (SHIPPED_STATUSES.includes(order.deliveryStatus)) {
            throw new Error('This order has already shipped and cannot be refunded through this workflow.');
        }

        if (order.refundStatus === 'refunded' || Number(order.refundedAmount || 0) >= Number(order.totalAmount || 0)) {
            throw new Error('This order has already been refunded.');
        }

        if (transactionId) {
            refundOutcome = await refundTransaction(transactionId, {
                amount: requestedRefundAmount,
                reason: merchantNote || request.reason || request.customerNote || 'Merchant approved order refund',
                reasonCategory: request.refundReasonCategory || request.reason,
                approvedPercentage: approval.approvedRefundPercentage || request.approvedRefundPercentage || 100,
                refundRequestId: request.id,
                merchantDecision: approval.approvedRefundPercentage >= 100 ? 'full_refund' : 'partial_refund',
                merchantDecisionReason: approval.customerFacingReason || merchantNote || '',
                acknowledgementAccepted: Boolean(request.feeAcknowledgedAt || request.feeDeductionApplies),
                feeAcknowledgedAt: request.feeAcknowledgedAt,
                feeAcknowledgementVersion: request.feeAcknowledgementVersion,
                lateFeeAmount: request.lateFeeAmount || 0,
                refundedBy: merchantUserId,
                merchantId: merchantUserId,
                orderId: transactionId
            });

            if (refundOutcome.refundStatus === 'refunded') {
                await updateDeliveryStatus(transactionId, 'cancelled', { merchantUserId });
            }

            if (request.receiptId) {
                await updateHistoryDeliveryStatus(request.receiptId, 'cancelled');
                if (!refundOutcome.manualRequired) {
                    await recordHistoryRefund(request.receiptId, refundOutcome.netRefundAmount || refundOutcome.amount);
                }
                await reverseCampaignCashback(request.receiptId);
            }
        } else {
            await updateHistoryDeliveryStatus(request.receiptId || request.targetId, 'cancelled');
            refundOutcome = {
                amount: approvedRefundAmount,
                refundStatus: 'manual_required',
                provider: 'manual',
                providerRefundId: '',
                manualRequired: true
            };
        }

        return refundOutcome;
    }

    if (request.targetType === 'booking') {
        const booking = await findBookingForCustomer(request.targetId, request.customerUserId);

        if (!booking) {
            throw new Error('The booking could not be found.');
        }

        if (String(booking.merchant_user_id) !== String(merchantUserId)) {
            throw new Error('This booking does not belong to your merchant account.');
        }

        if (booking.status === 'cancelled') {
            throw new Error('This booking is already cancelled.');
        }

        if (booking.transaction_id) {
            refundOutcome = await refundTransaction(booking.transaction_id, {
                amount: requestedRefundAmount,
                reason: merchantNote || request.reason || request.customerNote || 'Merchant approved booking refund',
                reasonCategory: request.refundReasonCategory || request.reason,
                approvedPercentage: approval.approvedRefundPercentage || request.approvedRefundPercentage || 100,
                refundRequestId: request.id,
                merchantDecision: approval.approvedRefundPercentage >= 100 ? 'full_refund' : 'partial_refund',
                merchantDecisionReason: approval.customerFacingReason || merchantNote || '',
                acknowledgementAccepted: Boolean(request.feeAcknowledgedAt || request.feeDeductionApplies),
                feeAcknowledgedAt: request.feeAcknowledgedAt,
                feeAcknowledgementVersion: request.feeAcknowledgementVersion,
                lateFeeAmount: request.lateFeeAmount || 0,
                refundedBy: merchantUserId,
                merchantId: merchantUserId,
                bookingId: request.targetId
            });
        } else {
            refundOutcome = {
                amount: approvedRefundAmount,
                refundStatus: 'manual_required',
                provider: 'manual',
                providerRefundId: '',
                manualRequired: true
            };
        }

        if (refundOutcome.refundStatus === 'refunded') {
            await markBookingCancelled(request.targetId);
        }
        await markBookingRefundStatus(request.targetId, refundOutcome.refundStatus);
        await reverseCampaignCashback(String(request.targetId));
        await sendCancellationForBooking(request.targetId, request.reason || request.customerNote || '').catch((error) => {
            console.error('WhatsApp cancellation notification failed:', error.message);
        });
        await sendSmsCancellationForBooking(request.targetId, request.reason || request.customerNote || '').catch((error) => {
            console.error('SMS cancellation notification failed:', error.message);
        });

        return refundOutcome;
    }

    throw new Error('This refund target type is not supported.');
}

async function attachMessages(requests = []) {
    const messageMap = await getSupportMessagesForRequests(requests.map((request) => request.id));

    return requests.map((request) => ({
        ...request,
        messages: messageMap[String(request.id)] || []
    }));
}

async function attachRefundHistory(requests = []) {
    const enriched = await Promise.all(requests.map(async (request) => {
        if (!request.paymentTransactionId) {
            return { ...request, previousRefunds: [] };
        }

        try {
            const rows = await getRefundsForTransaction(request.paymentTransactionId);
            return { ...request, previousRefunds: mapRefundRows(rows) };
        } catch (error) {
            console.error('Refund history load failed:', error.message);
            return { ...request, previousRefunds: [] };
        }
    }));

    return enriched;
}

function attachCustomerEligibility({ orders = [], bookings = [] } = {}) {
    return {
        orders: orders.map((order) => ({
            ...order,
            refundEligibility: evaluateOrder(order)
        })),
        bookings: bookings.map((booking) => ({
            ...booking,
            refundEligibility: evaluateBooking(booking)
        }))
    };
}

async function showHelpCenter(req, res) {
    try {
        const role = req.session.user.role;
        const viewModel = {
            title: 'Help Center',
            role,
            roleCopy: getRoleCopy(role),
            requestLabels,
            statusLabels,
            flash: getFlash(req),
            selectedTarget: {
                receiptId: req.query.receiptId || '',
                bookingId: req.query.bookingId || '',
                orderId: parseOrderTransactionId(req.query.orderId || req.query.receiptId) || ''
            },
            requests: [],
            bookings: [],
            orders: [],
            orderStatuses: ORDER_STATUSES,
            refundAdministrationFeeAmount: REFUND_ADMINISTRATION_FEE_AMOUNT
        };

        if (role === 'customer') {
            const [requests, bookings, transactionOrders, historyOrders] = await Promise.all([
                getCustomerRequests(req.session.user.id),
                getCustomerBookings(req.session.user.id),
                getCustomerOrders(req.session.user.id),
                getHistoryOrders(req.session.user.id)
            ]);

            const mergedOrders = mergeCustomerOrders(transactionOrders, historyOrders);
            const eligibleContext = attachCustomerEligibility({ orders: mergedOrders, bookings });

            return res.render('help-center', {
                ...viewModel,
                requests: await attachRefundHistory(await attachMessages(requests)),
                bookings: eligibleContext.bookings,
                orders: eligibleContext.orders
            });
        }

        if (role === 'merchant') {
            const [requests, orders] = await Promise.all([
                getMerchantRequests(req.session.user.id),
                getMerchantOrders(req.session.user.id)
            ]);

            return res.render('help-center', {
                ...viewModel,
                requests: await attachRefundHistory(await attachMessages(requests)),
                orders
            });
        }

        const requests = await getAdminRequests();

        return res.render('help-center', {
            ...viewModel,
            requests: await attachRefundHistory(await attachMessages(requests))
        });
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Help Center Error',
            message: 'The Help Center could not be loaded.'
        });
    }
}

function canReplyToRequest(req, request) {
    if (!request || !req.session.user) {
        return false;
    }

    if (req.session.user.role === 'admin') {
        return true;
    }

    if (req.session.user.role === 'merchant') {
        return String(request.merchantUserId) === String(req.session.user.id);
    }

    return String(request.customerUserId) === String(req.session.user.id);
}

async function replyToRequest(req, res) {
    try {
        const request = await findSupportRequest(req.params.requestId);

        if (!canReplyToRequest(req, request)) {
            throw new Error('You cannot reply to this support ticket.');
        }

        const messageBody = cleanText(req.body.messageBody, 1600);
        const evidenceFiles = getUploadedSupportEvidence(req);
        const screenshot = evidenceFiles[0] ? `/uploads/support/${evidenceFiles[0].filename}` : '';

        if (!messageBody && !evidenceFiles.length) {
            throw new Error('Add a message or screenshot before sending.');
        }

        const messageResult = await createSupportMessage({
            requestId: request.id,
            senderUserId: req.session.user.id,
            senderRole: req.session.user.role,
            messageBody,
            screenshotPath: screenshot
        });

        for (const file of evidenceFiles.slice(1)) {
            await createSupportMessage({
                requestId: request.id,
                senderUserId: req.session.user.id,
                senderRole: req.session.user.role,
                messageBody: 'Additional evidence attached.',
                screenshotPath: `/uploads/support/${file.filename}`
            });
        }

        const replyEventKey = `support:${request.id}:reply:${messageResult?.insertId || 'submitted'}`;
        const submittedMoreInformation = req.session.user.role === 'customer'
            && isRefundRequest(request.requestType)
            && request.status === 'more_information_required';
        const submittedReturnInformation = req.session.user.role === 'customer'
            && isRefundRequest(request.requestType)
            && request.status === 'return_required';

        if (submittedMoreInformation) {
            const statusResult = await markMoreInformationSubmitted(request.id, req.session.user.id);

            if (!statusResult.affectedRows) {
                throw new Error('This refund request changed before your update could be saved. Please reload and try again.');
            }

            await createSupportMessage({
                requestId: request.id,
                senderUserId: req.session.user.id,
                senderRole: 'system',
                messageBody: 'Additional customer information was submitted. Status returned to under review.',
                screenshotPath: ''
            });
        }

        if (submittedReturnInformation) {
            const statusResult = await markReturnSubmitted(request.id, req.session.user.id);

            if (!statusResult.affectedRows) {
                throw new Error('This return request changed before your update could be saved. Please reload and try again.');
            }

            await createSupportMessage({
                requestId: request.id,
                senderUserId: req.session.user.id,
                senderRole: 'system',
                messageBody: 'Customer submitted return tracking or drop-off information. Status returned to merchant review.',
                screenshotPath: ''
            });
        }

        if (req.session.user.role !== 'admin') {
            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: `New reply on ticket #${request.id}`,
                message: `${req.session.user.name || 'A user'} replied to ${requestLabels[request.requestType] || 'a support ticket'}.`,
                linkUrl: '/help-center',
                dedupeKey: `support-reply-admin-${replyEventKey}`
            });
        }

        if (req.session.user.role !== 'customer') {
            notifyCustomer(request.customerUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: `Support replied to ticket #${request.id}`,
                message: 'There is a new support reply waiting for you.',
                linkUrl: '/help-center',
                dedupeKey: `support-reply-customer-${replyEventKey}`
            });
        }

        if (request.merchantUserId && req.session.user.role !== 'merchant') {
            notifyMerchant(request.merchantUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: submittedMoreInformation || submittedReturnInformation ? 'New refund evidence submitted' : `New reply on ticket #${request.id}`,
                message: submittedMoreInformation
                    ? `${req.session.user.name || 'A customer'} added the requested information and evidence for ${requestLabels[request.requestType] || 'refund request'} #${request.id}. It is back under review.`
                    : submittedReturnInformation
                        ? `${req.session.user.name || 'A customer'} submitted return tracking or drop-off information for ${requestLabels[request.requestType] || 'refund request'} #${request.id}. It is back under review.`
                        : (req.session.user.role === 'customer'
                            ? `${req.session.user.name || 'A customer'} replied to ${requestLabels[request.requestType] || 'a support ticket'}.`
                            : `Vaniday admin replied to ${(requestLabels[request.requestType] || 'a support ticket').toLowerCase()} #${request.id}.`),
                linkUrl: '/help-center',
                dedupeKey: `support-reply-merchant-${replyEventKey}`
            });
        }

        return sendSupportResponse(req, res, {
            success: true,
            message: submittedMoreInformation
                ? `Additional information was added to ticket #${request.id}. The request is back under review.`
                : submittedReturnInformation
                    ? `Return information was added to ticket #${request.id}. The request is back under merchant review.`
                    : `Reply added to ticket #${request.id}.`,
            reply: {
                requestId: request.id,
                senderRole: req.session.user.role,
                senderName: req.session.user.name || req.session.user.role,
                messageBody,
                screenshotPath: screenshot,
                createdAt: new Date().toISOString()
            }
        });
    } catch (error) {
        return sendSupportResponse(req, res, {
            success: false,
            message: error.message || 'The reply could not be sent.'
        });
    }
}

async function buildOrderRequest(req, requestType, targetId, body) {
    if (requestType !== 'order_refund') {
        throw new Error('This order request type is not supported.');
    }

    const transactionId = parseOrderTransactionId(targetId);
    let order = null;

    if (transactionId) {
        order = await getOrderForCustomer(req.session.user.id, transactionId);
    }

    if (!order) {
        const receiptId = targetId;
        order = await getHistoryOrderForCustomer(req.session.user.id, receiptId);
    }

    if (!order) {
        throw new Error('This order could not be found on your account.');
    }

    if (!order.merchantUserIds[0]) {
        throw new Error('This order cannot be refunded through the Help Center because the merchant could not be verified.');
    }

    const eligibility = evaluateOrder(order);
    if (!eligibility.eligible) {
        throw new Error(eligibility.blockedReason || 'This order is not eligible for a standard refund request.');
    }

    const issueCode = getSubmittedIssueCode(body);
    const reasonValidation = validateEligibilityReason(eligibility, issueCode);
    if (!reasonValidation.valid) {
        throw new Error(reasonValidation.message);
    }
    const evidenceFiles = getUploadedSupportEvidence(req);
    if (reasonValidation.reason.evidenceRequired && evidenceFiles.length === 0) {
        throw new Error('Evidence is required for this refund reason.');
    }

    const reasonCategory = normalizeReasonCategory(mapEligibilityReasonToRefundCategory(reasonValidation.reason));
    const grossRefundAmount = Math.min(
        Number(body.requestedRefundAmount || eligibility.refundableAmount || order.totalAmount || 0),
        Number(eligibility.refundableAmount || order.totalAmount || 0)
    );
    const acknowledgementAccepted = body.processingFeeAcknowledged === 'on';
    const preliminary = transactionId
        ? await calculateTransactionRefundPreview(transactionId, {
            requestedGrossRefund: grossRefundAmount,
            reasonCategory,
            acknowledgementAccepted: false
        })
        : null;

    if (preliminary?.acknowledgementRequired && !acknowledgementAccepted) {
        throw new Error(`Please acknowledge that a fixed S$${REFUND_ADMINISTRATION_FEE_AMOUNT.toFixed(2)} Refund Administration Fee will be deducted from the approved refund amount.`);
    }

    const calculation = transactionId
        ? await calculateTransactionRefundPreview(transactionId, {
            requestedGrossRefund: grossRefundAmount,
            reasonCategory,
            acknowledgementAccepted
        })
        : {
            requestedGrossRefund: Number(order.totalAmount || 0),
            netCustomerRefund: Number(order.totalAmount || 0),
            processingFeeDeduction: 0,
            originalProcessingFee: 0,
            refundResponsibility: 'merchant',
            refundReasonCategory: reasonCategory,
            feeDeductionApplies: false
        };

    return {
        customerUserId: req.session.user.id,
        merchantUserId: order.merchantUserIds[0] || null,
        requestType,
        actionType: eligibility.actionType,
        eligibilityStatusCode: eligibility.statusCode,
        eligibilityDeadline: eligibility.deadline || null,
        returnRequired: eligibility.returnRequired || reasonValidation.reason.returnRequired,
        evidenceRequired: reasonValidation.reason.evidenceRequired,
        targetType: 'order',
        targetId: String(transactionId || order.transactionId || order.targetId || order.id),
        receiptId: order.receiptId,
        targetLabel: order.itemNames || 'Product order',
        paymentMethod: order.paymentMethod || order.paymentProvider || '',
        status: 'pending_merchant_review',
        reason: cleanText(issueCode, 160),
        customerNote: cleanText(body.customerNote),
        refundAmount: calculation.requestedGrossRefund,
        approvedRefundAmount: calculation.netCustomerRefund,
        grossRefundAmount: calculation.requestedGrossRefund,
        processingFeeDeduction: calculation.processingFeeDeduction,
        netRefundAmount: calculation.netCustomerRefund,
        originalProcessingFeeAmount: calculation.originalProcessingFee,
        processingFeeSource: preliminary?.processingFeeSource || '',
        refundReasonCategory: calculation.refundReasonCategory,
        refundResponsibility: calculation.refundResponsibility,
        feeDeductionApplies: calculation.feeDeductionApplies,
        feeAcknowledgedAt: calculation.feeDeductionApplies ? new Date() : null,
        feeAcknowledgementVersion: calculation.feeDeductionApplies ? REFUND_TERMS_VERSION : null,
        paymentTransactionId: transactionId || null,
        customerTermsAccepted: true,
        customerTermsVersion: REFUND_TERMS_VERSION,
        deliveryStatus: order.deliveryStatus
    };
}

async function buildBookingRequest(req, requestType, targetId, body) {
    const allowed = ['booking_refund'];

    if (!allowed.includes(requestType)) {
        throw new Error('This booking request type is not supported.');
    }

    const bookingId = Number(targetId);

    if (!bookingId) {
        throw new Error('Please choose a valid booking.');
    }

    const booking = await findBookingForCustomer(bookingId, req.session.user.id);

    if (!booking) {
        throw new Error('This booking could not be found on your account.');
    }

    const eligibility = evaluateBooking(booking);
    if (!eligibility.eligible) {
        throw new Error(eligibility.blockedReason || 'This booking is not eligible for a standard refund request.');
    }
    const issueCode = getSubmittedIssueCode(body);
    const reasonValidation = validateEligibilityReason(eligibility, issueCode);
    if (!reasonValidation.valid) {
        throw new Error(reasonValidation.message);
    }
    const evidenceFiles = getUploadedSupportEvidence(req);
    if (reasonValidation.reason.evidenceRequired && evidenceFiles.length === 0) {
        throw new Error('Evidence is required for this refund reason.');
    }
    const dayDifference = getDayDifferenceFromToday(booking.booking_date);
    const isLateCancellation = dayDifference !== null
        && dayDifference >= 0
        && dayDifference <= 1;
    const refundAmount = Number(eligibility.refundableAmount || booking.service_price || 0);
    const reasonCategory = normalizeReasonCategory(mapEligibilityReasonToRefundCategory(reasonValidation.reason));
    const acknowledgementAccepted = body.processingFeeAcknowledged === 'on';
    const preliminary = booking.transaction_id
        ? await calculateTransactionRefundPreview(booking.transaction_id, {
            requestedGrossRefund: refundAmount,
            reasonCategory,
            acknowledgementAccepted: false,
            lateFeeAmount: isLateCancellation ? calculateLateFee(refundAmount) : 0
        })
        : null;

    if (preliminary?.acknowledgementRequired && !acknowledgementAccepted) {
        throw new Error(`Please acknowledge that a fixed S$${REFUND_ADMINISTRATION_FEE_AMOUNT.toFixed(2)} Refund Administration Fee will be deducted from the approved refund amount.`);
    }

    const calculation = booking.transaction_id
        ? await calculateTransactionRefundPreview(booking.transaction_id, {
            requestedGrossRefund: refundAmount,
            reasonCategory,
            acknowledgementAccepted,
            lateFeeAmount: isLateCancellation ? calculateLateFee(refundAmount) : 0
        })
        : {
            requestedGrossRefund: refundAmount,
            netCustomerRefund: Math.max(0, refundAmount - (isLateCancellation ? calculateLateFee(refundAmount) : 0)),
            processingFeeDeduction: 0,
            originalProcessingFee: 0,
            refundResponsibility: 'merchant',
            refundReasonCategory: reasonCategory,
            feeDeductionApplies: false
        };

    return {
        customerUserId: req.session.user.id,
        merchantUserId: booking.merchant_user_id,
        requestType,
        actionType: eligibility.actionType,
        eligibilityStatusCode: eligibility.statusCode,
        eligibilityDeadline: eligibility.deadline || null,
        returnRequired: eligibility.returnRequired || reasonValidation.reason.returnRequired,
        evidenceRequired: reasonValidation.reason.evidenceRequired,
        targetType: 'booking',
        targetId: String(booking.id),
        receiptId: String(booking.id),
        targetLabel: booking.service_name || 'Booking service',
        paymentMethod: booking.transaction_id ? 'original payment transaction' : 'booking payment',
        status: 'pending_merchant_review',
        reason: cleanText(issueCode, 160),
        customerNote: cleanText(body.customerNote),
        requestedChange: null,
        refundAmount: calculation.requestedGrossRefund,
        approvedRefundAmount: calculation.netCustomerRefund,
        grossRefundAmount: calculation.requestedGrossRefund,
        processingFeeDeduction: calculation.processingFeeDeduction,
        netRefundAmount: calculation.netCustomerRefund,
        originalProcessingFeeAmount: calculation.originalProcessingFee,
        processingFeeSource: preliminary?.processingFeeSource || '',
        refundReasonCategory: calculation.refundReasonCategory,
        refundResponsibility: calculation.refundResponsibility,
        feeDeductionApplies: calculation.feeDeductionApplies,
        feeAcknowledgedAt: calculation.feeDeductionApplies ? new Date() : null,
        feeAcknowledgementVersion: calculation.feeDeductionApplies ? REFUND_TERMS_VERSION : null,
        paymentTransactionId: booking.transaction_id || null,
        lateFeeAmount: isLateCancellation ? calculateLateFee(refundAmount) : 0,
        isLateCancellation,
        customerTermsAccepted: true,
        customerTermsVersion: REFUND_TERMS_VERSION
    };
}

async function createRequest(req, res) {
    try {
        console.log('[refund:request:create:body]', {
            userId: req.session.user?.id,
            role: req.session.user?.role,
            body: req.body
        });

        const requestType = cleanText(req.body.requestType, 40);
        const targetType = cleanText(req.body.targetType, 20);
        const targetId = cleanText(req.body.targetId, 80);

        if (!isRefundRequest(requestType)) {
            throw new Error('Please choose a valid refund request type.');
        }

        if (!['order', 'booking'].includes(targetType)) {
            throw new Error('Please choose a valid order or booking.');
        }

        const note = cleanText(req.body.customerNote);
        if (note.length < 8) {
            throw new Error('Please add a short reason so the support team can review your request properly.');
        }

        const openCount = await countOpenByCustomer(req.session.user.id);
        if (openCount >= ACTIVE_REQUEST_LIMIT) {
            throw new Error(`You already have ${ACTIVE_REQUEST_LIMIT} open support requests. Please wait for one to be resolved first.`);
        }

        const duplicateTargetId = targetType === 'order'
            ? String(parseOrderTransactionId(targetId) || targetId)
            : String(Number(targetId) || targetId);
        const duplicateExists = await hasActiveRequest(req.session.user.id, targetType, duplicateTargetId, []);
        if (duplicateExists) {
            throw new Error('There is already an open support request for this order or booking.');
        }

        if (req.body.acceptRefundTerms !== 'on') {
            throw new Error('Please accept the refund terms before submitting your request.');
        }

        const data = targetType === 'order'
            ? await buildOrderRequest(req, requestType, targetId, req.body)
            : await buildBookingRequest(req, requestType, targetId, req.body);

        console.log('[refund:request:create:resolved]', {
            requestType,
            targetType,
            targetId,
            merchantUserId: data.merchantUserId,
            refundAmount: data.refundAmount,
            approvedRefundAmount: data.approvedRefundAmount,
            receiptId: data.receiptId
        });

        const result = await createSupportRequest(data);
        const requestId = result.insertId;

        console.log('[refund:request:create:sql:result]', {
            requestId,
            affectedRows: result.affectedRows
        });
        const evidenceFiles = getUploadedSupportEvidence(req);
        const screenshotPath = evidenceFiles[0] ? `/uploads/support/${evidenceFiles[0].filename}` : '';

        if (screenshotPath) {
            await createSupportMessage({
                requestId,
                senderUserId: req.session.user.id,
                senderRole: req.session.user.role,
                messageBody: 'Initial screenshot attached.',
                screenshotPath
            });
        }

        for (const file of evidenceFiles.slice(1)) {
            await createSupportMessage({
                requestId,
                senderUserId: req.session.user.id,
                senderRole: req.session.user.role,
                messageBody: 'Additional initial evidence attached.',
                screenshotPath: `/uploads/support/${file.filename}`
            });
        }

        const label = requestLabels[requestType] || 'Support request';
        const linkUrl = '/help-center';

        notifyUser(req.session.user, {
            type: 'support_request',
            title: 'Refund request submitted',
            message: `${label} #${requestId} was sent directly to the merchant for review. We will notify you when the merchant decides.`,
            linkUrl,
            dedupeKey: `support-customer-created-${requestId}`
        });

        notifyMerchant(data.merchantUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'New refund request needs review',
            message: `${req.session.user.name || 'A customer'} submitted ${label.toLowerCase()} #${requestId} for ${data.receiptId || data.targetId}.`,
            linkUrl,
            dedupeKey: `support-merchant-created-${requestId}`
        });

        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'New merchant refund review',
            message: `${req.session.user.name || 'A customer'} submitted ${label.toLowerCase()} #${requestId}; it is now with the merchant.`,
            linkUrl,
            dedupeKey: `support-admin-monitor-${requestId}`
        });

        return sendSupportResponse(req, res, {
            success: true,
            message: `${label} #${requestId} was submitted successfully.`,
            requestId
        });
    } catch (error) {
        console.error('[refund:request:create:error]', {
            userId: req.session.user?.id,
            body: req.body,
            error: error.message
        });

        return sendSupportResponse(req, res, {
            success: false,
            message: error.message || 'The request could not be submitted.'
        });
    }
}

async function adminSendToMerchant(req, res) {
    try {
        const request = await findSupportRequest(req.params.requestId);

        if (!request) {
            throw new Error('Support request not found.');
        }

        if (RESOLVED_REQUEST_STATUSES.includes(request.status)) {
            throw new Error('This request is already closed or cannot be updated.');
        }

        if (!isRefundRequest(request.requestType) || request.status !== 'pending_merchant_review') {
            throw new Error('Refund requests are sent directly to the merchant when the customer submits them.');
        }

        if (!request.merchantUserId) {
            throw new Error('This request is not attached to a merchant.');
        }

        const result = await sendSupportToMerchant(
            request.id,
            req.session.user.id,
            cleanText(req.body.adminNote)
        );

        if (!result.affectedRows) {
            throw new Error('This request could not be sent to the merchant.');
        }

        notifyMerchant(request.merchantUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'Support request needs your decision',
            message: `Vaniday admin sent ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id} to you for approval.`,
            linkUrl: '/help-center',
            dedupeKey: `support-sent-merchant-${request.id}`
        });

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'Support request sent to merchant',
            message: `${requestLabels[request.requestType]} #${request.id} is now waiting for the merchant decision.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-merchant-review-${request.id}`
        });

        setFlash(req, 'success', `Request #${request.id} was sent to the merchant.`);
    } catch (error) {
        setFlash(req, 'error', error.message || 'The request could not be sent to the merchant.');
    }

    return res.redirect('/help-center');
}

function assertFreshMerchantRequest(req, request) {
    const body = req.body || {};
    const submittedStatus = cleanText(body.requestStatus, 40);
    const submittedUpdatedAt = Date.parse(body.requestUpdatedAt || '');
    const currentUpdatedAt = Date.parse(request.updatedAt || request.createdAt || '');

    if (submittedStatus && submittedStatus !== request.status) {
        throw new Error('This refund request changed since the page loaded. Reload the Help Center before taking action.');
    }

    if (
        Number.isFinite(submittedUpdatedAt)
        && Number.isFinite(currentUpdatedAt)
        && Math.floor(submittedUpdatedAt / 1000) !== Math.floor(currentUpdatedAt / 1000)
    ) {
        throw new Error('This refund request has newer activity. Reload the Help Center before taking action.');
    }
}

function isMerchantReviewStatus(status) {
    return ['pending_merchant_review', 'under_review'].includes(String(status || ''));
}

async function merchantRefundPreview(req, res) {
    try {
        const body = req.body || {};
        const request = await findSupportRequest(req.params.requestId);

        if (!request || String(request.merchantUserId) !== String(req.session.user.id)) {
            throw new Error('Refund request not found for your merchant account.');
        }
        if (!isRefundRequest(request.requestType)) {
            throw new Error('Only refund requests can be previewed here.');
        }
        if (!isMerchantReviewStatus(request.status)) {
            throw new Error('This refund request is not waiting for merchant review.');
        }

        const decision = normalizeMerchantRefundDecision(body.decision);
        if (!['full_refund', 'partial_refund'].includes(decision)) {
            throw new Error('Choose full refund or partial refund to preview.');
        }

        const percentage = decision === 'full_refund'
            ? 100
            : parseMerchantPartialRefundPercentage(body.approvedPercentage);
        const transactionId = request.paymentTransactionId || parseOrderTransactionId(request.targetId);
        if (!transactionId) {
            throw new Error('The original payment transaction could not be found.');
        }

        const calculation = await calculateTransactionRefundPreview(transactionId, {
            requestedGrossRefund: request.refundAmount,
            approvedPercentage: percentage,
            reasonCategory: request.refundReasonCategory || normalizeReasonCategory(request.reason),
            acknowledgementAccepted: Boolean(request.feeAcknowledgedAt || request.feeDeductionApplies),
            lateFeeAmount: request.lateFeeAmount || 0
        });
        const transaction = await getTransactionById(transactionId);
        const rewardEffects = transaction
            ? await previewRefundRewardEffects({ transaction, calculation })
            : {};
        const previousRefunds = mapRefundRows(await getRefundsForTransaction(transactionId));

        return res.json({
            success: true,
            calculation,
            rewardEffects,
            previousRefunds,
            message: 'Refund preview recalculated from the latest payment and refund records.'
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message || 'Refund preview could not be calculated.'
        });
    }
}

async function merchantRespond(req, res) {
    let request = null;
    let refundOutcome = null;
    let processingStarted = false;

    try {
        const body = req.body || {};
        request = await findSupportRequest(req.params.requestId);

        if (!request || String(request.merchantUserId) !== String(req.session.user.id)) {
            throw new Error('Support request not found for your merchant account.');
        }

        const decision = normalizeMerchantRefundDecision(body.decision);
        const merchantNote = cleanText(body.merchantNote);
        const moreInfoMessage = cleanText(body.moreInfoMessage, 1200);
        const partialReasonPreset = cleanText(body.partialReasonPreset);
        const partialReason = cleanText(body.partialReason || body.merchantDecisionReason || (partialReasonPreset === 'Other.' ? '' : partialReasonPreset));
        const rejectionReason = cleanText(body.rejectionReason || body.merchantNote);
        const internalNotes = cleanText(body.internalNotes);

        if (!isRefundRequest(request.requestType)) {
            throw new Error('Only refund requests can be reviewed here.');
        }

        assertFreshMerchantRequest(req, request);

        if (!isMerchantReviewStatus(request.status)) {
            throw new Error('This refund request is not waiting for merchant review.');
        }

        if (!decision) {
            throw new Error('Choose full refund, partial refund, request more information, require return, or reject.');
        }

        if (decision === 'request_more_information') {
            if (moreInfoMessage.length < 12) {
                throw new Error('Please enter a clear customer-visible message explaining what evidence or information is missing.');
            }

            const moreInfoResult = await markMoreInformationRequired(request.id, req.session.user.id, moreInfoMessage, internalNotes);
            if (!moreInfoResult.affectedRows) {
                throw new Error('This request changed before the information request could be saved. Reload and try again.');
            }

            await createSupportMessage({
                requestId: request.id,
                senderUserId: req.session.user.id,
                senderRole: 'merchant',
                messageBody: `More information requested: ${moreInfoMessage}`,
                screenshotPath: ''
            });

            const customerMessage = `${requestLabels[request.requestType]} #${request.id} needs more information from you before the merchant can continue reviewing it. ${moreInfoMessage}`;
            notifyCustomerMoreInformationChannels(request, customerMessage);

            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Merchant requested more refund information',
                message: `${req.session.user.name || 'Merchant'} requested more information on ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id}.`,
                linkUrl: '/help-center',
                dedupeKey: `support-admin-merchant-${request.id}-more-info`
            });

            setFlash(req, 'success', `Request #${request.id} now requires more information from the customer.`);
            return res.redirect('/help-center');
        }

        if (decision === 'return_required') {
            if (!request.returnRequired) {
                throw new Error('This request is not marked as requiring a product return.');
            }
            if (merchantNote.length < 8) {
                throw new Error('Please tell the customer what return action is required.');
            }

            const returnResult = await markReturnRequired(request.id, req.session.user.id, merchantNote, internalNotes);
            if (!returnResult.affectedRows) {
                throw new Error('This return requirement could not be saved.');
            }

            notifyCustomer(request.customerUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Return required before refund',
                message: `${requestLabels[request.requestType]} #${request.id} requires a product return before the merchant can approve the refund. ${merchantNote}`,
                linkUrl: '/help-center',
                dedupeKey: `support-customer-merchant-${request.id}-return-required`
            });

            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Merchant requested return before refund',
                message: `${req.session.user.name || 'Merchant'} marked ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id} as return required.`,
                linkUrl: '/help-center',
                dedupeKey: `support-admin-merchant-${request.id}-return-required`
            });

            setFlash(req, 'success', `Request #${request.id} was marked as return required.`);
            return res.redirect('/help-center');
        }

        if (decision === 'rejected') {
            if (rejectionReason.length < 8) {
                throw new Error('Please add a rejection reason for the customer.');
            }

            const rejectResult = await merchantRejectRequest(request.id, req.session.user.id, rejectionReason, internalNotes);

            if (!rejectResult.affectedRows) {
                throw new Error('This request is not ready for a merchant decision.');
            }

            notifyCustomer(request.customerUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Merchant rejected your refund request',
                message: `${requestLabels[request.requestType]} #${request.id} was rejected by the merchant. Reason: ${rejectionReason}`,
                linkUrl: '/help-center',
                dedupeKey: `support-customer-merchant-${request.id}-rejected`
            });

            notifyAdmins({
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Merchant rejected refund request',
                message: `${req.session.user.name || 'Merchant'} rejected ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id}.`,
                linkUrl: '/help-center',
                dedupeKey: `support-admin-merchant-${request.id}-rejected`
            });

            setFlash(req, 'success', `Request #${request.id} was rejected.`);
            return res.redirect('/help-center');
        }

        if (request.returnRequired && request.merchantDecision !== 'return_submitted') {
            throw new Error('This request requires the product return step before a refund can be approved.');
        }

        const percentage = decision === 'full_refund'
            ? 100
            : parseMerchantPartialRefundPercentage(body.approvedPercentage);

        if (decision === 'partial_refund' && partialReason.length < 8) {
            throw new Error('Please add a customer-facing reason for the partial refund.');
        }

        const transactionId = request.paymentTransactionId || parseOrderTransactionId(request.targetId);
        const approvalCalculation = await calculateTransactionRefundPreview(transactionId, {
            requestedGrossRefund: request.refundAmount,
            approvedPercentage: percentage,
            reasonCategory: request.refundReasonCategory || normalizeReasonCategory(request.reason),
            acknowledgementAccepted: Boolean(request.feeAcknowledgedAt || request.feeDeductionApplies),
            lateFeeAmount: request.lateFeeAmount || 0
        });

        if (approvalCalculation.approvedGrossRefund <= 0 || approvalCalculation.netCustomerRefund <= 0) {
            throw new Error(`The approved refund amount must be more than the S$${REFUND_ADMINISTRATION_FEE_AMOUNT.toFixed(2)} Refund Administration Fee.`);
        }

        const customerFacingReason = decision === 'partial_refund'
            ? partialReason
            : (merchantNote || 'Full refund approved.');
        const approveResult = await markMerchantApproved(request.id, req.session.user.id, merchantNote, {
            customerFacingReason,
            internalNotes,
            approvedRefundPercentage: approvalCalculation.approvedRefundPercentage,
            refundBaseAmount: approvalCalculation.refundBaseAmount,
            grossRefundAmount: approvalCalculation.approvedGrossRefund,
            processingFeeDeduction: approvalCalculation.processingFeeDeduction,
            otherDeductionAmount: approvalCalculation.otherDeductions,
            netRefundAmount: approvalCalculation.netCustomerRefund
        });

        if (!approveResult.affectedRows) {
            throw new Error('This request is not ready for a merchant decision.');
        }
        processingStarted = true;

        const requestTargetReference = request.requestType === 'order_refund'
            ? formatOrderDisplayReference(request)
            : (request.receiptId || request.targetId);

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: decision === 'partial_refund' ? 'Your refund was partially approved' : 'Your refund was fully approved',
            message: `${requestLabels[request.requestType]} #${request.id} for ${requestTargetReference} was approved for S$${approvalCalculation.approvedGrossRefund.toFixed(2)}. Refund Administration Fee: S$${approvalCalculation.processingFeeDeduction.toFixed(2)}. Amount returned: S$${approvalCalculation.netCustomerRefund.toFixed(2)}.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-merchant-${request.id}-approved`
        });

        refundOutcome = await processMerchantApprovedRefund(request, req.session.user.id, customerFacingReason, {
            customerFacingReason,
            approvedRefundPercentage: approvalCalculation.approvedRefundPercentage,
            grossRefundAmount: approvalCalculation.approvedGrossRefund
        });
        await markRefundSucceeded(request.id, req.session.user.id, refundOutcome);

        const completed = !refundOutcome.manualRequired;
        const completionSummary = formatRewardEffectSummary(refundOutcome);
        const finalMessage = completed
            ? `Refund request #${request.id} was completed: ${completionSummary}.`
            : `Refund request #${request.id} requires manual merchant action through ${refundOutcome.provider || 'the original payment provider'}.`;

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: completed ? 'Refund completed' : 'Refund requires manual processing',
            message: completed
                ? `${requestLabels[request.requestType]} #${request.id} for ${requestTargetReference} has been ${refundOutcome.refundStatus === 'partially_refunded' ? 'partially ' : ''}refunded. ${completionSummary}.`
                : `${requestLabels[request.requestType]} #${request.id} was approved, but this payment method needs manual merchant processing.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-refund-${request.id}-${completed ? 'refunded' : 'manual'}`
        });

        notifyMerchant(request.merchantUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: completed ? 'Refund completed' : 'Manual refund action required',
            message: completed
                ? `${requestTargetReference}: gross refund S$${Number(refundOutcome.grossRefundAmount || 0).toFixed(2)}, ${completionSummary}. Provider ref: ${refundOutcome.providerRefundId || 'not provided'}.`
                : finalMessage,
            linkUrl: '/help-center',
            dedupeKey: `support-merchant-refund-${request.id}-${completed ? 'refunded' : 'manual'}`
        });

        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: completed ? 'Merchant refund completed' : 'Merchant refund pending manual action',
            message: `${req.session.user.name || 'Merchant'} approved ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id}.`,
            linkUrl: '/help-center',
            dedupeKey: `support-admin-merchant-${request.id}-approved`
        });

        setFlash(req, 'success', finalMessage);
    } catch (error) {
        if (processingStarted && request?.id) {
            const needsReconciliation = error.code === 'REFUND_RECONCILIATION_REQUIRED';
            const markFailure = needsReconciliation ? markRefundReconciliationRequired : markRefundFailed;

            await markFailure(request.id, req.session.user.id, error.message || 'Refund provider failed.').catch((markError) => {
                console.error('Refund failure status could not be saved:', markError);
            });

            notifyCustomer(request.customerUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: needsReconciliation ? 'Refund needs manual review' : 'Refund processing failed',
                message: needsReconciliation
                    ? `${requestLabels[request.requestType]} #${request.id} needs manual payment reconciliation before it can be retried. The merchant has been notified.`
                    : `${requestLabels[request.requestType]} #${request.id} could not be processed automatically. The merchant has been notified to follow up.`,
                linkUrl: '/help-center',
                dedupeKey: `support-customer-refund-${request.id}-${needsReconciliation ? 'reconciliation' : 'failed'}`
            });

            notifyMerchant(request.merchantUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: needsReconciliation ? 'Refund reconciliation required' : 'Refund processing failed',
                message: needsReconciliation
                    ? `Refund request #${request.id} may have reached the provider, but local reconciliation did not complete. Check the provider record and do not issue a second refund until reconciled.`
                    : `Refund request #${request.id} failed during processing. Review the payment provider record and contact support if needed.`,
                linkUrl: '/help-center',
                dedupeKey: `support-merchant-refund-${request.id}-${needsReconciliation ? 'reconciliation' : 'failed'}`
            });
        }

        setFlash(req, 'error', error.message || 'The merchant response could not be saved.');
    }

    return res.redirect('/help-center');
}

async function adminResolve(req, res) {
    let refundOutcome = null;

    try {
        console.log('[refund:admin:request:body]', {
            adminUserId: req.session.user?.id,
            requestId: req.params.requestId,
            body: req.body
        });

        const request = await findSupportRequest(req.params.requestId);

        if (!request) {
            throw new Error('Support request not found.');
        }

        console.log('[refund:admin:request:loaded]', {
            requestId: request.id,
            requestType: request.requestType,
            targetType: request.targetType,
            targetId: request.targetId,
            receiptId: request.receiptId,
            status: request.status,
            merchantDecision: request.merchantDecision,
            adminDecision: request.adminDecision,
            refundAmount: request.refundAmount,
            approvedRefundAmount: request.approvedRefundAmount,
            merchantUserId: request.merchantUserId
        });

        const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
        const adminNote = cleanText(req.body.adminNote);

        if (!isRefundRequest(request.requestType)) {
            throw new Error('Only refund requests can be resolved from this desk.');
        }

        if (adminNote.length < 8) {
            throw new Error('Please add a final admin note for the refund decision.');
        }

        if (decision === 'approved') {
            if (!request.customerTermsAccepted || request.customerTermsVersion !== REFUND_TERMS_VERSION) {
                throw new Error('The customer must accept the current refund terms before approval.');
            }

            if (request.merchantDecision === 'declined') {
                throw new Error('The merchant declined this request, so it must be rejected.');
            }

            if (request.merchantDecision !== 'approved') {
                throw new Error('Please send this request to the merchant and wait for approval before approving it.');
            }
        }

        if (decision === 'approved' && request.requestType === 'order_refund') {
            const transactionId = parseOrderTransactionId(request.targetId);
            let order = transactionId ? await getOrderById(transactionId) : null;

            if (!order) {
                order = await getHistoryOrderForCustomer(
                    request.customerUserId,
                    request.receiptId || request.targetId
                );
            }

            if (!order) {
                throw new Error('The order could not be found.');
            }

            if (
                SHIPPED_STATUSES.includes(order.deliveryStatus)
                && request.actionType === 'cancellation'
            ) {
                throw new Error('This order is already in delivery, so it cannot be refunded through the cancellation flow.');
            }
        }

        if (decision === 'approved') {
            const approvedRefundAmount = getApprovedRefundAmount(request);
            if (request.requestType === 'order_refund') {
                const transactionId = parseOrderTransactionId(request.targetId);

                if (transactionId) {
                    console.log('[refund:admin:order:start]', {
                        requestId: request.id,
                        transactionId,
                        approvedRefundAmount,
                        merchantUserId: request.merchantUserId
                    });

                    refundOutcome = await refundTransaction(transactionId, {
                        amount: approvedRefundAmount,
                        reason: adminNote || request.reason || request.customerNote || 'Approved order refund',
                        refundedBy: req.session.user.id,
                        merchantId: request.merchantUserId || null
                    });

                    if (request.actionType === 'cancellation') {
                        const deliveryResult = await updateDeliveryStatus(transactionId, 'cancelled', {});
                        console.log('[refund:admin:order:delivery:update:result]', {
                            transactionId,
                            affectedRows: deliveryResult?.affectedRows,
                            changedRows: deliveryResult?.changedRows
                        });
                    }

                    if (request.receiptId) {
                        if (request.actionType === 'cancellation') {
                            await updateHistoryDeliveryStatus(request.receiptId, 'cancelled');
                        }
                        if (!refundOutcome.manualRequired) {
                            await recordHistoryRefund(request.receiptId, approvedRefundAmount);
                        }
                        await reverseCampaignCashback(request.receiptId);
                    }
                } else {
                    console.log('[refund:admin:history-only:start]', {
                        requestId: request.id,
                        receiptId: request.receiptId || request.targetId,
                        approvedRefundAmount
                    });

                    if (request.actionType === 'cancellation') {
                        await updateHistoryDeliveryStatus(request.receiptId || request.targetId, 'cancelled');
                    }
                    await recordHistoryRefund(request.receiptId || request.targetId, approvedRefundAmount);
                    await reverseCampaignCashback(request.receiptId || request.targetId);
                }
            } else if (request.targetType === 'booking') {
                const booking = await findBookingForCustomer(request.targetId, request.customerUserId);

                if (booking?.transaction_id) {
                    console.log('[refund:admin:booking:start]', {
                        requestId: request.id,
                        bookingId: request.targetId,
                        transactionId: booking.transaction_id,
                        approvedRefundAmount,
                        merchantUserId: request.merchantUserId
                    });

                    refundOutcome = await refundTransaction(booking.transaction_id, {
                        amount: approvedRefundAmount,
                        reason: adminNote || request.reason || request.customerNote || 'Approved booking refund',
                        refundedBy: req.session.user.id,
                        merchantId: request.merchantUserId || null,
                        bookingId: request.targetId
                    });
                } else if (approvedRefundAmount > 0) {
                    throw new Error('This paid booking is missing a linked payment transaction, so it cannot be refunded automatically.');
                }

                await markBookingCancelled(request.targetId);
                if (refundOutcome) {
                    await markBookingRefundStatus(request.targetId, refundOutcome.refundStatus);
                }
                await reverseCampaignCashback(String(request.targetId));
                await sendCancellationForBooking(request.targetId, request.reason || request.customerNote || '').catch((error) => {
                    console.error('WhatsApp cancellation notification failed:', error.message);
                });
                await sendSmsCancellationForBooking(request.targetId, request.reason || request.customerNote || '').catch((error) => {
                    console.error('SMS cancellation notification failed:', error.message);
                });
            }
        }

        const result = await adminResolveRequest(
            request.id,
            req.session.user.id,
            decision,
            adminNote
        );

        console.log('[refund:admin:resolve:sql:result]', {
            requestId: request.id,
            decision,
            affectedRows: result?.affectedRows,
            changedRows: result?.changedRows,
            refundOutcome
        });

        if (!result.affectedRows) {
            throw new Error('This request is already closed or cannot be updated.');
        }

        const label = requestLabels[request.requestType] || 'Support request';
        const approvedRefundAmount = getApprovedRefundAmount(request);
        const moneyMessage = decision === 'approved' && approvedRefundAmount > 0 && refundOutcome?.manualRequired
            ? ` Manual refund required: $${approvedRefundAmount.toFixed(2)} must be returned through ${refundOutcome.provider || 'the original payment provider'}.`
            : decision === 'approved' && approvedRefundAmount > 0
            ? ` Refund recorded: $${approvedRefundAmount.toFixed(2)}.`
            : '';
        const feeMessage = decision === 'approved' && request.lateFeeAmount > 0
            ? ` Late cancellation fee recorded: $${request.lateFeeAmount.toFixed(2)}.`
            : '';

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: `${label} ${decision}`,
            message: `${label} #${request.id} was ${decision} by Vaniday admin.${moneyMessage}${feeMessage}`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-final-${request.id}-${decision}`
        });

        notifyMerchant(request.merchantUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: `Support request ${decision}`,
            message: `${label} #${request.id} was ${decision} by Vaniday admin.`,
            linkUrl: '/help-center',
            dedupeKey: `support-merchant-final-${request.id}-${decision}`
        });

        setFlash(req, 'success', `Request #${request.id} was ${decision}.`);
    } catch (error) {
        console.error('[refund:admin:error]', {
            requestId: req.params.requestId,
            adminUserId: req.session.user?.id,
            body: req.body,
            error: error.message,
            stack: error.stack
        });

        setFlash(req, 'error', error.message || 'The final decision could not be saved.');
    }

    return res.redirect('/help-center');
}

async function updateOrderDeliveryStatus(req, res) {
    try {
        const status = ORDER_STATUSES.includes(req.body.deliveryStatus)
            ? req.body.deliveryStatus
            : 'processing';
        const options = req.session.user.role === 'merchant'
            ? { merchantUserId: req.session.user.id }
            : {};
        const result = await updateDeliveryStatus(req.params.transactionId, status, options);

        if (!result.affectedRows) {
            throw new Error('This order could not be updated for your account.');
        }

        const order = await getOrderById(req.params.transactionId);
        const orderDisplayReference = order?.order_number || order?.orderNumber || `#${req.params.transactionId}`;

        if (order) {
            notifyCustomer(order.userId, {
                actorUserId: req.session.user.id,
                type: 'order_update',
                title: 'Order delivery updated',
                message: `Order ${orderDisplayReference} is now ${status}.`,
                linkUrl: '/help-center',
                dedupeKey: `order-delivery-${order.id}-${status}-${Date.now()}`
            });
        }

        setFlash(req, 'success', `Order ${orderDisplayReference} was updated to ${status}.`);
    } catch (error) {
        setFlash(req, 'error', error.message || 'The order delivery status could not be updated.');
    }

    return res.redirect('/help-center');
}

module.exports = {
    createRequest,
    merchantRefundPreview,
    merchantRespond,
    replyToRequest,
    showHelpCenter,
    updateOrderDeliveryStatus
};
