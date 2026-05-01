CREATE DATABASE IF NOT EXISTS `vaniday_booking_system`
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE `vaniday_booking_system`;

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS `game_plays`;
DROP TABLE IF EXISTS `game_wallets`;
DROP TABLE IF EXISTS `game_prizes`;
DROP TABLE IF EXISTS `game_settings`;
DROP TABLE IF EXISTS `promotion_redemptions`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `bookings`;
DROP TABLE IF EXISTS `promotions`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `service_slots`;
DROP TABLE IF EXISTS `services`;
DROP TABLE IF EXISTS `salons`;
DROP TABLE IF EXISTS `transactions`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;

CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('customer','merchant','admin') DEFAULT 'customer',
  `glints_balance` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `referral_code` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `users` VALUES
(1,'mary','mary@mary.com',NULL,'$2b$10$V0J24b/4laUlBYcUc.gvve9U.mmAdsgVngrw9VqEgT.vwfCQ5hUQK','customer',0,'2026-04-29 06:37:32','VANI0001'),
(2,'Admin User','admin@vaniday.sg',NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','admin',0,'2026-04-30 06:12:21',NULL),
(3,'Vaniday Beauty Merchant','beauty@vaniday.sg',NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL),
(4,'FreshGlow Spa Merchant','spa@vaniday.sg',NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL),
(5,'Urban Groom Merchant','barber@vaniday.sg',NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL);

CREATE TABLE `categories` (
  `category_id` int NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) NOT NULL,
  `icon_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `categories` VALUES
(1,'Hair',NULL),
(2,'Facial',NULL),
(3,'Nails',NULL),
(4,'Massage',NULL),
(5,'Barber',NULL);

CREATE TABLE `salons` (
  `salon_id` int NOT NULL AUTO_INCREMENT,
  `merchant_id` int NOT NULL,
  `salon_name` varchar(255) NOT NULL,
  `address` text,
  `description` text,
  `image_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`salon_id`),
  KEY `merchant_id` (`merchant_id`),
  CONSTRAINT `salons_ibfk_1` FOREIGN KEY (`merchant_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `salons` VALUES
(1,3,'Vaniday Beauty Studio','Orchard','Hair styling, facials, and beauty treatments.',NULL),
(2,4,'FreshGlow Spa','Tampines','Relaxing spa and body treatments.',NULL),
(3,5,'Urban Groom Barbers','Woodlands','Haircuts, fades, and grooming services.',NULL);

CREATE TABLE `services` (
  `service_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `category_id` int NOT NULL,
  `service_name` varchar(255) NOT NULL,
  `description` text,
  `duration_mins` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`service_id`),
  KEY `salon_id` (`salon_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `services_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `services_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `services` VALUES
(1,1,1,'Hair Cut','Classic haircut and styling consultation.',45,35.00),
(2,1,2,'Hydrating Facial','Moisturising facial for dry or dull skin.',60,68.00),
(3,1,3,'Gel Manicure','Long-lasting gel manicure service.',60,55.00),
(4,2,4,'Aromatherapy Massage','Relaxing full-body aromatherapy massage.',90,98.00),
(5,2,4,'Body Scrub','Body exfoliation and spa care treatment.',60,72.00),
(6,3,5,'Classic Haircut','Classic men haircut.',30,28.00),
(7,3,5,'Skin Fade','Detailed fade haircut.',45,38.00);

CREATE TABLE `service_slots` (
  `slot_id` int NOT NULL AUTO_INCREMENT,
  `service_id` int NOT NULL,
  `timeslot` time NOT NULL,
  PRIMARY KEY (`slot_id`),
  UNIQUE KEY `uq_service_timeslot` (`service_id`,`timeslot`),
  CONSTRAINT `service_slots_ibfk_1` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `service_slots` VALUES
(1,1,'10:00:00'),(2,1,'14:00:00'),(3,1,'17:00:00'),
(4,2,'11:00:00'),(5,2,'15:30:00'),(6,2,'18:00:00'),
(7,3,'12:00:00'),(8,3,'16:00:00'),(9,3,'18:30:00'),
(10,4,'09:30:00'),(11,4,'13:00:00'),(12,4,'18:00:00'),
(13,5,'10:30:00'),(14,5,'14:30:00'),(15,5,'17:30:00'),
(16,6,'10:00:00'),(17,6,'13:30:00'),(18,6,'19:00:00'),
(19,7,'11:00:00'),(20,7,'14:30:00'),(21,7,'17:00:00');

CREATE TABLE `transactions` (
  `transaction_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `payment_status` enum('pending','paid','failed') DEFAULT 'pending',
  `payment_method` varchar(50) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`transaction_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `bookings` (
  `booking_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `merchant_id` int NOT NULL,
  `service_id` int NOT NULL,
  `transaction_id` int DEFAULT NULL,
  `booking_date` date NOT NULL,
  `timeslot` time NOT NULL,
  `status` enum('pending','confirmed','completed','cancelled') DEFAULT 'pending',
  `qr_code_token` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`booking_id`),
  KEY `user_id` (`user_id`),
  KEY `service_id` (`service_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `idx_bookings_merchant_service_slot` (`merchant_id`,`service_id`,`booking_date`,`timeslot`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`),
  CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `products` (
  `product_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock_quantity` int DEFAULT '0',
  `image_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  KEY `salon_id` (`salon_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `order_items` (
  `order_item_id` int NOT NULL AUTO_INCREMENT,
  `transaction_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `price_at_purchase` decimal(10,2) NOT NULL,
  PRIMARY KEY (`order_item_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `promotions` (
  `promotion_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `service_id` int DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `type` enum('first_trial','happy_hour','one_for_one','featured') NOT NULL,
  `discount_type` enum('percentage','fixed_amount','fixed_price','tag_only') NOT NULL DEFAULT 'percentage',
  `discount_value` decimal(10,2) DEFAULT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime NOT NULL,
  `status` enum('draft','active','inactive','expired') NOT NULL DEFAULT 'draft',
  `description` text,
  `terms` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`promotion_id`),
  KEY `idx_promotions_salon` (`salon_id`),
  KEY `idx_promotions_service` (`service_id`),
  KEY `idx_promotions_type_status` (`type`,`status`),
  KEY `idx_promotions_dates` (`start_date`,`end_date`),
  CONSTRAINT `fk_promotions_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_promotions_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `promotions` VALUES
(1,1,1,'First Trial Facial Glow','first_trial','percentage',30.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','30% off for first-time facial customers.','Valid once per customer for this salon.','2026-04-30 15:55:19','2026-04-30 15:55:19'),
(2,1,2,'Happy Hour Hair Treatment','happy_hour','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','15% off selected weekday off-peak slots.','Valid Monday to Thursday, 10:00 AM to 4:00 PM only.','2026-04-30 15:55:19','2026-04-30 18:12:36'),
(3,2,3,'1 For 1 Relaxing Massage','one_for_one','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Pay once and enjoy the same massage for two people.','Subject to double-slot availability. Same-time booking preferred.','2026-04-30 15:55:19','2026-04-30 18:12:36'),
(4,2,NULL,'Featured Salon Spotlight','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Featured salon campaign for premium visibility.','Featured placement only. No direct discount applied.','2026-04-30 15:55:19','2026-04-30 18:12:36'),
(5,3,4,'First Trial Scalp Therapy','first_trial','fixed_price',49.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Introductory scalp therapy price for new customers.','Valid once per customer at this salon.','2026-04-30 15:55:19','2026-04-30 18:12:36'),
(6,3,5,'Happy Hour Express Grooming','happy_hour','fixed_amount',10.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','$10 off selected grooming services during quiet hours.','Valid weekdays during listed promotion hours only.','2026-04-30 15:55:19','2026-04-30 18:12:36'),
(21,1,1,'First Trial Hair Refresh','first_trial','percentage',25.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','First-time customer hair refresh offer.','Valid once per customer for this salon.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(22,1,2,'Happy Hour Midday Facial','happy_hour','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Weekday facial discount during quieter hours.','Valid Monday to Thursday, 11:00 AM to 4:00 PM only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(23,1,3,'1 For 1 Nail Treats','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Bring a friend for a shared nail session.','Subject to same-time slot availability.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(24,2,4,'First Trial Body Glow','first_trial','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Introductory spa body treatment deal.','Valid once per customer for this merchant.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(25,2,5,'Happy Hour Afternoon Body Scrub','happy_hour','percentage',10.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Off-peak spa savings for flexible schedules.','Weekday afternoons only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(26,2,4,'1 For 1 Wellness Escape','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Book one wellness session and enjoy two.','Best used for pair bookings.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(27,3,6,'First Trial Grooming Cut','first_trial','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Try this barber service at an intro price.','New customers only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(28,3,7,'Happy Hour Quick Fade','happy_hour','percentage',5.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Small weekday discount for quick trims.','Valid during listed hours only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(29,3,6,'1 For 1 Grooming Duo','one_for_one','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Book together and enjoy better value.','Limited daily slots.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(30,1,NULL,'Featured Beauty Studio May','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Featured salon placement for May.','Homepage and featured salon visibility only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(31,2,NULL,'Featured Spa Escape','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Featured spa listing campaign.','Featured listing only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),
(32,3,NULL,'Featured Barber Spotlight','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59','active','Featured merchant visibility campaign.','Featured listing only.','2026-04-30 18:09:20','2026-04-30 18:12:36');

CREATE TABLE `promotion_redemptions` (
  `redemption_id` int NOT NULL AUTO_INCREMENT,
  `promotion_id` int NOT NULL,
  `user_id` int NOT NULL,
  `booking_id` int DEFAULT NULL,
  `redeemed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('reserved','used','cancelled') NOT NULL DEFAULT 'used',
  PRIMARY KEY (`redemption_id`),
  KEY `idx_redemptions_promotion` (`promotion_id`),
  KEY `idx_redemptions_user` (`user_id`),
  KEY `idx_redemptions_booking` (`booking_id`),
  CONSTRAINT `fk_redemptions_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_redemptions_promotion` FOREIGN KEY (`promotion_id`) REFERENCES `promotions` (`promotion_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_redemptions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `game_settings` (
  `setting_id` tinyint NOT NULL DEFAULT '1',
  `weekly_free_plays` int NOT NULL DEFAULT '1',
  `spend_per_bonus_play` decimal(10,2) NOT NULL DEFAULT '80.00',
  `bonus_plays_per_threshold` int NOT NULL DEFAULT '1',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `game_settings` VALUES (1,1,80.00,1,1,CURRENT_TIMESTAMP);

CREATE TABLE `game_wallets` (
  `user_id` int NOT NULL,
  `play_balance` int NOT NULL DEFAULT '0',
  `last_weekly_grant` date DEFAULT NULL,
  `bonus_milestones_granted` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_game_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `game_prizes` (
  `prize_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int DEFAULT NULL,
  `title` varchar(120) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `prize_type` enum('glints','voucher','benefit') NOT NULL DEFAULT 'voucher',
  `reward_value` int DEFAULT NULL,
  `weight` int NOT NULL DEFAULT '10',
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`prize_id`),
  KEY `fk_game_prize_salon` (`salon_id`),
  KEY `fk_game_prize_user` (`created_by`),
  CONSTRAINT `fk_game_prize_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_game_prize_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `game_prizes` VALUES
(1,NULL,'60 VaniGlints','Platform reward points added to the customer wallet.','glints',60,45,'active',NULL,CURRENT_TIMESTAMP),
(2,NULL,'$5 Beauty Voucher','Customer can use this as a future Vaniday benefit.','voucher',5,25,'active',NULL,CURRENT_TIMESTAMP),
(3,NULL,'Priority Booking Perk','Customer earns a platform benefit for a future booking.','benefit',NULL,15,'active',NULL,CURRENT_TIMESTAMP);

CREATE TABLE `game_plays` (
  `play_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `prize_id` int DEFAULT NULL,
  `prize_title` varchar(120) NOT NULL,
  `prize_type` enum('glints','voucher','benefit') NOT NULL,
  `reward_value` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`play_id`),
  KEY `fk_game_play_user` (`user_id`),
  KEY `fk_game_play_prize` (`prize_id`),
  CONSTRAINT `fk_game_play_prize` FOREIGN KEY (`prize_id`) REFERENCES `game_prizes` (`prize_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_game_play_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
