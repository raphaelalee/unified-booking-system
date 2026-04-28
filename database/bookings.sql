CREATE TABLE IF NOT EXISTS bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    merchant_id INT NOT NULL,
    merchant_name VARCHAR(100) NOT NULL,
    service_id INT NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    booking_date DATE NOT NULL,
    booking_time VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bookings_merchant_service (merchant_id, service_id),
    INDEX idx_bookings_merchant_service_slot (merchant_id, service_id, booking_date, booking_time),
    UNIQUE KEY uq_bookings_merchant_service_slot (merchant_id, service_id, booking_date, booking_time)
);
