USE vaniday_booking_system;

-- Link future orders and order items with indexed foreign keys.
ALTER TABLE orders
    ADD COLUMN transaction_id INT DEFAULT NULL AFTER user_id,
    ADD KEY idx_orders_user_id (user_id),
    ADD UNIQUE KEY uq_orders_transaction_id (transaction_id),
    ADD CONSTRAINT fk_orders_user_id
        FOREIGN KEY (user_id) REFERENCES users (user_id),
    ADD CONSTRAINT fk_orders_transaction_id
        FOREIGN KEY (transaction_id) REFERENCES transactions (transaction_id);

ALTER TABLE transactions
    ADD KEY idx_transactions_order_id (order_id),
    ADD KEY idx_transactions_order_item_id (order_item_id),
    ADD CONSTRAINT fk_transactions_order_id
        FOREIGN KEY (order_id) REFERENCES orders (order_id),
    ADD CONSTRAINT fk_transactions_order_item_id
        FOREIGN KEY (order_item_id) REFERENCES order_items (order_item_id);

ALTER TABLE order_items
    ADD KEY idx_order_items_order_id (order_id),
    ADD CONSTRAINT fk_order_items_order_id
        FOREIGN KEY (order_id) REFERENCES orders (order_id);

-- Create order headers for existing paid product transactions that have line
-- items but were not linked to the orders table by the old checkout code.
INSERT INTO orders (user_id, transaction_id, total_amount, created_at)
SELECT t.user_id, t.transaction_id, t.total_amount, t.created_at
FROM transactions t
WHERE t.payment_status = 'paid'
  AND EXISTS (
      SELECT 1
      FROM order_items oi
      WHERE oi.transaction_id = t.transaction_id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM orders o
      WHERE o.transaction_id = t.transaction_id
  );

UPDATE transactions t
INNER JOIN (
    SELECT
        t2.transaction_id,
        o.order_id AS matched_order_id,
        MIN(oi2.order_item_id) AS first_order_item_id
    FROM transactions t2
    INNER JOIN order_items oi2 ON oi2.transaction_id = t2.transaction_id
    INNER JOIN orders o ON o.transaction_id = t2.transaction_id
    WHERE t2.payment_status = 'paid'
    GROUP BY t2.transaction_id, o.order_id
) links ON links.transaction_id = t.transaction_id
SET t.order_id = COALESCE(t.order_id, links.matched_order_id),
    t.order_item_id = COALESCE(t.order_item_id, links.first_order_item_id);

UPDATE order_items oi
INNER JOIN transactions t ON t.transaction_id = oi.transaction_id
SET oi.order_id = t.order_id
WHERE oi.order_id IS NULL
  AND t.order_id IS NOT NULL;
