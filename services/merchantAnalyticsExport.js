const ExcelJS = require('exceljs');
const db = require('../db');
const { buildBookingReference } = require('../utils/bookingReference');
const {
    formatPaymentMethod,
    normalizePaymentMethod,
    normalizePaymentProvider
} = require('../utils/paymentDisplay');
const { ensureRewardAdjustmentSchema } = require('./refundRewardAdjustments');
const { summarizeRefundRow } = require('./refundSummary');

const TIME_ZONE = 'Asia/Singapore';
const CURRENCY = 'SGD';
const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;
const FORMULA_PREFIX = /^[=+\-@]/;
const DATE_FORMATTER = new Intl.DateTimeFormat('en-SG', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-SG', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
});

const DATASETS = [
    { id: 'salesRevenue', label: 'Sales or Revenue', worksheetName: 'Sales Revenue' },
    { id: 'bookings', label: 'Bookings', worksheetName: 'Bookings' },
    { id: 'productOrders', label: 'Product Orders', worksheetName: 'Product Orders' },
    { id: 'refunds', label: 'Refunds', worksheetName: 'Refunds' },
    { id: 'customers', label: 'Customers', worksheetName: 'Customers' },
    { id: 'servicePerformance', label: 'Service Performance', worksheetName: 'Service Performance' },
    { id: 'productPerformance', label: 'Product Performance', worksheetName: 'Product Performance' },
    { id: 'payments', label: 'Payments', worksheetName: 'Payments' }
];

const DATASET_MAP = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));

function query(sql, params = []) {
    return db.promise().query(sql, params).then(([rows]) => rows || []);
}

function roundMoney(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100) / 100;
}

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
    const date = toDate(value);
    return date ? DATE_FORMATTER.format(date) : '';
}

function formatDateTime(value) {
    const date = toDate(value);
    return date ? DATE_TIME_FORMATTER.format(date).replace(',', '') : '';
}

function normalizeDateInput(value, fieldName) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
    }
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (
        Number.isNaN(date.getTime())
        || date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        throw new Error(`${fieldName} is not a valid date.`);
    }
    return text;
}

function parseFilters(body = {}) {
    const startDate = normalizeDateInput(body.startDate, 'Start date');
    const endDate = normalizeDateInput(body.endDate, 'End date');
    const rawPaymentMethod = String(body.paymentMethod || '').trim();
    if (startDate && endDate && startDate > endDate) {
        throw new Error('Start date cannot be after end date.');
    }

    return {
        startDate,
        endDate,
        status: String(body.status || '').trim().toLowerCase(),
        paymentMethod: rawPaymentMethod ? normalizePaymentMethod(rawPaymentMethod) : '',
        serviceId: String(body.serviceId || '').trim(),
        productId: String(body.productId || '').trim(),
        search: String(body.search || '').trim()
    };
}

function parseDatasets(body = {}) {
    const raw = Array.isArray(body.datasets)
        ? body.datasets
        : String(body.datasets || '').split(',');
    const wantsAll = raw.some((item) => String(item || '').trim() === 'all');
    const selected = wantsAll ? DATASETS.map((dataset) => dataset.id) : raw.map((item) => String(item || '').trim()).filter(Boolean);
    const unique = Array.from(new Set(selected));

    if (!unique.length) {
        throw new Error('Select at least one dataset to export.');
    }

    const invalid = unique.filter((datasetId) => !DATASET_MAP.has(datasetId));
    if (invalid.length) {
        throw new Error(`Unknown dataset selected: ${invalid.join(', ')}.`);
    }

    return unique;
}

function addDateClauses(clauses, params, expression, filters) {
    if (filters.startDate) {
        clauses.push(`${expression} >= ?`);
        params.push(filters.startDate);
    }
    if (filters.endDate) {
        clauses.push(`${expression} < DATE_ADD(?, INTERVAL 1 DAY)`);
        params.push(filters.endDate);
    }
}

function addCommonClauses(clauses, params, aliases, filters) {
    if (filters.status && aliases.status) {
        clauses.push(`${aliases.status} = ?`);
        params.push(filters.status);
    }
    if (filters.paymentMethod && aliases.paymentMethod) {
        clauses.push(`${aliases.paymentMethod} = ?`);
        params.push(filters.paymentMethod);
    }
    if (filters.serviceId && aliases.serviceId) {
        clauses.push(`${aliases.serviceId} = ?`);
        params.push(filters.serviceId);
    }
    if (filters.productId && aliases.productId) {
        clauses.push(`${aliases.productId} = ?`);
        params.push(filters.productId);
    }
    if (filters.search && aliases.search?.length) {
        clauses.push(`(${aliases.search.map((field) => `${field} LIKE ?`).join(' OR ')})`);
        aliases.search.forEach(() => params.push(`%${filters.search}%`));
    }
}

function getShare(part, total) {
    const numericTotal = Number(total || 0);
    if (!numericTotal) return 0;
    return Number(part || 0) / numericTotal;
}

function allocateMoney(total, share) {
    return roundMoney(Number(total || 0) * Number(share || 0));
}

function getDisplayReference(prefix, id) {
    return id ? `${prefix}-${String(id).padStart(6, '0')}` : '';
}

function getTransactionReference(row = {}) {
    return row.provider_transaction_id
        || row.provider_capture_id
        || row.provider_payment_id
        || row.provider_session_id
        || (row.transaction_id ? `TXN-${row.transaction_id}` : '');
}

