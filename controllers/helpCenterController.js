const { promisify } = require('util');
const Booking = require('../models/Booking');
const Notification = require('../models/Notification');
const PurchaseHistory = require('../models/PurchaseHistory');
const SupportRequest = require('../models/SupportRequest');
const Transaction = require('../models/Transaction');
const {
    sendCancellationForBooking,
    sendRescheduleForBooking
} = require('../services/whatsappAutomation');

const ACTIVE_REQUEST_LIMIT = 5;
const SHIPPED_STATUSES = ['shipped', 'delivered'];
const ORDER_STATUSES = ['processing', 'packed', 'shipped', 'delivered', 'cancelled'];

const requestLabels = {
    order_refund: 'Order refund',
    booking_refund: 'Booking refund',
    booking_cancel: 'Booking cancellation',
    booking_change: 'Booking change'
};

const statusLabels = {
    pending_admin_review: 'Pending admin review',
    pending_merchant_review: 'Waiting for merchant',
    merchant_approved: 'Merchant approved',
    merchant_declined: 'Merchant declined',
    resolved_approved: 'Approved',
    resolved_rejected: 'Rejected',
    cancelled: 'Cancelled',
    closed: 'Closed'
};

const getCustomerRequests = promisify(SupportRequest.getForCustomer);
const getMerchantRequests = promisify(SupportRequest.getForMerchant);
const getAdminRequests = promisify(SupportRequest.getForAdmin);
const getCustomerBookings = promisify(Booking.getSupportBookingsByUserId);
const findBookingForCustomer = promisify(Booking.findSupportBookingForCustomer);
const getBookingNotificationDetails = promisify(Booking.getNotificationDetailsById);
const hasExistingBooking = promisify(Booking.hasExistingBookingInDatabase);
const markBookingCancelled = promisify(Booking.markCancelled);
const updateBookingSchedule = promisify(Booking.updateSchedule);
const getCustomerOrders = promisify(Transaction.getCustomerOrders);
const getOrderForCustomer = promisify(Transaction.getOrderForCustomer);
const getOrderById = promisify(Transaction.getOrderById);
const recordTransactionRefund = promisify(Transaction.recordRefund);
const getHistoryOrders = promisify(PurchaseHistory.getSupportOrdersByUserId);
const getHistoryOrderForCustomer = promisify(PurchaseHistory.getSupportOrderForCustomer);
const updateHistoryDeliveryStatus = promisify(PurchaseHistory.updateDeliveryStatus);
const recordHistoryRefund = promisify(PurchaseHistory.recordRefund);
const getMerchantOrders = promisify(Transaction.getMerchantOrderReport);
const updateDeliveryStatus = promisify(Transaction.updateDeliveryStatus);
const createSupportRequest = promisify(SupportRequest.create);
const findSupportRequest = promisify(SupportRequest.findById);
const hasActiveRequest = promisify(SupportRequest.hasActiveRequest);
const countOpenByCustomer = promisify(SupportRequest.countOpenByCustomer);
const sendSupportToMerchant = promisify(SupportRequest.adminSendToMerchant);
const merchantRespondToRequest = promisify(SupportRequest.merchantRespond);
const adminResolveRequest = promisify(SupportRequest.adminResolve);

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

