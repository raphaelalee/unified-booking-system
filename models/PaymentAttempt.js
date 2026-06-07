const db = require('../db');

let schemaReady = false;

function ensureSchema(callback) {
    if (schemaReady) {
        callback(null);
        return;
    }

    db.query(`
        CREATE TABLE IF NOT EXISTS payment_attempts (
            attempt_id VARCHAR(100) NOT NULL,
            user_id INT NOT NULL,
            provider VARCHAR(30) NOT NULL,
            provider_reference VARCHAR(160) DEFAULT NULL,
            payment_json LONGTEXT NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            transaction_id INT DEFAULT NULL,
            receipt_id VARCHAR(80) DEFAULT NULL,
            last_error TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (attempt_id),
            UNIQUE KEY uq_payment_attempt_provider_reference (provider, provider_reference),
            KEY idx_payment_attempt_user_status (user_id, status),
            CONSTRAINT fk_payment_attempt_user
                FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
            CONSTRAINT fk_payment_attempt_transaction
                FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `, (error) => {
        if (!error) schemaReady = true;
        callback(error);
    });
}

function mapAttempt(row) {
    if (!row) return null;

    return {
        attemptId: row.attempt_id,
        userId: Number(row.user_id),
        provider: row.provider,
        providerReference: row.provider_reference,
        payment: JSON.parse(row.payment_json || '{}'),
        status: row.status,
        transactionId: row.transaction_id ? Number(row.transaction_id) : null,
        receiptId: row.receipt_id || '',
        lastError: row.last_error || ''
    };
}

function save(payload, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);

        db.query(`
            INSERT INTO payment_attempts
                (attempt_id, user_id, provider, provider_reference, payment_json, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
            ON DUPLICATE KEY UPDATE
                provider_reference = COALESCE(VALUES(provider_reference), provider_reference),
                payment_json = VALUES(payment_json)
        `, [
            payload.attemptId,
            payload.userId,
            payload.provider,
            payload.providerReference || null,
            JSON.stringify(payload.payment || {})
        ], callback);
    });
}

function find(attemptId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query('SELECT * FROM payment_attempts WHERE attempt_id = ? LIMIT 1', [attemptId], (error, rows = []) => {
            if (error) return callback(error);
            try {
                callback(null, mapAttempt(rows[0]));
            } catch (parseError) {
                callback(parseError);
            }
        });
    });
}

function findByProviderReference(provider, providerReference, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(
            'SELECT * FROM payment_attempts WHERE provider = ? AND provider_reference = ? LIMIT 1',
            [provider, providerReference],
            (error, rows = []) => {
                if (error) return callback(error);
                try {
                    callback(null, mapAttempt(rows[0]));
                } catch (parseError) {
                    callback(parseError);
                }
            }
        );
    });
}

function markTransaction(attemptId, transactionId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(
            `UPDATE payment_attempts
             SET transaction_id = COALESCE(transaction_id, ?), status = 'processing', last_error = NULL
             WHERE attempt_id = ?`,
            [transactionId, attemptId],
            callback
        );
    });
}

function markCompleted(attemptId, receiptId, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(
            `UPDATE payment_attempts SET status = 'completed', receipt_id = ?, last_error = NULL WHERE attempt_id = ?`,
            [receiptId, attemptId],
            callback
        );
    });
}

function markError(attemptId, error, callback) {
    ensureSchema((schemaError) => {
        if (schemaError) return callback(schemaError);
        db.query(
            `UPDATE payment_attempts SET status = 'processing', last_error = ? WHERE attempt_id = ?`,
            [String(error?.message || error || '').slice(0, 2000), attemptId],
            callback
        );
    });
}

module.exports = {
    find,
    findByProviderReference,
    markCompleted,
    markError,
    markTransaction,
    save
};
