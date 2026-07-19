const { promisify } = require('util');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const PurchaseHistory = require('../models/PurchaseHistory');
const SupportRequest = require('../models/SupportRequest');
const Transaction = require('../models/Transaction');
const Loyalty = require('../models/Loyalty');
const {
    sendCancellationForBooking,
    sendRescheduleForBooking
} = require('../services/whatsappAutomation');
const {
    sendSmsCancellationForBooking,
    sendSmsRescheduleForBooking
} = require('../services/smsAutomation');
const { refundTransaction } = require('../services/refundProcessor');

const ACTIVE_REQUEST_LIMIT = 5;
const SHIPPED_STATUSES = ['shipped', 'delivered'];
const ORDER_STATUSES = ['processing', 'packed', 'shipped', 'delivered', 'cancelled'];
const REFUND_REQUEST_TYPES = ['order_refund', 'booking_refund'];
const REFUND_TERMS_VERSION = 'refund-policy-2026-05';
const RESOLVED_REQUEST_STATUSES = ['refunded', 'rejected', 'cancelled', 'closed'];

const requestLabels = {
    order_refund: 'Order refund',
    booking_refund: 'Booking refund'
};

const statusLabels = {
    pending_merchant_review: 'Pending merchant review',
    approved: 'Approved',
    refund_processing: 'Refund processing',
    refunded: 'Refunded',
    rejected: 'Rejected',
    refund_failed: 'Refund failed',
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
const markRefundSucceeded = promisify(SupportRequest.markRefundSucceeded);
const markRefundFailed = promisify(SupportRequest.markRefundFailed);
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
    const match = String(value || '').trim().match(/^(?:order-)?(\d+)$/i);
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
    return Math.max(0, Math.round((Number(request.refundAmount || 0) - Number(request.lateFeeAmount || 0)) * 100) / 100);
}