function getBookingRows(merchantUserId, filters) {
    const clauses = ['s.merchant_id = ?'];
    const params = [merchantUserId];
    addDateClauses(clauses, params, 'b.booking_date', filters);
    addCommonClauses(clauses, params, {
        status: 'LOWER(b.status)',
        paymentMethod: 't.payment_method',
        serviceId: 'svc.service_id',
        search: [
            'COALESCE(u.name, b.guest_customer_name)',
            'COALESCE(u.email, b.guest_email)',
            'svc.service_name',
            'CAST(b.booking_id AS CHAR)',
            'CAST(b.transaction_id AS CHAR)'
        ]
    }, filters);

    return query(`
        SELECT
            b.booking_id,
            b.user_id,
            b.transaction_id,
            b.booking_date,
            TIME_FORMAT(b.timeslot, '%H:%i') AS start_time,
            TIME_FORMAT(ADDTIME(b.timeslot, SEC_TO_TIME(COALESCE(svc.duration_mins, 0) * 60)), '%H:%i') AS end_time,
            b.status AS booking_status,
            b.payment_status AS booking_payment_status,
            b.refund_status AS booking_refund_status,
            b.checked_in_at,
            NULL AS booking_created_at,
            COALESCE(u.name, b.guest_customer_name, 'Customer') AS customer_name,
            COALESCE(u.email, b.guest_email, '') AS customer_email,
            svc.service_id,
            svc.service_name,
            svc.duration_mins,
            svc.price AS service_price,
            s.salon_name AS merchant_name,
            s.commission_rate,
            t.transaction_id AS payment_transaction_id,
            t.total_amount,
            t.gross_amount,
            t.discount_amount,
            t.voucher_discount_amount,
            t.wallet_amount_used,
            t.cashback_amount_used,
            t.refunded_amount,
            t.paid_amount,
            t.payment_method,
            t.payment_provider,
            t.payment_status,
            t.payment_date,
            t.created_at AS transaction_created_at,
            t.provider_payment_id,
            t.provider_session_id,
            t.provider_capture_id,
            t.provider_transaction_id,
            t.refund_status AS transaction_refund_status
        FROM bookings b
        INNER JOIN services svc ON svc.service_id = b.service_id
        INNER JOIN salons s ON s.salon_id = svc.salon_id
        LEFT JOIN users u ON u.user_id = b.user_id
        LEFT JOIN transactions t ON t.transaction_id = b.transaction_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY b.booking_date DESC, b.timeslot DESC, b.booking_id DESC
    `, params);
}

function getProductOrderRows(merchantUserId, filters) {
    const clauses = ['s.merchant_id = ?'];
    const params = [merchantUserId];
    addDateClauses(clauses, params, 't.created_at', filters);
    addCommonClauses(clauses, params, {
        status: 'LOWER(COALESCE(t.delivery_status, t.payment_status))',
        paymentMethod: 't.payment_method',
        productId: 'p.product_id',
        search: [
            'u.name',
            'p.name',
            'o.order_number',
            'CAST(t.transaction_id AS CHAR)'
        ]
    }, filters);

    return query(`
        SELECT
            t.transaction_id,
            t.user_id,
            t.total_amount,
            t.payment_method,
            t.payment_provider,
            t.payment_status,
            t.delivery_status,
            t.fulfilment_type,
            t.pickup_status,
            t.refund_status,
            t.refunded_amount,
            t.gross_amount,
            t.discount_amount,
            t.voucher_discount_amount,
            t.wallet_amount_used,
            t.cashback_amount_used,
            t.paid_amount,
            t.payment_date,
            t.created_at,
            t.provider_payment_id,
            t.provider_session_id,
            t.provider_capture_id,
            t.provider_transaction_id,
            o.order_id,
            o.order_number,
            u.name AS customer_name,
            p.product_id,
            p.name AS product_name,
            oi.order_item_id,
            oi.quantity,
            oi.price_at_purchase,
            s.salon_name AS merchant_name,
            s.address AS pickup_location,
            s.commission_rate,
            merchant_totals.merchant_total
        FROM transactions t
        INNER JOIN order_items oi ON oi.transaction_id = t.transaction_id
        INNER JOIN products p ON p.product_id = oi.product_id
        INNER JOIN salons s ON s.salon_id = p.salon_id
        INNER JOIN users u ON u.user_id = t.user_id
        LEFT JOIN orders o ON o.transaction_id = t.transaction_id
        INNER JOIN (
            SELECT oi2.transaction_id, SUM(oi2.quantity * oi2.price_at_purchase) AS merchant_total
            FROM order_items oi2
            INNER JOIN products p2 ON p2.product_id = oi2.product_id
            INNER JOIN salons s2 ON s2.salon_id = p2.salon_id
            WHERE s2.merchant_id = ?
            GROUP BY oi2.transaction_id
        ) merchant_totals ON merchant_totals.transaction_id = t.transaction_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.created_at DESC, t.transaction_id DESC, oi.order_item_id ASC
    `, [merchantUserId, ...params]);
}

