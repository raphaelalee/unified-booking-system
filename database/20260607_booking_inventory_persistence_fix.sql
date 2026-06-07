USE vaniday_booking_system;

-- Keep the transaction-to-booking relationship populated in both directions.
UPDATE transactions t
INNER JOIN bookings b ON b.transaction_id = t.transaction_id
SET t.booking_id = b.booking_id
WHERE t.booking_id IS NULL;

ALTER TABLE transactions
    ADD KEY idx_transactions_booking_id (booking_id),
    ADD CONSTRAINT fk_transactions_booking_id
        FOREIGN KEY (booking_id) REFERENCES bookings (booking_id);

-- Record service inventory consumption so completing a booking is idempotent.
CREATE TABLE IF NOT EXISTS service_inventory_usage (
    usage_id INT NOT NULL AUTO_INCREMENT,
    booking_id INT NOT NULL,
    service_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity_used INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (usage_id),
    UNIQUE KEY uq_service_inventory_usage_booking (booking_id),
    KEY idx_service_inventory_usage_service (service_id),
    KEY idx_service_inventory_usage_product (product_id),
    CONSTRAINT fk_service_inventory_usage_booking
        FOREIGN KEY (booking_id) REFERENCES bookings (booking_id) ON DELETE CASCADE,
    CONSTRAINT fk_service_inventory_usage_service
        FOREIGN KEY (service_id) REFERENCES services (service_id),
    CONSTRAINT fk_service_inventory_usage_product
        FOREIGN KEY (product_id) REFERENCES products (product_id)
);
