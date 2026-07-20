const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    db.query('SHOW TABLES LIKE "payment_refunds"', (tableError, tables = []) => {
        if (tableError) return callback(tableError);
        if (!tables.length) {
            return callback(new Error('Missing payment_refunds table. Run the refund financial integrity migration before processing refunds.'));
        }

        db.query('SHOW COLUMNS FROM payment_refunds', (columnError, columns = []) => {
            if (columnError) return callback(columnError);

            const fields = new Set(columns.map((column) => column.Field));
            const requiredFields = [
                'refund_id',
                'transaction_id',
                'refund_amount',
                'gross_refund_amount',
                'customer_requested_amount',
                'approved_refund_percentage',
                'refund_base_amount',
                'processing_fee_deduction',
                'other_deduction_amount',
                'net_refund_amount',
                'external_gross_refund_amount',
                'external_refund_amount',
                'wallet_restored_amount',
                'points_restored',
                'points_reversed',
                'cashback_restored_amount',
                'cashback_reversed_amount',
                'membership_progress_adjustment',
                'merchant_processing_fee_loss',
                'reward_adjustment_status',
                'original_processing_fee_amount',
                'processing_fee_source',
                'refund_status',
                'idempotency_key'
            ];
            const missing = requiredFields.filter((field) => !fields.has(field));
            if (missing.length) {
                return callback(new Error(`Missing refund schema columns: ${missing.join(', ')}. Run the refund financial integrity migration.`));
            }

            db.query('SHOW INDEX FROM payment_refunds WHERE Key_name = ?', ['uq_payment_refunds_idempotency'], (indexError, indexes = []) => {
                if (indexError) return callback(indexError);
                if (!indexes.length) {
                    return callback(new Error('Missing refund idempotency index uq_payment_refunds_idempotency. Run the refund financial integrity migration.'));
                }

                schemaReady = true;
                callback(null);
            });
        });
    });
}