function getRefundRows(merchantUserId, filters) {
    const clauses = [
        'sr.merchant_user_id = ?',
        "sr.request_type IN ('order_refund', 'booking_refund')"
    ];
    const params = [merchantUserId];
    addDateClauses(clauses, params, 'sr.created_at', filters);
    addCommonClauses(clauses, params, {
        status: 'LOWER(sr.status)',
        paymentMethod: 'sr.payment_method',
        search: [
            'customers.name',
            'sr.target_label',
            'sr.receipt_id',
            'CAST(sr.request_id AS CHAR)',
            'CAST(sr.target_id AS CHAR)'
        ]
    }, filters);

    return query(`
        SELECT
            sr.request_id,
            sr.request_type,
            sr.target_type,
            sr.target_id,
            sr.receipt_id,
            sr.target_label,
            sr.reason,
            sr.status,
            sr.merchant_decision,
            sr.merchant_decision_reason,
            sr.refund_amount,
            sr.approved_refund_amount,
            sr.approved_refund_percentage,
            sr.refund_base_amount,
            sr.gross_refund_amount,
            sr.processing_fee_deduction,
            sr.other_deduction_amount,
            sr.net_refund_amount,
            sr.original_processing_fee_amount,
            sr.processing_fee_source,
            sr.refund_reason_category,
            sr.refund_responsibility,
            sr.created_at,
            sr.reviewed_at,
            sr.refunded_at,
            pr.refund_id,
            pr.refund_reference,
            pr.refund_status AS provider_refund_status,
            pr.provider_refund_id,
            pr.customer_requested_amount,
            pr.gross_refund_amount AS provider_gross_refund_amount,
            pr.processing_fee_deduction AS provider_processing_fee_deduction,
            pr.other_deduction_amount AS provider_other_deduction_amount,
            pr.net_refund_amount AS provider_net_refund_amount,
            pr.external_refund_amount,
            pr.wallet_restored_amount,
            pr.points_restored,
            pr.points_reversed,
            pr.cashback_restored_amount,
            pr.cashback_reversed_amount,
            pr.membership_progress_adjustment,
            pr.reward_adjustment_status,
            customers.name AS customer_name,
            pt.transaction_id,
            pt.payment_method,
            pt.payment_provider,
            pt.total_amount,
            pt.gross_amount,
            pt.paid_amount,
            pt.refunded_amount AS transaction_refunded_amount,
            pt.provider_payment_id,
            pt.provider_session_id,
            pt.provider_capture_id,
            pt.provider_transaction_id,
            o.order_number,
            b.booking_id,
            b.booking_date
        FROM support_requests sr
        INNER JOIN users customers ON customers.user_id = sr.customer_user_id
        LEFT JOIN transactions pt ON pt.transaction_id = sr.payment_transaction_id
        LEFT JOIN payment_refunds pr ON pr.refund_request_id = sr.request_id
            AND pr.refund_status IN ('succeeded', 'refunded')
        LEFT JOIN orders o ON o.transaction_id = pt.transaction_id
        LEFT JOIN bookings b ON b.booking_id = sr.target_id AND sr.target_type = 'booking'
        WHERE ${clauses.join(' AND ')}
        ORDER BY sr.created_at DESC, sr.request_id DESC
    `, params);
}

function normalizeBooking(row = {}) {
    const gross = roundMoney(row.gross_amount || row.total_amount || row.service_price || 0);
    const discount = roundMoney(row.discount_amount || 0);
    const voucher = roundMoney(row.voucher_discount_amount || 0);
    const walletCashback = roundMoney(Number(row.wallet_amount_used || 0) + Number(row.cashback_amount_used || 0));
    const refund = roundMoney(row.refunded_amount || 0);
    const platformFee = allocateMoney(gross, Number(row.commission_rate || 0) / 100);
    const net = roundMoney(gross - discount - refund - platformFee);
    const bookingReference = buildBookingReference(row.booking_id, row.booking_date);

    return {
        ...row,
        bookingReference,
        transactionReference: getTransactionReference(row),
        customerName: row.customer_name || 'Customer',
        itemName: row.service_name || 'Service',
        quantity: 1,
        unitPrice: roundMoney(row.service_price || gross),
        grossAmount: gross,
        discountAmount: discount,
        voucherAmount: voucher,
        walletCashbackAmount: walletCashback,
        refundAmount: refund,
        platformFee,
        paymentProcessingFee: '',
        netMerchantRevenue: net,
        paymentMethodLabel: formatPaymentMethod(row.payment_method, row.payment_provider),
        paymentStatus: row.payment_status || row.booking_payment_status || 'pending',
        orderBookingStatus: row.booking_status || '',
        fulfilmentType: 'booking',
        createdDate: formatDateTime(row.transaction_created_at || row.booking_created_at),
        bookingDate: formatDate(row.booking_date),
        startTime: row.start_time || '',
        endTime: row.end_time || '',
        checkInStatus: row.checked_in_at ? 'checked in' : 'not checked in',
        cancellationRefundStatus: row.transaction_refund_status || row.booking_refund_status || ''
    };
}

