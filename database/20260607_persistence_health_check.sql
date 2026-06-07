USE vaniday_booking_system;

-- Every result set below should normally return zero rows.

-- Paid product transactions without product lines.
SELECT t.transaction_id, t.user_id, t.total_amount, t.payment_method, t.created_at
FROM transactions t
WHERE t.payment_status = 'paid'
  AND t.booking_id IS NULL
  AND t.order_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM order_items oi WHERE oi.transaction_id = t.transaction_id
  );

-- Product transactions with incomplete order relationships.
SELECT
    t.transaction_id,
    t.order_id AS transaction_order_id,
    t.order_item_id AS transaction_first_item_id,
    o.order_id,
    oi.order_item_id,
    oi.order_id AS item_order_id
FROM transactions t
LEFT JOIN orders o ON o.transaction_id = t.transaction_id
LEFT JOIN order_items oi ON oi.transaction_id = t.transaction_id
WHERE oi.order_item_id IS NOT NULL
  AND (
      t.order_id IS NULL
      OR t.order_item_id IS NULL
      OR o.order_id IS NULL
      OR oi.order_id IS NULL
      OR t.order_id <> o.order_id
      OR oi.order_id <> o.order_id
  );

-- Booking/transaction links that are not populated in both directions.
SELECT
    b.booking_id,
    b.transaction_id AS booking_transaction_id,
    t.transaction_id,
    t.booking_id AS transaction_booking_id
FROM bookings b
INNER JOIN transactions t ON t.transaction_id = b.transaction_id
WHERE t.booking_id IS NULL OR t.booking_id <> b.booking_id;

-- Completed linked-inventory bookings without a recorded inventory usage.
SELECT b.booking_id, b.service_id, sil.product_id, sil.quantity_required
FROM bookings b
INNER JOIN service_inventory_links sil ON sil.service_id = b.service_id
LEFT JOIN service_inventory_usage siu ON siu.booking_id = b.booking_id
WHERE b.status = 'completed'
  AND siu.usage_id IS NULL;

-- Completed payment attempts without their final transaction/receipt links.
SELECT attempt_id, provider, provider_reference, status, transaction_id, receipt_id, last_error
FROM payment_attempts
WHERE status = 'completed'
  AND (transaction_id IS NULL OR receipt_id IS NULL);

-- Payment attempts stuck in processing for over 30 minutes.
SELECT attempt_id, provider, provider_reference, status, transaction_id, receipt_id, last_error, updated_at
FROM payment_attempts
WHERE status = 'processing'
  AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE);

-- Used vouchers that have no booking or transaction reference.
SELECT user_voucher_id, user_id, code, status, used_booking_id, used_transaction_id, used_at
FROM user_vouchers
WHERE status = 'used'
  AND used_booking_id IS NULL
  AND used_transaction_id IS NULL;

-- Negative inventory should never occur.
SELECT product_id, name, stock_quantity
FROM products
WHERE stock_quantity < 0;
