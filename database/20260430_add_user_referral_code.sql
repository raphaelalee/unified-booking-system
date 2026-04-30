ALTER TABLE users
ADD COLUMN referral_code VARCHAR(32) NULL AFTER phone;

UPDATE users
SET referral_code = CONCAT('VANI', LPAD(user_id, 4, '0'))
WHERE role = 'customer'
  AND (referral_code IS NULL OR referral_code = '');

CREATE UNIQUE INDEX idx_users_referral_code ON users (referral_code);
