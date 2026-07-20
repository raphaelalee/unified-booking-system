const db = require('../db');

const CONFIRMED_REFUND_STATUSES = new Set(['succeeded', 'refunded']);
const RESERVED_REFUND_STATUSES = new Set([
    'processing',
    'succeeded',
    'refunded',
    'manual_required',
    'refund_reconciliation_required'
]);

function roundMoney(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100) / 100;
}

function publicRefundReference(row = {}) {
    return row.refund_reference || (row.refund_id ? `RF-${row.refund_id}` : 'Not available');
}

function publicOrderReference(row = {}) {
    return row.order_number
        || row.receipt_id
        || (row.order_id ? `#${row.order_id}` : '')
        || (row.transaction_id ? `#${row.transaction_id}` : 'Not available');
}

function refundDate(row = {}) {
    return row.completed_at
        || row.processing_at
        || row.decision_at
        || row.updated_at
        || row.created_at
        || null;
}

function summarizeRefundRow(row = {}) {
    const grossRefundAmount = roundMoney(row.gross_refund_amount || row.refund_amount || 0);
    const netExternalRefund = roundMoney(row.external_refund_amount || row.net_refund_amount || row.refund_amount || 0);
    return {
        refundId: row.refund_id ? Number(row.refund_id) : null,
        refundReference: publicRefundReference(row),
        orderReference: publicOrderReference(row),
        originalAmountPaid: roundMoney(row.original_amount_paid || row.paid_amount || row.total_amount || 0),
        customerRequestedAmount: roundMoney(row.customer_requested_amount || grossRefundAmount),
        approvedPercentage: roundMoney(row.approved_refund_percentage || 100),
        approvedGrossRefund: grossRefundAmount,
        processingFeeDeduction: roundMoney(row.processing_fee_deduction || 0),
        originalProcessingFee: roundMoney(row.original_processing_fee_amount || 0),
        netExternalRefund,
        walletRestored: roundMoney(row.wallet_restored_amount || 0),
        cashbackRestored: roundMoney(row.cashback_restored_amount || 0),
        pointsRestored: Number(row.points_restored || 0),
        cashbackReversed: roundMoney(row.cashback_reversed_amount || 0),
        pointsReversed: Number(row.points_reversed || 0),
        membershipAdjustment: roundMoney(row.membership_progress_adjustment || 0),
        merchantProcessingFeeLoss: roundMoney(row.merchant_processing_fee_loss || 0),
        fulfilmentStatus: row.delivery_status || row.fulfilment_status || '',
        refundStatus: row.refund_status || 'unknown',
        returnStatus: row.return_status || row.support_status || '',
        providerRefundStatus: row.provider_refund_status || row.refund_status || 'unknown',
        providerRefundId: row.provider_refund_id || '',
        provider: row.payment_provider || '',
        paymentMethod: row.payment_method || '',
        relevantDate: refundDate(row),
        completedAt: row.completed_at || null,
        failedAt: row.failed_at || null,
        createdAt: row.created_at || null,
        isConfirmed: CONFIRMED_REFUND_STATUSES.has(String(row.refund_status || '').toLowerCase()),
        isReserved: RESERVED_REFUND_STATUSES.has(String(row.refund_status || '').toLowerCase())
    };
}

function emptySummary(transactionId, base = {}) {
    const original = roundMoney(base.originalAmountPaid || base.paidAmount || base.totalAmount || 0);
    return {
        transactionId: Number(transactionId) || null,
        originalAmountPaid: original,
        customerRequestedAmount: 0,
        approvedPercentage: 0,
        approvedGrossRefund: 0,
        processingFeeDeduction: 0,
        netExternalRefund: 0,
        walletRestored: 0,
        cashbackRestored: 0,
        pointsRestored: 0,
        cashbackReversed: 0,
        pointsReversed: 0,
        membershipAdjustment: 0,
        cumulativeGrossRefunded: 0,
        cumulativeNetRefunded: 0,
        cumulativeReservedGrossRefunded: 0,
        remainingRefundableAmount: original,
        fulfilmentStatus: base.fulfilmentStatus || base.deliveryStatus || '',
        refundStatus: base.refundStatus || 'none',
        returnStatus: base.returnStatus || '',
        providerRefundStatus: 'none',
        orderReference: base.orderReference || base.orderNumber || base.receiptId || (transactionId ? `#${transactionId}` : 'Not available'),
        refundReference: 'Not available',
        latestRefundDate: null,
        refunds: []
    };
}

