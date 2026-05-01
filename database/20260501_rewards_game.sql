CREATE TABLE IF NOT EXISTS game_settings (
    setting_id TINYINT PRIMARY KEY DEFAULT 1,
    weekly_free_plays INT NOT NULL DEFAULT 1,
    spend_per_bonus_play DECIMAL(10,2) NOT NULL DEFAULT 80.00,
    bonus_plays_per_threshold INT NOT NULL DEFAULT 1,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO game_settings (
    setting_id,
    weekly_free_plays,
    spend_per_bonus_play,
    bonus_plays_per_threshold,
    is_enabled
) VALUES (1, 1, 80.00, 1, 1)
ON DUPLICATE KEY UPDATE setting_id = setting_id;

CREATE TABLE IF NOT EXISTS game_wallets (
    user_id INT PRIMARY KEY,
    play_balance INT NOT NULL DEFAULT 0,
    last_weekly_grant DATE NULL,
    bonus_milestones_granted INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_game_wallet_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_prizes (
    prize_id INT AUTO_INCREMENT PRIMARY KEY,
    salon_id INT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(255) NULL,
    prize_type ENUM('glints','voucher','benefit') NOT NULL DEFAULT 'voucher',
    reward_value INT NULL,
    weight INT NOT NULL DEFAULT 10,
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_game_prize_salon
        FOREIGN KEY (salon_id) REFERENCES salons(salon_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_game_prize_user
        FOREIGN KEY (created_by) REFERENCES users(user_id)
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS game_plays (
    play_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    prize_id INT NULL,
    prize_title VARCHAR(120) NOT NULL,
    prize_type ENUM('glints','voucher','benefit') NOT NULL,
    reward_value INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_game_play_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_game_play_prize
        FOREIGN KEY (prize_id) REFERENCES game_prizes(prize_id)
        ON DELETE SET NULL
);

INSERT INTO game_prizes (salon_id, title, description, prize_type, reward_value, weight, status, created_by)
SELECT NULL, '60 VaniGlints', 'Platform reward points added to the customer wallet.', 'glints', 60, 45, 'active', NULL
WHERE NOT EXISTS (SELECT 1 FROM game_prizes WHERE salon_id IS NULL AND title = '60 VaniGlints');

INSERT INTO game_prizes (salon_id, title, description, prize_type, reward_value, weight, status, created_by)
SELECT NULL, '$5 Beauty Voucher', 'Customer can use this as a future Vaniday benefit.', 'voucher', 5, 25, 'active', NULL
WHERE NOT EXISTS (SELECT 1 FROM game_prizes WHERE salon_id IS NULL AND title = '$5 Beauty Voucher');

INSERT INTO game_prizes (salon_id, title, description, prize_type, reward_value, weight, status, created_by)
SELECT NULL, 'Priority Booking Perk', 'Customer earns a platform benefit for a future booking.', 'benefit', NULL, 15, 'active', NULL
WHERE NOT EXISTS (SELECT 1 FROM game_prizes WHERE salon_id IS NULL AND title = 'Priority Booking Perk');
