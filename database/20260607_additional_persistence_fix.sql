USE vaniday_booking_system;

-- Persist customer favourites instead of keeping them only in the web session.
CREATE TABLE IF NOT EXISTS favourite_merchants (
    user_id INT NOT NULL,
    merchant_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, merchant_id),
    KEY idx_favourite_merchants_merchant (merchant_id),
    CONSTRAINT fk_favourite_merchants_user
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT fk_favourite_merchants_merchant
        FOREIGN KEY (merchant_id) REFERENCES salons (salon_id) ON DELETE CASCADE
);