function normalizeProduct(row = {}) {
    const quantity = Number(row.quantity || 0);
    const unitPrice = roundMoney(row.price_at_purchase || 0);
    const lineGross = roundMoney(quantity * unitPrice);
    const share = getShare(lineGross, row.merchant_total || lineGross);
    const discount = allocateMoney(row.discount_amount, share);
    const voucher = allocateMoney(row.voucher_discount_amount, share);
    const walletCashback = allocateMoney(Number(row.wallet_amount_used || 0) + Number(row.cashback_amount_used || 0), share);
    const refund = allocateMoney(row.refunded_amount, share);
    const platformFee = allocateMoney(lineGross, Number(row.commission_rate || 0) / 100);
    const net = roundMoney(lineGross - discount - refund - platformFee);

    return {
        ...row,
        orderReference: row.order_number || getDisplayReference('ORD', row.order_id || row.transaction_id),
        transactionReference: getTransactionReference(row),
        customerName: row.customer_name || 'Customer',
        productName: row.product_name || 'Product',
        variant: '',
        quantity,
        unitPrice,
        grossAmount: lineGross,
        discountAmount: discount,
        voucherAmount: voucher,
        walletCashbackAmount: walletCashback,
        refundAmount: refund,
        platformFee,
        paymentProcessingFee: '',
        netMerchantRevenue: net,
        fulfilmentType: row.fulfilment_type || 'pickup',
        deliveryPickupLocation: row.pickup_location || '',
        paymentMethodLabel: formatPaymentMethod(row.payment_method, row.payment_provider),
        paymentStatus: row.payment_status || '',
        orderStatus: row.delivery_status || row.pickup_status || '',
        refundStatus: row.refund_status || '',
        orderDate: formatDateTime(row.created_at)
    };
}

function normalizeRefund(row = {}) {
    const isBooking = row.target_type === 'booking';
    const summary = summarizeRefundRow({
        ...row,
        refund_status: row.provider_refund_status || row.status,
        refund_reference: row.refund_reference,
        gross_refund_amount: row.provider_gross_refund_amount || row.gross_refund_amount,
        customer_requested_amount: row.customer_requested_amount || row.refund_amount,
        processing_fee_deduction: row.provider_processing_fee_deduction ?? row.processing_fee_deduction,
        other_deduction_amount: row.provider_other_deduction_amount ?? row.other_deduction_amount,
        net_refund_amount: row.provider_net_refund_amount || row.net_refund_amount,
        paid_amount: row.paid_amount,
        total_amount: row.total_amount,
        support_status: row.status
    });
    return {
        refundReference: summary.refundReference || getDisplayReference('REF', row.request_id),
        orderBookingReference: row.order_number
            || (isBooking ? buildBookingReference(row.booking_id || row.target_id, row.booking_date) : row.receipt_id || row.target_id),
        customerName: row.customer_name || 'Customer',
        itemOrService: row.target_label || '',
        originalPaymentMethod: formatPaymentMethod(row.payment_method, row.payment_provider),
        paymentProvider: normalizePaymentProvider(row.payment_provider, row.payment_method),
        originalAmount: summary.originalAmountPaid || roundMoney(row.paid_amount || row.gross_amount || row.total_amount || 0),
        customerRequestedAmount: summary.customerRequestedAmount,
        approvedRefundPercentage: summary.approvedPercentage,
        refundBaseAmount: roundMoney(row.refund_base_amount || row.refund_amount || 0),
        originalProcessingFee: summary.originalProcessingFee || roundMoney(row.original_processing_fee_amount || 0),
        processingFeeSource: row.processing_fee_source || 'unknown',
        grossRefundAmount: summary.approvedGrossRefund,
        customerProcessingFeeDeduction: summary.processingFeeDeduction,
        otherDeductionAmount: roundMoney(row.provider_other_deduction_amount ?? row.other_deduction_amount ?? 0),
        netCustomerRefund: roundMoney(row.provider_net_refund_amount || row.net_refund_amount || row.approved_refund_amount || row.refund_amount || 0),
        externalRefundAmount: summary.netExternalRefund,
        walletRestoredAmount: summary.walletRestored,
        pointsRestored: summary.pointsRestored,
        pointsReversed: summary.pointsReversed,
        cashbackRestoredAmount: summary.cashbackRestored,
        cashbackReversedAmount: summary.cashbackReversed,
        membershipProgressAdjustment: '',
        rewardAdjustmentStatus: row.reward_adjustment_status || '',
        cumulativeGrossRefunded: roundMoney(row.transaction_refunded_amount || 0),
        remainingRefundableAmount: Math.max(roundMoney(row.paid_amount || row.total_amount || 0) - roundMoney(row.transaction_refunded_amount || 0), 0),
        merchantProcessingFeeLoss: summary.merchantProcessingFeeLoss,
        refundResponsibility: row.refund_responsibility || '',
        refundReason: row.refund_reason_category || row.reason || '',
        refundRequestDate: formatDateTime(row.created_at),
        merchantDecision: row.merchant_decision || '',
        merchantDecisionReason: row.merchant_decision_reason || '',
        refundStatus: summary.refundStatus || row.status || '',
        approvedDate: formatDateTime(row.reviewed_at),
        refundCompletionDate: formatDateTime(summary.completedAt || row.refunded_at),
        transactionReference: getTransactionReference(row)
    };
}

