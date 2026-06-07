USE vaniday_booking_system;

-- Persist customer carts across logout, session expiry, and server restarts.
CREATE TABLE IF NOT EXISTS customer_carts (
    user_id INT NOT NULL,
    cart_json LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_customer_carts_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

-- Persist provider payment state and completion progress. The transaction link
-- allows a failed callback to resume without creating a second paid transaction.
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
);

-- Prevent resumable payment processing from issuing the same gift card twice.
ALTER TABLE gift_card_vouchers
    ADD COLUMN source_reference VARCHAR(120) NULL AFTER status,
    ADD UNIQUE KEY uq_gift_card_voucher_source (source_reference);

-- Persist WhatsApp booking flow progress for 30-minute restart recovery.
CREATE TABLE IF NOT EXISTS whatsapp_conversation_sessions (
    phone VARCHAR(30) NOT NULL,
    session_json LONGTEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (phone),
    KEY idx_whatsapp_conversation_updated (updated_at)
);
