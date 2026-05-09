CREATE DATABASE IF NOT EXISTS `vaniday_booking_system`
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE `vaniday_booking_system`;

SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE `bookings`
    MODIFY COLUMN `status` ENUM('pending','confirmed','paid','checked_in','completed','cancelled') DEFAULT 'pending';

SET @schema_name = DATABASE();

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'delivery_status') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `delivery_status` VARCHAR(30) NOT NULL DEFAULT ''processing'' AFTER `payment_method`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'shipped_at') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `shipped_at` DATETIME DEFAULT NULL AFTER `delivery_status`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'delivered_at') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `delivered_at` DATETIME DEFAULT NULL AFTER `shipped_at`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'refund_status') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `refund_status` VARCHAR(30) NOT NULL DEFAULT ''none'' AFTER `delivered_at`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'refunded_amount') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `refunded_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `refund_status`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'refunded_at') = 0,
    'ALTER TABLE `transactions` ADD COLUMN `refunded_at` DATETIME DEFAULT NULL AFTER `refunded_amount`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'purchase_history' AND COLUMN_NAME = 'delivery_status') = 0,
    'ALTER TABLE `purchase_history` ADD COLUMN `delivery_status` VARCHAR(30) NOT NULL DEFAULT ''processing'' AFTER `payment_status`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'purchase_history' AND COLUMN_NAME = 'refund_status') = 0,
    'ALTER TABLE `purchase_history` ADD COLUMN `refund_status` VARCHAR(30) NOT NULL DEFAULT ''none'' AFTER `delivery_status`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'purchase_history' AND COLUMN_NAME = 'refunded_amount') = 0,
    'ALTER TABLE `purchase_history` ADD COLUMN `refunded_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `refund_status`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'purchase_history' AND COLUMN_NAME = 'refunded_at') = 0,
    'ALTER TABLE `purchase_history` ADD COLUMN `refunded_at` DATETIME DEFAULT NULL AFTER `refunded_amount`',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `notifications` (
    `notification_id` INT NOT NULL AUTO_INCREMENT,
    `recipient_user_id` INT NOT NULL,
    `recipient_role` VARCHAR(20) NOT NULL,
    `actor_user_id` INT DEFAULT NULL,
    `notification_type` VARCHAR(80) NOT NULL DEFAULT 'general',
    `title` VARCHAR(180) NOT NULL,
    `message` TEXT NOT NULL,
    `link_url` VARCHAR(255) DEFAULT NULL,
    `status` ENUM('unread','read') NOT NULL DEFAULT 'unread',
    `dedupe_key` VARCHAR(180) DEFAULT NULL,
    `metadata` TEXT,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `read_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`notification_id`),
    UNIQUE KEY `uq_notifications_dedupe_key` (`dedupe_key`),
    KEY `idx_notifications_user_status` (`recipient_user_id`, `status`, `created_at`),
    KEY `idx_notifications_role` (`recipient_role`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `support_requests` (
    `request_id` INT NOT NULL AUTO_INCREMENT,
    `customer_user_id` INT NOT NULL,
    `merchant_user_id` INT DEFAULT NULL,
    `admin_user_id` INT DEFAULT NULL,
    `request_type` VARCHAR(40) NOT NULL,
    `target_type` VARCHAR(20) NOT NULL,
    `target_id` VARCHAR(80) NOT NULL,
    `receipt_id` VARCHAR(80) DEFAULT NULL,
    `status` VARCHAR(40) NOT NULL DEFAULT 'pending_admin_review',
    `merchant_decision` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `admin_decision` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `reason` VARCHAR(160) DEFAULT NULL,
    `customer_note` TEXT,
    `requested_change` TEXT,
    `merchant_note` TEXT,
    `admin_note` TEXT,
    `refund_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `late_fee_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    `is_late_cancellation` TINYINT(1) NOT NULL DEFAULT 0,
    `delivery_status` VARCHAR(30) DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `resolved_at` TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`request_id`),
    KEY `idx_support_customer` (`customer_user_id`, `status`, `created_at`),
    KEY `idx_support_merchant` (`merchant_user_id`, `status`, `created_at`),
    KEY `idx_support_status` (`status`, `created_at`),
    KEY `idx_support_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE `transactions`
SET `delivery_status` = COALESCE(NULLIF(`delivery_status`, ''), 'processing'),
    `refund_status` = COALESCE(NULLIF(`refund_status`, ''), 'none');

UPDATE `purchase_history`
SET `delivery_status` = COALESCE(NULLIF(`delivery_status`, ''), 'processing'),
    `refund_status` = COALESCE(NULLIF(`refund_status`, ''), 'none');

SET FOREIGN_KEY_CHECKS = 1;
