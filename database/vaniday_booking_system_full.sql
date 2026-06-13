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
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `audit_log_id` int NOT NULL AUTO_INCREMENT,
  `actor_user_id` int DEFAULT NULL,
  `actor_role` varchar(30) DEFAULT NULL,
  `action` varchar(80) NOT NULL,
  `entity_type` varchar(80) NOT NULL,
  `entity_id` varchar(80) DEFAULT NULL,
  `details_json` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_log_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `fk_audit_actor_user` (`actor_user_id`),
  CONSTRAINT `fk_audit_actor_user` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

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
  `user_id` int DEFAULT NULL,
  `guest_customer_name` varchar(100) DEFAULT NULL,
  `guest_email` varchar(100) DEFAULT NULL,
  `guest_phone` varchar(20) DEFAULT NULL,
  `merchant_id` int NOT NULL,
  `service_id` int NOT NULL,
  `transaction_id` int DEFAULT NULL,
  `booking_date` date NOT NULL,
  `timeslot` time NOT NULL,
  `status` enum('pending','confirmed','paid','checked_in','completed','cancelled','no_show') DEFAULT 'pending',
  `qr_code_token` varchar(255) DEFAULT NULL,
  `cancellation_reason` varchar(180) DEFAULT NULL,
  `refund_status` varchar(40) NOT NULL DEFAULT 'not_requested',
  `cancelled_at` datetime DEFAULT NULL,
  `checked_in_at` datetime DEFAULT NULL,
  PRIMARY KEY (`booking_id`),
  KEY `user_id` (`user_id`),
  KEY `service_id` (`service_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `idx_bookings_merchant_service_slot` (`merchant_id`,`service_id`,`booking_date`,`timeslot`),
  KEY `idx_bookings_user_date_status` (`user_id`,`booking_date`,`status`),
  CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `bookings_ibfk_2` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`),
  CONSTRAINT `bookings_ibfk_3` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
