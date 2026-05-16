-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: vaniday_booking_system
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `booking_reschedule_requests`
--

DROP TABLE IF EXISTS `booking_reschedule_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `booking_reschedule_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `user_id` int NOT NULL,
  `merchant_id` int NOT NULL,
  `service_id` int NOT NULL,
  `old_booking_date` date NOT NULL,
  `old_timeslot` time DEFAULT NULL,
  `requested_booking_date` date NOT NULL,
  `requested_timeslot` time NOT NULL,
  `status` enum('auto_approved','pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
  `confidence_level` enum('high','medium','low') NOT NULL DEFAULT 'medium',
  `confidence_score` int NOT NULL DEFAULT '0',
  `decision_reason` varchar(255) DEFAULT NULL,
  `review_notes` text,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`request_id`),
  KEY `idx_reschedule_merchant_status` (`merchant_id`,`status`,`created_at`),
  KEY `idx_reschedule_booking` (`booking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `booking_reschedule_requests`
--

LOCK TABLES `booking_reschedule_requests` WRITE;
/*!40000 ALTER TABLE `booking_reschedule_requests` DISABLE KEYS */;
/*!40000 ALTER TABLE `booking_reschedule_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bookings` (
  `booking_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `merchant_id` int DEFAULT NULL,
  `service_id` int NOT NULL,
  `transaction_id` int DEFAULT NULL,
  `booking_date` date NOT NULL,
  `timeslot` time DEFAULT NULL,
  `status` enum('pending','confirmed','paid','checked_in','completed','cancelled') DEFAULT 'pending',
  `qr_code_token` varchar(255) DEFAULT NULL,
  `cancellation_reason` varchar(180) DEFAULT NULL,
  `refund_status` varchar(40) NOT NULL DEFAULT 'not_requested',
  `cancelled_at` datetime DEFAULT NULL,
  PRIMARY KEY (`booking_id`),
  KEY `user_id` (`user_id`),
  KEY `service_id` (`service_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `idx_bookings_merchant_service_slot` (`merchant_id`,`service_id`,`booking_date`,`timeslot`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`),
  CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
INSERT INTO `bookings` VALUES (1,1,3,6,NULL,'2026-05-02','10:00:00','pending','3.5hZQkaBOvB5EqhMqFhjMmmgtu7kBIU54hGN4DsJNzDo',NULL,'not_requested',NULL),(2,1,1,1,NULL,'2026-05-04','10:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL),(3,1,1,2,NULL,'2026-05-04','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL),(4,1,1,2,NULL,'2026-05-03','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL),(5,1,1,2,NULL,'2026-05-16','15:30:00','confirmed','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL),(6,6,1,1,NULL,'2026-05-27','14:00:00','confirmed','vaniday-beauty-studio-orchard',NULL,'not_requested',NULL),(7,1,2,4,NULL,'2026-05-29','13:00:00','checked_in',NULL,NULL,'not_requested',NULL);
/*!40000 ALTER TABLE `bookings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `category_id` int NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) NOT NULL,
  `icon_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES (1,'Hair',NULL),(2,'Facial',NULL),(3,'Nails',NULL),(4,'Massage',NULL),(5,'Barber',NULL);
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `daily_reward_settings`
--

DROP TABLE IF EXISTS `daily_reward_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_reward_settings` (
  `day_number` tinyint NOT NULL,
  `points` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`day_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_reward_settings`
--

LOCK TABLES `daily_reward_settings` WRITE;
/*!40000 ALTER TABLE `daily_reward_settings` DISABLE KEYS */;
INSERT INTO `daily_reward_settings` VALUES (1,10,'2026-05-06 02:29:02'),(2,10,'2026-05-06 02:29:02'),(3,20,'2026-05-06 02:29:02'),(4,20,'2026-05-06 02:29:02'),(5,30,'2026-05-06 02:29:02'),(6,50,'2026-05-06 02:29:02'),(7,100,'2026-05-06 02:29:02');
/*!40000 ALTER TABLE `daily_reward_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `daily_reward_wallets`
--

DROP TABLE IF EXISTS `daily_reward_wallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_reward_wallets` (
  `reward_wallet_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `cycle_start_date` date NOT NULL,
  `current_day` int NOT NULL DEFAULT '0',
  `last_claim_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reward_wallet_id`),
  UNIQUE KEY `uq_daily_reward_wallet_user` (`user_id`),
  CONSTRAINT `fk_daily_reward_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_reward_wallets`
--

LOCK TABLES `daily_reward_wallets` WRITE;
/*!40000 ALTER TABLE `daily_reward_wallets` DISABLE KEYS */;
INSERT INTO `daily_reward_wallets` VALUES (1,1,'2026-05-06',2,'2026-05-06','2026-05-02 03:30:41','2026-05-06 01:31:56'),(7,6,'2026-05-02',0,NULL,'2026-05-02 16:28:33','2026-05-02 16:28:33'),(8,7,'2026-05-03',0,NULL,'2026-05-03 12:13:36','2026-05-03 12:13:36');
/*!40000 ALTER TABLE `daily_reward_wallets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_plays`
--

DROP TABLE IF EXISTS `game_plays`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_plays`
--

LOCK TABLES `game_plays` WRITE;
/*!40000 ALTER TABLE `game_plays` DISABLE KEYS */;
INSERT INTO `game_plays` VALUES (1,1,1,'60 VaniGlints','glints',60,'2026-05-02 03:01:08'),(2,7,3,'Priority Booking Perk','benefit',NULL,'2026-05-03 12:20:14');
/*!40000 ALTER TABLE `game_plays` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_prizes`
--

DROP TABLE IF EXISTS `game_prizes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_prizes`
--

LOCK TABLES `game_prizes` WRITE;
/*!40000 ALTER TABLE `game_prizes` DISABLE KEYS */;
INSERT INTO `game_prizes` VALUES (1,NULL,'60 VaniGlints','Platform reward points added to the customer wallet.','glints',60,45,'active',NULL,'2026-05-01 13:37:55'),(2,NULL,'$5 Beauty Voucher','Customer can use this as a future Vaniday benefit.','voucher',5,25,'active',NULL,'2026-05-01 13:37:55'),(3,NULL,'Priority Booking Perk','Customer earns a platform benefit for a future booking.','benefit',NULL,15,'active',NULL,'2026-05-01 13:37:55');
/*!40000 ALTER TABLE `game_prizes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_settings`
--

DROP TABLE IF EXISTS `game_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_settings` (
  `setting_id` tinyint NOT NULL DEFAULT '1',
  `weekly_free_plays` int NOT NULL DEFAULT '1',
  `spend_per_bonus_play` decimal(10,2) NOT NULL DEFAULT '80.00',
  `bonus_plays_per_threshold` int NOT NULL DEFAULT '1',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_settings`
--

LOCK TABLES `game_settings` WRITE;
/*!40000 ALTER TABLE `game_settings` DISABLE KEYS */;
INSERT INTO `game_settings` VALUES (1,1,80.00,1,1,'2026-05-01 13:37:55');
/*!40000 ALTER TABLE `game_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_wallets`
--

DROP TABLE IF EXISTS `game_wallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_wallets` (
  `user_id` int NOT NULL,
  `play_balance` int NOT NULL DEFAULT '0',
  `last_weekly_grant` date DEFAULT NULL,
  `bonus_milestones_granted` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_game_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_wallets`
--

LOCK TABLES `game_wallets` WRITE;
/*!40000 ALTER TABLE `game_wallets` DISABLE KEYS */;
INSERT INTO `game_wallets` VALUES (1,7,'2026-05-01',5,'2026-05-06 01:36:47'),(7,0,'2026-04-23',0,'2026-05-03 12:20:19');
/*!40000 ALTER TABLE `game_wallets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `loyalty_rules`
--

DROP TABLE IF EXISTS `loyalty_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_rules` (
  `rule_id` int NOT NULL,
  `points_per_dollar` decimal(10,2) NOT NULL DEFAULT '10.00',
  `cashback_percent` decimal(5,2) NOT NULL DEFAULT '5.00',
  `min_points_to_redeem` int NOT NULL DEFAULT '100',
  `points_to_cash_rate` decimal(10,4) NOT NULL DEFAULT '0.0100',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `loyalty_rules`
--

LOCK TABLES `loyalty_rules` WRITE;
/*!40000 ALTER TABLE `loyalty_rules` DISABLE KEYS */;
INSERT INTO `loyalty_rules` VALUES (1,10.00,5.00,100,0.0100,1,'2026-05-01 18:47:04');
/*!40000 ALTER TABLE `loyalty_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `loyalty_transactions`
--

DROP TABLE IF EXISTS `loyalty_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_transactions` (
  `loyalty_transaction_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `source_receipt_id` varchar(80) DEFAULT NULL,
  `transaction_type` varchar(20) NOT NULL,
  `points_delta` int NOT NULL DEFAULT '0',
  `cashback_delta` decimal(10,2) NOT NULL DEFAULT '0.00',
  `description` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`loyalty_transaction_id`),
  UNIQUE KEY `uniq_loyalty_source_type` (`source_receipt_id`,`transaction_type`),
  KEY `idx_loyalty_user_created` (`user_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=150 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `loyalty_transactions`
--

LOCK TABLES `loyalty_transactions` WRITE;
/*!40000 ALTER TABLE `loyalty_transactions` DISABLE KEYS */;
INSERT INTO `loyalty_transactions` VALUES (1,1,'order-6','earn',280,1.40,'Earned from receipt 6','2026-05-03 11:49:33'),(2,1,'order-5','earn',280,1.40,'Earned from receipt 5','2026-05-03 11:49:33'),(29,1,'order-11','earn',320,1.60,'Earned from receipt 11','2026-05-03 12:00:56');
/*!40000 ALTER TABLE `loyalty_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `loyalty_wallets`
--

DROP TABLE IF EXISTS `loyalty_wallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `loyalty_wallets` (
  `user_id` int NOT NULL,
  `points_balance` int NOT NULL DEFAULT '0',
  `cashback_balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `lifetime_points` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `loyalty_wallets`
--

LOCK TABLES `loyalty_wallets` WRITE;
/*!40000 ALTER TABLE `loyalty_wallets` DISABLE KEYS */;
INSERT INTO `loyalty_wallets` VALUES (1,880,4.40,880,'2026-05-03 12:00:56'),(7,0,0.00,0,'2026-05-03 12:13:36');
/*!40000 ALTER TABLE `loyalty_wallets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `merchant_reschedule_settings`
--

DROP TABLE IF EXISTS `merchant_reschedule_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `merchant_reschedule_settings` (
  `salon_id` int NOT NULL,
  `auto_approve_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `minimum_notice_hours` int NOT NULL DEFAULT '24',
  `max_reschedules_allowed` int NOT NULL DEFAULT '2',
  `blocked_times` text,
  `peak_hour_restrictions` tinyint(1) NOT NULL DEFAULT '1',
  `business_start` time NOT NULL DEFAULT '09:00:00',
  `business_end` time NOT NULL DEFAULT '20:00:00',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`salon_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_reschedule_settings`
--

LOCK TABLES `merchant_reschedule_settings` WRITE;
/*!40000 ALTER TABLE `merchant_reschedule_settings` DISABLE KEYS */;
INSERT INTO `merchant_reschedule_settings` VALUES (1,1,24,2,'00:00, 00:30, 01:00, 01:30, 02:00, 02:30, 03:00, 03:30, 04:00, 04:30, 05:00, 05:30, 06:00, 06:30, 07:00, 07:30, 08:00, 08:30, 09:00',1,'09:00:00','21:00:00','2026-05-14 13:39:05');
/*!40000 ALTER TABLE `merchant_reschedule_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `recipient_user_id` int NOT NULL,
  `recipient_role` varchar(20) NOT NULL,
  `actor_user_id` int DEFAULT NULL,
  `notification_type` varchar(80) NOT NULL DEFAULT 'general',
  `title` varchar(180) NOT NULL,
  `message` text NOT NULL,
  `link_url` varchar(255) DEFAULT NULL,
  `status` enum('unread','read') NOT NULL DEFAULT 'unread',
  `dedupe_key` varchar(180) DEFAULT NULL,
  `metadata` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`notification_id`),
  UNIQUE KEY `uq_notifications_dedupe_key` (`dedupe_key`),
  KEY `idx_notifications_user_status` (`recipient_user_id`,`status`,`created_at`),
  KEY `idx_notifications_role` (`recipient_role`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
/*!40000 ALTER TABLE `notifications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `order_items`
--

DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `order_item_id` int NOT NULL AUTO_INCREMENT,
  `transaction_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `price_at_purchase` decimal(10,2) NOT NULL,
  `order_id` int DEFAULT NULL,
  PRIMARY KEY (`order_item_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `order_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `product_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock_quantity` int DEFAULT '0',
  `image_url` text,
  `description` text,
  `ingredients` text,
  `how_to_use` text,
  PRIMARY KEY (`product_id`),
  KEY `salon_id` (`salon_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (2,4,'Cetaphil Gentle Face Wash',30.00,10,'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=900&q=80','Gentle daily cleanser for fresh, soft-feeling skin.','Aqua, glycerin, mild cleansing agents','Massage onto damp skin, then rinse well.'),(3,1,'ANUA Heartleaf Quercetinol Pore Deep Cleansing Foam150 ml',20.00,11,'https://www.google.com/aclk?sa=L&ai=DChsSEwiEw8r5zKaUAxVHjmYCHXt3LCgYACICCAEQAxoCc20&co=1&ase=2&gclid=CjwKCAjwzevPBhBaEiwAplAxvvc-ba5OBVj8SJsaLBXyxAN4VO3E8Lei-KUcaJwaIwwZjtkPt7orxBoCCYcQAvD_BwE&cid=CAASuwHkaBu8zPygOutWmtcoQUe9_z32p78AJOk8lzSipHrGjphU5ntY4RVCbq06DC9r2rVz37DF3ubnoT-ezpKMrzdME8lfHk0pwLUH0pYiyaDZM5iLQWw7zkGkbnLovgjoD-nuMAHC9NUWg9WdkaevZKB3igNhSLdYjeOWF6_EabwfrDqOaAyu-0QhxsORYOETWXF1j_gyHrrRItG-GOsXlzV_IHKx6Z70-8a6gVGK6DD8hTojeXmWK2z0K4NL&cce=2&category=acrcp_v1_32&sig=AOD64_0D0Q9xmI1mYfxgVBqva1gNdvFEvg&ctype=5&q=&nis=4&ved=2ahUKEwi_xsL5zKaUAxXXXGwGHcJqJYsQ9aACKAB6BAgJEBo&adurl=','Deep cleanse your pores with ANUA Heartleaf Quercetinol Pore Deep Cleansing Foam. Formulated with heartleaf extract and quercetinol, this gentle yet effective cleanser helps to purify and refine your skin.','Water, Glycerin, Sodium Cocoyl Isethionate, Quercetinol, Heartleaf Extract, Xylitylglucoside, Anhydroxylitol, Xylitol, Disodium EDTA, Citric Acid, Phenoxyethanol','Massage a small amount onto damp skin, then rinse thoroughly with lukewarm water. Use twice a day for best results.');
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `promotion_redemptions`
--

DROP TABLE IF EXISTS `promotion_redemptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promotion_redemptions`
--

LOCK TABLES `promotion_redemptions` WRITE;
/*!40000 ALTER TABLE `promotion_redemptions` DISABLE KEYS */;
INSERT INTO `promotion_redemptions` VALUES (1,1,1,2,'2026-05-02 01:24:54','used'),(2,22,1,3,'2026-05-02 01:44:24','used'),(3,2,1,4,'2026-05-02 01:44:41','used'),(4,22,1,5,'2026-05-02 01:48:11','used');
/*!40000 ALTER TABLE `promotion_redemptions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `promotions`
--

DROP TABLE IF EXISTS `promotions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `allowed_slots` text,
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promotions`
--

LOCK TABLES `promotions` WRITE;
/*!40000 ALTER TABLE `promotions` DISABLE KEYS */;
INSERT INTO `promotions` VALUES (1,1,1,'First Trial Facial Glow','first_trial','percentage',30.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','30% off for first-time facial customers.','Valid once per customer for this salon.','2026-04-30 15:55:19','2026-04-30 15:55:19'),(2,1,2,'Happy Hour Hair Treatment','happy_hour','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','15% off selected weekday off-peak slots.','Valid Monday to Thursday, 10:00 AM to 4:00 PM only.','2026-04-30 15:55:19','2026-04-30 18:12:36'),(21,1,1,'First Trial Hair Refresh','first_trial','percentage',25.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','First-time customer hair refresh offer.','Valid once per customer for this salon.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(22,1,2,'Happy Hour Midday Facial','happy_hour','percentage',15.00,'2026-04-30 00:00:00','2026-06-30 00:00:00',NULL,'inactive','Weekday facial discount during quieter hours.','Valid Monday to Thursday, 11:00 AM to 4:00 PM only.','2026-04-30 18:09:20','2026-05-02 02:10:48'),(23,1,3,'1 For 1 Nail Treats','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Bring a friend for a shared nail session.','Subject to same-time slot availability.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(24,2,4,'First Trial Body Glow','first_trial','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Introductory spa body treatment deal.','Valid once per customer for this merchant.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(25,2,5,'Happy Hour Afternoon Body Scrub','happy_hour','percentage',10.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Off-peak spa savings for flexible schedules.','Weekday afternoons only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(26,2,4,'1 For 1 Wellness Escape','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book one wellness session and enjoy two.','Best used for pair bookings.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(27,3,6,'First Trial Grooming Cut','first_trial','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Try this barber service at an intro price.','New customers only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(28,3,7,'Happy Hour Quick Fade','happy_hour','percentage',5.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Small weekday discount for quick trims.','Valid during listed hours only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(29,3,6,'1 For 1 Grooming Duo','one_for_one','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book together and enjoy better value.','Limited daily slots.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(30,1,NULL,'Featured Beauty Studio May','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured salon placement for May.','Homepage and featured salon visibility only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(31,2,NULL,'Featured Spa Escape','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured spa listing campaign.','Featured listing only.','2026-04-30 18:09:20','2026-04-30 18:12:36'),(32,3,NULL,'Featured Barber Spotlight','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured merchant visibility campaign.','Featured listing only.','2026-04-30 18:09:20','2026-04-30 18:12:36');
/*!40000 ALTER TABLE `promotions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_history`
--

DROP TABLE IF EXISTS `purchase_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_history` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `receipt_id` varchar(64) NOT NULL,
  `user_id` int NOT NULL,
  `purchase_type` varchar(20) NOT NULL,
  `item_names` text NOT NULL,
  `items_json` json NOT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_status` varchar(50) DEFAULT 'paid',
  `delivery_status` varchar(30) NOT NULL DEFAULT 'processing',
  `refund_status` varchar(30) NOT NULL DEFAULT 'none',
  `refunded_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refunded_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`history_id`),
  UNIQUE KEY `uniq_purchase_history_receipt` (`receipt_id`),
  KEY `idx_purchase_history_user` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_history`
--

LOCK TABLES `purchase_history` WRITE;
/*!40000 ALTER TABLE `purchase_history` DISABLE KEYS */;
INSERT INTO `purchase_history` VALUES (1,'order-5',1,'product','Calming Body Oil','[{\"name\": \"Calming Body Oil\", \"type\": \"Product\", \"price\": 28, \"detail\": \"Bodycare\", \"quantity\": 1, \"lineTotal\": 28, \"serviceId\": \"body-oil\", \"unitPrice\": 28}]',28.00,'Card payment','paid','processing','none',0.00,NULL,'2026-05-01 18:35:55'),(3,'order-6',1,'product','Calming Body Oil','[{\"name\": \"Calming Body Oil\", \"type\": \"Product\", \"price\": 28, \"detail\": \"Bodycare\", \"quantity\": 1, \"lineTotal\": 28, \"serviceId\": \"body-oil\", \"unitPrice\": 28}]',28.00,'Card payment','paid','processing','none',0.00,NULL,'2026-05-01 18:49:39'),(4,'order-11',1,'product','Repair Hair Mask','[{\"name\": \"Repair Hair Mask\", \"type\": \"Product\", \"price\": 32, \"detail\": \"Haircare\", \"quantity\": 1, \"lineTotal\": 32, \"serviceId\": \"hair-mask\", \"unitPrice\": 32}]',32.00,'Card payment','paid','processing','none',0.00,NULL,'2026-05-03 12:00:55');
/*!40000 ALTER TABLE `purchase_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reviews`
--

DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `review_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `user_id` int NOT NULL,
  `merchant_id` int NOT NULL,
  `service_id` int NOT NULL,
  `rating` tinyint NOT NULL,
  `comment` text,
  `image_path` varchar(255) DEFAULT NULL,
  `video_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`review_id`),
  UNIQUE KEY `uq_reviews_booking` (`booking_id`),
  KEY `idx_reviews_merchant_created` (`merchant_id`,`created_at`),
  KEY `idx_reviews_user_created` (`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reviews`
--

LOCK TABLES `reviews` WRITE;
/*!40000 ALTER TABLE `reviews` DISABLE KEYS */;
/*!40000 ALTER TABLE `reviews` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reward_shop_vouchers`
--

DROP TABLE IF EXISTS `reward_shop_vouchers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reward_shop_vouchers` (
  `voucher_id` int NOT NULL AUTO_INCREMENT,
  `glints_cost` int NOT NULL,
  `voucher_value` decimal(10,2) NOT NULL,
  `title` varchar(120) NOT NULL,
  `detail` varchar(255) NOT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`voucher_id`),
  KEY `idx_reward_shop_vouchers_status_sort` (`status`,`sort_order`,`glints_cost`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reward_shop_vouchers`
--

LOCK TABLES `reward_shop_vouchers` WRITE;
/*!40000 ALTER TABLE `reward_shop_vouchers` DISABLE KEYS */;
INSERT INTO `reward_shop_vouchers` VALUES (1,1000,1.00,'$1 Off Booking','Best for stacking up small cashback-style redemptions.','active',10,'2026-05-06 02:07:21','2026-05-06 02:07:21'),(2,5000,5.00,'$5 Off Booking','A stronger offset for weekday treatments and quick services.','active',20,'2026-05-06 02:07:21','2026-05-06 02:07:21'),(3,10000,10.00,'$10 Off Booking','Ideal for premium facials, massages, and bundled appointments.','active',30,'2026-05-06 02:07:21','2026-05-06 02:07:21'),(4,15000,15.00,'$15 Off Booking','Higher-value reward for larger bookings and platform promos.','active',40,'2026-05-06 02:07:21','2026-05-06 02:07:21');
/*!40000 ALTER TABLE `reward_shop_vouchers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `salons`
--

DROP TABLE IF EXISTS `salons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `salons` (
  `salon_id` int NOT NULL AUTO_INCREMENT,
  `merchant_id` int NOT NULL,
  `salon_name` varchar(255) NOT NULL,
  `business_category` varchar(80) DEFAULT NULL,
  `uen` varchar(20) DEFAULT NULL,
  `years_in_business` int DEFAULT NULL,
  `staff_count` int DEFAULT NULL,
  `address` text,
  `description` text,
  `image_url` varchar(255) DEFAULT NULL,
  `commission_rate` decimal(5,2) NOT NULL DEFAULT '15.00',
  `slug` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`salon_id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `merchant_id` (`merchant_id`),
  CONSTRAINT `salons_ibfk_1` FOREIGN KEY (`merchant_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `salons`
--

LOCK TABLES `salons` WRITE;
/*!40000 ALTER TABLE `salons` DISABLE KEYS */;
INSERT INTO `salons` VALUES (1,3,'Vaniday Beauty Studio','Beauty Salon','202600001A',6,8,'Orchard','Hair styling, facials, and beauty treatments.',NULL,15.00,NULL),(2,4,'FreshGlow Spa','Spa','202600002B',4,6,'Tampines','Relaxing spa and body treatments.',NULL,15.00,NULL),(3,5,'Urban Groom Barbers','Barber','202600003C',5,4,'Woodlands','Haircuts, fades, and grooming services.',NULL,15.00,NULL),(4,2,'Vaniday Beauty Studio',NULL,NULL,NULL,NULL,'Singapore','Merchant storefront for product listings.',NULL,15.00,NULL);
/*!40000 ALTER TABLE `salons` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `service_inventory_links`
--

DROP TABLE IF EXISTS `service_inventory_links`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_inventory_links` (
  `service_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity_required` int NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`service_id`),
  KEY `idx_service_inventory_product` (`product_id`),
  CONSTRAINT `fk_service_inventory_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_service_inventory_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `service_inventory_links`
--

LOCK TABLES `service_inventory_links` WRITE;
/*!40000 ALTER TABLE `service_inventory_links` DISABLE KEYS */;
/*!40000 ALTER TABLE `service_inventory_links` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `service_slots`
--

DROP TABLE IF EXISTS `service_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_slots` (
  `slot_id` int NOT NULL AUTO_INCREMENT,
  `service_id` int NOT NULL,
  `timeslot` time NOT NULL,
  PRIMARY KEY (`slot_id`),
  UNIQUE KEY `uq_service_timeslot` (`service_id`,`timeslot`),
  CONSTRAINT `service_slots_ibfk_1` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `service_slots`
--

LOCK TABLES `service_slots` WRITE;
/*!40000 ALTER TABLE `service_slots` DISABLE KEYS */;
INSERT INTO `service_slots` VALUES (1,1,'10:00:00'),(2,1,'14:00:00'),(3,1,'17:00:00'),(4,2,'11:00:00'),(5,2,'15:30:00'),(6,2,'18:00:00'),(7,3,'12:00:00'),(8,3,'16:00:00'),(9,3,'18:30:00'),(10,4,'09:30:00'),(11,4,'13:00:00'),(12,4,'18:00:00'),(13,5,'10:30:00'),(14,5,'14:30:00'),(15,5,'17:30:00'),(16,6,'10:00:00'),(17,6,'13:30:00'),(18,6,'19:00:00'),(19,7,'11:00:00'),(20,7,'14:30:00'),(21,7,'17:00:00');
/*!40000 ALTER TABLE `service_slots` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `services`
--

DROP TABLE IF EXISTS `services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `service_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `category_id` int NOT NULL,
  `service_name` varchar(255) NOT NULL,
  `description` text,
  `duration_mins` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `package_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `package_sessions` int NOT NULL DEFAULT '0',
  `package_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`service_id`),
  KEY `salon_id` (`salon_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `services_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `services_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `services`
--

LOCK TABLES `services` WRITE;
/*!40000 ALTER TABLE `services` DISABLE KEYS */;
INSERT INTO `services` VALUES (1,1,1,'Hair Cut','Classic haircut and styling consultation.',45,35.00,0,0,0.00),(2,1,2,'Hydrating Facial','Moisturising facial for dry or dull skin.',60,68.00,0,0,0.00),(3,1,3,'Gel Manicure','Long-lasting gel manicure service.',60,55.00,0,0,0.00),(4,2,4,'Aromatherapy Massage','Relaxing full-body aromatherapy massage.',90,98.00,0,0,0.00),(5,2,4,'Body Scrub','Body exfoliation and spa care treatment.',60,72.00,0,0,0.00),(6,3,5,'Classic Haircut','Classic men haircut.',30,28.00,0,0,0.00),(7,3,5,'Skin Fade','Detailed fade haircut.',45,38.00,0,0,0.00);
/*!40000 ALTER TABLE `services` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `support_requests`
--

DROP TABLE IF EXISTS `support_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `customer_user_id` int NOT NULL,
  `merchant_user_id` int DEFAULT NULL,
  `admin_user_id` int DEFAULT NULL,
  `request_type` varchar(40) NOT NULL,
  `target_type` varchar(20) NOT NULL,
  `target_id` varchar(80) NOT NULL,
  `receipt_id` varchar(80) DEFAULT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'pending_admin_review',
  `merchant_decision` varchar(30) NOT NULL DEFAULT 'pending',
  `admin_decision` varchar(30) NOT NULL DEFAULT 'pending',
  `reason` varchar(160) DEFAULT NULL,
  `customer_note` text,
  `requested_change` text,
  `merchant_note` text,
  `admin_note` text,
  `refund_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `late_fee_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `is_late_cancellation` tinyint(1) NOT NULL DEFAULT '0',
  `delivery_status` varchar(30) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `idx_support_customer` (`customer_user_id`,`status`,`created_at`),
  KEY `idx_support_merchant` (`merchant_user_id`,`status`,`created_at`),
  KEY `idx_support_status` (`status`,`created_at`),
  KEY `idx_support_target` (`target_type`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_requests`
--

LOCK TABLES `support_requests` WRITE;
/*!40000 ALTER TABLE `support_requests` DISABLE KEYS */;
/*!40000 ALTER TABLE `support_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transactions`
--

DROP TABLE IF EXISTS `transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transactions` (
  `transaction_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `payment_status` enum('pending','paid','failed') DEFAULT 'pending',
  `payment_method` varchar(50) DEFAULT NULL,
  `delivery_status` varchar(30) NOT NULL DEFAULT 'processing',
  `shipped_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `refund_status` varchar(30) NOT NULL DEFAULT 'none',
  `refunded_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refunded_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `booking_id` int DEFAULT NULL,
  `order_item_id` int DEFAULT NULL,
  `order_id` int DEFAULT NULL,
  PRIMARY KEY (`transaction_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transactions`
--

LOCK TABLES `transactions` WRITE;
/*!40000 ALTER TABLE `transactions` DISABLE KEYS */;
INSERT INTO `transactions` VALUES (1,1,89.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:09:33',NULL,NULL,NULL),(2,1,32.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:19:33',NULL,NULL,NULL),(3,1,22.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:28:14',NULL,NULL,NULL),(4,1,28.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:32:11',NULL,NULL,NULL),(5,1,28.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:35:55',NULL,NULL,NULL),(6,1,28.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-01 18:49:39',NULL,NULL,NULL),(7,1,28.00,'paid','card','processing',NULL,NULL,'none',0.00,NULL,'2026-05-02 00:56:04',NULL,NULL,NULL),(8,1,35.00,'paid','card','processing',NULL,NULL,'none',0.00,NULL,'2026-05-02 01:25:03',NULL,NULL,NULL),(9,1,68.00,'paid','card','processing',NULL,NULL,'none',0.00,NULL,'2026-05-02 01:44:28',NULL,NULL,NULL),(10,1,68.00,'paid','card','processing',NULL,NULL,'none',0.00,NULL,'2026-05-02 01:48:20',NULL,NULL,NULL),(11,1,32.00,'paid','Card payment','processing',NULL,NULL,'none',0.00,NULL,'2026-05-03 12:00:55',NULL,NULL,NULL);
/*!40000 ALTER TABLE `transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Temporary view structure for view `user_history`
--

DROP TABLE IF EXISTS `user_history`;
/*!50001 DROP VIEW IF EXISTS `user_history`*/;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `user_history` AS SELECT 
 1 AS `transaction_id`,
 1 AS `user_id`,
 1 AS `total_amount`,
 1 AS `payment_method`,
 1 AS `payment_status`,
 1 AS `created_at`,
 1 AS `type`,
 1 AS `reference_id`,
 1 AS `description`*/;
SET character_set_client = @saved_cs_client;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `google_id` varchar(255) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `age` int DEFAULT NULL,
  `birthday` date DEFAULT NULL,
  `gender` enum('female','male','non_binary','prefer_not_to_say','other') DEFAULT NULL,
  `postal_code` varchar(6) DEFAULT NULL,
  `preferred_contact_method` enum('email','phone','whatsapp') DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `role` enum('customer','merchant','admin') DEFAULT 'customer',
  `glints_balance` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `referral_code` varchar(50) DEFAULT NULL,
  `referred_by_code` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_referred_by_code` (`referred_by_code`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,NULL,'mary','mary@mary.com','94477346',NULL,NULL,NULL,NULL,NULL,'$2b$10$V0J24b/4laUlBYcUc.gvve9U.mmAdsgVngrw9VqEgT.vwfCQ5hUQK','customer',80,'2026-04-29 06:37:32','VANI0001',NULL),(2,NULL,'Admin User','admin@vaniday.sg',NULL,NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','admin',0,'2026-04-30 06:12:21',NULL,NULL),(3,NULL,'Vaniday Beauty Merchant','beauty@vaniday.sg','81234561',NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL,NULL),(4,NULL,'FreshGlow Spa Merchant','spa@vaniday.sg','81234562',NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL,NULL),(5,NULL,'Urban Groom Merchant','barber@vaniday.sg','81234563',NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant',0,'2026-04-30 06:12:21',NULL,NULL),(6,NULL,'Angelo Casia','angelomiguelcasia@gmail.com',NULL,NULL,NULL,NULL,NULL,NULL,'$2b$12$os470VO4oeCLvDNvrZk2nOKpPqA.GpYzdstEMzWJeQ7l1e7nXmeEC','customer',0,'2026-05-02 16:28:33','VANI0006',NULL),(7,NULL,'Raphaela Lee','raphaelalee24@gmail.com','80298963',NULL,NULL,NULL,NULL,NULL,'$2b$12$L0D9Gmq4LDHRP7OB2Yq6FuHBD2CB5kspGefZrkW68F6/Hljx/SEaG','customer',0,'2026-05-03 12:13:36','VANI0007',NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `whatsapp_reminder_logs`
--

DROP TABLE IF EXISTS `whatsapp_reminder_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_reminder_logs` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `reminder_type` varchar(40) NOT NULL,
  `sent_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  UNIQUE KEY `uq_whatsapp_reminder_booking_type` (`booking_id`,`reminder_type`),
  KEY `idx_whatsapp_reminder_sent_at` (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `whatsapp_reminder_logs`
--

LOCK TABLES `whatsapp_reminder_logs` WRITE;
/*!40000 ALTER TABLE `whatsapp_reminder_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `whatsapp_reminder_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Final view structure for view `user_history`
--

/*!50001 DROP VIEW IF EXISTS `user_history`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `user_history` AS select `t`.`transaction_id` AS `transaction_id`,`t`.`user_id` AS `user_id`,`t`.`total_amount` AS `total_amount`,`t`.`payment_method` AS `payment_method`,`t`.`payment_status` AS `payment_status`,`t`.`created_at` AS `created_at`,'booking' AS `type`,`b`.`booking_id` AS `reference_id`,`s`.`service_name` AS `description` from ((`transactions` `t` join `bookings` `b` on((`t`.`booking_id` = `b`.`booking_id`))) join `services` `s` on((`b`.`service_id` = `s`.`service_id`))) where (`t`.`booking_id` is not null) union all select `t`.`transaction_id` AS `transaction_id`,`t`.`user_id` AS `user_id`,`t`.`total_amount` AS `total_amount`,`t`.`payment_method` AS `payment_method`,`t`.`payment_status` AS `payment_status`,`t`.`created_at` AS `created_at`,'product' AS `type`,`oi`.`order_item_id` AS `reference_id`,`p`.`name` AS `description` from ((`transactions` `t` join `order_items` `oi` on((`t`.`order_item_id` = `oi`.`order_item_id`))) join `products` `p` on((`oi`.`product_id` = `p`.`product_id`))) where (`t`.`order_item_id` is not null) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-14 22:01:57