function isRefundRequest(requestType) {
    return REFUND_REQUEST_TYPES.includes(requestType);
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

async function processMerchantApprovedRefund(request, merchantUserId, merchantNote) {
    const approvedRefundAmount = getApprovedRefundAmount(request);

    if (approvedRefundAmount <= 0) {
        throw new Error('Approved refund amount must be greater than zero.');
    }

    let refundOutcome = null;

    if (request.requestType === 'order_refund') {
        const transactionId = parseOrderTransactionId(request.targetId || request.paymentTransactionId);
        let order = transactionId ? await getOrderById(transactionId) : null;

        if (!order) {
            order = await getHistoryOrderForCustomer(
                request.customerUserId,
                request.receiptId || (transactionId ? `order-${transactionId}` : request.targetId)
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
                amount: approvedRefundAmount,
                reason: merchantNote || request.reason || request.customerNote || 'Merchant approved order refund',
                refundedBy: merchantUserId,
                merchantId: merchantUserId,
                orderId: transactionId
            });

            await updateDeliveryStatus(transactionId, 'cancelled', { merchantUserId });

            if (request.receiptId) {
                await updateHistoryDeliveryStatus(request.receiptId, 'cancelled');
                if (!refundOutcome.manualRequired) {
                    await recordHistoryRefund(request.receiptId, approvedRefundAmount);
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
                amount: approvedRefundAmount,
                reason: merchantNote || request.reason || request.customerNote || 'Merchant approved booking refund',
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

        await markBookingCancelled(request.targetId);
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
            orderStatuses: ORDER_STATUSES
        };

        if (role === 'customer') {
            const [requests, bookings, transactionOrders, historyOrders] = await Promise.all([
                getCustomerRequests(req.session.user.id),
                getCustomerBookings(req.session.user.id),
                getCustomerOrders(req.session.user.id),
                getHistoryOrders(req.session.user.id)
            ]);

            return res.render('help-center', {
                ...viewModel,
                requests: await attachMessages(requests),
                bookings,
                orders: mergeCustomerOrders(transactionOrders, historyOrders)
            });
        }

        if (role === 'merchant') {
            const [requests, orders] = await Promise.all([
                getMerchantRequests(req.session.user.id),
                getMerchantOrders(req.session.user.id)
            ]);

            return res.render('help-center', {
                ...viewModel,
                requests: await attachMessages(requests),
                orders
            });
        }

        const requests = await getAdminRequests();

        return res.render('help-center', {
            ...viewModel,
            requests: await attachMessages(requests)
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
        const screenshot = req.file ? `/uploads/support/${req.file.filename}` : '';

        if (!messageBody && !screenshot) {
            throw new Error('Add a message or screenshot before sending.');
        }

        await createSupportMessage({
            requestId: request.id,
            senderUserId: req.session.user.id,
            senderRole: req.session.user.role,
            messageBody,
            screenshotPath: screenshot
        });

        const replyEventKey = `${request.id}-${Date.now()}`;

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
                title: `New reply on ticket #${request.id}`,
                message: req.session.user.role === 'customer'
                    ? `${req.session.user.name || 'A customer'} replied to ${requestLabels[request.requestType] || 'a support ticket'}.`
                    : `Vaniday admin replied to ${(requestLabels[request.requestType] || 'a support ticket').toLowerCase()} #${request.id}.`,
                linkUrl: '/help-center',
                dedupeKey: `support-reply-merchant-${replyEventKey}`
            });
        }

        return sendSupportResponse(req, res, {
            success: true,
            message: `Reply added to ticket #${request.id}.`,
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
        const receiptId = transactionId ? `order-${transactionId}` : targetId;
        order = await getHistoryOrderForCustomer(req.session.user.id, receiptId);
    }

    if (!order) {
        throw new Error('This order could not be found on your account.');
    }

    if (SHIPPED_STATUSES.includes(order.deliveryStatus)) {
        throw new Error('This order has already been shipped, so it cannot be cancelled or refunded from the Help Center.');
    }

    if (order.deliveryStatus === 'cancelled') {
        throw new Error('This order is already cancelled.');
    }

    if (order.refundStatus === 'refunded' || Number(order.refundedAmount || 0) > 0) {
        throw new Error('This order has already been refunded.');
    }

    if (!order.merchantUserIds[0]) {
        throw new Error('This order cannot be refunded through the Help Center because the merchant could not be verified.');
    }

    return {
        customerUserId: req.session.user.id,
        merchantUserId: order.merchantUserIds[0] || null,
        requestType,
        targetType: 'order',
        targetId: String(transactionId || parseOrderTransactionId(order.receiptId) || order.targetId || order.id),
        receiptId: order.receiptId,
        targetLabel: order.itemNames || 'Product order',
        paymentMethod: order.paymentMethod || order.paymentProvider || '',
        status: 'pending_merchant_review',
        reason: cleanText(body.reason, 160),
        customerNote: cleanText(body.customerNote),
        refundAmount: Number(order.totalAmount || 0),
        approvedRefundAmount: Number(order.totalAmount || 0),
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

    if (booking.status === 'cancelled') {
        throw new Error('This booking is already cancelled.');
    }

    if (!booking.transaction_id && booking.status !== 'paid') {
        throw new Error('Only paid bookings can be submitted for refund review.');
    }

    const dayDifference = getDayDifferenceFromToday(booking.booking_date);
    const isPastBooking = dayDifference !== null && dayDifference < 0;

    if (isPastBooking && requestType !== 'booking_refund') {
        throw new Error('Past bookings cannot be changed or cancelled from the Help Center.');
    }

    const isLateCancellation = dayDifference !== null
        && dayDifference >= 0
        && dayDifference <= 1;
    const refundAmount = Number(booking.service_price || 0);

    return {
        customerUserId: req.session.user.id,
        merchantUserId: booking.merchant_user_id,
        requestType,
        targetType: 'booking',
        targetId: String(booking.id),
        receiptId: String(booking.id),
        targetLabel: booking.service_name || 'Booking service',
        paymentMethod: booking.transaction_id ? 'original payment transaction' : 'booking payment',
        status: 'pending_merchant_review',
        reason: cleanText(body.reason, 160),
        customerNote: cleanText(body.customerNote),
        requestedChange: null,
        refundAmount,
        approvedRefundAmount: Math.max(0, refundAmount - (isLateCancellation ? calculateLateFee(refundAmount) : 0)),
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
        const screenshotPath = req.file ? `/uploads/support/${req.file.filename}` : '';

        if (screenshotPath) {
            await createSupportMessage({
                requestId,
                senderUserId: req.session.user.id,
                senderRole: req.session.user.role,
                messageBody: 'Initial screenshot attached.',
                screenshotPath
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

async function merchantRespond(req, res) {
    let request = null;
    let refundOutcome = null;
    let processingStarted = false;

    try {
        request = await findSupportRequest(req.params.requestId);

        if (!request || String(request.merchantUserId) !== String(req.session.user.id)) {
            throw new Error('Support request not found for your merchant account.');
        }

        const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';
        const merchantNote = cleanText(req.body.merchantNote);
        const rejectionReason = cleanText(req.body.rejectionReason || req.body.merchantNote);
        const internalNotes = cleanText(req.body.internalNotes);

        if (!isRefundRequest(request.requestType)) {
            throw new Error('Only refund requests can be reviewed here.');
        }

        if (request.status !== 'pending_merchant_review') {
            throw new Error('This refund request is not waiting for merchant review.');
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

        const approveResult = await markMerchantApproved(request.id, req.session.user.id, internalNotes || merchantNote);

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
            title: 'Merchant approved your refund request',
            message: `${requestLabels[request.requestType]} #${request.id} for ${requestTargetReference} was approved for $${getApprovedRefundAmount(request).toFixed(2)}. The refund is now processing.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-merchant-${request.id}-approved`
        });

        refundOutcome = await processMerchantApprovedRefund(request, req.session.user.id, merchantNote || internalNotes);
        await markRefundSucceeded(request.id, req.session.user.id, refundOutcome);

        const completed = !refundOutcome.manualRequired;
        const finalMessage = completed
            ? `Refund request #${request.id} was completed for $${refundOutcome.amount.toFixed(2)}.`
            : `Refund request #${request.id} requires manual merchant action through ${refundOutcome.provider || 'the original payment provider'}.`;

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: completed ? 'Refund completed' : 'Refund requires manual processing',
            message: completed
                ? `${requestLabels[request.requestType]} #${request.id} for ${requestTargetReference} has been refunded for $${refundOutcome.amount.toFixed(2)}.`
                : `${requestLabels[request.requestType]} #${request.id} was approved, but this payment method needs manual merchant processing.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-refund-${request.id}-${completed ? 'refunded' : 'manual'}`
        });

        notifyMerchant(request.merchantUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: completed ? 'Refund completed' : 'Manual refund action required',
            message: finalMessage,
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
            await markRefundFailed(request.id, req.session.user.id, error.message || 'Refund provider failed.').catch((markError) => {
                console.error('Refund failure status could not be saved:', markError);
            });

            notifyCustomer(request.customerUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Refund processing failed',
                message: `${requestLabels[request.requestType]} #${request.id} could not be processed automatically. The merchant has been notified to follow up.`,
                linkUrl: '/help-center',
                dedupeKey: `support-customer-refund-${request.id}-failed`
            });

            notifyMerchant(request.merchantUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Refund processing failed',
                message: `Refund request #${request.id} failed during processing. Review the payment provider record and contact support if needed.`,
                linkUrl: '/help-center',
                dedupeKey: `support-merchant-refund-${request.id}-failed`
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
                    request.receiptId || (transactionId ? `order-${transactionId}` : request.targetId)
                );
            }

            if (!order) {
                throw new Error('The order could not be found.');
            }

            if (SHIPPED_STATUSES.includes(order.deliveryStatus)) {
                throw new Error('This order has already shipped, so it cannot be refunded through the cancellation flow.');
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

                    const deliveryResult = await updateDeliveryStatus(transactionId, 'cancelled', {});
                    console.log('[refund:admin:order:delivery:update:result]', {
                        transactionId,
                        affectedRows: deliveryResult?.affectedRows,
                        changedRows: deliveryResult?.changedRows
                    });

                    if (request.receiptId) {
                        await updateHistoryDeliveryStatus(request.receiptId, 'cancelled');
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

                    await updateHistoryDeliveryStatus(request.receiptId || request.targetId, 'cancelled');
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
    merchantRespond,
    replyToRequest,
    showHelpCenter,
    updateOrderDeliveryStatus
};