function buildCustomerDataset(bookings, products, refunds) {
    const map = new Map();
    const ensure = (key, name) => {
        const safeKey = key || name || 'Customer';
        if (!map.has(safeKey)) {
            map.set(safeKey, {
                customerName: name || 'Customer',
                numberOfOrders: 0,
                numberOfBookings: 0,
                totalSpend: 0,
                totalRefunds: 0,
                netSpend: 0,
                lastPurchaseOrBookingDate: '',
                customerTypeOrLoyaltyTier: ''
            });
        }
        return map.get(safeKey);
    };

    bookings.forEach((booking) => {
        const customer = ensure(booking.email || booking.customerName, booking.customerName);
        customer.numberOfBookings += 1;
        customer.totalSpend = roundMoney(customer.totalSpend + booking.grossAmount - booking.discountAmount);
        customer.totalRefunds = roundMoney(customer.totalRefunds + booking.refundAmount);
        if (!customer.lastPurchaseOrBookingDate || booking.bookingDate > customer.lastPurchaseOrBookingDate) {
            customer.lastPurchaseOrBookingDate = booking.bookingDate;
        }
    });

    const orderIds = new Set();
    products.forEach((product) => {
        const customer = ensure(product.user_id || product.customerName, product.customerName);
        if (!orderIds.has(`${product.transaction_id}:${product.user_id}`)) {
            customer.numberOfOrders += 1;
            orderIds.add(`${product.transaction_id}:${product.user_id}`);
        }
        customer.totalSpend = roundMoney(customer.totalSpend + product.grossAmount - product.discountAmount);
        customer.totalRefunds = roundMoney(customer.totalRefunds + product.refundAmount);
        if (!customer.lastPurchaseOrBookingDate || product.orderDate > customer.lastPurchaseOrBookingDate) {
            customer.lastPurchaseOrBookingDate = product.orderDate;
        }
    });

    refunds.forEach((refund) => {
        const customer = ensure(refund.customerName, refund.customerName);
        customer.totalRefunds = Math.max(customer.totalRefunds, roundMoney(customer.totalRefunds));
    });

    return Array.from(map.values()).map((customer) => ({
        ...customer,
        netSpend: roundMoney(customer.totalSpend - customer.totalRefunds)
    })).sort((left, right) => right.netSpend - left.netSpend);
}

function aggregateBy(rows, keyFn, seedFn, updateFn) {
    const map = new Map();
    rows.forEach((row) => {
        const key = keyFn(row);
        if (!map.has(key)) map.set(key, seedFn(row));
        updateFn(map.get(key), row);
    });
    return Array.from(map.values());
}

function buildServicePerformance(bookings) {
    return aggregateBy(
        bookings,
        (booking) => booking.itemName,
        (booking) => ({
            serviceName: booking.itemName,
            numberOfBookings: 0,
            completedBookings: 0,
            cancelledBookings: 0,
            noShows: 0,
            grossRevenue: 0,
            refundAmount: 0,
            netRevenue: 0,
            averageBookingValue: 0
        }),
        (item, booking) => {
            item.numberOfBookings += 1;
            if (booking.orderBookingStatus === 'completed') item.completedBookings += 1;
            if (booking.orderBookingStatus === 'cancelled') item.cancelledBookings += 1;
            if (booking.orderBookingStatus === 'no_show') item.noShows += 1;
            item.grossRevenue = roundMoney(item.grossRevenue + booking.grossAmount);
            item.refundAmount = roundMoney(item.refundAmount + booking.refundAmount);
            item.netRevenue = roundMoney(item.netRevenue + booking.netMerchantRevenue);
            item.averageBookingValue = roundMoney(item.grossRevenue / item.numberOfBookings);
        }
    );
}

function buildProductPerformance(products) {
    const seenOrders = new Map();
    return aggregateBy(
        products,
        (product) => product.productName,
        (product) => ({
            productName: product.productName,
            unitsSold: 0,
            numberOfOrders: 0,
            grossRevenue: 0,
            discountAmount: 0,
            refundAmount: 0,
            netRevenue: 0
        }),
        (item, product) => {
            item.unitsSold += product.quantity;
            const orderKey = `${product.productName}:${product.transaction_id}`;
            if (!seenOrders.has(orderKey)) {
                item.numberOfOrders += 1;
                seenOrders.set(orderKey, true);
            }
            item.grossRevenue = roundMoney(item.grossRevenue + product.grossAmount);
            item.discountAmount = roundMoney(item.discountAmount + product.discountAmount);
            item.refundAmount = roundMoney(item.refundAmount + product.refundAmount);
            item.netRevenue = roundMoney(item.netRevenue + product.netMerchantRevenue);
        }
    );
}

function buildPayments(bookings, products) {
    const map = new Map();
    bookings.forEach((booking) => {
        if (!booking.payment_transaction_id) return;
        map.set(`booking:${booking.payment_transaction_id}`, {
            transactionReference: booking.transactionReference,
            orderBookingReference: booking.bookingReference,
            customerName: booking.customerName,
            amount: booking.grossAmount,
            paymentMethod: booking.paymentMethodLabel,
            paymentProvider: normalizePaymentProvider(booking.payment_provider, booking.payment_method),
            paymentStatus: booking.paymentStatus,
            transactionDate: booking.createdDate,
            refundStatus: booking.cancellationRefundStatus
        });
    });
    products.forEach((product) => {
        const key = `product:${product.transaction_id}`;
        const current = map.get(key) || {
            transactionReference: product.transactionReference,
            orderBookingReference: product.orderReference,
            customerName: product.customerName,
            amount: 0,
            paymentMethod: product.paymentMethodLabel,
            paymentProvider: normalizePaymentProvider(product.payment_provider, product.payment_method),
            paymentStatus: product.paymentStatus,
            transactionDate: product.orderDate,
            refundStatus: product.refundStatus
        };
        current.amount = roundMoney(current.amount + product.grossAmount);
        map.set(key, current);
    });
    return Array.from(map.values());
}

