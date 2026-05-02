CREATE TABLE IF NOT EXISTS daily_reward_wallets (
    reward_wallet_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    cycle_start_date DATE NOT NULL,
    current_day INT NOT NULL DEFAULT 0,
    last_claim_date DATE DEFAULT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (reward_wallet_id),
    UNIQUE KEY uq_daily_reward_wallet_user (user_id),
    CONSTRAINT fk_daily_reward_wallet_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

INSERT INTO daily_reward_wallets (user_id, cycle_start_date, current_day, last_claim_date)
SELECT user_id, CURDATE(), 0, NULL
FROM users
WHERE role = 'customer'
ON DUPLICATE KEY UPDATE user_id = user_id;