function summarizeRefundRows(rows = [], base = {}) {
    const first = rows[0] || {};
    const transactionId = first.transaction_id || base.transactionId || null;
    const summary = emptySummary(transactionId, {
        ...base,
        originalAmountPaid: base.originalAmountPaid || first.paid_amount || first.total_amount,
        orderReference: base.orderReference || publicOrderReference(first),
        refundStatus: base.refundStatus || first.transaction_refund_status || first.refund_status,
        fulfilmentStatus: base.fulfilmentStatus || first.delivery_status
    });

    summary.refunds = rows.map(summarizeRefundRow);

    summary.refunds.forEach((refund) => {
        if (refund.isReserved) {
            summary.cumulativeReservedGrossRefunded = roundMoney(summary.cumulativeReservedGrossRefunded + refund.approvedGrossRefund);
        }
        if (refund.isConfirmed) {
            summary.cumulativeGrossRefunded = roundMoney(summary.cumulativeGrossRefunded + refund.approvedGrossRefund);
            summary.cumulativeNetRefunded = roundMoney(summary.cumulativeNetRefunded + refund.netExternalRefund);
            summary.processingFeeDeduction = roundMoney(summary.processingFeeDeduction + refund.processingFeeDeduction);
            summary.netExternalRefund = roundMoney(summary.netExternalRefund + refund.netExternalRefund);
            summary.walletRestored = roundMoney(summary.walletRestored + refund.walletRestored);
            summary.cashbackRestored = roundMoney(summary.cashbackRestored + refund.cashbackRestored);
            summary.pointsRestored += refund.pointsRestored;
            summary.cashbackReversed = roundMoney(summary.cashbackReversed + refund.cashbackReversed);
            summary.pointsReversed += refund.pointsReversed;
            summary.membershipAdjustment = roundMoney(summary.membershipAdjustment + refund.membershipAdjustment);
        }
    });

    const latest = summary.refunds[0] || null;
    if (latest) {
        summary.customerRequestedAmount = latest.customerRequestedAmount;
        summary.approvedPercentage = latest.approvedPercentage;
        summary.approvedGrossRefund = latest.approvedGrossRefund;
        summary.refundStatus = latest.refundStatus;
        summary.returnStatus = latest.returnStatus || summary.returnStatus;
        summary.providerRefundStatus = latest.providerRefundStatus;
        summary.refundReference = latest.refundReference;
        summary.latestRefundDate = latest.completedAt || latest.relevantDate;
    }

    summary.remainingRefundableAmount = roundMoney(Math.max(
        summary.originalAmountPaid - summary.cumulativeReservedGrossRefunded,
        0
    ));
    summary.refundCount = summary.refunds.length;
    summary.grossRefundTotal = summary.cumulativeGrossRefunded;
    summary.netRefundTotal = summary.cumulativeNetRefunded;
    summary.externalRefundTotal = summary.netExternalRefund;
    summary.walletRestoredTotal = summary.walletRestored;
    summary.pointsRestoredTotal = summary.pointsRestored;
    summary.pointsReversedTotal = summary.pointsReversed;
    summary.cashbackRestoredTotal = summary.cashbackRestored;
    summary.cashbackReversedTotal = summary.cashbackReversed;
    summary.latestRefundReference = summary.refundReference === 'Not available' ? '' : summary.refundReference;

    return summary;
}

async function getRefundSummariesForTransactions(transactionIds = [], baseByTransactionId = {}) {
    const ids = [...new Set((Array.isArray(transactionIds) ? transactionIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0))];

    if (!ids.length) return {};

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await db.promise().query(`
        SELECT
            pr.*,
            t.paid_amount,
            t.total_amount,
            t.refund_status AS transaction_refund_status,
            t.delivery_status,
            t.payment_status,
            o.order_number,
            sr.status AS support_status,
            sr.receipt_id
        FROM payment_refunds pr
        LEFT JOIN transactions t ON t.transaction_id = pr.transaction_id
        LEFT JOIN orders o ON o.transaction_id = pr.transaction_id
        LEFT JOIN support_requests sr ON sr.request_id = pr.refund_request_id
        WHERE pr.transaction_id IN (${placeholders})
        ORDER BY pr.created_at DESC, pr.refund_id DESC
    `, ids);

    const grouped = rows.reduce((map, row) => {
        const key = String(row.transaction_id);
        map[key] = map[key] || [];
        map[key].push(row);
        return map;
    }, {});

    return ids.reduce((map, id) => {
        map[String(id)] = summarizeRefundRows(grouped[String(id)] || [], {
            ...(baseByTransactionId[String(id)] || {}),
            transactionId: id
        });
        return map;
    }, {});
}

module.exports = {
    CONFIRMED_REFUND_STATUSES,
    RESERVED_REFUND_STATUSES,
    emptySummary,
    getRefundSummariesForTransactions,
    summarizeRefundRow,
    summarizeRefundRows
};