function buildSalesRevenue(bookings, products) {
    return [
        ...bookings.map((booking) => ({
            date: booking.bookingDate,
            orderOrBookingReference: booking.bookingReference,
            transactionReference: booking.transactionReference,
            customerName: booking.customerName,
            itemOrServiceName: booking.itemName,
            quantity: booking.quantity,
            unitPrice: booking.unitPrice,
            grossAmount: booking.grossAmount,
            discountAmount: booking.discountAmount,
            voucherAmount: booking.voucherAmount,
            cashbackOrWalletAmountUsed: booking.walletCashbackAmount,
            refundAmount: booking.refundAmount,
            platformFee: booking.platformFee,
            paymentProcessingFee: booking.paymentProcessingFee,
            netMerchantRevenue: booking.netMerchantRevenue,
            paymentMethod: booking.paymentMethodLabel,
            paymentStatus: booking.paymentStatus,
            orderOrBookingStatus: booking.orderBookingStatus,
            fulfilmentType: booking.fulfilmentType,
            createdDate: booking.createdDate
        })),
        ...products.map((product) => ({
            date: product.orderDate,
            orderOrBookingReference: product.orderReference,
            transactionReference: product.transactionReference,
            customerName: product.customerName,
            itemOrServiceName: product.productName,
            quantity: product.quantity,
            unitPrice: product.unitPrice,
            grossAmount: product.grossAmount,
            discountAmount: product.discountAmount,
            voucherAmount: product.voucherAmount,
            cashbackOrWalletAmountUsed: product.walletCashbackAmount,
            refundAmount: product.refundAmount,
            platformFee: product.platformFee,
            paymentProcessingFee: product.paymentProcessingFee,
            netMerchantRevenue: product.netMerchantRevenue,
            paymentMethod: product.paymentMethodLabel,
            paymentStatus: product.paymentStatus,
            orderOrBookingStatus: product.orderStatus,
            fulfilmentType: product.fulfilmentType,
            createdDate: product.orderDate
        }))
    ];
}