INSERT INTO `bookings` VALUES (1,1,NULL,NULL,NULL,3,6,NULL,'2026-05-02','10:00:00','confirmed','3.5hZQkaBOvB5EqhMqFhjMmmgtu7kBIU54hGN4DsJNzDo',NULL,'not_requested',NULL,NULL),(2,1,NULL,NULL,NULL,1,1,NULL,'2026-05-04','10:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(3,1,NULL,NULL,NULL,1,2,NULL,'2026-05-04','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(4,1,NULL,NULL,NULL,1,2,NULL,'2026-05-03','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(5,1,NULL,NULL,NULL,1,2,NULL,'2026-05-18','15:30:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(6,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',2,4,NULL,'2026-06-12','13:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(7,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',2,4,NULL,'2026-06-12','18:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(8,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-13','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(9,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',1,1,NULL,'2026-06-13','14:00:00','confirmed','vaniday-beauty-studio-orchard',NULL,'not_requested',NULL,NULL),(10,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',1,1,NULL,'2026-06-07','17:00:00','cancelled','vaniday-beauty-studio-orchard','Cancelled by WhatsApp reply','customer_cancelled_review','2026-06-05 00:22:11',NULL),(11,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-08','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(12,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-09','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(13,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-14','17:00:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(14,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,6,NULL,'2026-06-14','13:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(15,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-12','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(18,1,'mary','mary@mary.com','94477346',3,6,NULL,'2026-06-13','13:30:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(19,1,'mary','mary@mary.com','94477346',1,3,NULL,'2026-06-13','16:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL);
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
  `display_order` int NOT NULL DEFAULT '999',
  `category_scope` varchar(20) NOT NULL DEFAULT 'service',
  PRIMARY KEY (`category_id`),
  KEY `idx_categories_scope_order` (`category_scope`,`display_order`,`category_name`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES (1,'Hair',NULL,1,'service'),(2,'Spa',NULL,7,'service'),(3,'Nails',NULL,6,'service'),(4,'Massage',NULL,999,'service'),(5,'Barber',NULL,99,'service'),(6,'Sets',NULL,70,'product'),(7,'Makeup',NULL,50,'product'),(8,'Wellness',NULL,40,'product'),(9,'Bodycare',NULL,30,'product'),(10,'Skincare',NULL,20,'product'),(11,'Skincare',NULL,20,'product'),(12,'Haircare',NULL,10,'product'),(13,'Bodycare',NULL,30,'product'),(14,'Makeup',NULL,50,'product'),(15,'Wellness',NULL,40,'product'),(16,'Sets',NULL,70,'product'),(17,'Nailcare',NULL,60,'product');
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customer_addresses`
--

DROP TABLE IF EXISTS `customer_addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_addresses` (
  `address_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `label` varchar(80) NOT NULL DEFAULT 'Delivery address',
  `recipient_name` varchar(120) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `address_line1` varchar(255) NOT NULL,
  `address_line2` varchar(120) DEFAULT NULL,
  `postal_code` varchar(6) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `source_receipt_id` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`address_id`),
  UNIQUE KEY `uq_customer_addresses_user_receipt` (`user_id`,`source_receipt_id`),
  KEY `idx_customer_addresses_user_default` (`user_id`,`is_default`,`updated_at`),
  KEY `idx_customer_addresses_receipt` (`source_receipt_id`),
  CONSTRAINT `fk_customer_addresses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_addresses`
--

LOCK TABLES `customer_addresses` WRITE;
/*!40000 ALTER TABLE `customer_addresses` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_addresses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customer_carts`
--

DROP TABLE IF EXISTS `customer_carts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_carts` (
  `user_id` int NOT NULL,
  `cart_json` longtext NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_customer_carts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_carts`
--

LOCK TABLES `customer_carts` WRITE;
/*!40000 ALTER TABLE `customer_carts` DISABLE KEYS */;
INSERT INTO `customer_carts` VALUES (1,'[]','2026-06-11 13:23:22'),(6,'[]','2026-06-07 09:54:16');
/*!40000 ALTER TABLE `customer_carts` ENABLE KEYS */;
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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`day_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_reward_settings`
--

LOCK TABLES `daily_reward_settings` WRITE;
/*!40000 ALTER TABLE `daily_reward_settings` DISABLE KEYS */;
INSERT INTO `daily_reward_settings` VALUES (1,20,'2026-06-09 05:09:32'),(2,30,'2026-06-09 05:09:32'),(3,40,'2026-06-09 05:09:32'),(4,50,'2026-06-09 05:09:32'),(5,60,'2026-06-09 05:09:32'),(6,80,'2026-06-09 05:09:32'),(7,100,'2026-06-09 05:09:32');
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
) ENGINE=InnoDB AUTO_INCREMENT=58 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_reward_wallets`
--

LOCK TABLES `daily_reward_wallets` WRITE;
/*!40000 ALTER TABLE `daily_reward_wallets` DISABLE KEYS */;
INSERT INTO `daily_reward_wallets` VALUES (1,1,'2026-05-01',2,'2026-06-04','2026-05-01 19:30:41','2026-06-03 16:58:47'),(7,6,'2026-06-04',1,'2026-06-04','2026-06-03 05:08:44','2026-06-04 10:41:47'),(56,12,'2026-06-11',0,NULL,'2026-06-11 13:43:50','2026-06-11 13:43:50'),(57,13,'2026-06-11',0,NULL,'2026-06-11 13:48:35','2026-06-11 13:48:35');
/*!40000 ALTER TABLE `daily_reward_wallets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `favourite_merchants`
--

DROP TABLE IF EXISTS `favourite_merchants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `favourite_merchants` (
  `user_id` int NOT NULL,
  `merchant_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`merchant_id`),
  KEY `idx_favourite_merchants_merchant` (`merchant_id`),
  CONSTRAINT `fk_favourite_merchants_merchant` FOREIGN KEY (`merchant_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_favourite_merchants_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `favourite_merchants`
--

LOCK TABLES `favourite_merchants` WRITE;
/*!40000 ALTER TABLE `favourite_merchants` DISABLE KEYS */;
/*!40000 ALTER TABLE `favourite_merchants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `spin_settings`
--

DROP TABLE IF EXISTS `spin_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `spin_settings` (
  `setting_id` tinyint NOT NULL DEFAULT '1',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `token_expiry_days` int NOT NULL DEFAULT '30',
  `try_again_weight` int NOT NULL DEFAULT '8',
  `platform_points_weight` int NOT NULL DEFAULT '6',
  `platform_cashback_weight` int NOT NULL DEFAULT '4',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `spin_settings`
--

LOCK TABLES `spin_settings` WRITE;
/*!40000 ALTER TABLE `spin_settings` DISABLE KEYS */;
INSERT INTO `spin_settings` (`setting_id`, `is_enabled`, `token_expiry_days`, `try_again_weight`, `platform_points_weight`, `platform_cashback_weight`) VALUES (1,1,30,8,6,4);
/*!40000 ALTER TABLE `spin_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `spin_tokens`
--

DROP TABLE IF EXISTS `spin_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `spin_tokens` (
  `token_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `source_type` enum('booking','order','manual') NOT NULL,
  `source_transaction_id` int DEFAULT NULL,
  `source_reference_id` int DEFAULT NULL,
  `status` enum('available','used','expired') NOT NULL DEFAULT 'available',
  `earned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_id`),
  UNIQUE KEY `uq_spin_token_source` (`user_id`,`source_type`,`source_transaction_id`),
  KEY `idx_spin_tokens_user_status_expiry` (`user_id`,`status`,`expires_at`),
  KEY `idx_spin_tokens_source_transaction` (`source_transaction_id`),
  CONSTRAINT `fk_spin_tokens_transaction` FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_spin_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `spin_tokens`
--

LOCK TABLES `spin_tokens` WRITE;
/*!40000 ALTER TABLE `spin_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `spin_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `spin_results`
--

DROP TABLE IF EXISTS `spin_results`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `spin_results` (
  `result_id` int NOT NULL AUTO_INCREMENT,
  `token_id` int NOT NULL,
  `user_id` int NOT NULL,
  `reward_type` enum('promotion','service_discount','product_discount','voucher','loyalty_points','cashback','try_again') NOT NULL,
  `reward_source_type` varchar(40) DEFAULT NULL,
  `reward_source_id` int DEFAULT NULL,
  `title` varchar(180) NOT NULL,
  `description` text,
  `reward_value` decimal(10,2) DEFAULT NULL,
  `reward_payload_json` json DEFAULT NULL,
  `status` enum('claimed','no_prize','failed') NOT NULL DEFAULT 'claimed',
  `user_voucher_id` int DEFAULT NULL,
  `loyalty_transaction_id` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`result_id`),
  UNIQUE KEY `uq_spin_results_token` (`token_id`),
  KEY `idx_spin_results_user_created` (`user_id`,`created_at`),
  KEY `idx_spin_results_reward_source` (`reward_source_type`,`reward_source_id`),
  KEY `fk_spin_results_voucher` (`user_voucher_id`),
  CONSTRAINT `fk_spin_results_token` FOREIGN KEY (`token_id`) REFERENCES `spin_tokens` (`token_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spin_results_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spin_results_voucher` FOREIGN KEY (`user_voucher_id`) REFERENCES `user_vouchers` (`user_voucher_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `spin_results`
--

LOCK TABLES `spin_results` WRITE;
/*!40000 ALTER TABLE `spin_results` DISABLE KEYS */;
/*!40000 ALTER TABLE `spin_results` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gift_card_amounts`
--

DROP TABLE IF EXISTS `gift_card_amounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gift_card_amounts` (
  `gift_card_amount_id` int NOT NULL AUTO_INCREMENT,
  `amount` decimal(10,2) NOT NULL,
  `label` varchar(80) DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`gift_card_amount_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gift_card_amounts`
--

LOCK TABLES `gift_card_amounts` WRITE;
/*!40000 ALTER TABLE `gift_card_amounts` DISABLE KEYS */;
INSERT INTO `gift_card_amounts` VALUES (1,20.00,'$20',10,1,'2026-06-08 15:40:52'),(2,50.00,'$50',20,1,'2026-06-09 05:07:25'),(3,100.00,'$100',30,1,'2026-06-09 05:07:25'),(4,200.00,'$200',40,1,'2026-06-09 05:07:25');
/*!40000 ALTER TABLE `gift_card_amounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gift_card_settings`
--

DROP TABLE IF EXISTS `gift_card_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gift_card_settings` (
  `setting_key` varchar(60) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gift_card_settings`
--

LOCK TABLES `gift_card_settings` WRITE;
/*!40000 ALTER TABLE `gift_card_settings` DISABLE KEYS */;
INSERT INTO `gift_card_settings` VALUES ('is_enabled','1','2026-06-09 05:10:11'),('max_amount','500','2026-06-09 05:10:11'),('min_amount','20','2026-06-09 05:10:11'),('validity_months','12','2026-06-09 05:10:11');
/*!40000 ALTER TABLE `gift_card_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gift_card_terms`
--

DROP TABLE IF EXISTS `gift_card_terms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gift_card_terms` (
  `gift_card_term_id` int NOT NULL AUTO_INCREMENT,
  `term_text` varchar(500) NOT NULL,
  `sort_order` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`gift_card_term_id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gift_card_terms`
--

LOCK TABLES `gift_card_terms` WRITE;
/*!40000 ALTER TABLE `gift_card_terms` DISABLE KEYS */;
INSERT INTO `gift_card_terms` VALUES (1,'Gift cards are redeemable for Vaniday beauty, salon, spa, and grooming appointments.',10,1,'2026-06-08 15:37:00'),(2,'Gift cards are valid for 12 months from the purchase date.',20,1,'2026-06-08 15:37:00'),(3,'Gift cards cannot be exchanged for cash or refunded after purchase.',30,1,'2026-06-08 15:37:00'),(4,'Gift card value can be used across multiple appointments until the balance is fully redeemed.',40,1,'2026-06-08 15:37:00'),(5,'Lost, stolen, or expired gift cards cannot be replaced.',50,1,'2026-06-08 15:37:00'),(6,'Gift cards cannot be used with other vouchers unless stated by Vaniday.',60,1,'2026-06-08 15:37:00'),(7,'Gift cards are redeemable for Vaniday beauty, salon, spa, and grooming appointments.',10,1,'2026-06-08 15:38:27'),(8,'Gift cards are valid for 12 months from the purchase date.',20,1,'2026-06-08 15:38:27'),(9,'Gift cards cannot be exchanged for cash or refunded after purchase.',30,1,'2026-06-08 15:38:27'),(10,'Gift card value can be used across multiple appointments until the balance is fully redeemed.',40,1,'2026-06-08 15:38:27'),(11,'Lost, stolen, or expired gift cards cannot be replaced.',50,1,'2026-06-08 15:38:27'),(12,'Gift cards cannot be used with other vouchers unless stated by Vaniday.',60,1,'2026-06-08 15:38:27'),(13,'Gift cards are valid for eligible Vaniday purchases only.',10,1,'2026-06-09 05:07:25'),(14,'Unused balances remain available until the stated expiry date.',20,1,'2026-06-09 05:07:25'),(15,'Gift cards are non-refundable and cannot be exchanged for cash.',30,1,'2026-06-09 05:07:25');
/*!40000 ALTER TABLE `gift_card_terms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `gift_card_vouchers`
--

DROP TABLE IF EXISTS `gift_card_vouchers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gift_card_vouchers` (
  `gift_card_voucher_id` int NOT NULL AUTO_INCREMENT,
  `voucher_code` varchar(40) NOT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `sender_user_id` int DEFAULT NULL,
  `sender_name` varchar(120) DEFAULT NULL,
  `recipient_name` varchar(120) DEFAULT NULL,
  `recipient_email` varchar(255) DEFAULT NULL,
  `message` text,
  `delivery_option` varchar(20) NOT NULL DEFAULT 'self',
  `scheduled_send_date` datetime DEFAULT NULL,
  `expiry_date` datetime DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `source_reference` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`gift_card_voucher_id`),
  UNIQUE KEY `uq_gift_card_voucher_code` (`voucher_code`),
  UNIQUE KEY `uq_gift_card_voucher_source` (`source_reference`),
  KEY `fk_giftcard_sender_user` (`sender_user_id`),
  CONSTRAINT `fk_giftcard_sender_user` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `gift_card_vouchers`
--

LOCK TABLES `gift_card_vouchers` WRITE;
/*!40000 ALTER TABLE `gift_card_vouchers` DISABLE KEYS */;
/*!40000 ALTER TABLE `gift_card_vouchers` ENABLE KEYS */;
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
  `max_discount_percent` decimal(5,2) NOT NULL DEFAULT '20.00',
  `points_expiry_days` int NOT NULL DEFAULT '365',
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
INSERT INTO `loyalty_rules` VALUES (1,10.00,5.00,100,0.0100,20.00,365,1,'2026-05-01 10:47:04');
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
  `campaign_id` int DEFAULT NULL,
  `salon_id` int DEFAULT NULL,
  `transaction_type` varchar(20) NOT NULL,
  `points_delta` int NOT NULL DEFAULT '0',
  `cashback_delta` decimal(10,2) NOT NULL DEFAULT '0.00',
  `description` varchar(255) NOT NULL,
  `expires_at` datetime DEFAULT NULL,
  `booking_reference` varchar(80) DEFAULT NULL,
  `merchant_name` varchar(120) DEFAULT NULL,
  `reward_discount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`loyalty_transaction_id`),
  UNIQUE KEY `uniq_loyalty_source_type` (`source_receipt_id`,`transaction_type`),
  KEY `idx_loyalty_user_created` (`user_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `loyalty_transactions`
--

LOCK TABLES `loyalty_transactions` WRITE;
/*!40000 ALTER TABLE `loyalty_transactions` DISABLE KEYS */;
INSERT INTO `loyalty_transactions` VALUES (1,1,'order-11',NULL,NULL,'EARNED',320,1.60,'Earned points and platform cashback from receipt 11','2027-06-03 21:46:00','11','Any merchant',0.00,'2026-06-03 13:46:00'),(2,1,'order-6',NULL,NULL,'EARNED',280,1.40,'Earned points and platform cashback from receipt 6','2027-06-04 01:23:11','6','Bodycare',0.00,'2026-06-03 17:23:11'),(3,1,'order-5',NULL,NULL,'EARNED',280,1.40,'Earned points and platform cashback from receipt 5','2027-06-04 01:23:11','5','Bodycare',0.00,'2026-06-03 17:23:11'),(4,6,'order-12',NULL,NULL,'EARNED',189,0.95,'Earned points and platform cashback from receipt 12','2027-06-07 17:15:40','12','Any merchant',0.00,'2026-06-07 09:15:40'),(5,6,'cashback-order-13',NULL,NULL,'CASHBACK_USED',0,-0.95,'Cashback used at checkout for order-13',NULL,NULL,NULL,0.00,'2026-06-07 09:54:16'),(6,6,'order-13',NULL,NULL,'EARNED',179,0.90,'Earned points and platform cashback from receipt 13','2027-06-07 17:54:16','13','Any merchant',0.00,'2026-06-07 09:54:16'),(7,1,'order-14',NULL,NULL,'EARNED',89,0.45,'Earned points and platform cashback from receipt 14','2027-06-08 21:34:14','14','Any merchant',0.00,'2026-06-08 13:34:14'),(8,1,'order-15',NULL,NULL,'EARNED',151,0.76,'Earned points and platform cashback from receipt 15','2027-06-08 21:52:12','15','Any merchant',0.00,'2026-06-08 13:52:12'),(9,1,'order-16',NULL,NULL,'EARNED',785,3.93,'Earned points and platform cashback from receipt 16','2027-06-08 22:48:17','16','Delivery',0.00,'2026-06-08 14:48:17'),(10,1,'cashback-order-23',NULL,NULL,'CASHBACK_USED',0,-9.54,'Cashback used at checkout for order-23',NULL,NULL,NULL,0.00,'2026-06-11 13:12:39'),(11,1,'order-23',NULL,NULL,'EARNED',93,0.47,'Earned points and platform cashback from receipt 23','2027-06-11 21:12:39','23','Any merchant',0.00,'2026-06-11 13:12:39'),(12,1,'cashback-order-24',NULL,NULL,'CASHBACK_USED',0,-0.47,'Cashback used at checkout for order-24',NULL,NULL,NULL,0.00,'2026-06-11 13:23:22'),(13,1,'order-24',NULL,NULL,'EARNED',473,2.37,'Earned points and platform cashback from receipt 24','2027-06-11 21:23:22','24','Any merchant',0.00,'2026-06-11 13:23:22');
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
INSERT INTO `loyalty_wallets` VALUES (1,2471,2.37,2471,'2026-06-11 13:23:22'),(6,368,0.90,368,'2026-06-07 09:54:16'),(12,0,0.00,0,'2026-06-11 13:43:56'),(13,0,0.00,0,'2026-06-11 13:48:36');
/*!40000 ALTER TABLE `loyalty_wallets` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `merchant_cashback_campaigns`
--

DROP TABLE IF EXISTS `merchant_cashback_campaigns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `merchant_cashback_campaigns` (
  `campaign_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `title` varchar(120) NOT NULL,
  `cashback_percent` decimal(5,2) NOT NULL,
  `minimum_spend` decimal(10,2) NOT NULL DEFAULT '0.00',
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `status` enum('draft','active','inactive','expired') NOT NULL DEFAULT 'draft',
  `applicable_type` enum('products','services','both') NOT NULL DEFAULT 'both',
  `created_by_user_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`campaign_id`),
  KEY `idx_cashback_campaign_salon_status_dates` (`salon_id`,`status`,`start_at`,`end_at`),
  KEY `idx_cashback_campaign_lookup` (`salon_id`,`status`,`applicable_type`,`minimum_spend`),
  KEY `idx_cashback_campaign_creator` (`created_by_user_id`),
  CONSTRAINT `fk_cashback_campaign_creator` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_cashback_campaign_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_cashback_campaigns`
--

LOCK TABLES `merchant_cashback_campaigns` WRITE;
/*!40000 ALTER TABLE `merchant_cashback_campaigns` DISABLE KEYS */;
/*!40000 ALTER TABLE `merchant_cashback_campaigns` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `merchant_loyalty_rules`
--

DROP TABLE IF EXISTS `merchant_loyalty_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `merchant_loyalty_rules` (
  `merchant_id` int NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `max_discount_percent` decimal(5,2) DEFAULT NULL,
  `promotion_label` varchar(120) DEFAULT NULL,
  `promotion_multiplier` decimal(5,2) NOT NULL DEFAULT '1.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_loyalty_rules`
--

LOCK TABLES `merchant_loyalty_rules` WRITE;
/*!40000 ALTER TABLE `merchant_loyalty_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `merchant_loyalty_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `merchant_loyalty_services`
--

DROP TABLE IF EXISTS `merchant_loyalty_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `merchant_loyalty_services` (
  `merchant_id` int NOT NULL,
  `service_id` int NOT NULL,
  `redemption_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`merchant_id`,`service_id`),
  KEY `idx_merchant_loyalty_service` (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_loyalty_services`
--

LOCK TABLES `merchant_loyalty_services` WRITE;
/*!40000 ALTER TABLE `merchant_loyalty_services` DISABLE KEYS */;
/*!40000 ALTER TABLE `merchant_loyalty_services` ENABLE KEYS */;
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
  `auto_approve_bookings` tinyint(1) NOT NULL DEFAULT '1',
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
INSERT INTO `merchant_reschedule_settings` VALUES (1,1,1,24,2,NULL,1,'09:00:00','20:00:00','2026-06-03 05:10:07'),(2,1,1,24,2,NULL,1,'09:00:00','20:00:00','2026-06-03 05:01:20'),(3,1,1,24,2,NULL,1,'09:00:00','20:00:00','2026-06-03 17:06:07');
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
) ENGINE=InnoDB AUTO_INCREMENT=99 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
INSERT INTO `notifications` VALUES (1,6,'customer',4,'booking_confirmed','Booking request submitted','Aromatherapy Massage at FreshGlow Spa is booked for Fri Jun 12 at 13:00.','/receipt/6','unread','web-booking-customer-6',NULL,'2026-06-03 05:27:10',NULL),(2,4,'merchant',6,'booking','New booking received','Angelo Casia booked Aromatherapy Massage for Fri Jun 12 at 13:00.','/merchant/bookings','unread','web-booking-merchant-6',NULL,'2026-06-03 05:27:10',NULL),(3,2,'admin',6,'booking','New customer booking','Angelo Casia booked Aromatherapy Massage at FreshGlow Spa.','/admin/bookings','unread','web-booking-admin-6-2',NULL,'2026-06-03 05:27:10',NULL),(4,6,'customer',4,'booking_confirmed','Booking request submitted','Aromatherapy Massage at FreshGlow Spa is booked for Fri Jun 12 at 18:00.','/receipt/7','unread','web-booking-customer-7',NULL,'2026-06-03 05:46:49',NULL),(5,4,'merchant',6,'booking','New booking received','Angelo Casia booked Aromatherapy Massage for Fri Jun 12 at 18:00.','/merchant/bookings','unread','web-booking-merchant-7',NULL,'2026-06-03 05:46:49',NULL),(6,2,'admin',6,'booking','New customer booking','Angelo Casia booked Aromatherapy Massage at FreshGlow Spa.','/admin/bookings','unread','web-booking-admin-7-2',NULL,'2026-06-03 05:46:49',NULL),(7,3,'merchant',3,'stock_update','Stock updated','Product stock increased by 1.','/merchant/products','unread','merchant-stock-updated-6-1780491109964',NULL,'2026-06-03 12:51:49',NULL),(8,2,'admin',3,'stock_update','Merchant restocked a product','Merchant product #6 stock increased by 1.','/admin/products','unread','admin-stock-updated-6-1780491109964-2',NULL,'2026-06-03 12:51:49',NULL),(9,3,'merchant',3,'product_update','Product listed','EFFACLAR ULTRA CONCENTRATED SERUM is now available in the Vaniday product catalogue.','/merchant/products','unread','merchant-product-created-7-3',NULL,'2026-06-03 13:06:04',NULL),(10,1,'customer',3,'product_update','New beauty product added','Vaniday Beauty Studio added EFFACLAR ULTRA CONCENTRATED SERUM to the Vaniday shop.','/products','unread','customer-product-created-7-1',NULL,'2026-06-03 13:06:04',NULL),(11,2,'admin',3,'product_update','Merchant listed a product','Vaniday Beauty Studio listed EFFACLAR ULTRA CONCENTRATED SERUM.','/admin/products','unread','admin-product-created-7-2',NULL,'2026-06-03 13:06:04',NULL),(12,6,'customer',3,'product_update','New beauty product added','Vaniday Beauty Studio added EFFACLAR ULTRA CONCENTRATED SERUM to the Vaniday shop.','/products','unread','customer-product-created-7-6',NULL,'2026-06-03 13:06:04',NULL),(13,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($32.00).','/receipt/order-11','unread','payment-customer-order-11','{\"receiptId\":\"order-11\",\"transactionId\":11}','2026-06-03 13:46:00',NULL),(14,2,'admin',1,'order_paid','Paid order completed','mary completed a $32.00 checkout.','/admin','unread','payment-admin-order-11-2','{\"receiptId\":\"order-11\",\"transactionId\":11}','2026-06-03 13:46:00',NULL),(15,2,'admin',2,'reward_update','Reward voucher created','$5 OFF BOOKING was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780505887281-2',NULL,'2026-06-03 16:58:07',NULL),(16,6,'customer',2,'reward_update','New reward voucher','$5 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780505887281-6',NULL,'2026-06-03 16:58:07',NULL),(17,1,'customer',2,'reward_update','New reward voucher','$5 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780505887281-1',NULL,'2026-06-03 16:58:07',NULL),(18,1,'customer',NULL,'reward_update','Daily reward claimed','10 VaniGlints were added to your reward balance.','/reward-shop','unread','customer-daily-reward-1-2026-06-03',NULL,'2026-06-03 16:58:47',NULL),(19,2,'admin',2,'reward_update','Reward voucher created','$10 off booking was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506014526-2',NULL,'2026-06-03 17:00:14',NULL),(20,6,'customer',2,'reward_update','New reward voucher','$10 off booking is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506014526-6',NULL,'2026-06-03 17:00:14',NULL),(21,1,'customer',2,'reward_update','New reward voucher','$10 off booking is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506014526-1',NULL,'2026-06-03 17:00:14',NULL),(22,6,'customer',2,'reward_update','New reward voucher','$20 is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506068381-6',NULL,'2026-06-03 17:01:08',NULL),(23,1,'customer',2,'reward_update','New reward voucher','$20 is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506068381-1',NULL,'2026-06-03 17:01:08',NULL),(24,2,'admin',2,'reward_update','Reward voucher created','$20 was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506068381-2',NULL,'2026-06-03 17:01:08',NULL),(25,6,'customer',2,'reward_update','New reward voucher','$50 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506107596-6',NULL,'2026-06-03 17:01:47',NULL),(26,1,'customer',2,'reward_update','New reward voucher','$50 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506107596-1',NULL,'2026-06-03 17:01:47',NULL),(27,2,'admin',2,'reward_update','Reward voucher created','$50 OFF BOOKING was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506107597-2',NULL,'2026-06-03 17:01:47',NULL),(28,1,'customer',NULL,'reward_update','Voucher redeemed','$5 OFF BOOKING was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-1',NULL,'2026-06-03 17:25:12',NULL),(29,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Ladies Haircut was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-2',NULL,'2026-06-03 17:28:43',NULL),(30,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off booking was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-3',NULL,'2026-06-03 17:28:45',NULL),(31,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-4',NULL,'2026-06-03 17:28:52',NULL),(32,1,'customer',NULL,'reward_update','Voucher redeemed','24.99% OFF Skin Fade was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-5',NULL,'2026-06-03 17:28:58',NULL),(33,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Hydrating Face Mask was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-6',NULL,'2026-06-03 17:29:06',NULL),(34,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-7',NULL,'2026-06-03 17:29:22',NULL),(35,1,'customer',NULL,'reward_update','Voucher redeemed','20% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-8',NULL,'2026-06-03 17:46:33',NULL),(36,6,'customer',2,'reward_update','New reward voucher','$10 off is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780513065595-6',NULL,'2026-06-03 18:57:45',NULL),(37,1,'customer',2,'reward_update','New reward voucher','$10 off is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780513065595-1',NULL,'2026-06-03 18:57:45',NULL),(38,2,'admin',2,'reward_update','Reward voucher created','$10 off was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780513065596-2',NULL,'2026-06-03 18:57:45',NULL),(39,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-9',NULL,'2026-06-03 18:58:04',NULL),(40,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-13 at 14:30.','/receipt/8','unread','booking-created-customer-8','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:57',NULL),(41,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-13 at 14:30.','/merchant/schedule','unread','booking-created-merchant-8','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:57',NULL),(42,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-8-2','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:58',NULL),(43,6,'customer',3,'booking_confirmed','Booking request confirmed','Hair Cut at Vaniday Beauty Studio is booked for 2026-06-13 at 14:00.','/receipt/9','unread','booking-created-customer-9','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(44,3,'merchant',6,'booking','New booking received','Angelo Casia booked Hair Cut for 2026-06-13 at 14:00.','/merchant/schedule','unread','booking-created-merchant-9','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(45,2,'admin',6,'booking','New customer booking','Angelo Casia booked Hair Cut at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-9-2','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(46,6,'customer',3,'booking_confirmed','Booking request confirmed','Hair Cut at Vaniday Beauty Studio is booked for 2026-06-07 at 17:00.','/receipt/10','unread','booking-created-customer-10','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(47,3,'merchant',6,'booking','New booking received','Angelo Casia booked Hair Cut for 2026-06-07 at 17:00.','/merchant/schedule','unread','booking-created-merchant-10','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(48,2,'admin',6,'booking','New customer booking','Angelo Casia booked Hair Cut at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-10-2','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(49,6,'customer',NULL,'reward_update','Daily reward claimed','10 VaniGlints were added to your reward balance.','/reward-shop','unread','customer-daily-reward-6-2026-06-04',NULL,'2026-06-04 10:41:47',NULL),(50,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-08 at 14:30.','/receipt/11','unread','booking-created-customer-11','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(51,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-08 at 14:30.','/merchant/schedule','unread','booking-created-merchant-11','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(52,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-11-2','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(53,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-09 at 14:30.','/receipt/12','unread','booking-created-customer-12','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(54,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-09 at 14:30.','/merchant/schedule','unread','booking-created-merchant-12','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(55,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-12-2','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(56,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-14 at 17:00.','/receipt/13','unread','booking-created-customer-13','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(57,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-14 at 17:00.','/merchant/schedule','unread','booking-created-merchant-13','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(58,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-13-2','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(59,6,'customer',5,'booking_confirmed','Booking request confirmed','Classic Haircut at Urban Groom Barbers is booked for 2026-06-14 at 13:30.','/receipt/14','unread','booking-created-customer-14','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(60,5,'merchant',6,'booking','New booking received','Angelo Casia booked Classic Haircut for 2026-06-14 at 13:30.','/merchant/schedule','unread','booking-created-merchant-14','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(61,2,'admin',6,'booking','New customer booking','Angelo Casia booked Classic Haircut at Urban Groom Barbers.','/admin','unread','booking-created-admin-14-2','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(62,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-12 at 14:30.','/receipt/15','unread','booking-created-customer-15','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(63,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-12 at 14:30.','/merchant/schedule','unread','booking-created-merchant-15','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(64,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-15-2','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(65,6,'customer',NULL,'booking_cancelled','Booking cancelled via WhatsApp','Hair Cut at Vaniday Beauty Studio was cancelled from WhatsApp.','/profile#bookings','unread','whatsapp-cancel-customer-10','{\"bookingId\":10}','2026-06-04 16:22:11',NULL),(66,3,'merchant',6,'booking_cancelled','Customer cancelled via WhatsApp','Angelo Casia cancelled Hair Cut for 2026-06-06 at 17:00.','/merchant/bookings','unread','whatsapp-cancel-merchant-10','{\"bookingId\":10}','2026-06-04 16:22:11',NULL),(67,6,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.90).','/receipt/order-12','unread','payment-customer-order-12','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(68,2,'admin',6,'order_paid','Paid order completed','Angelo Casia completed a $18.90 checkout.','/admin','unread','payment-admin-order-12-2','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(69,3,'merchant',6,'order_received','New product order received','Angelo Casia bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-12-3','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(70,6,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($17.95).','/receipt/order-13','unread','payment-customer-order-13','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(71,2,'admin',6,'order_paid','Paid order completed','Angelo Casia completed a $17.95 checkout.','/admin','unread','payment-admin-order-13-2','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(72,3,'merchant',6,'order_received','New product order received','Angelo Casia bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-13-3','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(73,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($8.91).','/receipt/order-14','unread','payment-customer-order-14','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(74,2,'admin',1,'order_paid','Paid order completed','mary completed a $8.91 checkout.','/admin','unread','payment-admin-order-14-2','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(75,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-14-3','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(76,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($15.12).','/receipt/order-15','unread','payment-customer-order-15','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(77,2,'admin',1,'order_paid','Paid order completed','mary completed a $15.12 checkout.','/admin','unread','payment-admin-order-15-2','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(78,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-15-3','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(79,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off was added to your profile vouchers.','/profile#vouchers','unread','reward-voucher-redeemed-1-19',NULL,'2026-06-08 14:45:53',NULL),(80,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($78.51).','/receipt/order-16','unread','payment-customer-order-16','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(81,2,'admin',1,'order_paid','Paid order completed','mary completed a $78.51 checkout.','/admin','unread','payment-admin-order-16-2','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(82,4,'merchant',1,'order_received','New product order received','mary bought 1 item from FreshGlow Spa ($45.80).','/merchant/orders','unread','payment-merchant-order-16-4','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(83,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($37.80).','/merchant/orders','unread','payment-merchant-order-16-3','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(84,1,'customer',5,'booking_confirmed','Booking request confirmed','Classic Haircut at Urban Groom Barbers is booked for 2026-06-13 at 13:30.','/receipt/18','unread','booking-created-customer-18','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(85,5,'merchant',1,'booking','New booking received','mary booked Classic Haircut for 2026-06-13 at 13:30.','/merchant/schedule','unread','booking-created-merchant-18','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(86,2,'admin',1,'booking','New customer booking','mary booked Classic Haircut at Urban Groom Barbers.','/admin','unread','booking-created-admin-18-2','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(87,1,'customer',5,'booking_confirmed','Booking confirmed','Your booking has been confirmed by the merchant. Classic Haircut at Urban Groom Barbers.','/profile#bookings','unread','merchant-booking-status-1-confirmed',NULL,'2026-06-11 13:11:28',NULL),(88,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($9.36).','/receipt/order-23','unread','payment-customer-order-23','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(89,2,'admin',1,'order_paid','Paid order completed','mary completed a $9.36 checkout.','/admin','unread','payment-admin-order-23-2','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(90,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-23-3','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(91,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($47.33).','/receipt/order-24','unread','payment-customer-order-24','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(92,2,'admin',1,'order_paid','Paid order completed','mary completed a $47.33 checkout.','/admin','unread','payment-admin-order-24-2','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(93,3,'merchant',1,'order_received','New product order received','mary bought 2 items from Vaniday Beauty Studio ($47.80).','/merchant/orders','unread','payment-merchant-order-24-3','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(94,1,'customer',3,'order_update','Order status updated','Your Repair Shampoo, Scalp Treatment Serum order is now delivered.','/receipt/order-24','unread','merchant-order-status-24-delivered-1781184236534','{\"transactionId\":24,\"status\":\"delivered\"}','2026-06-11 13:23:56',NULL),(95,1,'customer',3,'order_update','Order status updated','Your Repair Shampoo order is now processing.','/receipt/order-23','unread','merchant-order-status-23-processing-1781184239901','{\"transactionId\":23,\"status\":\"processing\"}','2026-06-11 13:23:59',NULL),(96,1,'customer',3,'booking_confirmed','Booking request confirmed','Gel Manicure at Vaniday Beauty Studio is booked for 2026-06-13 at 16:00.','/receipt/19','unread','booking-created-customer-19','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL),(97,3,'merchant',1,'booking','New booking received','mary booked Gel Manicure for 2026-06-13 at 16:00.','/merchant/schedule','unread','booking-created-merchant-19','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL),(98,2,'admin',1,'booking','New customer booking','mary booked Gel Manicure at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-19-2','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL);
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
  `transaction_id` int DEFAULT NULL,
  `product_id` int NOT NULL,
  `quantity` int NOT NULL,
  `price_at_purchase` decimal(10,2) NOT NULL,
  `order_id` int DEFAULT NULL,
  PRIMARY KEY (`order_item_id`),
  KEY `transaction_id` (`transaction_id`),
  KEY `product_id` (`product_id`),
  KEY `idx_order_items_order_id` (`order_id`),
  CONSTRAINT `fk_order_items_order_id` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
INSERT INTO `order_items` VALUES (1,12,1,1,18.90,1),(2,13,1,1,18.90,2),(3,14,1,1,18.90,3),(4,15,1,1,18.90,4),(5,16,4,2,22.90,5),(6,16,1,2,18.90,5),(9,23,1,1,18.90,10),(10,24,1,1,18.90,11),(11,24,2,1,28.90,11);
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
  `transaction_id` int DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `order_status` varchar(40) NOT NULL DEFAULT 'processing',
  `refund_status` varchar(40) NOT NULL DEFAULT 'none',
  `refunded_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refunded_at` datetime DEFAULT NULL,
  `refund_reason` text,
  `provider_refund_id` varchar(190) DEFAULT NULL,
  `refunded_by` int DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  UNIQUE KEY `uq_orders_transaction_id` (`transaction_id`),
  KEY `idx_orders_user_id` (`user_id`),
  KEY `idx_orders_refund_status` (`refund_status`),
  CONSTRAINT `fk_orders_transaction_id` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `fk_orders_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (1,6,12,18.90,'2026-06-07 09:15:40','processing','none',0.00,NULL,NULL,NULL,NULL),(2,6,13,17.95,'2026-06-07 09:54:16','processing','none',0.00,NULL,NULL,NULL,NULL),(3,1,14,8.91,'2026-06-08 13:34:14','processing','none',0.00,NULL,NULL,NULL,NULL),(4,1,15,15.12,'2026-06-08 13:52:11','processing','none',0.00,NULL,NULL,NULL,NULL),(5,1,16,78.51,'2026-06-08 14:48:17','processing','none',0.00,NULL,NULL,NULL,NULL),(10,1,23,9.36,'2026-06-11 13:12:39','processing','none',0.00,NULL,NULL,NULL,NULL),(11,1,24,47.33,'2026-06-11 13:23:22','processing','none',0.00,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payment_attempts`
--

DROP TABLE IF EXISTS `payment_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_attempts` (
  `attempt_id` varchar(100) NOT NULL,
  `user_id` int NOT NULL,
  `provider` varchar(30) NOT NULL,
  `provider_reference` varchar(160) DEFAULT NULL,
  `payment_json` longtext NOT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'pending',
  `transaction_id` int DEFAULT NULL,
  `receipt_id` varchar(80) DEFAULT NULL,
  `last_error` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `uq_payment_attempt_provider_reference` (`provider`,`provider_reference`),
  KEY `idx_payment_attempt_user_status` (`user_id`,`status`),
  KEY `fk_payment_attempt_transaction` (`transaction_id`),
  CONSTRAINT `fk_payment_attempt_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `fk_payment_attempt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_attempts`
--

LOCK TABLES `payment_attempts` WRITE;
/*!40000 ALTER TABLE `payment_attempts` DISABLE KEYS */;
INSERT INTO `payment_attempts` VALUES ('checkout:ORD-1780825986336-adbae382',6,'checkout','ORD-1780825986336-adbae382','{\"kind\":\"order\",\"receiptId\":\"ORD-1780825986336-adbae382\",\"checkoutId\":\"ORD-1780825986336-adbae382\",\"cartCheckout\":true,\"userId\":6,\"userName\":\"Angelo Casia\",\"userEmail\":\"angelomiguelcasia@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780825961460\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780825986336-adbae382\"}','pending',NULL,NULL,NULL,'2026-06-07 09:53:06','2026-06-07 09:53:06'),('checkout:ORD-1780925413184-c5a94c7b',1,'checkout','ORD-1780925413184-c5a94c7b','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925413184-c5a94c7b\",\"checkoutId\":\"ORD-1780925413184-c5a94c7b\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"FreshGlow Spa\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"2\",\"pickupMerchantName\":\"FreshGlow Spa\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780925413184-c5a94c7b\"}','pending',NULL,NULL,NULL,'2026-06-08 13:30:13','2026-06-08 13:30:13'),('checkout:ORD-1780925605242-56a4c37f',1,'checkout','ORD-1780925605242-56a4c37f','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925605242-56a4c37f\",\"checkoutId\":\"ORD-1780925605242-56a4c37f\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780925605242-56a4c37f\"}','pending',NULL,NULL,NULL,'2026-06-08 13:33:25','2026-06-08 13:33:25'),('checkout:ORD-1780926660803-fff06848',1,'checkout','ORD-1780926660803-fff06848','{\"kind\":\"order\",\"receiptId\":\"ORD-1780926660803-fff06848\",\"checkoutId\":\"ORD-1780926660803-fff06848\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780926650344\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780926660803-fff06848\"}','pending',NULL,NULL,NULL,'2026-06-08 13:51:00','2026-06-08 13:51:00'),('checkout:ORD-1780927096128-9754eaac',1,'checkout','ORD-1780927096128-9754eaac','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927096128-9754eaac\",\"checkoutId\":\"ORD-1780927096128-9754eaac\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927096128-9754eaac\"}','pending',NULL,NULL,NULL,'2026-06-08 13:58:16','2026-06-08 13:58:16'),('checkout:ORD-1780927574743-59cdc0c3',1,'checkout','ORD-1780927574743-59cdc0c3','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927574743-59cdc0c3\",\"checkoutId\":\"ORD-1780927574743-59cdc0c3\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927574743-59cdc0c3\"}','pending',NULL,NULL,NULL,'2026-06-08 14:06:14','2026-06-08 14:06:14'),('checkout:ORD-1780927658351-d07cd7f5',1,'checkout','ORD-1780927658351-d07cd7f5','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927658351-d07cd7f5\",\"checkoutId\":\"ORD-1780927658351-d07cd7f5\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927658351-d07cd7f5\"}','pending',NULL,NULL,NULL,'2026-06-08 14:07:38','2026-06-08 14:07:38'),('checkout:ORD-1780927862579-8220a397',1,'checkout','ORD-1780927862579-8220a397','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927862579-8220a397\",\"checkoutId\":\"ORD-1780927862579-8220a397\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927862579-8220a397\"}','pending',NULL,NULL,NULL,'2026-06-08 14:11:02','2026-06-08 14:11:02'),('checkout:ORD-1780927900163-a45a67d0',1,'checkout','ORD-1780927900163-a45a67d0','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927900163-a45a67d0\",\"checkoutId\":\"ORD-1780927900163-a45a67d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927900163-a45a67d0\"}','pending',NULL,NULL,NULL,'2026-06-08 14:11:40','2026-06-08 14:11:40'),('checkout:ORD-1780928768794-b36389b8',1,'checkout','ORD-1780928768794-b36389b8','{\"kind\":\"order\",\"receiptId\":\"ORD-1780928768794-b36389b8\",\"checkoutId\":\"ORD-1780928768794-b36389b8\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780928768794-b36389b8\"}','pending',NULL,NULL,NULL,'2026-06-08 14:26:08','2026-06-08 14:26:08'),('checkout:ORD-1780929744227-8f2ef169',1,'checkout','ORD-1780929744227-8f2ef169','{\"kind\":\"order\",\"receiptId\":\"ORD-1780929744227-8f2ef169\",\"checkoutId\":\"ORD-1780929744227-8f2ef169\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":45.8,\"itemSubtotal\":45.8,\"shippingFee\":0,\"originalAmount\":45.8,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780929662424\",\"selectedVoucherId\":\"none\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780929744227-8f2ef169\"}','pending',NULL,NULL,NULL,'2026-06-08 14:42:24','2026-06-08 14:42:24'),('checkout:ORD-1780930004681-e08f0a2d',1,'checkout','ORD-1780930004681-e08f0a2d','{\"kind\":\"order\",\"receiptId\":\"ORD-1780930004681-e08f0a2d\",\"checkoutId\":\"ORD-1780930004681-e08f0a2d\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":83.6,\"itemSubtotal\":83.6,\"shippingFee\":0,\"originalAmount\":83.6,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":37.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780929662424,1780929991675\",\"selectedVoucherId\":\"19\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780930004681-e08f0a2d\"}','pending',NULL,NULL,NULL,'2026-06-08 14:46:44','2026-06-08 14:46:44'),('checkout:ORD-1781183551768-7ed7179c',1,'checkout','ORD-1781183551768-7ed7179c','{\"kind\":\"order\",\"receiptId\":\"ORD-1781183551768-7ed7179c\",\"checkoutId\":\"ORD-1781183551768-7ed7179c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781183546347\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1781183551768-7ed7179c\"}','pending',NULL,NULL,NULL,'2026-06-11 13:12:31','2026-06-11 13:12:31'),('checkout:ORD-1781184198908-20d5d553',1,'checkout','ORD-1781184198908-20d5d553','{\"kind\":\"order\",\"receiptId\":\"ORD-1781184198908-20d5d553\",\"checkoutId\":\"ORD-1781184198908-20d5d553\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":47.8,\"itemSubtotal\":47.8,\"shippingFee\":0,\"originalAmount\":47.8,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781184194176,1781184195085\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1781184198908-20d5d553\"}','pending',NULL,NULL,NULL,'2026-06-11 13:23:18','2026-06-11 13:23:18'),('direct:apple_pay-ORD-1781183551768-7ed7179c',1,'direct','apple_pay-ORD-1781183551768-7ed7179c','{\"kind\":\"order\",\"receiptId\":\"ORD-1781183551768-7ed7179c\",\"checkoutId\":\"ORD-1781183551768-7ed7179c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":9.36,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781183546347\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":9.54,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paymentAttemptId\":\"direct:apple_pay-ORD-1781183551768-7ed7179c\"}','completed',23,'order-23',NULL,'2026-06-11 13:12:39','2026-06-11 13:12:39'),('direct:apple_pay-ORD-1781184198908-20d5d553',1,'direct','apple_pay-ORD-1781184198908-20d5d553','{\"kind\":\"order\",\"receiptId\":\"ORD-1781184198908-20d5d553\",\"checkoutId\":\"ORD-1781184198908-20d5d553\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":47.33,\"itemSubtotal\":47.8,\"shippingFee\":0,\"originalAmount\":47.8,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781184194176,1781184195085\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.47,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paymentAttemptId\":\"direct:apple_pay-ORD-1781184198908-20d5d553\"}','completed',24,'order-24',NULL,'2026-06-11 13:23:22','2026-06-11 13:23:22'),('stripe:cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj',1,'stripe','cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925605242-56a4c37f\",\"checkoutId\":\"ORD-1780925605242-56a4c37f\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":8.91,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[{\"id\":9,\"userId\":1,\"sourceType\":\"reward_shop\",\"sourceReference\":\"12\",\"title\":\"$10 off\",\"detail\":\"lovely\",\"voucherValue\":9.99,\"remainingValue\":9.99,\"discountType\":\"fixed\",\"discountPercent\":0,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":12,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-A9207B14\",\"expiresAt\":null,\"createdAt\":\"2026-06-03T18:58:04.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9}],\"voucherRecommendation\":{\"voucher\":{\"id\":8,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"11\",\"title\":\"20% OFF Repair Shampoo\",\"detail\":\"20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":20,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":11,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-9ADE9738\",\"expiresAt\":\"2026-09-02T17:45:00.000Z\",\"createdAt\":\"2026-06-03T17:46:33.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9},\"discount\":3.78},\"smartVoucherMessage\":\"\",\"voucherMode\":\"product\",\"voucherId\":9,\"voucherCode\":\"RWD-A9207B14\",\"voucherTitle\":\"$10 off\",\"voucherDiscountType\":\"fixed\",\"voucherDiscountPercent\":0,\"voucherEligibleAmount\":18.9,\"voucherDiscount\":9.99,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj\",\"paymentAttemptId\":\"stripe:cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj\"}','completed',14,'order-14',NULL,'2026-06-08 13:33:50','2026-06-08 13:34:14'),('stripe:cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u',6,'stripe','cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u','{\"kind\":\"order\",\"receiptId\":\"ORD-1780825986336-adbae382\",\"checkoutId\":\"ORD-1780825986336-adbae382\",\"cartCheckout\":true,\"userId\":6,\"userName\":\"Angelo Casia\",\"userEmail\":\"angelomiguelcasia@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":17.95,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780825961460\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.95,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u\",\"paymentAttemptId\":\"stripe:cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u\"}','completed',13,'order-13',NULL,'2026-06-07 09:53:19','2026-06-07 09:54:16'),('stripe:cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq',1,'stripe','cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq','{\"kind\":\"order\",\"receiptId\":\"ORD-1780930004681-e08f0a2d\",\"checkoutId\":\"ORD-1780930004681-e08f0a2d\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Delivery\",\"serviceName\":\"Cart checkout\",\"amount\":78.51,\"itemSubtotal\":83.6,\"shippingFee\":4.9,\"originalAmount\":88.5,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":37.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780929662424,1780929991675\",\"selectedVoucherId\":\"19\",\"useCashback\":false,\"fulfilment\":\"delivery\",\"pickupMerchantId\":\"\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"123 woodlands ave\",\"deliveryUnit\":\"#11-132\",\"deliveryPostal\":\"123432\",\"deliveryPhone\":\"91234556\",\"availableVouchers\":[{\"id\":19,\"userId\":1,\"sourceType\":\"reward_shop\",\"sourceReference\":\"12\",\"title\":\"$10 off\",\"detail\":\"lovely\",\"voucherValue\":9.99,\"remainingValue\":9.99,\"discountType\":\"fixed\",\"discountPercent\":0,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":12,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-097D7242\",\"expiresAt\":null,\"createdAt\":\"2026-06-08T14:45:53.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":37.8}],\"voucherRecommendation\":{\"voucher\":{\"id\":6,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"9\",\"title\":\"10% OFF Hydrating Face Mask\",\"detail\":\"10% off product voucher for Hydrating Face Mask. Redeem with 500 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":10,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":9,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"linkedItemType\":\"product\",\"linkedItemId\":4,\"linkedItemName\":\"Hydrating Face Mask\",\"minimumSpend\":0,\"code\":\"RWD-547E3062\",\"expiresAt\":\"2026-08-31T17:09:00.000Z\",\"createdAt\":\"2026-06-03T17:29:06.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":45.8},\"discount\":4.58},\"smartVoucherMessage\":\"\",\"voucherMode\":\"product\",\"voucherId\":19,\"voucherCode\":\"RWD-097D7242\",\"voucherTitle\":\"$10 off\",\"voucherDiscountType\":\"fixed\",\"voucherDiscountPercent\":0,\"voucherEligibleAmount\":37.8,\"voucherDiscount\":9.99,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq\",\"paymentAttemptId\":\"stripe:cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq\"}','completed',16,'order-16',NULL,'2026-06-08 14:48:04','2026-06-08 14:48:17'),('stripe:cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc',1,'stripe','cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc','{\"kind\":\"order\",\"receiptId\":\"ORD-1780926660803-fff06848\",\"checkoutId\":\"ORD-1780926660803-fff06848\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":15.12,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780926650344\",\"selectedVoucherId\":\"\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":{\"voucher\":{\"id\":8,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"11\",\"title\":\"20% OFF Repair Shampoo\",\"detail\":\"20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":20,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":11,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-9ADE9738\",\"expiresAt\":\"2026-09-02T17:45:00.000Z\",\"createdAt\":\"2026-06-03T17:46:33.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9},\"discount\":3.78},\"smartVoucherMessage\":\"\",\"voucherMode\":\"\",\"voucherId\":8,\"voucherCode\":\"RWD-9ADE9738\",\"voucherTitle\":\"20% OFF Repair Shampoo\",\"voucherDiscountType\":\"percentage\",\"voucherDiscountPercent\":20,\"voucherEligibleAmount\":18.9,\"voucherDiscount\":3.78,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc\",\"paymentAttemptId\":\"stripe:cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc\"}','completed',15,'order-15',NULL,'2026-06-08 13:51:59','2026-06-08 13:52:12');
/*!40000 ALTER TABLE `payment_attempts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payment_refunds`
--

DROP TABLE IF EXISTS `payment_refunds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_refunds` (
  `refund_id` int NOT NULL AUTO_INCREMENT,
  `transaction_id` int NOT NULL,
  `booking_id` int DEFAULT NULL,
  `order_id` int DEFAULT NULL,
  `user_id` int NOT NULL,
  `merchant_id` int DEFAULT NULL,
  `refunded_by` int DEFAULT NULL,
  `refund_amount` decimal(10,2) NOT NULL,
  `currency` varchar(10) NOT NULL DEFAULT 'SGD',
  `refund_status` varchar(40) NOT NULL DEFAULT 'pending',
  `refund_reason` text,
  `payment_provider` varchar(40) DEFAULT NULL,
  `provider_payment_id` varchar(190) DEFAULT NULL,
  `provider_session_id` varchar(190) DEFAULT NULL,
  `provider_capture_id` varchar(190) DEFAULT NULL,
  `provider_refund_id` varchar(190) DEFAULT NULL,
  `provider_response_json` longtext,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`refund_id`),
  UNIQUE KEY `uq_payment_refunds_provider_refund` (`payment_provider`,`provider_refund_id`),
  KEY `idx_payment_refunds_transaction` (`transaction_id`),
  KEY `idx_payment_refunds_user` (`user_id`),
  KEY `idx_payment_refunds_status` (`refund_status`),
  CONSTRAINT `fk_payment_refunds_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`),
  CONSTRAINT `fk_payment_refunds_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_refunds`
--

LOCK TABLES `payment_refunds` WRITE;
/*!40000 ALTER TABLE `payment_refunds` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_refunds` ENABLE KEYS */;
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
  `category_id` int DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock_quantity` int DEFAULT '0',
  `image_url` text,
  `description` text,
  `ingredients` text,
  `how_to_use` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_featured` tinyint(1) NOT NULL DEFAULT '0',
  `featured_order` int NOT NULL DEFAULT '0',
  `featured_start_date` date DEFAULT NULL,
  `featured_end_date` date DEFAULT NULL,
  `routine_goal_tags` json DEFAULT NULL,
  `routine_concern_tags` json DEFAULT NULL,
  `routine_recommendation_note` varchar(255) DEFAULT NULL,
  `routine_budget_min` decimal(10,2) DEFAULT NULL,
  `routine_budget_max` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  KEY `salon_id` (`salon_id`),
  KEY `fk_products_category` (`category_id`),
  KEY `idx_products_salon_featured` (`salon_id`,`is_featured`,`featured_order`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` (`product_id`,`salon_id`,`category_id`,`name`,`price`,`stock_quantity`,`image_url`,`description`,`ingredients`,`how_to_use`,`created_at`,`updated_at`,`is_featured`,`featured_order`,`featured_start_date`,`featured_end_date`) VALUES (1,1,12,'Repair Shampoo',18.90,43,NULL,'Hair repair shampoo for dry and damaged hair.',NULL,NULL,'2026-06-03 12:32:10','2026-06-11 13:23:22',0,0,NULL,NULL),(2,1,12,'Scalp Treatment Serum',28.90,29,NULL,'Serum for scalp care and hair growth support.',NULL,NULL,'2026-06-03 12:32:10','2026-06-11 13:23:22',0,0,NULL,NULL),(3,1,17,'Gel Nail Polish',15.90,40,NULL,'Long-lasting gel polish for nails.',NULL,NULL,'2026-06-03 12:32:10','2026-06-04 10:15:48',0,0,NULL,NULL),(4,2,10,'Hydrating Face Mask',22.90,33,NULL,'Moisturising mask for facial care.',NULL,NULL,'2026-06-03 12:32:10','2026-06-08 14:48:17',0,0,NULL,NULL),(5,2,9,'Aromatherapy Massage Oil',19.90,25,NULL,'Relaxing massage oil for body treatment.',NULL,NULL,'2026-06-03 12:32:10','2026-06-04 16:27:45',0,0,NULL,NULL),(6,1,6,'Hair Care Bundle Set',39.90,21,NULL,'Bundle set with shampoo and treatment serum.',NULL,NULL,'2026-06-03 12:32:10','2026-06-04 16:27:45',1,0,NULL,NULL),(7,1,10,'EFFACLAR ULTRA CONCENTRATED SERUM',50.00,1,NULL,'Effaclar Ultra Concentrated Serum is a powerful treatment that helps to minimize the appearance of pores and reduce sebum production. Formulated with salicylic acid and glycolic acid, this serum exfoliates the skin to reveal a smoother, more even-toned complexion.','Salicylic Acid, Glycolic Acid, Caffeine, Glycerin, Panthenol, Green Tea Extract','Apply 2-3 drops to the face and neck after cleansing and toning. Gently massage into the skin until absorbed. Follow up with your daily moisturizer.','2026-06-03 13:06:04','2026-06-04 16:27:45',0,0,NULL,NULL);
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
INSERT INTO `promotion_redemptions` VALUES (1,1,1,2,'2026-05-01 17:24:54','used'),(2,22,1,3,'2026-05-01 17:44:24','used'),(3,2,1,4,'2026-05-01 17:44:41','used'),(4,22,1,5,'2026-05-01 17:48:11','used');
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
  `product_id` int DEFAULT NULL,
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
  `spin_eligible` tinyint(1) NOT NULL DEFAULT '0',
  `spin_reward_type` enum('service_discount','product_discount','free_add_on','cashback','loyalty_points_bonus','limited_time_deal') DEFAULT NULL,
  `minimum_spend` decimal(10,2) NOT NULL DEFAULT '0.00',
  `usage_limit` int DEFAULT NULL,
  `spin_claim_limit` int DEFAULT NULL,
  `spin_inventory_remaining` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`promotion_id`),
  KEY `idx_promotions_salon` (`salon_id`),
  KEY `idx_promotions_service` (`service_id`),
  KEY `idx_promotions_product` (`product_id`),
  KEY `idx_promotions_spin_active` (`spin_eligible`,`status`,`start_date`,`end_date`),
  KEY `idx_promotions_type_status` (`type`,`status`),
  KEY `idx_promotions_dates` (`start_date`,`end_date`),
  CONSTRAINT `fk_promotions_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_promotions_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_promotions_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promotions`
--

LOCK TABLES `promotions` WRITE;
/*!40000 ALTER TABLE `promotions` DISABLE KEYS */;
INSERT INTO `promotions` (`promotion_id`,`salon_id`,`service_id`,`title`,`type`,`discount_type`,`discount_value`,`start_date`,`end_date`,`allowed_slots`,`status`,`description`,`terms`,`created_at`,`updated_at`) VALUES (1,1,1,'First Trial Facial Glow','first_trial','percentage',30.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','30% off for first-time facial customers.','Valid once per customer for this salon.','2026-04-30 07:55:19','2026-04-30 07:55:19'),(2,1,2,'Happy Hour Hair Treatment','happy_hour','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','15% off selected weekday off-peak slots.','Valid Monday to Thursday, 10:00 AM to 4:00 PM only.','2026-04-30 07:55:19','2026-04-30 10:12:36'),(21,1,1,'First Trial Hair Refresh','first_trial','percentage',25.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','First-time customer hair refresh offer.','Valid once per customer for this salon.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(22,1,2,'Happy Hour Midday Facial','happy_hour','percentage',15.00,'2026-04-30 00:00:00','2026-06-30 00:00:00',NULL,'inactive','Weekday facial discount during quieter hours.','Valid Monday to Thursday, 11:00 AM to 4:00 PM only.','2026-04-30 10:09:20','2026-05-01 18:10:48'),(23,1,3,'1 For 1 Nail Treats','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Bring a friend for a shared nail session.','Subject to same-time slot availability.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(24,2,4,'First Trial Body Glow','first_trial','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Introductory spa body treatment deal.','Valid once per customer for this merchant.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(25,2,5,'Happy Hour Afternoon Body Scrub','happy_hour','percentage',10.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Off-peak spa savings for flexible schedules.','Weekday afternoons only.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(26,2,4,'1 For 1 Wellness Escape','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book one wellness session and enjoy two.','Best used for pair bookings.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(27,3,6,'First Trial Grooming Cut','first_trial','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Try this barber service at an intro price.','New customers only.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(28,3,7,'Happy Hour Quick Fade','happy_hour','percentage',5.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Small weekday discount for quick trims.','Valid during listed hours only.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(29,3,6,'1 For 1 Grooming Duo','one_for_one','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book together and enjoy better value.','Limited daily slots.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(30,1,NULL,'Featured Beauty Studio May','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured salon placement for May.','Homepage and featured salon visibility only.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(31,2,NULL,'Featured Spa Escape','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured spa listing campaign.','Featured listing only.','2026-04-30 10:09:20','2026-04-30 10:12:36'),(32,3,NULL,'Featured Barber Spotlight','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured merchant visibility campaign.','Featured listing only.','2026-04-30 10:09:20','2026-04-30 10:12:36');
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
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivery_status` varchar(30) NOT NULL DEFAULT 'processing',
  `refund_status` varchar(30) NOT NULL DEFAULT 'none',
  `refunded_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refunded_at` datetime DEFAULT NULL,
  `fulfilment` varchar(30) DEFAULT NULL,
  `pickup_merchant_id` varchar(64) DEFAULT NULL,
  `pickup_merchant_name` varchar(120) DEFAULT NULL,
  `pickup_status` varchar(40) DEFAULT NULL,
  `pickup_at` datetime DEFAULT NULL,
  `original_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `cashback_used` decimal(10,2) NOT NULL DEFAULT '0.00',
  `points_redeemed` int NOT NULL DEFAULT '0',
  `points_discount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `item_subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `shipping_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`history_id`),
  UNIQUE KEY `uniq_purchase_history_receipt` (`receipt_id`),
  KEY `idx_purchase_history_user` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_history`
--

LOCK TABLES `purchase_history` WRITE;
/*!40000 ALTER TABLE `purchase_history` DISABLE KEYS */;
INSERT INTO `purchase_history` VALUES (13,'order-23',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',9.36,'Apple Pay','paid','2026-06-11 13:12:40','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,9.54,0,0.00,18.90,0.00),(15,'order-24',1,'product','Repair Shampoo, Scalp Treatment Serum','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}, {\"name\": \"Scalp Treatment Serum\", \"type\": \"Product\", \"price\": 28.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 28.9, \"serviceId\": 2, \"unitPrice\": 28.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',47.33,'Apple Pay','paid','2026-06-11 13:23:22','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,47.80,0.47,0,0.00,47.80,0.00);
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
  `review_type` varchar(20) NOT NULL DEFAULT 'service',
  `booking_id` int DEFAULT NULL,
  `receipt_id` varchar(64) DEFAULT NULL,
  `user_id` int NOT NULL,
  `merchant_id` int NOT NULL,
  `service_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `rating` tinyint NOT NULL,
  `comment` text,
  `image_path` varchar(255) DEFAULT NULL,
  `video_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`review_id`),
  UNIQUE KEY `uq_reviews_booking` (`booking_id`),
  UNIQUE KEY `uq_reviews_receipt_product` (`receipt_id`,`product_id`),
  KEY `idx_reviews_merchant_created` (`merchant_id`,`created_at`),
  KEY `idx_reviews_user_created` (`user_id`,`created_at`),
  KEY `idx_reviews_product_created` (`product_id`,`created_at`)
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
  `detail` varchar(255) DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `voucher_source` varchar(20) NOT NULL DEFAULT 'platform',
  `merchant_id` int DEFAULT NULL,
  `discount_type` varchar(20) NOT NULL DEFAULT 'fixed',
  `discount_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `minimum_spend` decimal(10,2) NOT NULL DEFAULT '0.00',
  `points_required` int DEFAULT NULL,
  `start_date` datetime DEFAULT NULL,
  `expiry_date` datetime DEFAULT NULL,
  `usage_limit_per_user` int DEFAULT NULL,
  `usage_limit_total` int DEFAULT NULL,
  `redemption_count` int NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `applies_to_booking` tinyint(1) NOT NULL DEFAULT '1',
  `linked_service_id` int DEFAULT NULL,
  `linked_product_id` int DEFAULT NULL,
  `linked_item_type` varchar(20) DEFAULT NULL,
  `linked_item_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`voucher_id`),
  KEY `idx_reward_shop_vouchers_status_sort` (`status`,`sort_order`,`glints_cost`),
  KEY `idx_reward_shop_vouchers_source_merchant` (`voucher_source`,`merchant_id`),
  KEY `idx_reward_shop_vouchers_expiry` (`expiry_date`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reward_shop_vouchers`
--

LOCK TABLES `reward_shop_vouchers` WRITE;
/*!40000 ALTER TABLE `reward_shop_vouchers` DISABLE KEYS */;
INSERT INTO `reward_shop_vouchers` VALUES (1,1000,5.00,'$5 OFF BOOKING','Get $5 off your next booking when you redeem 1,000 VaniGlints. Applicable to eligible services and valid for one-time use.','active',1,'platform',NULL,'fixed',5.00,0.00,1000,NULL,NULL,NULL,NULL,1,NULL,1,NULL,NULL,NULL,NULL,'2026-06-03 16:58:07','2026-06-03 17:25:12'),(2,1500,10.00,'$10 off booking','Get $10 off your next booking when you redeem 1,500 VaniGlints. Applicable to eligible services and valid for one-time use.','active',2,'platform',NULL,'fixed',10.00,0.00,1500,NULL,NULL,NULL,NULL,1,NULL,1,NULL,NULL,NULL,NULL,'2026-06-03 17:00:14','2026-06-03 17:28:45'),(3,2000,20.00,'$20 OFF BOOKING','Get $20 off your next booking when you redeem 2,000 VaniGlints. Applicable to eligible services and valid for one-time use.','active',3,'platform',NULL,'fixed',20.00,0.00,2000,NULL,NULL,NULL,NULL,0,NULL,1,NULL,NULL,NULL,NULL,'2026-06-03 17:01:08','2026-06-03 17:01:18'),(4,5000,50.00,'$50 OFF BOOKING','Get $50 off your next booking when you redeem 5,000 VaniGlints. Applicable to eligible services and valid for one-time use.','active',4,'platform',NULL,'fixed',50.00,0.00,5000,NULL,NULL,NULL,NULL,0,NULL,1,NULL,NULL,NULL,NULL,'2026-06-03 17:01:47','2026-06-03 17:01:47'),(5,500,0.00,'10% OFF Ladies Haircut','10% off service voucher for Ladies Haircut. Redeem with 500 VaniGlints.','active',0,'merchant',1,'percentage',10.00,0.00,500,'2026-06-04 01:03:00','2026-09-30 01:03:00',5,2,1,3,1,8,NULL,'service',8,'2026-06-03 17:04:16','2026-06-03 18:57:21'),(6,998,10.00,'$10 OFF EFFACLAR ULTRA CONCENTRATED SERUM','$10 off product voucher for EFFACLAR ULTRA CONCENTRATED SERUM. Redeem with 998 VaniGlints.','active',0,'merchant',1,'fixed',10.00,0.00,998,'2026-06-04 01:04:00','2026-08-31 01:04:00',2,1,0,3,0,NULL,7,'product',7,'2026-06-03 17:05:10','2026-06-03 18:57:21'),(7,500,0.00,'10% OFF Repair Shampoo','10% off product voucher for Repair Shampoo. Redeem with 500 VaniGlints.','active',0,'merchant',3,'percentage',10.00,0.00,500,'2026-06-04 01:06:00','2026-08-31 01:06:00',4,4,2,5,0,NULL,1,'product',1,'2026-06-03 17:06:53','2026-06-03 18:57:21'),(8,1500,0.00,'24.99% OFF Skin Fade','24.99% off service voucher for Skin Fade. Redeem with 1500 VaniGlints.','active',0,'merchant',3,'percentage',24.99,0.00,1500,'2026-06-04 01:07:00','2026-09-30 01:07:00',10,10,1,5,1,7,NULL,'service',7,'2026-06-03 17:07:39','2026-06-03 18:57:21'),(9,500,0.00,'10% OFF Hydrating Face Mask','10% off product voucher for Hydrating Face Mask. Redeem with 500 VaniGlints.','active',0,'merchant',2,'percentage',10.00,0.00,500,'2026-06-04 01:09:00','2026-09-01 01:09:00',2,2,1,4,0,NULL,4,'product',4,'2026-06-03 17:09:40','2026-06-03 18:57:21'),(10,1000,15.00,'$15 OFF Body Scrub','$15 off service voucher for Body Scrub. Redeem with 1000 VaniGlints.','active',0,'merchant',2,'fixed',15.00,0.00,1000,'2026-06-04 01:10:00','2026-09-01 01:10:00',5,5,0,4,1,5,NULL,'service',5,'2026-06-03 17:10:37','2026-06-03 18:57:21'),(11,1000,0.00,'20% OFF Repair Shampoo','20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.','active',0,'merchant',1,'percentage',20.00,0.00,1000,'2026-06-04 01:45:00','2026-09-03 01:45:00',10,100,1,3,0,NULL,1,'product',1,'2026-06-03 17:46:02','2026-06-03 18:57:21'),(12,500,9.99,'$10 off','lovely','active',0,'platform',NULL,'fixed',9.99,0.00,500,NULL,NULL,NULL,NULL,2,NULL,0,NULL,1,'product',1,'2026-06-03 18:57:45','2026-06-08 14:45:53'),(13,1,0.00,'20% OFF Hydrating Facial','20% OFF Limited Time','active',0,'merchant',1,'percentage',20.00,0.00,1,'2026-06-04 18:39:00','2026-06-05 18:39:00',1,98,0,3,0,NULL,7,'product',7,'2026-06-04 10:39:52','2026-06-04 10:54:18'),(18,1,10.00,'$10 OFF','$10 off product voucher for EFFACLAR ULTRA CONCENTRATED SERUM.','active',0,'merchant',1,'fixed',10.00,10.00,1,'2026-06-10 22:43:00','2026-09-23 10:44:00',3,3,0,3,1,NULL,NULL,'product',7,'2026-06-08 14:44:22','2026-06-08 14:44:22');
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
  `is_featured` tinyint(1) NOT NULL DEFAULT '0',
  `featured_type` varchar(50) DEFAULT NULL,
  `featured_order` int NOT NULL DEFAULT '0',
  `featured_start_date` date DEFAULT NULL,
  `featured_end_date` date DEFAULT NULL,
  `featured_score` decimal(10,2) NOT NULL DEFAULT '0.00',
  `commission_rate` decimal(5,2) NOT NULL DEFAULT '15.00',
  `approval_status` enum('pending_review','approved','rejected','suspended','changes_requested') NOT NULL DEFAULT 'approved',
  `submitted_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `reviewed_by_admin_id` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_reason` text,
  `approval_updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`salon_id`),
  KEY `merchant_id` (`merchant_id`),
  KEY `idx_salons_featured` (`is_featured`,`featured_order`,`featured_score`),
  KEY `idx_salons_approval_status` (`approval_status`),
  KEY `idx_salons_reviewed_by` (`reviewed_by_admin_id`),
  CONSTRAINT `salons_ibfk_1` FOREIGN KEY (`merchant_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `salons`
--

LOCK TABLES `salons` WRITE;
/*!40000 ALTER TABLE `salons` DISABLE KEYS */;
INSERT INTO `salons` (`salon_id`,`merchant_id`,`salon_name`,`business_category`,`uen`,`years_in_business`,`staff_count`,`address`,`description`,`image_url`,`is_featured`,`featured_type`,`featured_order`,`featured_start_date`,`featured_end_date`,`featured_score`,`commission_rate`,`approval_status`,`submitted_at`,`reviewed_by_admin_id`,`reviewed_at`,`review_reason`,`approval_updated_at`) VALUES (1,3,'Vaniday Beauty Studio',NULL,NULL,NULL,NULL,'Orchard','Hair styling, facials, and beauty treatments.',NULL,0,NULL,0,NULL,NULL,44.29,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21'),(2,4,'FreshGlow Spa',NULL,NULL,NULL,NULL,'Tampines','Relaxing spa and body treatments.',NULL,0,NULL,0,NULL,NULL,16.43,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21'),(3,5,'Urban Groom Barbers',NULL,NULL,NULL,NULL,'Woodlands','Haircuts, fades, and grooming services.',NULL,0,NULL,0,NULL,NULL,45.00,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21');
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
-- Table structure for table `service_inventory_usage`
--

DROP TABLE IF EXISTS `service_inventory_usage`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_inventory_usage` (
  `usage_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `service_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity_used` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`usage_id`),
  UNIQUE KEY `uq_service_inventory_usage_booking` (`booking_id`),
  KEY `idx_service_inventory_usage_service` (`service_id`),
  KEY `idx_service_inventory_usage_product` (`product_id`),
  CONSTRAINT `fk_service_inventory_usage_booking` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_service_inventory_usage_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  CONSTRAINT `fk_service_inventory_usage_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `service_inventory_usage`
--

LOCK TABLES `service_inventory_usage` WRITE;
/*!40000 ALTER TABLE `service_inventory_usage` DISABLE KEYS */;
/*!40000 ALTER TABLE `service_inventory_usage` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
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
  `gender_target` enum('male','female','unisex') NOT NULL DEFAULT 'unisex',
  `display_order` int NOT NULL DEFAULT '999',
  `short_description` varchar(255) DEFAULT NULL,
  `is_featured` tinyint(1) NOT NULL DEFAULT '0',
  `featured_order` int NOT NULL DEFAULT '0',
  `featured_start_date` date DEFAULT NULL,
  `featured_end_date` date DEFAULT NULL,
  `routine_goal_tags` json DEFAULT NULL,
  `routine_concern_tags` json DEFAULT NULL,
  `routine_recommendation_note` varchar(255) DEFAULT NULL,
  `routine_budget_min` decimal(10,2) DEFAULT NULL,
  `routine_budget_max` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`service_id`),
  KEY `salon_id` (`salon_id`),
  KEY `category_id` (`category_id`),
  KEY `idx_services_salon_featured` (`salon_id`,`is_featured`,`featured_order`),
  CONSTRAINT `services_ibfk_1` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `services_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `services`
--

LOCK TABLES `services` WRITE;
/*!40000 ALTER TABLE `services` DISABLE KEYS */;
INSERT INTO `services` (`service_id`,`salon_id`,`category_id`,`service_name`,`description`,`duration_mins`,`price`,`package_enabled`,`package_sessions`,`package_price`,`gender_target`,`display_order`,`short_description`,`is_featured`,`featured_order`,`featured_start_date`,`featured_end_date`) VALUES (1,1,1,'Hair Cut','Classic haircut and styling consultation.',45,35.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL),(2,1,2,'Hydrating Facial','Moisturising facial for dry or dull skin.',60,68.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL),(3,1,3,'Gel Manicure','Long-lasting gel manicure service.',60,55.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL),(4,2,4,'Aromatherapy Massage','Relaxing full-body aromatherapy massage.',90,98.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL),(5,2,4,'Body Scrub','Body exfoliation and spa care treatment.',60,72.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL),(6,3,5,'Classic Haircut','Classic men haircut.',30,28.00,0,0,0.00,'male',999,NULL,0,0,NULL,NULL),(7,3,5,'Skin Fade','Detailed fade haircut.',45,38.00,0,0,0.00,'male',999,NULL,0,0,NULL,NULL),(8,1,1,'Ladies Haircut','Haircut and styling for women.',60,45.00,0,0,0.00,'female',1,NULL,0,0,NULL,NULL),(9,1,1,'Hair Wash and Blow Dry','Wash, blow dry, and basic styling.',45,35.00,0,0,0.00,'female',2,NULL,0,0,NULL,NULL),(10,1,1,'Ladies Hair Colour','Hair colouring service for women.',120,120.00,0,0,0.00,'female',3,NULL,0,0,NULL,NULL),(11,1,3,'Classic Manicure','Basic nail care and polish.',45,30.00,0,0,0.00,'female',4,NULL,0,0,NULL,NULL),(12,1,3,'Gel Pedicure','Long-lasting gel pedicure treatment.',60,45.00,0,0,0.00,'female',5,NULL,0,0,NULL,NULL);
/*!40000 ALTER TABLE `services` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `support_messages`
--

DROP TABLE IF EXISTS `support_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_messages` (
  `message_id` int NOT NULL AUTO_INCREMENT,
  `request_id` int NOT NULL,
  `sender_user_id` int DEFAULT NULL,
  `sender_role` varchar(30) NOT NULL DEFAULT 'customer',
  `message_body` text,
  `screenshot_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`),
  KEY `idx_support_messages_request` (`request_id`,`created_at`),
  KEY `fk_support_messages_sender` (`sender_user_id`),
  CONSTRAINT `fk_support_messages_request` FOREIGN KEY (`request_id`) REFERENCES `support_requests` (`request_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_support_messages_sender` FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_messages`
--

LOCK TABLES `support_messages` WRITE;
/*!40000 ALTER TABLE `support_messages` DISABLE KEYS */;
/*!40000 ALTER TABLE `support_messages` ENABLE KEYS */;
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
  `approved_refund_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `late_fee_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `is_late_cancellation` tinyint(1) NOT NULL DEFAULT '0',
  `customer_terms_accepted` tinyint(1) NOT NULL DEFAULT '0',
  `customer_terms_version` varchar(40) DEFAULT NULL,
  `delivery_status` varchar(30) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resolved_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  KEY `idx_support_customer` (`customer_user_id`,`status`,`created_at`),
  KEY `idx_support_merchant` (`merchant_user_id`,`status`,`created_at`),
  KEY `idx_support_status` (`status`,`created_at`),
  KEY `idx_support_target` (`target_type`,`target_id`),
  CONSTRAINT `fk_support_customer_user` FOREIGN KEY (`customer_user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_support_merchant_user` FOREIGN KEY (`merchant_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `booking_id` int DEFAULT NULL,
  `order_item_id` int DEFAULT NULL,
  `order_id` int DEFAULT NULL,
  `delivery_status` varchar(30) NOT NULL DEFAULT 'processing',
  `shipped_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `refund_status` varchar(30) NOT NULL DEFAULT 'none',
  `refunded_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `refunded_at` datetime DEFAULT NULL,
  `pickup_status` varchar(40) NOT NULL DEFAULT 'pending_pickup',
  `collected_at` datetime DEFAULT NULL,
  `original_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `cashback_used` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(10) NOT NULL DEFAULT 'SGD',
  `payment_provider` varchar(40) DEFAULT NULL,
  `provider_payment_id` varchar(190) DEFAULT NULL,
  `provider_session_id` varchar(190) DEFAULT NULL,
  `provider_capture_id` varchar(190) DEFAULT NULL,
  `provider_refund_id` varchar(190) DEFAULT NULL,
  `refund_reason` text,
  `refunded_by` int DEFAULT NULL,
  PRIMARY KEY (`transaction_id`),
  KEY `user_id` (`user_id`),
  KEY `idx_transactions_order_id` (`order_id`),
  KEY `idx_transactions_order_item_id` (`order_item_id`),
  KEY `idx_transactions_booking_id` (`booking_id`),
  KEY `idx_transactions_provider_payment` (`payment_provider`,`provider_payment_id`),
  CONSTRAINT `fk_transactions_booking_id` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`),
  CONSTRAINT `fk_transactions_order_id` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `fk_transactions_order_item_id` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`order_item_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transactions`
--

LOCK TABLES `transactions` WRITE;
/*!40000 ALTER TABLE `transactions` DISABLE KEYS */;
INSERT INTO `transactions` VALUES (1,1,89.00,'paid','Card payment','2026-05-01 10:09:33',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(2,1,32.00,'paid','Card payment','2026-05-01 10:19:33',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(3,1,22.00,'paid','Card payment','2026-05-01 10:28:14',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(4,1,28.00,'paid','Card payment','2026-05-01 10:32:11',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(5,1,28.00,'paid','Card payment','2026-05-01 10:35:55',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(6,1,28.00,'paid','Card payment','2026-05-01 10:49:39',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(7,1,28.00,'paid','card','2026-05-01 16:56:04',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(8,1,35.00,'paid','card','2026-05-01 17:25:03',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(9,1,68.00,'paid','card','2026-05-01 17:44:28',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(10,1,68.00,'paid','card','2026-05-01 17:48:20',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(11,1,32.00,'paid','Apple Pay','2026-06-03 13:46:00',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,32.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(12,6,18.90,'paid','Stripe','2026-06-07 09:15:40',NULL,1,1,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(13,6,17.95,'paid','Stripe','2026-06-07 09:54:16',NULL,2,2,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.95,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(14,1,8.91,'paid','Stripe','2026-06-08 13:34:14',NULL,3,3,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(15,1,15.12,'paid','Stripe','2026-06-08 13:52:11',NULL,4,4,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(16,1,78.51,'paid','Stripe','2026-06-08 14:48:17',NULL,5,5,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,88.50,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(23,1,9.36,'paid','Apple Pay','2026-06-11 13:12:39',NULL,9,10,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,9.54,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(24,1,47.33,'paid','Apple Pay','2026-06-11 13:23:22',NULL,10,11,'delivered',NULL,'2026-06-11 21:23:56','none',0.00,NULL,'pending_pickup',NULL,47.80,0.47,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL);
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
-- Table structure for table `user_vouchers`
--

DROP TABLE IF EXISTS `user_vouchers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_vouchers` (
  `user_voucher_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `source_type` varchar(30) NOT NULL DEFAULT 'reward_shop',
  `source_reference` varchar(120) DEFAULT NULL,
  `title` varchar(120) NOT NULL,
  `detail` text,
  `voucher_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `remaining_value` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_type` varchar(20) NOT NULL DEFAULT 'fixed',
  `discount_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `booking_only` tinyint(1) NOT NULL DEFAULT '1',
  `first_booking_only` tinyint(1) NOT NULL DEFAULT '0',
  `voucher_definition_id` int DEFAULT NULL,
  `merchant_id` int DEFAULT NULL,
  `linked_item_type` varchar(20) DEFAULT NULL,
  `linked_item_id` int DEFAULT NULL,
  `minimum_spend` decimal(10,2) NOT NULL DEFAULT '0.00',
  `code` varchar(40) NOT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `redeemed_at` datetime DEFAULT NULL,
  `used_booking_id` int DEFAULT NULL,
  `used_transaction_id` int DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_voucher_id`),
  UNIQUE KEY `uq_user_vouchers_code` (`code`),
  KEY `idx_user_vouchers_user_status` (`user_id`,`status`,`created_at`),
  KEY `fk_user_vouchers_definition` (`voucher_definition_id`),
  CONSTRAINT `fk_user_vouchers_definition` FOREIGN KEY (`voucher_definition_id`) REFERENCES `reward_shop_vouchers` (`voucher_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_user_vouchers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_vouchers`
--

LOCK TABLES `user_vouchers` WRITE;
/*!40000 ALTER TABLE `user_vouchers` DISABLE KEYS */;
INSERT INTO `user_vouchers` VALUES (1,1,'reward_shop','1','$5 OFF BOOKING','Get $5 off your next booking when you redeem 1,000 VaniGlints. Applicable to eligible services and valid for one-time use.',5.00,5.00,'fixed',0.00,'active',1,0,1,NULL,NULL,NULL,0.00,'RWD-B6A4D522',NULL,'2026-06-03 17:25:12',NULL,NULL,NULL,NULL),(2,1,'reward_shop_merchant','5','10% OFF Ladies Haircut','10% off service voucher for Ladies Haircut. Redeem with 500 VaniGlints.',0.00,0.00,'percentage',10.00,'active',1,0,5,1,NULL,NULL,0.00,'RWD-22B00294','2026-09-30 01:03:00','2026-06-03 17:28:43',NULL,NULL,NULL,NULL),(3,1,'reward_shop','2','$10 off booking','Get $10 off your next booking when you redeem 1,500 VaniGlints. Applicable to eligible services and valid for one-time use.',10.00,10.00,'fixed',0.00,'active',1,0,2,NULL,NULL,NULL,0.00,'RWD-55789A09',NULL,'2026-06-03 17:28:45',NULL,NULL,NULL,NULL),(4,1,'reward_shop_merchant','7','10% OFF Repair Shampoo','10% off product voucher for Repair Shampoo. Redeem with 500 VaniGlints.',0.00,0.00,'percentage',10.00,'active',0,0,7,3,NULL,NULL,0.00,'RWD-193005F5','2026-08-31 01:06:00','2026-06-03 17:28:52',NULL,NULL,NULL,NULL),(5,1,'reward_shop_merchant','8','24.99% OFF Skin Fade','24.99% off service voucher for Skin Fade. Redeem with 1500 VaniGlints.',0.00,0.00,'percentage',24.99,'active',1,0,8,3,NULL,NULL,0.00,'RWD-5B368E62','2026-09-30 01:07:00','2026-06-03 17:28:58',NULL,NULL,NULL,NULL),(6,1,'reward_shop_merchant','9','10% OFF Hydrating Face Mask','10% off product voucher for Hydrating Face Mask. Redeem with 500 VaniGlints.',0.00,0.00,'percentage',10.00,'active',0,0,9,2,NULL,NULL,0.00,'RWD-547E3062','2026-09-01 01:09:00','2026-06-03 17:29:06',NULL,NULL,NULL,NULL),(7,1,'reward_shop_merchant','7','10% OFF Repair Shampoo','10% off product voucher for Repair Shampoo. Redeem with 500 VaniGlints.',0.00,0.00,'percentage',10.00,'active',0,0,7,3,NULL,NULL,0.00,'RWD-7D3F8F25','2026-08-31 01:06:00','2026-06-03 17:29:22',NULL,NULL,NULL,NULL),(8,1,'reward_shop_merchant','11','20% OFF Repair Shampoo','20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.',0.00,0.00,'percentage',20.00,'used',0,0,11,1,NULL,NULL,0.00,'RWD-9ADE9738','2026-09-03 01:45:00','2026-06-03 17:46:33','2026-06-08 21:52:11',NULL,15,'2026-06-08 21:52:11'),(9,1,'reward_shop','12','$10 off','lovely',9.99,0.00,'fixed',0.00,'used',0,0,12,1,'product',1,0.00,'RWD-A9207B14',NULL,'2026-06-03 18:58:04','2026-06-08 21:34:14',NULL,14,'2026-06-08 21:34:14'),(10,6,'birthday','birthday-2026','20% OFF Birthday Month Voucher','20% off eligible beauty and wellness service bookings. Valid until 30 June 2026.',0.00,0.00,'percentage',20.00,'active',1,0,NULL,NULL,NULL,NULL,0.00,'RWD-F01D224F','2026-07-01 00:00:00','2026-06-04 10:40:44',NULL,NULL,NULL,NULL),(19,1,'reward_shop','12','$10 off','lovely',9.99,0.00,'fixed',0.00,'used',0,0,12,1,'product',1,0.00,'RWD-097D7242',NULL,'2026-06-08 14:45:53','2026-06-08 22:48:17',NULL,16,'2026-06-08 22:48:17'),(20,13,'referral','VANI0012','$10 Off First Booking','Referral reward voucher for your first paid booking.',10.00,10.00,'fixed',0.00,'active',1,1,NULL,NULL,NULL,NULL,0.00,'REF-BCD40629',NULL,'2026-06-11 13:48:35',NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `user_vouchers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `age` int DEFAULT NULL,
  `birthday` date DEFAULT NULL,
  `gender` enum('female','male','non_binary','prefer_not_to_say','other') DEFAULT NULL,
  `postal_code` varchar(6) DEFAULT NULL,
  `preferred_contact_method` enum('email','phone','whatsapp') DEFAULT NULL,
  `profile_image` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('customer','merchant','admin') DEFAULT 'customer',
  `account_status` enum('active','terminated') DEFAULT 'active',
  `glints_balance` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `referral_code` varchar(50) DEFAULT NULL,
  `referred_by_code` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_users_role_status` (`role`,`account_status`),
  KEY `idx_users_referral_code` (`referral_code`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'mary','mary@mary.com','94477346',21,'2005-02-02','female','213245','whatsapp',NULL,'$2b$10$V0J24b/4laUlBYcUc.gvve9U.mmAdsgVngrw9VqEgT.vwfCQ5hUQK','customer','active',9992000,'2026-04-28 22:37:32','VANI0001',NULL),(2,'Admin User','admin@vaniday.sg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','admin','active',0,'2026-04-29 22:12:21',NULL,NULL),(3,'Vaniday Beauty Merchant','beauty@vaniday.sg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant','active',0,'2026-04-29 22:12:21',NULL,NULL),(4,'FreshGlow Spa Merchant','spa@vaniday.sg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant','active',0,'2026-04-29 22:12:21',NULL,NULL),(5,'Urban Groom Merchant','barber@vaniday.sg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'$2b$10$WJyxKoWZ6dIO3aSRCuWMUuqT3nJpCqpbWpqZ8xl2suKy4jx3nRcc6','merchant','active',0,'2026-04-29 22:12:21',NULL,NULL),(6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',21,'2026-06-04','male','760353','whatsapp',NULL,'$2b$12$aMIIp9cMfdBkdg0uKAvEx.VDVnmuEH/8fuNVPjho4OJttIUk6fu1q','customer','active',100,'2026-06-03 05:08:44','VANI0006',NULL),(12,'Raphaela Lee','raphaelalee24@gmail.com','89081215',20,'2006-01-24','female','823226','whatsapp','/uploads/profiles/profile-1781185471705-0aa8a38960449554c1fd.jpg','$2b$12$V.dc1bsR12tvCNE5cDLvvurwwuZ13WB8mubRbqHDbIa1Ur8R8kx/e','customer','active',0,'2026-06-11 13:43:50','VANI0012',NULL),(13,'rebecca lim rui min','rebecca@rebecca.com','92142432',29,'1989-09-27','female','454354','email',NULL,'$2b$12$HgKaYrE01OevpS6R34myB.tUOyQvzjtyvc/y/xcwXNEynZQmMFbae','customer','active',0,'2026-06-11 13:48:35','VANI0013','VANI0012');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `merchant_approval_logs`
--

DROP TABLE IF EXISTS `merchant_approval_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `merchant_approval_logs` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `salon_id` int NOT NULL,
  `merchant_user_id` int NOT NULL,
  `admin_user_id` int DEFAULT NULL,
  `from_status` varchar(40) DEFAULT NULL,
  `to_status` varchar(40) NOT NULL,
  `reason` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_merchant_approval_salon` (`salon_id`,`created_at`),
  KEY `idx_merchant_approval_merchant` (`merchant_user_id`,`created_at`),
  KEY `idx_merchant_approval_admin` (`admin_user_id`,`created_at`),
  CONSTRAINT `fk_merchant_approval_log_admin` FOREIGN KEY (`admin_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_merchant_approval_log_merchant` FOREIGN KEY (`merchant_user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_merchant_approval_log_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_approval_logs`
--

LOCK TABLES `merchant_approval_logs` WRITE;
/*!40000 ALTER TABLE `merchant_approval_logs` DISABLE KEYS */;
INSERT INTO `merchant_approval_logs` (`salon_id`,`merchant_user_id`,`admin_user_id`,`from_status`,`to_status`,`reason`,`created_at`) VALUES (1,3,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21'),(2,4,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21'),(3,5,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21');
/*!40000 ALTER TABLE `merchant_approval_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `beauty_routine_attempts`
--

DROP TABLE IF EXISTS `beauty_routine_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `beauty_routine_attempts` (
  `attempt_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `goals_json` json DEFAULT NULL,
  `concerns_json` json DEFAULT NULL,
  `preferences_json` json DEFAULT NULL,
  `budget_min` decimal(10,2) DEFAULT NULL,
  `budget_max` decimal(10,2) DEFAULT NULL,
  `location_preference` varchar(255) DEFAULT NULL,
  `recommended_service_ids` json DEFAULT NULL,
  `recommended_product_ids` json DEFAULT NULL,
  `recommended_salon_ids` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`attempt_id`),
  KEY `idx_routine_attempt_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_routine_attempt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `beauty_routine_attempts`
--

LOCK TABLES `beauty_routine_attempts` WRITE;
/*!40000 ALTER TABLE `beauty_routine_attempts` DISABLE KEYS */;
/*!40000 ALTER TABLE `beauty_routine_attempts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vouchers`
--

DROP TABLE IF EXISTS `vouchers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vouchers` (
  `voucher_id` int NOT NULL AUTO_INCREMENT,
  `merchant_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `voucher_type` enum('first_trial','birthday','happy_hour','discount','cashback','free_addon','featured') DEFAULT 'discount',
  `discount_type` enum('percentage','fixed_amount','free_service') DEFAULT 'percentage',
  `discount_value` decimal(10,2) DEFAULT '0.00',
  `minimum_spend` decimal(10,2) DEFAULT '0.00',
  `points_required` int DEFAULT '0',
  `voucher_code` varchar(50) DEFAULT NULL,
  `quantity_available` int DEFAULT '999',
  `quantity_redeemed` int DEFAULT '0',
  `start_date` datetime NOT NULL,
  `end_date` datetime NOT NULL,
  `status` enum('active','inactive','expired') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`voucher_id`),
  UNIQUE KEY `voucher_code` (`voucher_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vouchers`
--

LOCK TABLES `vouchers` WRITE;
/*!40000 ALTER TABLE `vouchers` DISABLE KEYS */;
/*!40000 ALTER TABLE `vouchers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `whatsapp_conversation_sessions`
--

DROP TABLE IF EXISTS `whatsapp_conversation_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `whatsapp_conversation_sessions` (
  `phone` varchar(30) NOT NULL,
  `session_json` longtext NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`phone`),
  KEY `idx_whatsapp_conversation_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `whatsapp_conversation_sessions`
--

LOCK TABLES `whatsapp_conversation_sessions` WRITE;
/*!40000 ALTER TABLE `whatsapp_conversation_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `whatsapp_conversation_sessions` ENABLE KEYS */;
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

-- Dump completed on 2026-06-11 21:50:44
