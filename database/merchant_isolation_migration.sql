ALTER TABLE bookings
    ADD INDEX idx_bookings_merchant_service (merchant_id, service_id),
    ADD INDEX idx_bookings_merchant_service_slot (merchant_id, service_id, booking_date, booking_time),
    ADD UNIQUE KEY uq_bookings_merchant_service_slot (merchant_id, service_id, booking_date, booking_time);