const COLUMNS = {
    salesRevenue: [
        ['date', 'Date', 'date'],
        ['orderOrBookingReference', 'Order or Booking Reference'],
        ['transactionReference', 'Transaction Reference'],
        ['customerName', 'Customer Name'],
        ['itemOrServiceName', 'Item or Service Name'],
        ['quantity', 'Quantity', 'number'],
        ['unitPrice', 'Unit Price', 'currency'],
        ['grossAmount', 'Gross Amount', 'currency'],
        ['discountAmount', 'Discount Amount', 'currency'],
        ['voucherAmount', 'Voucher Amount', 'currency'],
        ['cashbackOrWalletAmountUsed', 'Cashback or Wallet Amount Used', 'currency'],
        ['refundAmount', 'Refund Amount', 'currency'],
        ['platformFee', 'Platform Fee', 'currency'],
        ['paymentProcessingFee', 'Payment Processing Fee', 'currency'],
        ['netMerchantRevenue', 'Net Merchant Revenue', 'currency'],
        ['paymentMethod', 'Payment Method'],
        ['paymentStatus', 'Payment Status'],
        ['orderOrBookingStatus', 'Order or Booking Status'],
        ['fulfilmentType', 'Fulfilment Type'],
        ['createdDate', 'Created Date', 'datetime']
    ],
    bookings: [
        ['bookingReference', 'Booking Reference'],
        ['customerName', 'Customer Name'],
        ['itemName', 'Service Name'],
        ['staffName', 'Staff Name'],
        ['bookingDate', 'Booking Date', 'date'],
        ['startTime', 'Start Time'],
        ['endTime', 'End Time'],
        ['unitPrice', 'Original Price', 'currency'],
        ['discountAmount', 'Discount', 'currency'],
        ['grossAmount', 'Final Amount', 'currency'],
        ['paymentMethodLabel', 'Payment Method'],
        ['paymentStatus', 'Payment Status'],
        ['orderBookingStatus', 'Booking Status'],
        ['checkInStatus', 'Check-in Status'],
        ['createdDate', 'Created Date', 'datetime'],
        ['cancellationRefundStatus', 'Cancellation or Refund Status']
    ],
    productOrders: [
        ['orderReference', 'Order Reference'],
        ['customerName', 'Customer Name'],
        ['productName', 'Product Name'],
        ['variant', 'Variant'],
        ['quantity', 'Quantity', 'number'],
        ['unitPrice', 'Unit Price', 'currency'],
        ['discountAmount', 'Discount', 'currency'],
        ['grossAmount', 'Final Amount', 'currency'],
        ['fulfilmentType', 'Fulfilment Type'],
        ['deliveryPickupLocation', 'Delivery or Pickup Location'],
        ['paymentMethodLabel', 'Payment Method'],
        ['paymentStatus', 'Payment Status'],
        ['orderStatus', 'Order Status'],
        ['refundStatus', 'Refund Status'],
        ['orderDate', 'Order Date', 'datetime']
    ],
    refunds: [
        ['refundReference', 'Refund Reference'],
        ['orderBookingReference', 'Order or Booking Reference'],
        ['originalPaymentMethod', 'Original Payment Method'],
        ['paymentProvider', 'Payment Provider'],
        ['originalAmount', 'Original Amount', 'currency'],
        ['customerRequestedAmount', 'Customer Requested Amount', 'currency'],
        ['approvedRefundPercentage', 'Approved Percentage', 'number'],
        ['refundBaseAmount', 'Refund Base', 'currency'],
        ['originalProcessingFee', 'Original Processing Fee', 'currency'],
        ['processingFeeSource', 'Processing Fee Source'],
        ['grossRefundAmount', 'Gross Refund Amount', 'currency'],
        ['customerProcessingFeeDeduction', 'Refund Administration Fee', 'currency'],
        ['otherDeductionAmount', 'Other Deduction', 'currency'],
        ['netCustomerRefund', 'Net Customer Refund', 'currency'],
        ['externalRefundAmount', 'External Cash Refund', 'currency'],
        ['walletRestoredAmount', 'Wallet Restored', 'currency'],
        ['pointsRestored', 'Points Restored', 'number'],
        ['pointsReversed', 'Points Reversed', 'number'],
        ['cashbackRestoredAmount', 'Cashback Restored', 'currency'],
        ['cashbackReversedAmount', 'Cashback Reversed', 'currency'],
        ['membershipProgressAdjustment', 'Membership Progress Adjustment Applied'],
        ['rewardAdjustmentStatus', 'Reward Adjustment Status'],
        ['cumulativeGrossRefunded', 'Cumulative Gross Refunded', 'currency'],
        ['remainingRefundableAmount', 'Remaining Refundable Amount', 'currency'],
        ['merchantProcessingFeeLoss', 'Merchant Processing-Fee Loss', 'currency'],
        ['merchantDecision', 'Merchant Decision'],
        ['merchantDecisionReason', 'Decision Reason'],
        ['refundResponsibility', 'Refund Responsibility'],
        ['refundReason', 'Refund Reason'],
        ['refundStatus', 'Refund Status'],
        ['refundRequestDate', 'Requested Date', 'datetime'],
        ['approvedDate', 'Approved Date', 'datetime'],
        ['refundCompletionDate', 'Completed Date', 'datetime']
    ],
    customers: [
        ['customerName', 'Customer Name'],
        ['numberOfOrders', 'Number of Orders', 'number'],
        ['numberOfBookings', 'Number of Bookings', 'number'],
        ['totalSpend', 'Total Spend', 'currency'],
        ['totalRefunds', 'Total Refunds', 'currency'],
        ['netSpend', 'Net Spend', 'currency'],
        ['lastPurchaseOrBookingDate', 'Last Purchase or Booking Date', 'datetime'],
        ['customerTypeOrLoyaltyTier', 'Customer Type or Loyalty Tier']
    ],
    servicePerformance: [
        ['serviceName', 'Service Name'],
        ['numberOfBookings', 'Number of Bookings', 'number'],
        ['completedBookings', 'Completed Bookings', 'number'],
        ['cancelledBookings', 'Cancelled Bookings', 'number'],
        ['noShows', 'No-shows', 'number'],
        ['grossRevenue', 'Gross Revenue', 'currency'],
        ['refundAmount', 'Refund Amount', 'currency'],
        ['netRevenue', 'Net Revenue', 'currency'],
        ['averageBookingValue', 'Average Booking Value', 'currency']
    ],
    productPerformance: [
        ['productName', 'Product Name'],
        ['unitsSold', 'Units Sold', 'number'],
        ['numberOfOrders', 'Number of Orders', 'number'],
        ['grossRevenue', 'Gross Revenue', 'currency'],
        ['discountAmount', 'Discount Amount', 'currency'],
        ['refundAmount', 'Refund Amount', 'currency'],
        ['netRevenue', 'Net Revenue', 'currency']
    ],
    payments: [
        ['transactionReference', 'Transaction Reference'],
        ['orderBookingReference', 'Order or Booking Reference'],
        ['customerName', 'Customer Name'],
        ['amount', 'Amount', 'currency'],
        ['paymentMethod', 'Payment Method'],
        ['paymentProvider', 'Payment Provider'],
        ['paymentStatus', 'Payment Status'],
        ['transactionDate', 'Transaction Date', 'datetime'],
        ['refundStatus', 'Refund Status']
    ]
};