function create(payload, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        const executor = payload.connection || db;
        executor.query(`
            INSERT INTO payment_refunds (
                transaction_id,
                booking_id,
                order_id,
                user_id,
                merchant_id,
                refunded_by,
                refund_amount,
                gross_refund_amount,
                customer_requested_amount,
                approved_refund_percentage,
                refund_base_amount,
                processing_fee_deduction,
                other_deduction_amount,
                net_refund_amount,
                external_gross_refund_amount,
                external_refund_amount,
                wallet_restored_amount,
                points_restored,
                points_reversed,
                cashback_restored_amount,
                cashback_reversed_amount,
                membership_progress_adjustment,
                merchant_processing_fee_loss,
                reward_adjustment_status,
                original_processing_fee_amount,
                processing_fee_source,
                currency,
                refund_status,
                refund_reason,
                refund_reason_category,
                refund_responsibility,
                merchant_decision,
                merchant_decision_reason,
                fee_deduction_applies,
                fee_acknowledged_at,
                fee_acknowledgement_version,
                payment_method,
                provider_transaction_id,
                idempotency_key,
                decision_at,
                processing_at,
                completed_at,
                failed_at,
                failure_reason,
                payment_provider,
                provider_payment_id,
                provider_session_id,
                provider_capture_id,
                provider_refund_id,
                refund_request_id,
                refund_reference,
                provider_response_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.transactionId,
            payload.bookingId || null,
            payload.orderId || null,
            payload.userId,
            payload.merchantId || null,
            payload.refundedBy || null,
            Number(payload.amount || payload.netRefundAmount || 0),
            Number(payload.grossRefundAmount || payload.amount || 0),
            Number(payload.customerRequestedAmount || payload.grossRefundAmount || payload.amount || 0),
            Number(payload.approvedRefundPercentage || 100),
            Number(payload.refundBaseAmount || payload.grossRefundAmount || payload.amount || 0),
            Number(payload.processingFeeDeduction || 0),
            Number(payload.otherDeductionAmount || 0),
            Number(payload.netRefundAmount || payload.amount || 0),
            Number(payload.externalGrossRefundAmount || 0),
            Number(payload.externalRefundAmount || payload.amount || 0),
            Number(payload.walletRestoredAmount || 0),
            Number(payload.pointsRestored || 0),
            Number(payload.pointsReversed || 0),
            Number(payload.cashbackRestoredAmount || 0),
            Number(payload.cashbackReversedAmount || 0),
            Number(payload.membershipProgressAdjustment || 0),
            Number(payload.merchantProcessingFeeLoss || 0),
            payload.rewardAdjustmentStatus || 'not_applied',
            Number(payload.originalProcessingFeeAmount || 0),
            payload.processingFeeSource || 'unknown',
            payload.currency || 'SGD',
            payload.status || 'succeeded',
            payload.reason || null,
            payload.refundReasonCategory || null,
            payload.refundResponsibility || null,
            payload.merchantDecision || null,
            payload.merchantDecisionReason || null,
            payload.feeDeductionApplies ? 1 : 0,
            payload.feeAcknowledgedAt || null,
            payload.feeAcknowledgementVersion || null,
            payload.paymentMethod || null,
            payload.providerTransactionId || null,
            payload.idempotencyKey || null,
            payload.decisionAt || null,
            payload.processingAt || null,
            payload.completedAt || null,
            payload.failedAt || null,
            payload.failureReason || null,
            payload.paymentProvider || null,
            payload.providerPaymentId || null,
            payload.providerSessionId || null,
            payload.providerCaptureId || null,
            payload.providerRefundId || null,
            payload.refundRequestId || null,
            payload.refundReference || null,
            payload.providerResponse ? JSON.stringify(payload.providerResponse) : null
        ], callback);
    });
}

function updateProviderResult(refundId, payload = {}, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        const executor = payload.connection || db;
        const status = payload.status || 'processing';
        executor.query(`
            UPDATE payment_refunds
            SET
                refund_status = ?,
                provider_refund_id = COALESCE(?, provider_refund_id),
                provider_response_json = COALESCE(?, provider_response_json),
                completed_at = CASE WHEN ? IN ('succeeded', 'refunded') THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END,
                failed_at = CASE WHEN ? IN ('failed', 'refund_reconciliation_required') THEN COALESCE(failed_at, CURRENT_TIMESTAMP) ELSE failed_at END,
                failure_reason = COALESCE(?, failure_reason),
                updated_at = CURRENT_TIMESTAMP
            WHERE refund_id = ?
        `, [
            status,
            payload.providerRefundId || null,
            payload.providerResponse ? JSON.stringify(payload.providerResponse) : null,
            status,
            status,
            payload.failureReason || null,
            refundId
        ], callback);
    });
}

function findByIdempotencyKey(idempotencyKey, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(
            `SELECT * FROM payment_refunds WHERE idempotency_key = ? LIMIT 1`,
            [idempotencyKey],
            (error, rows = []) => {
                if (error) return callback(error);
                callback(null, rows[0] || null);
            }
        );
    });
}

function countCompletedForTransaction(transactionId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(
            `SELECT COALESCE(SUM(refund_amount), 0) AS refunded_total
             FROM payment_refunds
             WHERE transaction_id = ?
                AND refund_status IN ('processing', 'succeeded', 'refunded', 'manual_required', 'refund_reconciliation_required')`,
            [transactionId],
            (error, rows = []) => {
                if (error) return callback(error);
                callback(null, Number(rows[0]?.refunded_total || 0));
            }
        );
    });
}

function getCompletedTotalsForTransaction(transactionId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(
            `SELECT
                COALESCE(SUM(gross_refund_amount), 0) AS gross_refunded_total,
                COALESCE(SUM(external_gross_refund_amount), 0) AS external_gross_refunded_total,
                COALESCE(SUM(processing_fee_deduction), 0) AS fee_deduction_total,
                COALESCE(SUM(net_refund_amount), 0) AS net_refunded_total,
                COALESCE(SUM(wallet_restored_amount), 0) AS wallet_restored_total,
                COALESCE(SUM(cashback_restored_amount), 0) AS cashback_restored_total,
                COALESCE(SUM(merchant_processing_fee_loss), 0) AS merchant_fee_loss_total
             FROM payment_refunds
             WHERE transaction_id = ?
                AND refund_status IN ('processing', 'succeeded', 'refunded', 'manual_required', 'refund_reconciliation_required')`,
            [transactionId],
            (error, rows = []) => {
                if (error) return callback(error);
                callback(null, {
                    grossRefundedTotal: Number(rows[0]?.gross_refunded_total || 0),
                    externalGrossRefundedTotal: Number(rows[0]?.external_gross_refunded_total || 0),
                    feeDeductionTotal: Number(rows[0]?.fee_deduction_total || 0),
                    netRefundedTotal: Number(rows[0]?.net_refunded_total || 0),
                    walletRestoredTotal: Number(rows[0]?.wallet_restored_total || 0),
                    cashbackRestoredTotal: Number(rows[0]?.cashback_restored_total || 0),
                    merchantFeeLossTotal: Number(rows[0]?.merchant_fee_loss_total || 0)
                });
            }
        );
    });
}

function getForTransaction(transactionId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(
            `SELECT *
             FROM payment_refunds
             WHERE transaction_id = ?
             ORDER BY created_at DESC, refund_id DESC`,
            [transactionId],
            callback
        );
    });
}

module.exports = {
    countCompletedForTransaction,
    create,
    findByIdempotencyKey,
    getForTransaction,
    getCompletedTotalsForTransaction,
    ensureSchema,
    updateProviderResult
};