function parseOrderTransactionId(value) {
    const match = String(value || '').trim().match(/^(?:order-)?(\d+)$/i);
    return match ? Number(match[1]) : null;
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
        const slotTaken = await hasExistingBooking(
            booking.salon_id,
            booking.service_id,
            nextSlot.bookingDate,
            nextSlot.bookingTime
        );

        if (slotTaken) {
            throw new Error('The requested new slot is already booked. Please ask the customer to choose another time.');
        }
    }

    const result = await updateBookingSchedule(request.targetId, nextSlot.bookingDate, nextSlot.bookingTime);

    if (!result.affectedRows) {
        throw new Error('The booking could not be rescheduled.');
    }

    await sendRescheduleForBooking(request.targetId).catch((error) => {
        console.error('WhatsApp reschedule notification failed:', error.message);
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
            heading: 'Help Center control desk',
            description: 'Review customer refund requests, send them to merchants, and close the final decision with a clear audit trail.'
        };
    }

    if (role === 'merchant') {
        return {
            eyebrow: 'Merchant support',
            heading: 'Refunds, booking changes, and fulfilment',
            description: 'Respond to customer requests that admin sends to you, and update order delivery progress from one clean workspace.'
        };
    }

    return {
        eyebrow: 'Customer Help Center',
        heading: 'Refunds and booking support',
        description: 'Request help for paid orders and service bookings. Vaniday reviews refund cases first, then checks with the merchant where needed.'
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
                requests,
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
                requests,
                orders
            });
        }

        const requests = await getAdminRequests();

        return res.render('help-center', {
            ...viewModel,
            requests
        });
    } catch (error) {
        console.error(error);
        return res.status(500).render('error', {
            title: 'Help Center Error',
            message: 'The Help Center could not be loaded.'
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

    return {
        customerUserId: req.session.user.id,
        merchantUserId: order.merchantUserIds[0] || null,
        requestType,
        targetType: 'order',
        targetId: String(transactionId || parseOrderTransactionId(order.receiptId) || order.targetId || order.id),
        receiptId: order.receiptId,
        status: 'pending_admin_review',
        reason: cleanText(body.reason, 160),
        customerNote: cleanText(body.customerNote),
        refundAmount: Number(order.totalAmount || 0),
        deliveryStatus: order.deliveryStatus
    };
}

async function buildBookingRequest(req, requestType, targetId, body) {
    const allowed = ['booking_refund', 'booking_cancel', 'booking_change'];

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

    const dayDifference = getDayDifferenceFromToday(booking.booking_date);
    const isPastBooking = dayDifference !== null && dayDifference < 0;

    if (isPastBooking && requestType !== 'booking_refund') {
        throw new Error('Past bookings cannot be changed or cancelled from the Help Center.');
    }

    const isLateCancellation = requestType !== 'booking_change'
        && dayDifference !== null
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
        status: requestType === 'booking_change' ? 'pending_merchant_review' : 'pending_admin_review',
        reason: cleanText(body.reason, 160),
        customerNote: cleanText(body.customerNote),
        requestedChange: cleanText(body.requestedChange),
        refundAmount: requestType === 'booking_change' ? 0 : refundAmount,
        lateFeeAmount: isLateCancellation ? calculateLateFee(refundAmount) : 0,
        isLateCancellation
    };
}

async function createRequest(req, res) {
    try {
        const requestType = cleanText(req.body.requestType, 40);
        const targetType = cleanText(req.body.targetType, 20);
        const targetId = cleanText(req.body.targetId, 80);

        if (!requestLabels[requestType]) {
            throw new Error('Please choose a valid request type.');
        }

        if (!['order', 'booking'].includes(targetType)) {
            throw new Error('Please choose a valid order or booking.');
        }

        const note = cleanText(req.body.customerNote);
        const requestedChange = cleanText(req.body.requestedChange);

        if (requestType === 'booking_change' && requestedChange.length < 8) {
            throw new Error('Please describe what you want to change for this booking.');
        }

        if (requestType !== 'booking_change' && note.length < 8) {
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

        const data = targetType === 'order'
            ? await buildOrderRequest(req, requestType, targetId, req.body)
            : await buildBookingRequest(req, requestType, targetId, req.body);

        const result = await createSupportRequest(data);
        const requestId = result.insertId;
        const label = requestLabels[requestType] || 'Support request';
        const linkUrl = '/help-center';

        notifyUser(req.session.user, {
            type: 'support_request',
            title: 'Support request submitted',
            message: `${label} #${requestId} has been submitted. We will update you once it moves to the next step.`,
            linkUrl,
            dedupeKey: `support-customer-created-${requestId}`
        });

        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'New customer support request',
            message: `${req.session.user.name || 'A customer'} submitted ${label.toLowerCase()} #${requestId}.`,
            linkUrl,
            dedupeKey: `support-admin-created-${requestId}`
        });

        if (data.status === 'pending_merchant_review') {
            notifyMerchant(data.merchantUserId, {
                actorUserId: req.session.user.id,
                type: 'support_request',
                title: 'Booking change request',
                message: `${req.session.user.name || 'A customer'} requested a booking change. Please approve or decline it in Help Center.`,
                linkUrl,
                dedupeKey: `support-merchant-created-${requestId}`
            });
        }

        setFlash(req, 'success', `${label} #${requestId} was submitted successfully.`);
    } catch (error) {
        setFlash(req, 'error', error.message || 'The request could not be submitted.');
    }

    return res.redirect('/help-center');
}

