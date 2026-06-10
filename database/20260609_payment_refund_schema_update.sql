-- Vaniday payment and refund schema update
-- Safe to run after the current vaniday_booking_system schema on MySQL 8.x.
-- This file is additive/idempotent and does not drop or rename existing data.

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_column_if_missing$$
CREATE PROCEDURE add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
            AND table_name = p_table_name
            AND column_name = p_column_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS add_index_if_missing$$
CREATE PROCEDURE add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
            AND table_name = p_table_name
            AND index_name = p_index_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DELIMITER ;

CALL add_column_if_missing('transactions', 'currency', 'currency VARCHAR(10) NOT NULL DEFAULT ''SGD''');
CALL add_column_if_missing('transactions', 'payment_provider', 'payment_provider VARCHAR(40) DEFAULT NULL');
CALL add_column_if_missing('transactions', 'provider_payment_id', 'provider_payment_id VARCHAR(190) DEFAULT NULL');
CALL add_column_if_missing('transactions', 'provider_session_id', 'provider_session_id VARCHAR(190) DEFAULT NULL');
CALL add_column_if_missing('transactions', 'provider_capture_id', 'provider_capture_id VARCHAR(190) DEFAULT NULL');
CALL add_column_if_missing('transactions', 'provider_refund_id', 'provider_refund_id VARCHAR(190) DEFAULT NULL');
CALL add_column_if_missing('transactions', 'refund_reason', 'refund_reason TEXT DEFAULT NULL');
CALL add_column_if_missing('transactions', 'refunded_by', 'refunded_by INT DEFAULT NULL');
CALL add_index_if_missing('transactions', 'idx_transactions_provider_payment', 'INDEX idx_transactions_provider_payment (payment_provider, provider_payment_id)');

CALL add_column_if_missing('orders', 'order_status', 'order_status VARCHAR(40) NOT NULL DEFAULT ''processing''');
CALL add_column_if_missing('orders', 'refund_status', 'refund_status VARCHAR(40) NOT NULL DEFAULT ''none''');
CALL add_column_if_missing('orders', 'refunded_amount', 'refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00');
CALL add_column_if_missing('orders', 'refunded_at', 'refunded_at DATETIME DEFAULT NULL');
CALL add_column_if_missing('orders', 'refund_reason', 'refund_reason TEXT DEFAULT NULL');
CALL add_column_if_missing('orders', 'provider_refund_id', 'provider_refund_id VARCHAR(190) DEFAULT NULL');
CALL add_column_if_missing('orders', 'refunded_by', 'refunded_by INT DEFAULT NULL');
CALL add_index_if_missing('orders', 'idx_orders_refund_status', 'INDEX idx_orders_refund_status (refund_status)');

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
    CONSTRAINT fk_payment_refunds_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id),
    CONSTRAINT fk_payment_refunds_user FOREIGN KEY (user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;

SET FOREIGN_KEY_CHECKS = IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1);
