ALTER TABLE promotions
    ADD COLUMN allowed_slots TEXT NULL AFTER end_date;