async function adminSendToMerchant(req, res) {
    try {
        const request = await findSupportRequest(req.params.requestId);

        if (!request) {
            throw new Error('Support request not found.');
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
    try {
        const request = await findSupportRequest(req.params.requestId);

        if (!request || String(request.merchantUserId) !== String(req.session.user.id)) {
            throw new Error('Support request not found for your merchant account.');
        }

        const decision = req.body.decision === 'approved' ? 'approved' : 'declined';
        const note = cleanText(req.body.merchantNote);

        if (request.requestType === 'booking_change' && decision === 'approved') {
            await applyApprovedBookingChange(request);
        }

        const result = await merchantRespondToRequest(request.id, req.session.user.id, decision, note);

        if (!result.affectedRows) {
            throw new Error('This request is not ready for a merchant decision.');
        }

        if (request.requestType === 'booking_change') {
            await adminResolveRequest(
                request.id,
                null,
                decision === 'approved' ? 'approved' : 'rejected',
                decision === 'approved'
                    ? 'Merchant approved the booking change request.'
                    : 'Merchant declined the booking change request.'
            );
        }

        notifyAdmins({
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: 'Merchant responded to support request',
            message: `${req.session.user.name || 'Merchant'} ${decision} ${(requestLabels[request.requestType] || 'support request').toLowerCase()} #${request.id}.`,
            linkUrl: '/help-center',
            dedupeKey: `support-admin-merchant-${request.id}-${decision}`
        });

        notifyCustomer(request.customerUserId, {
            actorUserId: req.session.user.id,
            type: 'support_request',
            title: decision === 'approved' ? 'Merchant approved your request' : 'Merchant declined your request',
            message: request.requestType === 'booking_change'
                ? `Your booking change request #${request.id} was ${decision}.`
                : `The merchant ${decision} request #${request.id}. Vaniday admin will close the final decision.`,
            linkUrl: '/help-center',
            dedupeKey: `support-customer-merchant-${request.id}-${decision}`
        });

        setFlash(req, 'success', `Request #${request.id} was ${decision}.`);
    } catch (error) {
        setFlash(req, 'error', error.message || 'The merchant response could not be saved.');
    }

    return res.redirect('/help-center');
}

async function adminResolve(req, res) {
    try {
        const request = await findSupportRequest(req.params.requestId);

        if (!request) {
            throw new Error('Support request not found.');
        }

        const decision = req.body.decision === 'approved' ? 'approved' : 'rejected';

        if (decision === 'approved' && request.merchantUserId && request.requestType !== 'booking_change') {
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

        const result = await adminResolveRequest(
            request.id,
            req.session.user.id,
            decision,
            cleanText(req.body.adminNote)
        );

        if (!result.affectedRows) {
            throw new Error('This request is already closed or cannot be updated.');
        }

        if (decision === 'approved') {
            if (request.requestType === 'order_refund') {
                const transactionId = parseOrderTransactionId(request.targetId);

                if (transactionId) {
                    await updateDeliveryStatus(transactionId, 'cancelled', {});
                    await recordTransactionRefund(transactionId, request.refundAmount);

                    if (request.receiptId) {
                        await updateHistoryDeliveryStatus(request.receiptId, 'cancelled');
                        await recordHistoryRefund(request.receiptId, request.refundAmount);
                    }
                } else {
                    await updateHistoryDeliveryStatus(request.receiptId || request.targetId, 'cancelled');
                    await recordHistoryRefund(request.receiptId || request.targetId, request.refundAmount);
                }
            } else if (request.targetType === 'booking' && request.requestType !== 'booking_change') {
                await markBookingCancelled(request.targetId);
                await sendCancellationForBooking(request.targetId, request.reason || request.customerNote || '').catch((error) => {
                    console.error('WhatsApp cancellation notification failed:', error.message);
                });
            }
        }

        const label = requestLabels[request.requestType] || 'Support request';
        const moneyMessage = decision === 'approved' && request.refundAmount > 0
            ? ` Refund recorded: $${request.refundAmount.toFixed(2)}.`
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

        if (order) {
            notifyCustomer(order.userId, {
                actorUserId: req.session.user.id,
                type: 'order_update',
                title: 'Order delivery updated',
                message: `Order ${order.receiptId} is now ${status}.`,
                linkUrl: '/help-center',
                dedupeKey: `order-delivery-${order.id}-${status}-${Date.now()}`
            });
        }

        setFlash(req, 'success', `Order #${req.params.transactionId} was updated to ${status}.`);
    } catch (error) {
        setFlash(req, 'error', error.message || 'The order delivery status could not be updated.');
    }

    return res.redirect('/help-center');
}

module.exports = {
    adminResolve,
    adminSendToMerchant,
    createRequest,
    merchantRespond,
    showHelpCenter,
    updateOrderDeliveryStatus
};
