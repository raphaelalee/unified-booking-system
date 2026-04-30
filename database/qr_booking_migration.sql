ALTER TABLE bookings
    ADD COLUMN merchant_id INT NULL AFTER user_id;

UPDATE bookings
INNER JOIN services ON services.service_id = bookings.service_id
SET bookings.merchant_id = services.salon_id
WHERE bookings.merchant_id IS NULL;

ALTER TABLE bookings
    MODIFY merchant_id INT NOT NULL;

CREATE INDEX idx_bookings_merchant_service_slot
    ON bookings (merchant_id, service_id, booking_date, timeslot);
