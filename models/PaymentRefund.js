const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    db.query(`
        CREATE TABLE IF NOT EXISTS payment_refunds (
            refund_id INT NOT NULL AUTO_INCREMENT,
            transaction_id INT NOT NULL,
            booking_id INT DEFAULT NULL,
            order_id INT DEFAULT NULL,
            user_id INT NOT NULL,
            merchant_id INT DEFAULT NULL,
            refunded_by INT DEFAULT NULL,
            refund_amount DECIMAL(10,2) NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'SGD',
            refund_status VARCHAR(40) NOT NULL DEFAULT 'pending',
            refund_reason TEXT DEFAULT NULL,
            payment_provider VARCHAR(40) DEFAULT NULL,
            provider_payment_id VARCHAR(190) DEFAULT NULL,
            provider_session_id VARCHAR(190) DEFAULT NULL,
            provider_capture_id VARCHAR(190) DEFAULT NULL,
            provider_refund_id VARCHAR(190) DEFAULT NULL,
            provider_response_json LONGTEXT DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (refund_id),
            UNIQUE KEY uq_payment_refunds_provider_refund (payment_provider, provider_refund_id),
            KEY idx_payment_refunds_transaction (transaction_id),
            KEY idx_payment_refunds_user (user_id),
            KEY idx_payment_refunds_status (refund_status),
            CONSTRAINT fk_payment_refunds_transaction
                FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
            CONSTRAINT fk_payment_refunds_user
                FOREIGN KEY (user_id) REFERENCES users (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, (error) => {
        if (!error) schemaReady = true;
        callback(error);
    });
}

function create(payload, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(`
            INSERT INTO payment_refunds (
                transaction_id,
                booking_id,
                order_id,
                user_id,
                merchant_id,
                refunded_by,
                refund_amount,
                currency,
                refund_status,
                refund_reason,
                payment_provider,
                provider_payment_id,
                provider_session_id,
                provider_capture_id,
                provider_refund_id,
                provider_response_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            payload.transactionId,
            payload.bookingId || null,
            payload.orderId || null,
            payload.userId,
            payload.merchantId || null,
            payload.refundedBy || null,
            Number(payload.amount || 0),
            payload.currency || 'SGD',
            payload.status || 'succeeded',
            payload.reason || null,
            payload.paymentProvider || null,
            payload.providerPaymentId || null,
            payload.providerSessionId || null,
            payload.providerCaptureId || null,
            payload.providerRefundId || null,
            payload.providerResponse ? JSON.stringify(payload.providerResponse) : null
        ], callback);
    });
}

function countCompletedForTransaction(transactionId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(
            `SELECT COALESCE(SUM(refund_amount), 0) AS refunded_total
             FROM payment_refunds
             WHERE transaction_id = ?
                AND refund_status IN ('succeeded', 'refunded', 'manual_required')`,
            [transactionId],
            (error, rows = []) => {
                if (error) return callback(error);
                callback(null, Number(rows[0]?.refunded_total || 0));
            }
        );
    });
}

module.exports = {
    countCompletedForTransaction,
    create,
    ensureSchema
};