function safeSheetName(name, usedNames) {
    const base = String(name || 'Dataset').replace(INVALID_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Dataset';
    let candidate = base;
    let index = 2;
    while (usedNames.has(candidate)) {
        const suffix = ` ${index}`;
        candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
        index += 1;
    }
    usedNames.add(candidate);
    return candidate;
}

function safeFilenamePart(value) {
    return String(value || 'merchant')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'merchant';
}

function safeCellValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value instanceof Date) return value;
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function addWorksheet(workbook, usedNames, datasetId, rows) {
    const dataset = DATASET_MAP.get(datasetId);
    const columns = COLUMNS[datasetId];
    const sheet = workbook.addWorksheet(safeSheetName(dataset.worksheetName, usedNames));
    sheet.columns = columns.map(([key, header]) => ({
        key,
        header,
        width: Math.min(Math.max(header.length + 4, 14), 34)
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length }
    };

    rows.forEach((row) => {
        const values = {};
        columns.forEach(([key]) => {
            values[key] = safeCellValue(row[key]);
        });
        sheet.addRow(values);
    });

    if (!rows.length) {
        const emptyRow = sheet.addRow({ [columns[0][0]]: 'No records found for the selected filters' });
        emptyRow.font = { italic: true, color: { argb: 'FF666666' } };
    }

    columns.forEach(([key, header, type], index) => {
        const column = sheet.getColumn(index + 1);
        if (type === 'currency') {
            column.numFmt = '$#,##0.00;[Red]-$#,##0.00';
        } else if (type === 'number') {
            column.numFmt = '0';
        }
        const maxLength = Math.min(Math.max(
            header.length,
            ...rows.slice(0, 100).map((row) => String(row[key] ?? '').length)
        ) + 2, 42);
        column.width = Math.max(column.width || 12, maxLength);
    });
}

function calculateSummaryTotals(rowsByDataset) {
    const salesRows = rowsByDataset.salesRevenue || [];
    return salesRows.reduce((totals, row) => ({
        grossRevenue: roundMoney(totals.grossRevenue + Number(row.grossAmount || 0)),
        discounts: roundMoney(totals.discounts + Number(row.discountAmount || 0)),
        refunds: roundMoney(totals.refunds + Number(row.refundAmount || 0)),
        netRevenue: roundMoney(totals.netRevenue + Number(row.netMerchantRevenue || 0))
    }), {
        grossRevenue: 0,
        discounts: 0,
        refunds: 0,
        netRevenue: 0
    });
}

function addSummaryWorksheet(workbook, usedNames, context, selectedDatasetIds, rowsByDataset) {
    const sheet = workbook.addWorksheet(safeSheetName('Export Summary', usedNames));
    const totals = calculateSummaryTotals(rowsByDataset);
    const filterLines = [
        ['Merchant name', context.merchantName],
        ['Merchant reference', context.merchantReference],
        ['Export generated date and time', formatDateTime(new Date())],
        ['Selected start date', context.filters.startDate || 'All available'],
        ['Selected end date', context.filters.endDate || 'All available'],
        ['Applied filters', [
            context.filters.status && `Status: ${context.filters.status}`,
            context.filters.paymentMethod && `Payment method: ${context.filters.paymentMethod}`,
            context.filters.serviceId && `Service ID: ${context.filters.serviceId}`,
            context.filters.productId && `Product ID: ${context.filters.productId}`,
            context.filters.search && `Search: ${context.filters.search}`
        ].filter(Boolean).join('; ') || 'None'],
        ['Exported datasets', selectedDatasetIds.map((id) => DATASET_MAP.get(id).label).join(', ')],
        ['Currency used', CURRENCY],
        ['Total gross revenue', totals.grossRevenue],
        ['Total discounts', totals.discounts],
        ['Total refunds', totals.refunds],
        ['Total net revenue', totals.netRevenue]
    ];

    sheet.columns = [
        { key: 'field', header: 'Field', width: 28 },
        { key: 'value', header: 'Value', width: 54 }
    ];
    sheet.getRow(1).font = { bold: true };
    filterLines.forEach(([field, value]) => sheet.addRow({ field, value: safeCellValue(value) }));
    sheet.addRow({});
    sheet.addRow({ field: 'Dataset', value: 'Records' }).font = { bold: true };
    selectedDatasetIds.forEach((id) => {
        sheet.addRow({
            field: DATASET_MAP.get(id).label,
            value: (rowsByDataset[id] || []).length
        });
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getColumn(2).numFmt = '$#,##0.00;[Red]-$#,##0.00';
}

async function buildExport({ merchant, merchantUserId, body }) {
    const selectedDatasetIds = parseDatasets(body);
    const filters = parseFilters(body);

    await ensureRewardAdjustmentSchema();

    const [bookingRawRows, productRawRows, refundRawRows] = await Promise.all([
        getBookingRows(merchantUserId, filters),
        getProductOrderRows(merchantUserId, filters),
        getRefundRows(merchantUserId, filters)
    ]);

    const bookings = bookingRawRows.map(normalizeBooking);
    const products = productRawRows.map(normalizeProduct);
    const refunds = refundRawRows.map(normalizeRefund);
    const allRows = {
        salesRevenue: buildSalesRevenue(bookings, products),
        bookings,
        productOrders: products,
        refunds,
        customers: buildCustomerDataset(bookings, products, refunds),
        servicePerformance: buildServicePerformance(bookings),
        productPerformance: buildProductPerformance(products),
        payments: buildPayments(bookings, products)
    };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vaniday Merchant Analytics';
    workbook.created = new Date();
    workbook.modified = new Date();
    const usedNames = new Set();

    if (selectedDatasetIds.length > 1) {
        addSummaryWorksheet(workbook, usedNames, {
            merchantName: merchant.salonName || merchant.name || merchant.salon_name || 'Merchant',
            merchantReference: merchant.id || merchant.salonId || merchantUserId,
            filters
        }, selectedDatasetIds, allRows);
    }

    selectedDatasetIds.forEach((datasetId) => {
        addWorksheet(workbook, usedNames, datasetId, allRows[datasetId] || []);
    });

    const merchantName = safeFilenamePart(merchant.salonName || merchant.name || merchant.salon_name || 'merchant');
    const start = filters.startDate || 'all';
    const end = filters.endDate || formatDate(new Date()).replace(/\//g, '-');
    const filename = `merchant-analytics_${merchantName}_${start}_to_${end}.xlsx`;

    return {
        workbook,
        filename,
        selectedDatasetIds,
        columns: COLUMNS,
        totals: calculateSummaryTotals(allRows)
    };
}

module.exports = {
    DATASETS,
    COLUMNS,
    buildExport,
    parseDatasets,
    parseFilters,
    safeSheetName
};
