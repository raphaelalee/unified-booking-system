-- Pickup and fulfilment synchronization migration
-- Run against the same database used by the app.

ALTER TABLE transactions
    ADD COLUMN fulfilment_type VARCHAR(20) NOT NULL DEFAULT 'pickup',
    ADD COLUMN pickup_ready_at DATETIME DEFAULT NULL,
    ADD COLUMN pickup_verified_at DATETIME DEFAULT NULL,
    ADD COLUMN pickup_verified_by INT DEFAULT NULL,
    ADD COLUMN pickup_qr_used TINYINT(1) NOT NULL DEFAULT 0;

-- Ensure existing product orders have explicit fulfilment type.
UPDATE transactions t
LEFT JOIN order_items oi ON oi.transaction_id = t.transaction_id
SET t.fulfilment_type = CASE
    WHEN oi.transaction_id IS NOT NULL THEN COALESCE(NULLIF(t.fulfilment_type, ''), 'pickup')
    ELSE COALESCE(NULLIF(t.fulfilment_type, ''), 'pickup')
END;

-- Synchronize history status columns for already verified pickup records.
UPDATE purchase_history ph
INNER JOIN transactions t ON ph.receipt_id = CONCAT('order-', t.transaction_id)
SET
    ph.pickup_status = CASE
        WHEN t.pickup_status IN ('picked_up', 'collected') OR t.pickup_qr_used = 1 OR t.pickup_verified_at IS NOT NULL THEN 'picked_up'
        WHEN t.pickup_status IS NOT NULL AND t.pickup_status <> '' THEN t.pickup_status
        ELSE ph.pickup_status
    END,
    ph.pickup_at = COALESCE(ph.pickup_at, t.collected_at, t.pickup_verified_at),
    ph.delivery_status = CASE
        WHEN t.pickup_status IN ('picked_up', 'collected') OR t.pickup_qr_used = 1 OR t.pickup_verified_at IS NOT NULL THEN 'completed'
        ELSE COALESCE(t.delivery_status, ph.delivery_status)
    END
WHERE ph.purchase_type = 'product';
