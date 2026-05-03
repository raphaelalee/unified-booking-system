CREATE TABLE IF NOT EXISTS loyalty_wallets (
    user_id INT NOT NULL,
    points_balance INT NOT NULL DEFAULT 0,
    cashback_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    loyalty_transaction_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    source_receipt_id VARCHAR(80) DEFAULT NULL,
    transaction_type VARCHAR(20) NOT NULL,
    points_delta INT NOT NULL DEFAULT 0,
    cashback_delta DECIMAL(10,2) NOT NULL DEFAULT 0,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (loyalty_transaction_id),
    UNIQUE KEY uniq_loyalty_source_type (source_receipt_id, transaction_type),
    KEY idx_loyalty_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS loyalty_rules (
    rule_id INT NOT NULL,
    points_per_dollar DECIMAL(10,2) NOT NULL DEFAULT 10,
    cashback_percent DECIMAL(5,2) NOT NULL DEFAULT 5,
    min_points_to_redeem INT NOT NULL DEFAULT 100,
    points_to_cash_rate DECIMAL(10,4) NOT NULL DEFAULT 0.01,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_id)
);

INSERT INTO loyalty_rules
    (rule_id, points_per_dollar, cashback_percent, min_points_to_redeem, points_to_cash_rate, is_enabled)
VALUES (1, 10, 5, 100, 0.01, 1)
ON DUPLICATE KEY UPDATE rule_id = rule_id;
