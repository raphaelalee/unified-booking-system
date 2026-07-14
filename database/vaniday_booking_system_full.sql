CREATE DATABASE  IF NOT EXISTS `vaniday_booking_system` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `vaniday_booking_system`;
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,12,'customer','points_converted_to_cashback','loyalty_wallet','12','{\"points\":100,\"cashback\":1}','2026-07-08 06:39:31');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
INSERT INTO `bookings` VALUES (1,1,NULL,NULL,NULL,3,6,NULL,'2026-05-02','10:00:00','confirmed','3.5hZQkaBOvB5EqhMqFhjMmmgtu7kBIU54hGN4DsJNzDo',NULL,'not_requested',NULL,NULL),(2,1,NULL,NULL,NULL,1,1,NULL,'2026-05-04','10:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(3,1,NULL,NULL,NULL,1,2,NULL,'2026-05-04','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(4,1,NULL,NULL,NULL,1,2,NULL,'2026-05-03','11:00:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(5,1,NULL,NULL,NULL,1,2,NULL,'2026-05-18','15:30:00','pending','1.5DrcsaqSGQOxXceqYQMKib_AVegXgVwcxYjABvNy658',NULL,'not_requested',NULL,NULL),(6,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',2,4,NULL,'2026-06-12','13:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(7,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',2,4,NULL,'2026-06-12','18:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(8,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-13','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(9,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',1,1,NULL,'2026-06-13','14:00:00','confirmed','vaniday-beauty-studio-orchard',NULL,'not_requested',NULL,NULL),(10,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',1,1,NULL,'2026-06-07','17:00:00','cancelled','vaniday-beauty-studio-orchard','Cancelled by WhatsApp reply','customer_cancelled_review','2026-06-05 00:22:11',NULL),(11,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-08','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(12,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-09','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(13,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-14','17:00:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(14,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,6,NULL,'2026-06-14','13:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(15,6,'Angelo Casia','angelomiguelcasia@gmail.com','6589771550',3,7,NULL,'2026-06-12','14:30:00','confirmed','urban-groom-barbers-woodlands',NULL,'not_requested',NULL,NULL),(18,1,'mary','mary@mary.com','94477346',3,6,NULL,'2026-06-13','13:30:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(19,1,'mary','mary@mary.com','94477346',1,3,NULL,'2026-06-13','16:00:00','confirmed',NULL,NULL,'not_requested',NULL,NULL),(20,12,'Raphaela Lee','raphaelalee24@gmail.com','89081215',3,7,NULL,'2026-07-18','14:30:00','confirmed',NULL,NULL,'not_requested',NULL,NULL);
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
INSERT INTO `customer_carts` VALUES (1,'[]','2026-07-08 10:30:30'),(6,'[]','2026-06-07 09:54:16'),(12,'[]','2026-07-08 06:51:10');
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
-- Table structure for table `e_wallet_transactions`
--

DROP TABLE IF EXISTS `e_wallet_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `e_wallet_transactions` (
  `transaction_id` int NOT NULL AUTO_INCREMENT,
  `wallet_id` int NOT NULL,
  `user_id` int NOT NULL,
  `transaction_type` enum('TOPUP','PAYMENT','REFUND','CASHBACK','ADJUSTMENT') NOT NULL,
  `payment_method` enum('STRIPE','PAYPAL','PAYNOW','NETS_QR','EWALLET','SYSTEM') DEFAULT 'SYSTEM',
  `amount` decimal(10,2) NOT NULL,
  `balance_before` decimal(10,2) NOT NULL,
  `balance_after` decimal(10,2) NOT NULL,
  `status` enum('PENDING','COMPLETED','FAILED','CANCELLED') DEFAULT 'PENDING',
  `reference_id` varchar(255) DEFAULT NULL,
  `payment_attempt_id` varchar(100) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`transaction_id`),
  KEY `wallet_id` (`wallet_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `e_wallet_transactions_ibfk_1` FOREIGN KEY (`wallet_id`) REFERENCES `e_wallets` (`wallet_id`),
  CONSTRAINT `e_wallet_transactions_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `e_wallet_transactions`
--

LOCK TABLES `e_wallet_transactions` WRITE;
/*!40000 ALTER TABLE `e_wallet_transactions` DISABLE KEYS */;
INSERT INTO `e_wallet_transactions` VALUES (1,1,1,'TOPUP','STRIPE',10.00,0.00,10.00,'COMPLETED',NULL,NULL,'Wallet top-up completed via Stripe','2026-07-08 10:10:24'),(2,1,1,'TOPUP','STRIPE',100.00,10.00,110.00,'COMPLETED',NULL,NULL,'Wallet top-up completed via Stripe','2026-07-08 10:11:56'),(3,1,1,'TOPUP','EWALLET',10.00,110.00,110.00,'PENDING',NULL,NULL,'Test top-up','2026-07-08 10:27:21');
/*!40000 ALTER TABLE `e_wallet_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `e_wallets`
--

DROP TABLE IF EXISTS `e_wallets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `e_wallets` (
  `wallet_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `balance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `currency` varchar(5) NOT NULL DEFAULT 'SGD',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`wallet_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `e_wallets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `e_wallets`
--

LOCK TABLES `e_wallets` WRITE;
/*!40000 ALTER TABLE `e_wallets` DISABLE KEYS */;
INSERT INTO `e_wallets` VALUES (1,1,110.00,'SGD','2026-07-08 10:04:58','2026-07-08 10:12:32');
/*!40000 ALTER TABLE `e_wallets` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_plays`
--

LOCK TABLES `game_plays` WRITE;
/*!40000 ALTER TABLE `game_plays` DISABLE KEYS */;
INSERT INTO `game_plays` VALUES (1,1,1,'60 VaniGlints','glints',60,'2026-05-01 19:01:08');
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
INSERT INTO `game_prizes` VALUES (1,NULL,'60 VaniGlints','Platform reward points added to the customer wallet.','glints',60,45,'active',NULL,'2026-05-01 05:37:55'),(2,NULL,'$5 Beauty Voucher','Customer can use this as a future Vaniday benefit.','voucher',5,25,'active',NULL,'2026-05-01 05:37:55'),(3,NULL,'Priority Booking Perk','Customer earns a platform benefit for a future booking.','benefit',NULL,15,'active',NULL,'2026-05-01 05:37:55');
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
INSERT INTO `game_settings` VALUES (1,1,80.00,1,1,'2026-05-01 05:37:55');
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
INSERT INTO `game_wallets` VALUES (1,6,'2026-04-21',5,'2026-05-01 19:07:27'),(6,1,'2026-05-31',0,'2026-06-03 05:47:30');
/*!40000 ALTER TABLE `game_wallets` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `loyalty_transactions`
--

LOCK TABLES `loyalty_transactions` WRITE;
/*!40000 ALTER TABLE `loyalty_transactions` DISABLE KEYS */;
INSERT INTO `loyalty_transactions` VALUES (1,1,'order-11',NULL,NULL,'EARNED',320,1.60,'Earned points and platform cashback from receipt 11','2027-06-03 21:46:00','11','Any merchant',0.00,'2026-06-03 13:46:00'),(2,1,'order-6',NULL,NULL,'EARNED',280,1.40,'Earned points and platform cashback from receipt 6','2027-06-04 01:23:11','6','Bodycare',0.00,'2026-06-03 17:23:11'),(3,1,'order-5',NULL,NULL,'EARNED',280,1.40,'Earned points and platform cashback from receipt 5','2027-06-04 01:23:11','5','Bodycare',0.00,'2026-06-03 17:23:11'),(4,6,'order-12',NULL,NULL,'EARNED',189,0.95,'Earned points and platform cashback from receipt 12','2027-06-07 17:15:40','12','Any merchant',0.00,'2026-06-07 09:15:40'),(5,6,'cashback-order-13',NULL,NULL,'CASHBACK_USED',0,-0.95,'Cashback used at checkout for order-13',NULL,NULL,NULL,0.00,'2026-06-07 09:54:16'),(6,6,'order-13',NULL,NULL,'EARNED',179,0.90,'Earned points and platform cashback from receipt 13','2027-06-07 17:54:16','13','Any merchant',0.00,'2026-06-07 09:54:16'),(7,1,'order-14',NULL,NULL,'EARNED',89,0.45,'Earned points and platform cashback from receipt 14','2027-06-08 21:34:14','14','Any merchant',0.00,'2026-06-08 13:34:14'),(8,1,'order-15',NULL,NULL,'EARNED',151,0.76,'Earned points and platform cashback from receipt 15','2027-06-08 21:52:12','15','Any merchant',0.00,'2026-06-08 13:52:12'),(9,1,'order-16',NULL,NULL,'EARNED',785,3.93,'Earned points and platform cashback from receipt 16','2027-06-08 22:48:17','16','Delivery',0.00,'2026-06-08 14:48:17'),(10,1,'cashback-order-23',NULL,NULL,'CASHBACK_USED',0,-9.54,'Cashback used at checkout for order-23',NULL,NULL,NULL,0.00,'2026-06-11 13:12:39'),(11,1,'order-23',NULL,NULL,'EARNED',93,0.47,'Earned points and platform cashback from receipt 23','2027-06-11 21:12:39','23','Any merchant',0.00,'2026-06-11 13:12:39'),(12,1,'cashback-order-24',NULL,NULL,'CASHBACK_USED',0,-0.47,'Cashback used at checkout for order-24',NULL,NULL,NULL,0.00,'2026-06-11 13:23:22'),(13,1,'order-24',NULL,NULL,'EARNED',473,2.37,'Earned points and platform cashback from receipt 24','2027-06-11 21:23:22','24','Any merchant',0.00,'2026-06-11 13:23:22'),(14,12,'order-25',NULL,NULL,'EARNED',189,0.95,'Earned points and platform cashback from receipt 25','2027-07-08 14:30:45','25','Any merchant',0.00,'2026-07-08 06:30:45'),(15,12,'points-1783492771552',NULL,NULL,'REDEEMED',-100,1.00,'Redeemed 100 points for $1.00 cashback',NULL,NULL,NULL,0.00,'2026-07-08 06:39:31'),(16,12,'cashback-order-26',NULL,NULL,'CASHBACK_USED',0,-1.95,'Cashback used at checkout for order-26',NULL,NULL,NULL,0.00,'2026-07-08 06:43:13'),(17,12,'order-26',NULL,NULL,'EARNED',269,1.35,'Earned points and platform cashback from receipt 26','2027-07-08 14:43:13','26','Any merchant',0.00,'2026-07-08 06:43:13'),(18,12,'cashback-order-27',NULL,NULL,'CASHBACK_USED',0,-1.35,'Cashback used at checkout for order-27',NULL,NULL,NULL,0.00,'2026-07-08 06:51:10'),(19,12,'order-27',NULL,NULL,'EARNED',175,0.88,'Earned points and platform cashback from receipt 27','2027-07-08 14:51:10','27','Any merchant',0.00,'2026-07-08 06:51:10'),(20,1,'cashback-order-28',NULL,NULL,'CASHBACK_USED',0,-2.37,'Cashback used at checkout for order-28',NULL,NULL,NULL,0.00,'2026-07-08 10:24:17'),(21,1,'order-28',NULL,NULL,'EARNED',165,0.83,'Earned points and platform cashback from receipt 28','2027-07-08 18:24:17','28','Any merchant',0.00,'2026-07-08 10:24:17'),(22,1,'cashback-order-29',NULL,NULL,'CASHBACK_USED',0,-0.83,'Cashback used at checkout for order-29',NULL,NULL,NULL,0.00,'2026-07-08 10:24:26'),(23,1,'order-29',NULL,NULL,'EARNED',180,0.90,'Earned points and platform cashback from receipt 29','2027-07-08 18:24:26','29','Any merchant',0.00,'2026-07-08 10:24:26'),(24,1,'cashback-order-30',NULL,NULL,'CASHBACK_USED',0,-0.90,'Cashback used at checkout for order-30',NULL,NULL,NULL,0.00,'2026-07-08 10:27:51'),(25,1,'order-30',NULL,NULL,'EARNED',180,0.90,'Earned points and platform cashback from receipt 30','2027-07-08 18:27:51','30','Any merchant',0.00,'2026-07-08 10:27:51'),(26,1,'cashback-order-31',NULL,NULL,'CASHBACK_USED',0,-0.90,'Cashback used at checkout for order-31',NULL,NULL,NULL,0.00,'2026-07-08 10:28:01'),(27,1,'order-31',NULL,NULL,'EARNED',180,0.90,'Earned points and platform cashback from receipt 31','2027-07-08 18:28:01','31','Any merchant',0.00,'2026-07-08 10:28:01'),(28,1,'cashback-order-32',NULL,NULL,'CASHBACK_USED',0,-0.90,'Cashback used at checkout for order-32',NULL,NULL,NULL,0.00,'2026-07-08 10:28:19'),(29,1,'order-32',NULL,NULL,'EARNED',180,0.90,'Earned points and platform cashback from receipt 32','2027-07-08 18:28:19','32','Any merchant',0.00,'2026-07-08 10:28:19'),(30,1,'cashback-order-33',NULL,NULL,'CASHBACK_USED',0,-0.90,'Cashback used at checkout for order-33',NULL,NULL,NULL,0.00,'2026-07-08 10:28:48'),(31,1,'order-33',NULL,NULL,'EARNED',180,0.90,'Earned points and platform cashback from receipt 33','2027-07-08 18:28:48','33','Any merchant',0.00,'2026-07-08 10:28:48'),(32,1,'cashback-order-34',NULL,NULL,'CASHBACK_USED',0,-0.90,'Cashback used at checkout for order-34',NULL,NULL,NULL,0.00,'2026-07-08 10:29:01'),(33,1,'order-34',NULL,NULL,'EARNED',280,1.40,'Earned points and platform cashback from receipt 34','2027-07-08 18:29:01','34','Any merchant',0.00,'2026-07-08 10:29:01'),(34,1,'cashback-order-35',NULL,NULL,'CASHBACK_USED',0,-1.40,'Cashback used at checkout for order-35',NULL,NULL,NULL,0.00,'2026-07-08 10:29:32'),(35,1,'order-35',NULL,NULL,'EARNED',275,1.38,'Earned points and platform cashback from receipt 35','2027-07-08 18:29:32','35','Any merchant',0.00,'2026-07-08 10:29:32'),(36,1,'cashback-order-36',NULL,NULL,'CASHBACK_USED',0,-1.38,'Cashback used at checkout for order-36',NULL,NULL,NULL,0.00,'2026-07-08 10:30:30'),(37,1,'order-36',NULL,NULL,'EARNED',784,3.92,'Earned points and platform cashback from receipt 36','2027-07-08 18:30:30','36','Any merchant',0.00,'2026-07-08 10:30:30'),(38,1,'cashback-order-37',NULL,NULL,'CASHBACK_USED',0,-3.92,'Cashback used at checkout for order-37',NULL,NULL,NULL,0.00,'2026-07-08 10:31:27'),(39,1,'order-37',NULL,NULL,'EARNED',758,3.79,'Earned points and platform cashback from receipt 37','2027-07-08 18:31:27','37','Any merchant',0.00,'2026-07-08 10:31:27'),(40,1,'cashback-order-38',NULL,NULL,'CASHBACK_USED',0,-3.79,'Cashback used at checkout for order-38',NULL,NULL,NULL,0.00,'2026-07-08 10:32:09'),(41,1,'order-38',NULL,NULL,'EARNED',760,3.80,'Earned points and platform cashback from receipt 38','2027-07-08 18:32:09','38','Any merchant',0.00,'2026-07-08 10:32:09');
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
INSERT INTO `loyalty_wallets` VALUES (1,6393,3.80,6393,'2026-07-08 10:32:09'),(6,368,0.90,368,'2026-06-07 09:54:16'),(12,533,0.88,633,'2026-07-08 06:51:10'),(13,0,0.00,0,'2026-06-11 13:48:36');
/*!40000 ALTER TABLE `loyalty_wallets` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `merchant_approval_logs`
--

LOCK TABLES `merchant_approval_logs` WRITE;
/*!40000 ALTER TABLE `merchant_approval_logs` DISABLE KEYS */;
INSERT INTO `merchant_approval_logs` VALUES (1,1,3,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21'),(2,2,4,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21'),(3,3,5,2,NULL,'approved','Seed merchant approved.','2026-04-29 22:12:21');
/*!40000 ALTER TABLE `merchant_approval_logs` ENABLE KEYS */;
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
) ENGINE=InnoDB AUTO_INCREMENT=151 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `notifications`
--

LOCK TABLES `notifications` WRITE;
/*!40000 ALTER TABLE `notifications` DISABLE KEYS */;
INSERT INTO `notifications` VALUES (1,6,'customer',4,'booking_confirmed','Booking request submitted','Aromatherapy Massage at FreshGlow Spa is booked for Fri Jun 12 at 13:00.','/receipt/6','unread','web-booking-customer-6',NULL,'2026-06-03 05:27:10',NULL),(2,4,'merchant',6,'booking','New booking received','Angelo Casia booked Aromatherapy Massage for Fri Jun 12 at 13:00.','/merchant/bookings','unread','web-booking-merchant-6',NULL,'2026-06-03 05:27:10',NULL),(3,2,'admin',6,'booking','New customer booking','Angelo Casia booked Aromatherapy Massage at FreshGlow Spa.','/admin/bookings','unread','web-booking-admin-6-2',NULL,'2026-06-03 05:27:10',NULL),(4,6,'customer',4,'booking_confirmed','Booking request submitted','Aromatherapy Massage at FreshGlow Spa is booked for Fri Jun 12 at 18:00.','/receipt/7','unread','web-booking-customer-7',NULL,'2026-06-03 05:46:49',NULL),(5,4,'merchant',6,'booking','New booking received','Angelo Casia booked Aromatherapy Massage for Fri Jun 12 at 18:00.','/merchant/bookings','unread','web-booking-merchant-7',NULL,'2026-06-03 05:46:49',NULL),(6,2,'admin',6,'booking','New customer booking','Angelo Casia booked Aromatherapy Massage at FreshGlow Spa.','/admin/bookings','unread','web-booking-admin-7-2',NULL,'2026-06-03 05:46:49',NULL),(7,3,'merchant',3,'stock_update','Stock updated','Product stock increased by 1.','/merchant/products','unread','merchant-stock-updated-6-1780491109964',NULL,'2026-06-03 12:51:49',NULL),(8,2,'admin',3,'stock_update','Merchant restocked a product','Merchant product #6 stock increased by 1.','/admin/products','unread','admin-stock-updated-6-1780491109964-2',NULL,'2026-06-03 12:51:49',NULL),(9,3,'merchant',3,'product_update','Product listed','EFFACLAR ULTRA CONCENTRATED SERUM is now available in the Vaniday product catalogue.','/merchant/products','unread','merchant-product-created-7-3',NULL,'2026-06-03 13:06:04',NULL),(10,1,'customer',3,'product_update','New beauty product added','Vaniday Beauty Studio added EFFACLAR ULTRA CONCENTRATED SERUM to the Vaniday shop.','/products','unread','customer-product-created-7-1',NULL,'2026-06-03 13:06:04',NULL),(11,2,'admin',3,'product_update','Merchant listed a product','Vaniday Beauty Studio listed EFFACLAR ULTRA CONCENTRATED SERUM.','/admin/products','unread','admin-product-created-7-2',NULL,'2026-06-03 13:06:04',NULL),(12,6,'customer',3,'product_update','New beauty product added','Vaniday Beauty Studio added EFFACLAR ULTRA CONCENTRATED SERUM to the Vaniday shop.','/products','unread','customer-product-created-7-6',NULL,'2026-06-03 13:06:04',NULL),(13,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($32.00).','/receipt/order-11','unread','payment-customer-order-11','{\"receiptId\":\"order-11\",\"transactionId\":11}','2026-06-03 13:46:00',NULL),(14,2,'admin',1,'order_paid','Paid order completed','mary completed a $32.00 checkout.','/admin','unread','payment-admin-order-11-2','{\"receiptId\":\"order-11\",\"transactionId\":11}','2026-06-03 13:46:00',NULL),(15,2,'admin',2,'reward_update','Reward voucher created','$5 OFF BOOKING was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780505887281-2',NULL,'2026-06-03 16:58:07',NULL),(16,6,'customer',2,'reward_update','New reward voucher','$5 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780505887281-6',NULL,'2026-06-03 16:58:07',NULL),(17,1,'customer',2,'reward_update','New reward voucher','$5 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780505887281-1',NULL,'2026-06-03 16:58:07',NULL),(18,1,'customer',NULL,'reward_update','Daily reward claimed','10 VaniGlints were added to your reward balance.','/reward-shop','unread','customer-daily-reward-1-2026-06-03',NULL,'2026-06-03 16:58:47',NULL),(19,2,'admin',2,'reward_update','Reward voucher created','$10 off booking was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506014526-2',NULL,'2026-06-03 17:00:14',NULL),(20,6,'customer',2,'reward_update','New reward voucher','$10 off booking is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506014526-6',NULL,'2026-06-03 17:00:14',NULL),(21,1,'customer',2,'reward_update','New reward voucher','$10 off booking is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506014526-1',NULL,'2026-06-03 17:00:14',NULL),(22,6,'customer',2,'reward_update','New reward voucher','$20 is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506068381-6',NULL,'2026-06-03 17:01:08',NULL),(23,1,'customer',2,'reward_update','New reward voucher','$20 is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506068381-1',NULL,'2026-06-03 17:01:08',NULL),(24,2,'admin',2,'reward_update','Reward voucher created','$20 was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506068381-2',NULL,'2026-06-03 17:01:08',NULL),(25,6,'customer',2,'reward_update','New reward voucher','$50 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506107596-6',NULL,'2026-06-03 17:01:47',NULL),(26,1,'customer',2,'reward_update','New reward voucher','$50 OFF BOOKING is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780506107596-1',NULL,'2026-06-03 17:01:47',NULL),(27,2,'admin',2,'reward_update','Reward voucher created','$50 OFF BOOKING was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780506107597-2',NULL,'2026-06-03 17:01:47',NULL),(28,1,'customer',NULL,'reward_update','Voucher redeemed','$5 OFF BOOKING was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-1',NULL,'2026-06-03 17:25:12',NULL),(29,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Ladies Haircut was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-2',NULL,'2026-06-03 17:28:43',NULL),(30,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off booking was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-3',NULL,'2026-06-03 17:28:45',NULL),(31,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-4',NULL,'2026-06-03 17:28:52',NULL),(32,1,'customer',NULL,'reward_update','Voucher redeemed','24.99% OFF Skin Fade was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-5',NULL,'2026-06-03 17:28:58',NULL),(33,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Hydrating Face Mask was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-6',NULL,'2026-06-03 17:29:06',NULL),(34,1,'customer',NULL,'reward_update','Voucher redeemed','10% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-7',NULL,'2026-06-03 17:29:22',NULL),(35,1,'customer',NULL,'reward_update','Voucher redeemed','20% OFF Repair Shampoo was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-8',NULL,'2026-06-03 17:46:33',NULL),(36,6,'customer',2,'reward_update','New reward voucher','$10 off is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780513065595-6',NULL,'2026-06-03 18:57:45',NULL),(37,1,'customer',2,'reward_update','New reward voucher','$10 off is now available in the Vaniday reward shop.','/reward-shop','unread','customer-reward-voucher-created-1780513065595-1',NULL,'2026-06-03 18:57:45',NULL),(38,2,'admin',2,'reward_update','Reward voucher created','$10 off was added to the reward shop.','/admin/reward-shop','unread','admin-reward-voucher-created-1780513065596-2',NULL,'2026-06-03 18:57:45',NULL),(39,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off was added to your profile vouchers.','/profile#membership','unread','reward-voucher-redeemed-1-9',NULL,'2026-06-03 18:58:04',NULL),(40,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-13 at 14:30.','/receipt/8','unread','booking-created-customer-8','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:57',NULL),(41,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-13 at 14:30.','/merchant/schedule','unread','booking-created-merchant-8','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:57',NULL),(42,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-8-2','{\"merchantId\":3,\"bookingId\":8,\"serviceName\":\"Skin Fade\"}','2026-06-04 09:38:58',NULL),(43,6,'customer',3,'booking_confirmed','Booking request confirmed','Hair Cut at Vaniday Beauty Studio is booked for 2026-06-13 at 14:00.','/receipt/9','unread','booking-created-customer-9','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(44,3,'merchant',6,'booking','New booking received','Angelo Casia booked Hair Cut for 2026-06-13 at 14:00.','/merchant/schedule','unread','booking-created-merchant-9','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(45,2,'admin',6,'booking','New customer booking','Angelo Casia booked Hair Cut at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-9-2','{\"merchantId\":1,\"bookingId\":9,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:50:40',NULL),(46,6,'customer',3,'booking_confirmed','Booking request confirmed','Hair Cut at Vaniday Beauty Studio is booked for 2026-06-07 at 17:00.','/receipt/10','unread','booking-created-customer-10','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(47,3,'merchant',6,'booking','New booking received','Angelo Casia booked Hair Cut for 2026-06-07 at 17:00.','/merchant/schedule','unread','booking-created-merchant-10','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(48,2,'admin',6,'booking','New customer booking','Angelo Casia booked Hair Cut at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-10-2','{\"merchantId\":1,\"bookingId\":10,\"serviceName\":\"Hair Cut\"}','2026-06-04 09:59:50',NULL),(49,6,'customer',NULL,'reward_update','Daily reward claimed','10 VaniGlints were added to your reward balance.','/reward-shop','unread','customer-daily-reward-6-2026-06-04',NULL,'2026-06-04 10:41:47',NULL),(50,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-08 at 14:30.','/receipt/11','unread','booking-created-customer-11','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(51,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-08 at 14:30.','/merchant/schedule','unread','booking-created-merchant-11','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(52,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-11-2','{\"merchantId\":3,\"bookingId\":11,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:00:07',NULL),(53,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-09 at 14:30.','/receipt/12','unread','booking-created-customer-12','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(54,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-09 at 14:30.','/merchant/schedule','unread','booking-created-merchant-12','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(55,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-12-2','{\"merchantId\":3,\"bookingId\":12,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:11:42',NULL),(56,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-14 at 17:00.','/receipt/13','unread','booking-created-customer-13','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(57,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-14 at 17:00.','/merchant/schedule','unread','booking-created-merchant-13','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(58,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-13-2','{\"merchantId\":3,\"bookingId\":13,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:16:56',NULL),(59,6,'customer',5,'booking_confirmed','Booking request confirmed','Classic Haircut at Urban Groom Barbers is booked for 2026-06-14 at 13:30.','/receipt/14','unread','booking-created-customer-14','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(60,5,'merchant',6,'booking','New booking received','Angelo Casia booked Classic Haircut for 2026-06-14 at 13:30.','/merchant/schedule','unread','booking-created-merchant-14','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(61,2,'admin',6,'booking','New customer booking','Angelo Casia booked Classic Haircut at Urban Groom Barbers.','/admin','unread','booking-created-admin-14-2','{\"merchantId\":3,\"bookingId\":14,\"serviceName\":\"Classic Haircut\"}','2026-06-04 16:20:04',NULL),(62,6,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-06-12 at 14:30.','/receipt/15','unread','booking-created-customer-15','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(63,5,'merchant',6,'booking','New booking received','Angelo Casia booked Skin Fade for 2026-06-12 at 14:30.','/merchant/schedule','unread','booking-created-merchant-15','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(64,2,'admin',6,'booking','New customer booking','Angelo Casia booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-15-2','{\"merchantId\":3,\"bookingId\":15,\"serviceName\":\"Skin Fade\"}','2026-06-04 16:21:59',NULL),(65,6,'customer',NULL,'booking_cancelled','Booking cancelled via WhatsApp','Hair Cut at Vaniday Beauty Studio was cancelled from WhatsApp.','/profile#bookings','unread','whatsapp-cancel-customer-10','{\"bookingId\":10}','2026-06-04 16:22:11',NULL),(66,3,'merchant',6,'booking_cancelled','Customer cancelled via WhatsApp','Angelo Casia cancelled Hair Cut for 2026-06-06 at 17:00.','/merchant/bookings','unread','whatsapp-cancel-merchant-10','{\"bookingId\":10}','2026-06-04 16:22:11',NULL),(67,6,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.90).','/receipt/order-12','unread','payment-customer-order-12','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(68,2,'admin',6,'order_paid','Paid order completed','Angelo Casia completed a $18.90 checkout.','/admin','unread','payment-admin-order-12-2','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(69,3,'merchant',6,'order_received','New product order received','Angelo Casia bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-12-3','{\"receiptId\":\"order-12\",\"transactionId\":12}','2026-06-07 09:15:40',NULL),(70,6,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($17.95).','/receipt/order-13','unread','payment-customer-order-13','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(71,2,'admin',6,'order_paid','Paid order completed','Angelo Casia completed a $17.95 checkout.','/admin','unread','payment-admin-order-13-2','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(72,3,'merchant',6,'order_received','New product order received','Angelo Casia bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-13-3','{\"receiptId\":\"order-13\",\"transactionId\":13}','2026-06-07 09:54:16',NULL),(73,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($8.91).','/receipt/order-14','unread','payment-customer-order-14','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(74,2,'admin',1,'order_paid','Paid order completed','mary completed a $8.91 checkout.','/admin','unread','payment-admin-order-14-2','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(75,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-14-3','{\"receiptId\":\"order-14\",\"transactionId\":14}','2026-06-08 13:34:14',NULL),(76,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($15.12).','/receipt/order-15','unread','payment-customer-order-15','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(77,2,'admin',1,'order_paid','Paid order completed','mary completed a $15.12 checkout.','/admin','unread','payment-admin-order-15-2','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(78,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-15-3','{\"receiptId\":\"order-15\",\"transactionId\":15}','2026-06-08 13:52:12',NULL),(79,1,'customer',NULL,'reward_update','Voucher redeemed','$10 off was added to your profile vouchers.','/profile#vouchers','unread','reward-voucher-redeemed-1-19',NULL,'2026-06-08 14:45:53',NULL),(80,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($78.51).','/receipt/order-16','unread','payment-customer-order-16','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(81,2,'admin',1,'order_paid','Paid order completed','mary completed a $78.51 checkout.','/admin','unread','payment-admin-order-16-2','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(82,4,'merchant',1,'order_received','New product order received','mary bought 1 item from FreshGlow Spa ($45.80).','/merchant/orders','unread','payment-merchant-order-16-4','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(83,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($37.80).','/merchant/orders','unread','payment-merchant-order-16-3','{\"receiptId\":\"order-16\",\"transactionId\":16}','2026-06-08 14:48:17',NULL),(84,1,'customer',5,'booking_confirmed','Booking request confirmed','Classic Haircut at Urban Groom Barbers is booked for 2026-06-13 at 13:30.','/receipt/18','unread','booking-created-customer-18','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(85,5,'merchant',1,'booking','New booking received','mary booked Classic Haircut for 2026-06-13 at 13:30.','/merchant/schedule','unread','booking-created-merchant-18','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(86,2,'admin',1,'booking','New customer booking','mary booked Classic Haircut at Urban Groom Barbers.','/admin','unread','booking-created-admin-18-2','{\"merchantId\":3,\"bookingId\":18,\"serviceName\":\"Classic Haircut\"}','2026-06-11 13:06:24',NULL),(87,1,'customer',5,'booking_confirmed','Booking confirmed','Your booking has been confirmed by the merchant. Classic Haircut at Urban Groom Barbers.','/profile#bookings','unread','merchant-booking-status-1-confirmed',NULL,'2026-06-11 13:11:28',NULL),(88,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($9.36).','/receipt/order-23','unread','payment-customer-order-23','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(89,2,'admin',1,'order_paid','Paid order completed','mary completed a $9.36 checkout.','/admin','unread','payment-admin-order-23-2','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(90,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-23-3','{\"receiptId\":\"order-23\",\"transactionId\":23}','2026-06-11 13:12:39',NULL),(91,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($47.33).','/receipt/order-24','unread','payment-customer-order-24','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(92,2,'admin',1,'order_paid','Paid order completed','mary completed a $47.33 checkout.','/admin','unread','payment-admin-order-24-2','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(93,3,'merchant',1,'order_received','New product order received','mary bought 2 items from Vaniday Beauty Studio ($47.80).','/merchant/orders','unread','payment-merchant-order-24-3','{\"receiptId\":\"order-24\",\"transactionId\":24}','2026-06-11 13:23:22',NULL),(94,1,'customer',3,'order_update','Order status updated','Your Repair Shampoo, Scalp Treatment Serum order is now delivered.','/receipt/order-24','unread','merchant-order-status-24-delivered-1781184236534','{\"transactionId\":24,\"status\":\"delivered\"}','2026-06-11 13:23:56',NULL),(95,1,'customer',3,'order_update','Order status updated','Your Repair Shampoo order is now processing.','/receipt/order-23','unread','merchant-order-status-23-processing-1781184239901','{\"transactionId\":23,\"status\":\"processing\"}','2026-06-11 13:23:59',NULL),(96,1,'customer',3,'booking_confirmed','Booking request confirmed','Gel Manicure at Vaniday Beauty Studio is booked for 2026-06-13 at 16:00.','/receipt/19','unread','booking-created-customer-19','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL),(97,3,'merchant',1,'booking','New booking received','mary booked Gel Manicure for 2026-06-13 at 16:00.','/merchant/schedule','unread','booking-created-merchant-19','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL),(98,2,'admin',1,'booking','New customer booking','mary booked Gel Manicure at Vaniday Beauty Studio.','/admin','unread','booking-created-admin-19-2','{\"merchantId\":1,\"bookingId\":19,\"serviceName\":\"Gel Manicure\"}','2026-06-11 13:26:49',NULL),(99,12,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.90).','/receipt/order-25','unread','payment-customer-order-25','{\"receiptId\":\"order-25\",\"transactionId\":25}','2026-07-08 06:30:45',NULL),(100,2,'admin',12,'order_paid','Paid order completed','Raphaela Lee completed a $18.90 checkout.','/admin','unread','payment-admin-order-25-2','{\"receiptId\":\"order-25\",\"transactionId\":25}','2026-07-08 06:30:46',NULL),(101,3,'merchant',12,'order_received','New product order received','Raphaela Lee bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-25-3','{\"receiptId\":\"order-25\",\"transactionId\":25}','2026-07-08 06:30:46',NULL),(102,12,'customer',5,'booking_confirmed','Booking request confirmed','Skin Fade at Urban Groom Barbers is booked for 2026-07-18 at 14:30.','/receipt/20','unread','booking-created-customer-20','{\"merchantId\":3,\"bookingId\":20,\"serviceName\":\"Skin Fade\"}','2026-07-08 06:37:26',NULL),(103,5,'merchant',12,'booking','New booking received','Raphaela Lee booked Skin Fade for 2026-07-18 at 14:30.','/merchant/schedule','unread','booking-created-merchant-20','{\"merchantId\":3,\"bookingId\":20,\"serviceName\":\"Skin Fade\"}','2026-07-08 06:37:26',NULL),(104,2,'admin',12,'booking','New customer booking','Raphaela Lee booked Skin Fade at Urban Groom Barbers.','/admin','unread','booking-created-admin-20-2','{\"merchantId\":3,\"bookingId\":20,\"serviceName\":\"Skin Fade\"}','2026-07-08 06:37:26',NULL),(105,12,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($26.95).','/receipt/order-26','unread','payment-customer-order-26','{\"receiptId\":\"order-26\",\"transactionId\":26}','2026-07-08 06:43:13',NULL),(106,2,'admin',12,'order_paid','Paid order completed','Raphaela Lee completed a $26.95 checkout.','/admin','unread','payment-admin-order-26-2','{\"receiptId\":\"order-26\",\"transactionId\":26}','2026-07-08 06:43:13',NULL),(107,3,'merchant',12,'order_received','New product order received','Raphaela Lee bought 1 item from Vaniday Beauty Studio ($28.90).','/merchant/orders','unread','payment-merchant-order-26-3','{\"receiptId\":\"order-26\",\"transactionId\":26}','2026-07-08 06:43:13',NULL),(108,12,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($17.55).','/receipt/order-27','unread','payment-customer-order-27','{\"receiptId\":\"order-27\",\"transactionId\":27}','2026-07-08 06:51:10',NULL),(109,2,'admin',12,'order_paid','Paid order completed','Raphaela Lee completed a $17.55 checkout.','/admin','unread','payment-admin-order-27-2','{\"receiptId\":\"order-27\",\"transactionId\":27}','2026-07-08 06:51:10',NULL),(110,3,'merchant',12,'order_received','New product order received','Raphaela Lee bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-27-3','{\"receiptId\":\"order-27\",\"transactionId\":27}','2026-07-08 06:51:10',NULL),(111,12,'customer',3,'order_update','Order status updated','Your Repair Shampoo order is now delivered.','/receipt/order-27','unread','merchant-order-status-27-delivered-1783493572938','{\"transactionId\":27,\"status\":\"delivered\"}','2026-07-08 06:52:52',NULL),(112,1,'customer',NULL,'support_request','Support request submitted','Order refund #1 has been submitted and is pending admin review. We will notify you at each next step.','/help-center','unread','support-customer-created-1',NULL,'2026-07-08 06:54:16',NULL),(113,2,'admin',1,'support_request','New customer support request','mary submitted order refund #1.','/help-center','read','support-admin-created-1-2',NULL,'2026-07-08 06:54:16','2026-07-08 06:54:42'),(114,3,'merchant',2,'support_request','Support request needs your decision','Vaniday admin sent order refund #1 to you for approval.','/help-center','unread','support-sent-merchant-1',NULL,'2026-07-08 06:56:40',NULL),(115,1,'customer',2,'support_request','Support request sent to merchant','Order refund #1 is now waiting for the merchant decision.','/help-center','unread','support-customer-merchant-review-1',NULL,'2026-07-08 06:56:40',NULL),(116,1,'customer',3,'support_request','Merchant approved your request','The merchant approved refund request #1. Vaniday admin will complete the final decision.','/help-center','read','support-customer-merchant-1-approved',NULL,'2026-07-08 06:57:22','2026-07-08 06:57:42'),(117,2,'admin',3,'support_request','Merchant responded to support request','Vaniday Beauty Merchant approved order refund #1.','/help-center','unread','support-admin-merchant-1-approved-2',NULL,'2026-07-08 06:57:22',NULL),(118,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($16.53).','/receipt/order-28','unread','payment-customer-order-28','{\"receiptId\":\"order-28\",\"transactionId\":28}','2026-07-08 10:24:17',NULL),(119,2,'admin',1,'order_paid','Paid order completed','mary completed a $16.53 checkout.','/admin','unread','payment-admin-order-28-2','{\"receiptId\":\"order-28\",\"transactionId\":28}','2026-07-08 10:24:17',NULL),(120,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-28-3','{\"receiptId\":\"order-28\",\"transactionId\":28}','2026-07-08 10:24:17',NULL),(121,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.07).','/receipt/order-29','unread','payment-customer-order-29','{\"receiptId\":\"order-29\",\"transactionId\":29}','2026-07-08 10:24:26',NULL),(122,2,'admin',1,'order_paid','Paid order completed','mary completed a $18.07 checkout.','/admin','unread','payment-admin-order-29-2','{\"receiptId\":\"order-29\",\"transactionId\":29}','2026-07-08 10:24:26',NULL),(123,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-29-3','{\"receiptId\":\"order-29\",\"transactionId\":29}','2026-07-08 10:24:26',NULL),(124,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.00).','/receipt/order-30','unread','payment-customer-order-30','{\"receiptId\":\"order-30\",\"transactionId\":30}','2026-07-08 10:27:51',NULL),(125,2,'admin',1,'order_paid','Paid order completed','mary completed a $18.00 checkout.','/admin','unread','payment-admin-order-30-2','{\"receiptId\":\"order-30\",\"transactionId\":30}','2026-07-08 10:27:51',NULL),(126,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-30-3','{\"receiptId\":\"order-30\",\"transactionId\":30}','2026-07-08 10:27:51',NULL),(127,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.00).','/receipt/order-31','unread','payment-customer-order-31','{\"receiptId\":\"order-31\",\"transactionId\":31}','2026-07-08 10:28:02',NULL),(128,2,'admin',1,'order_paid','Paid order completed','mary completed a $18.00 checkout.','/admin','unread','payment-admin-order-31-2','{\"receiptId\":\"order-31\",\"transactionId\":31}','2026-07-08 10:28:02',NULL),(129,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-31-3','{\"receiptId\":\"order-31\",\"transactionId\":31}','2026-07-08 10:28:02',NULL),(130,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.00).','/receipt/order-32','unread','payment-customer-order-32','{\"receiptId\":\"order-32\",\"transactionId\":32}','2026-07-08 10:28:19',NULL),(131,2,'admin',1,'order_paid','Paid order completed','mary completed a $18.00 checkout.','/admin','unread','payment-admin-order-32-2','{\"receiptId\":\"order-32\",\"transactionId\":32}','2026-07-08 10:28:19',NULL),(132,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-32-3','{\"receiptId\":\"order-32\",\"transactionId\":32}','2026-07-08 10:28:19',NULL),(133,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($18.00).','/receipt/order-33','unread','payment-customer-order-33','{\"receiptId\":\"order-33\",\"transactionId\":33}','2026-07-08 10:28:48',NULL),(134,2,'admin',1,'order_paid','Paid order completed','mary completed a $18.00 checkout.','/admin','unread','payment-admin-order-33-2','{\"receiptId\":\"order-33\",\"transactionId\":33}','2026-07-08 10:28:48',NULL),(135,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($18.90).','/merchant/orders','unread','payment-merchant-order-33-3','{\"receiptId\":\"order-33\",\"transactionId\":33}','2026-07-08 10:28:48',NULL),(136,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($28.00).','/receipt/order-34','unread','payment-customer-order-34','{\"receiptId\":\"order-34\",\"transactionId\":34}','2026-07-08 10:29:01',NULL),(137,2,'admin',1,'order_paid','Paid order completed','mary completed a $28.00 checkout.','/admin','unread','payment-admin-order-34-2','{\"receiptId\":\"order-34\",\"transactionId\":34}','2026-07-08 10:29:01',NULL),(138,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($28.90).','/merchant/orders','unread','payment-merchant-order-34-3','{\"receiptId\":\"order-34\",\"transactionId\":34}','2026-07-08 10:29:01',NULL),(139,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($27.50).','/receipt/order-35','unread','payment-customer-order-35','{\"receiptId\":\"order-35\",\"transactionId\":35}','2026-07-08 10:29:32',NULL),(140,2,'admin',1,'order_paid','Paid order completed','mary completed a $27.50 checkout.','/admin','unread','payment-admin-order-35-2','{\"receiptId\":\"order-35\",\"transactionId\":35}','2026-07-08 10:29:32',NULL),(141,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($28.90).','/merchant/orders','unread','payment-merchant-order-35-3','{\"receiptId\":\"order-35\",\"transactionId\":35}','2026-07-08 10:29:32',NULL),(142,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($78.42).','/receipt/order-36','unread','payment-customer-order-36','{\"receiptId\":\"order-36\",\"transactionId\":36}','2026-07-08 10:30:30',NULL),(143,2,'admin',1,'order_paid','Paid order completed','mary completed a $78.42 checkout.','/admin','unread','payment-admin-order-36-2','{\"receiptId\":\"order-36\",\"transactionId\":36}','2026-07-08 10:30:30',NULL),(144,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($79.80).','/merchant/orders','unread','payment-merchant-order-36-3','{\"receiptId\":\"order-36\",\"transactionId\":36}','2026-07-08 10:30:30',NULL),(145,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($75.88).','/receipt/order-37','unread','payment-customer-order-37','{\"receiptId\":\"order-37\",\"transactionId\":37}','2026-07-08 10:31:27',NULL),(146,2,'admin',1,'order_paid','Paid order completed','mary completed a $75.88 checkout.','/admin','unread','payment-admin-order-37-2','{\"receiptId\":\"order-37\",\"transactionId\":37}','2026-07-08 10:31:27',NULL),(147,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($79.80).','/merchant/orders','unread','payment-merchant-order-37-3','{\"receiptId\":\"order-37\",\"transactionId\":37}','2026-07-08 10:31:27',NULL),(148,1,'customer',NULL,'order_paid','Order purchased successfully','Your Vaniday order has been paid successfully ($76.01).','/receipt/order-38','unread','payment-customer-order-38','{\"receiptId\":\"order-38\",\"transactionId\":38}','2026-07-08 10:32:09',NULL),(149,2,'admin',1,'order_paid','Paid order completed','mary completed a $76.01 checkout.','/admin','unread','payment-admin-order-38-2','{\"receiptId\":\"order-38\",\"transactionId\":38}','2026-07-08 10:32:09',NULL),(150,3,'merchant',1,'order_received','New product order received','mary bought 1 item from Vaniday Beauty Studio ($79.80).','/merchant/orders','unread','payment-merchant-order-38-3','{\"receiptId\":\"order-38\",\"transactionId\":38}','2026-07-08 10:32:09',NULL);
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
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
INSERT INTO `order_items` VALUES (1,12,1,1,18.90,1),(2,13,1,1,18.90,2),(3,14,1,1,18.90,3),(4,15,1,1,18.90,4),(5,16,4,2,22.90,5),(6,16,1,2,18.90,5),(9,23,1,1,18.90,10),(10,24,1,1,18.90,11),(11,24,2,1,28.90,11),(12,25,1,1,18.90,12),(13,26,2,1,28.90,13),(14,27,1,1,18.90,14),(15,28,1,1,18.90,15),(16,29,1,1,18.90,16),(17,30,1,1,18.90,17),(18,31,1,1,18.90,18),(19,32,1,1,18.90,19),(20,33,1,1,18.90,20),(21,34,2,1,28.90,21),(22,35,2,1,28.90,22),(23,36,6,2,39.90,23),(24,37,6,2,39.90,24),(25,38,6,2,39.90,25);
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
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (1,6,12,18.90,'2026-06-07 09:15:40','processing','none',0.00,NULL,NULL,NULL,NULL),(2,6,13,17.95,'2026-06-07 09:54:16','processing','none',0.00,NULL,NULL,NULL,NULL),(3,1,14,8.91,'2026-06-08 13:34:14','processing','none',0.00,NULL,NULL,NULL,NULL),(4,1,15,15.12,'2026-06-08 13:52:11','processing','none',0.00,NULL,NULL,NULL,NULL),(5,1,16,78.51,'2026-06-08 14:48:17','processing','none',0.00,NULL,NULL,NULL,NULL),(10,1,23,9.36,'2026-06-11 13:12:39','processing','none',0.00,NULL,NULL,NULL,NULL),(11,1,24,47.33,'2026-06-11 13:23:22','processing','none',0.00,NULL,NULL,NULL,NULL),(12,12,25,18.90,'2026-07-08 06:30:45','processing','none',0.00,NULL,NULL,NULL,NULL),(13,12,26,26.95,'2026-07-08 06:43:13','processing','none',0.00,NULL,NULL,NULL,NULL),(14,12,27,17.55,'2026-07-08 06:51:10','processing','none',0.00,NULL,NULL,NULL,NULL),(15,1,28,16.53,'2026-07-08 10:24:17','processing','none',0.00,NULL,NULL,NULL,NULL),(16,1,29,18.07,'2026-07-08 10:24:26','processing','none',0.00,NULL,NULL,NULL,NULL),(17,1,30,18.00,'2026-07-08 10:27:51','processing','none',0.00,NULL,NULL,NULL,NULL),(18,1,31,18.00,'2026-07-08 10:28:01','processing','none',0.00,NULL,NULL,NULL,NULL),(19,1,32,18.00,'2026-07-08 10:28:19','processing','none',0.00,NULL,NULL,NULL,NULL),(20,1,33,18.00,'2026-07-08 10:28:48','processing','none',0.00,NULL,NULL,NULL,NULL),(21,1,34,28.00,'2026-07-08 10:29:01','processing','none',0.00,NULL,NULL,NULL,NULL),(22,1,35,27.50,'2026-07-08 10:29:32','processing','none',0.00,NULL,NULL,NULL,NULL),(23,1,36,78.42,'2026-07-08 10:30:30','processing','none',0.00,NULL,NULL,NULL,NULL),(24,1,37,75.88,'2026-07-08 10:31:27','processing','none',0.00,NULL,NULL,NULL,NULL),(25,1,38,76.01,'2026-07-08 10:32:09','processing','none',0.00,NULL,NULL,NULL,NULL);
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
INSERT INTO `payment_attempts` VALUES ('checkout:ORD-1780825986336-adbae382',6,'checkout','ORD-1780825986336-adbae382','{\"kind\":\"order\",\"receiptId\":\"ORD-1780825986336-adbae382\",\"checkoutId\":\"ORD-1780825986336-adbae382\",\"cartCheckout\":true,\"userId\":6,\"userName\":\"Angelo Casia\",\"userEmail\":\"angelomiguelcasia@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780825961460\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780825986336-adbae382\"}','pending',NULL,NULL,NULL,'2026-06-07 09:53:06','2026-06-07 09:53:06'),('checkout:ORD-1780925413184-c5a94c7b',1,'checkout','ORD-1780925413184-c5a94c7b','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925413184-c5a94c7b\",\"checkoutId\":\"ORD-1780925413184-c5a94c7b\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"FreshGlow Spa\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"2\",\"pickupMerchantName\":\"FreshGlow Spa\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780925413184-c5a94c7b\"}','pending',NULL,NULL,NULL,'2026-06-08 13:30:13','2026-06-08 13:30:13'),('checkout:ORD-1780925605242-56a4c37f',1,'checkout','ORD-1780925605242-56a4c37f','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925605242-56a4c37f\",\"checkoutId\":\"ORD-1780925605242-56a4c37f\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780925605242-56a4c37f\"}','pending',NULL,NULL,NULL,'2026-06-08 13:33:25','2026-06-08 13:33:25'),('checkout:ORD-1780926660803-fff06848',1,'checkout','ORD-1780926660803-fff06848','{\"kind\":\"order\",\"receiptId\":\"ORD-1780926660803-fff06848\",\"checkoutId\":\"ORD-1780926660803-fff06848\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780926650344\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780926660803-fff06848\"}','pending',NULL,NULL,NULL,'2026-06-08 13:51:00','2026-06-08 13:51:00'),('checkout:ORD-1780927096128-9754eaac',1,'checkout','ORD-1780927096128-9754eaac','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927096128-9754eaac\",\"checkoutId\":\"ORD-1780927096128-9754eaac\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927096128-9754eaac\"}','pending',NULL,NULL,NULL,'2026-06-08 13:58:16','2026-06-08 13:58:16'),('checkout:ORD-1780927574743-59cdc0c3',1,'checkout','ORD-1780927574743-59cdc0c3','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927574743-59cdc0c3\",\"checkoutId\":\"ORD-1780927574743-59cdc0c3\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927574743-59cdc0c3\"}','pending',NULL,NULL,NULL,'2026-06-08 14:06:14','2026-06-08 14:06:14'),('checkout:ORD-1780927658351-d07cd7f5',1,'checkout','ORD-1780927658351-d07cd7f5','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927658351-d07cd7f5\",\"checkoutId\":\"ORD-1780927658351-d07cd7f5\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927658351-d07cd7f5\"}','pending',NULL,NULL,NULL,'2026-06-08 14:07:38','2026-06-08 14:07:38'),('checkout:ORD-1780927862579-8220a397',1,'checkout','ORD-1780927862579-8220a397','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927862579-8220a397\",\"checkoutId\":\"ORD-1780927862579-8220a397\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927862579-8220a397\"}','pending',NULL,NULL,NULL,'2026-06-08 14:11:02','2026-06-08 14:11:02'),('checkout:ORD-1780927900163-a45a67d0',1,'checkout','ORD-1780927900163-a45a67d0','{\"kind\":\"order\",\"receiptId\":\"ORD-1780927900163-a45a67d0\",\"checkoutId\":\"ORD-1780927900163-a45a67d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780927900163-a45a67d0\"}','pending',NULL,NULL,NULL,'2026-06-08 14:11:40','2026-06-08 14:11:40'),('checkout:ORD-1780928768794-b36389b8',1,'checkout','ORD-1780928768794-b36389b8','{\"kind\":\"order\",\"receiptId\":\"ORD-1780928768794-b36389b8\",\"checkoutId\":\"ORD-1780928768794-b36389b8\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":162.7,\"itemSubtotal\":162.70000000000002,\"shippingFee\":0,\"originalAmount\":162.7,\"items\":[{\"name\":\"EFFACLAR ULTRA CONCENTRATED SERUM\",\"type\":\"Product\",\"serviceId\":7,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":50,\"unitPrice\":50,\"lineTotal\":100,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Aromatherapy Massage Oil\",\"type\":\"Product\",\"serviceId\":5,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":19.9,\"unitPrice\":19.9,\"lineTotal\":39.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":1,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":22.9,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780926810882,1780926811917,1780926813552\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780928768794-b36389b8\"}','pending',NULL,NULL,NULL,'2026-06-08 14:26:08','2026-06-08 14:26:08'),('checkout:ORD-1780929744227-8f2ef169',1,'checkout','ORD-1780929744227-8f2ef169','{\"kind\":\"order\",\"receiptId\":\"ORD-1780929744227-8f2ef169\",\"checkoutId\":\"ORD-1780929744227-8f2ef169\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":45.8,\"itemSubtotal\":45.8,\"shippingFee\":0,\"originalAmount\":45.8,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"}],\"selectedItemIds\":\"1780929662424\",\"selectedVoucherId\":\"none\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780929744227-8f2ef169\"}','pending',NULL,NULL,NULL,'2026-06-08 14:42:24','2026-06-08 14:42:24'),('checkout:ORD-1780930004681-e08f0a2d',1,'checkout','ORD-1780930004681-e08f0a2d','{\"kind\":\"order\",\"receiptId\":\"ORD-1780930004681-e08f0a2d\",\"checkoutId\":\"ORD-1780930004681-e08f0a2d\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":83.6,\"itemSubtotal\":83.6,\"shippingFee\":0,\"originalAmount\":83.6,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":37.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780929662424,1780929991675\",\"selectedVoucherId\":\"19\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1780930004681-e08f0a2d\"}','pending',NULL,NULL,NULL,'2026-06-08 14:46:44','2026-06-08 14:46:44'),('checkout:ORD-1781183551768-7ed7179c',1,'checkout','ORD-1781183551768-7ed7179c','{\"kind\":\"order\",\"receiptId\":\"ORD-1781183551768-7ed7179c\",\"checkoutId\":\"ORD-1781183551768-7ed7179c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781183546347\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1781183551768-7ed7179c\"}','pending',NULL,NULL,NULL,'2026-06-11 13:12:31','2026-06-11 13:12:31'),('checkout:ORD-1781184198908-20d5d553',1,'checkout','ORD-1781184198908-20d5d553','{\"kind\":\"order\",\"receiptId\":\"ORD-1781184198908-20d5d553\",\"checkoutId\":\"ORD-1781184198908-20d5d553\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":47.8,\"itemSubtotal\":47.8,\"shippingFee\":0,\"originalAmount\":47.8,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781184194176,1781184195085\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1781184198908-20d5d553\"}','pending',NULL,NULL,NULL,'2026-06-11 13:23:18','2026-06-11 13:23:18'),('checkout:ORD-1783492240682-3a54a705',12,'checkout','ORD-1783492240682-3a54a705','{\"kind\":\"order\",\"receiptId\":\"ORD-1783492240682-3a54a705\",\"checkoutId\":\"ORD-1783492240682-3a54a705\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783492231766\",\"selectedVoucherId\":\"none\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783492240682-3a54a705\"}','pending',NULL,NULL,NULL,'2026-07-08 06:30:40','2026-07-08 06:30:40'),('checkout:ORD-1783492926204-f5de89f8',12,'checkout','ORD-1783492926204-f5de89f8','{\"kind\":\"order\",\"receiptId\":\"ORD-1783492926204-f5de89f8\",\"checkoutId\":\"ORD-1783492926204-f5de89f8\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":28.9,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783492889531\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783492926204-f5de89f8\"}','pending',NULL,NULL,NULL,'2026-07-08 06:42:06','2026-07-08 06:42:06'),('checkout:ORD-1783493441962-6bb63ac1',12,'checkout','ORD-1783493441962-6bb63ac1','{\"kind\":\"order\",\"receiptId\":\"ORD-1783493441962-6bb63ac1\",\"checkoutId\":\"ORD-1783493441962-6bb63ac1\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783493436782\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783493441962-6bb63ac1\"}','pending',NULL,NULL,NULL,'2026-07-08 06:50:41','2026-07-08 06:50:41'),('checkout:ORD-1783505584258-c1408cae',1,'checkout','ORD-1783505584258-c1408cae','{\"kind\":\"order\",\"receiptId\":\"ORD-1783505584258-c1408cae\",\"checkoutId\":\"ORD-1783505584258-c1408cae\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783505584258-c1408cae\"}','pending',NULL,NULL,NULL,'2026-07-08 10:13:04','2026-07-08 10:13:04'),('checkout:ORD-1783506246267-d0f7bbf7',1,'checkout','ORD-1783506246267-d0f7bbf7','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506246267-d0f7bbf7\",\"checkoutId\":\"ORD-1783506246267-d0f7bbf7\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783506246267-d0f7bbf7\"}','pending',NULL,NULL,NULL,'2026-07-08 10:24:06','2026-07-08 10:24:06'),('checkout:ORD-1783506495114-efba8ace',1,'checkout','ORD-1783506495114-efba8ace','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506495114-efba8ace\",\"checkoutId\":\"ORD-1783506495114-efba8ace\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506491537\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783506495114-efba8ace\"}','pending',NULL,NULL,NULL,'2026-07-08 10:28:15','2026-07-08 10:28:15'),('checkout:ORD-1783506537935-a5c8a7d0',1,'checkout','ORD-1783506537935-a5c8a7d0','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506537935-a5c8a7d0\",\"checkoutId\":\"ORD-1783506537935-a5c8a7d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":28.9,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506535373\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783506537935-a5c8a7d0\"}','pending',NULL,NULL,NULL,'2026-07-08 10:28:57','2026-07-08 10:28:57'),('checkout:ORD-1783506609564-27ffc8b1',1,'checkout','ORD-1783506609564-27ffc8b1','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506609564-27ffc8b1\",\"checkoutId\":\"ORD-1783506609564-27ffc8b1\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":79.8,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783506609564-27ffc8b1\"}','pending',NULL,NULL,NULL,'2026-07-08 10:30:09','2026-07-08 10:30:09'),('checkout:ORD-1783506626249-be67751c',1,'checkout','ORD-1783506626249-be67751c','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506626249-be67751c\",\"checkoutId\":\"ORD-1783506626249-be67751c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":79.8,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"checkout:ORD-1783506626249-be67751c\"}','pending',NULL,NULL,NULL,'2026-07-08 10:30:26','2026-07-08 10:30:26'),('direct:apple_pay-ORD-1781183551768-7ed7179c',1,'direct','apple_pay-ORD-1781183551768-7ed7179c','{\"kind\":\"order\",\"receiptId\":\"ORD-1781183551768-7ed7179c\",\"checkoutId\":\"ORD-1781183551768-7ed7179c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":9.36,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781183546347\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":9.54,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paymentAttemptId\":\"direct:apple_pay-ORD-1781183551768-7ed7179c\"}','completed',23,'order-23',NULL,'2026-06-11 13:12:39','2026-06-11 13:12:39'),('direct:apple_pay-ORD-1781184198908-20d5d553',1,'direct','apple_pay-ORD-1781184198908-20d5d553','{\"kind\":\"order\",\"receiptId\":\"ORD-1781184198908-20d5d553\",\"checkoutId\":\"ORD-1781184198908-20d5d553\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":47.33,\"itemSubtotal\":47.8,\"shippingFee\":0,\"originalAmount\":47.8,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"},{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1781184194176,1781184195085\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.47,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paymentAttemptId\":\"direct:apple_pay-ORD-1781184198908-20d5d553\"}','completed',24,'order-24',NULL,'2026-06-11 13:23:22','2026-06-11 13:23:22'),('direct:apple_pay-ORD-1783492240682-3a54a705',12,'direct','apple_pay-ORD-1783492240682-3a54a705','{\"kind\":\"order\",\"receiptId\":\"ORD-1783492240682-3a54a705\",\"checkoutId\":\"ORD-1783492240682-3a54a705\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.9,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783492231766\",\"selectedVoucherId\":\"none\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paymentAttemptId\":\"direct:apple_pay-ORD-1783492240682-3a54a705\"}','completed',25,'order-25',NULL,'2026-07-08 06:30:45','2026-07-08 06:30:46'),('hitpay:a2353162-56b4-4520-b5d6-7ca3443b6a7b',12,'hitpay','a2353162-56b4-4520-b5d6-7ca3443b6a7b','{\"kind\":\"order\",\"receiptId\":\"ORD-1783493441962-6bb63ac1\",\"checkoutId\":\"ORD-1783493441962-6bb63ac1\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":17.55,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783493436782\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.35,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"hitpayRequestId\":\"a2353162-56b4-4520-b5d6-7ca3443b6a7b\",\"paymentAttemptId\":\"hitpay:a2353162-56b4-4520-b5d6-7ca3443b6a7b\"}','completed',27,'order-27',NULL,'2026-07-08 06:50:54','2026-07-08 06:51:10'),('hitpay:a235804e-e1b3-47a4-80c3-742244b644d3',1,'hitpay','a235804e-e1b3-47a4-80c3-742244b644d3','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506626249-be67751c\",\"checkoutId\":\"ORD-1783506626249-be67751c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":76.01,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"hitpay:a235804e-e1b3-47a4-80c3-742244b644d3\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":3.79,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"hitpayRequestId\":\"a235804e-e1b3-47a4-80c3-742244b644d3\"}','completed',38,'order-38',NULL,'2026-07-08 10:31:36','2026-07-08 10:32:09'),('nets:0i0w59dx03zr',1,'nets','0i0w59dx03zr','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506609564-27ffc8b1\",\"checkoutId\":\"ORD-1783506609564-27ffc8b1\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":78.42,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.38,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"txnRetrievalRef\":\"0i0w59dx03zr\",\"netsQrData\":{\"txn_nets_qr_id\":30875,\"txn_retrieval_ref\":\"0i0w59dx03zr\",\"amt_in_dollars\":78.42,\"qr_code\":\"iVBORw0KGgoAAAANSUhEUgAAAPoAAAD6CAYAAACI7Fo9AAAMr0lEQVR42u3cUXaqMBAAUPbjp2txC66j23ALXQu/XY9P+2yLEFRqJgn2zjkerSiNMDfBIdgdhRAvH51NIAToQgjQhRCgCyFAF0KALoQAXQgBuhACdCFAF0KALoQAXQgBuhACdCEE6EII0IUQoAsBuhAC9AdW1nVFb/f+f+7PE/3/ord/9PZ4Nh9K59/a8ht00EEHHXTQQQcddNBBBz0yEaLhPQt17VBqL4/en7m3Z+v5DTrooIMOOuiggw466KCD3tKOy514tV9fO1FLQ4vOh9b2Z+1iMuiggw466KCDDjrooIMOeksbovQEhtIdUe3Eqv15Su8f0EEHHXTQQQcddNBBBx100OMSK7p9tRMxN5zaxbfW1g866KCDDjrooIMOOuigg75m6KU7kuiOInrHl97+tdtXuxjXen6DDjrooIMOOuiggw466KDnTJTaxSLLLW+p2BndsYJuueWgg2655aCDbrnlfxt67ShdTCo9wab2hJDo9+feP6Xzo2kboIMOOuiggw466KCDDjromRO1NTitTYBprfhZG2r0/o3eP6CDDjrooIMOOuiggw466CUTc20Qoju23J+n9vaLbn/u/RG9vtIdJ+iggw466KCDDjrooIMOemQxLXpD5W5fbnitFxuji4GtFRNLd7Sggw466KCDDjrooIMOOug5P3j0BJToYlDpz1O6IywNJ7oYt+YJLqCDDjrooIMOOuiggw466NlXHlyMevb/tQY5uj3RiR/dntoDQe6OYbXFONBBBx100EEHHXTQQQf9JaCvvfgS3dE927HVnlBSumOPzsfa7QMddNBBBx100EEHHXTQQS8Z0Yn0LOTSxb/SHVFpqNGvr93x1O4oQAcddNBBBx100EEHHXTQn0nM6B1VOnFqF6OiEzX6Fp1f0ROIojtW0EEHHXTQQQcddNBBBx30SPi5EzH366M7ntyJm3v7t16cWluxNLqYCjrooIMOOuiggw466KCDXjNKw88NrfVEql3MrN3xlu4YQAcddNBBBx100EEHHXTQa8LMvbz2/4veHq13NNGfNxpeaehF7YEOOuiggw466KCDDjrofw56dDElesO2NmEluqMrDTN6wlDpjrt08RF00EEHHXTQQQcddNBBB70klOji1NralxvWX5tgEr2/ozsy0EEHHXTQQQcddNBBBx30NcGPToTa0FqDknv/R+dP9OcvPRCAXgi6aCtABx100EEHHXTQQQ/bEdEbMvf6wX+tjiA3/NoTdkAHXYAOOuiggw466KCDXnLDly6uPfT6t8Pptr/cX267/e83ymB9/em2f++P+7f+eLjcn/8+jO6Hy2+9rh+2cdzmtfx9+hy/za/SE5iiOxrQS0E/ge7Pz59ufbe93P88Xhr9Zv+9juNlHftuf+w2hyy37el2vNHe8/3w80wfby+vn3ucWmfM+o/nbfXRgw56KejbSyJuLzi334n5+XhJbLaT9e1PCd3t+v9YJ/dnwP3ofv51X9BTbV7b469O4nOUBx30MtC7QRKOIC05jN/sB6P5YES/AntIwD4kYE9ft90dJm2dPu6mndXV424AL/W45Pov73s/gN4S9NoXIWTf0bt9coScJPaj3ys34xGs+z+i3zwk7x88dO8Hh+7DQ+VE5zT7mVLLuweef+b96fVMnjvmL7a2PsEL9ELQ+0/oc8BHzz0IfZzwhxP0c3Ft+9bP3B/uLP+5/2zv+Sjkcj++XT0/wdf9HKHMrCf9/inauTb09/4efkcfHQWcv6+DDnqBET09Ml09vhNfxbirDuL9cKwR/e6nLd/teXu8LcNt8pv3306MREd6WjfooIdB78fJfII5BXsZfTbbuyP6JInf6kCfFhq7ZfWGxNeBe1Xy5W3rrmohoFeCXvuikvAJDVcYuqsRuJ87hL8xQv+cXtt+nwarBj3xNaL/xYh+tX1yfZa3/ejwvcyInjv/asIHfTH0mcPTj+NPEg6W97dGtk2i2NTAiP4NatGInjo9dqlrvGcY2c8d5m4woeZ4BB30OOiT7+VDmOfZbaORfVglnof+M6ofLufRz6fGtg/fp5ctg544GtktGNHfDtNC3tW26hLL5+4v7ztvnxsdBeigh4/ow6LQNd594hzxzGSazfQU0vfptd3zM+MWxSbxPfhtv3QHTI8Kbp62S93PnX+/HB2AXh96dEdRuvhye0S/MXljLoFHncL1d/TUhJnR7LfJ48v9cOLMrv8d9FQntlu4jvP8+rlaRXKSzHSCze3Tl9380VGF/Mo90IXaAn0Z9MmIM/edOnk4OppMs5mOfP9H9AHq2cejUX88S24h9OHpte/2/uZinXM9YmbmW3oSzNwEmRvv22ybyC/QXxj6vVE6NbpNvqt+4Zod0fNc1LIoNvspsrcnrso7g0+cpZjeb2ee7250GF0T+QX6y0JPHE7eqpJ/dwzTw9L/0BPTO0/vOXwcPy8/7d9P9x/nS1FPrz1ffnr1/Mxr3i/Pfyzc+JPpvb84dM8d585is0+fo/9F20BfCeSl68/+/1KTSu7MZOs3M99VR9M8s597Xhh9Yt79IkzniUMLZwY+3LZLh3kFPvG1ovZFJqC/HPSFMO9eNHKjil8qErPP+gWH7ul6RKbPkijypb6ngw56NugTtI/A/DhOT7XNnTuuNjPuyar7JjVZJtfMuEPia4URHfQg6P2SYtw43q8n00x/uOJrRN8fq0Rq1t+SqvvMtfqf2+eZOe/nsxSJIyLQG4Je+6KD7B3PblolX3R4OsE0nUWXs+q+3S1t2+h035JO52P+HPp4nvqS5/uum73mP/cPmbR20QvoFaFPZnAtPdSePUfcjaCnfj1mwf3l8aORumR28aH33ev0l8+QS//4RJclv0AH/aER/bdV8vR39cEvzIx/I244IWb4m3Fzz3/9ZtyiET0xkWX3m8/WzU6KSU4LHh8h3ZlVN9zmoIMeBD1Tlfyjn/3RxkO3TyB/bPR+ZkQ/ji6ZXfwdfTSyXx+O3z/b8MiIPu58QG8E+rPQlr4/fEN+V38Hs7d+W2j6Ls5dr++h34vr5n4/rh8sW3YFW/9+mH5vfraIthlcP3539ls3em3iqrcnf8giulgWflEV6PV7zBzRr67F6wrQQReggw66AB30MJjRxbeaG17Ew82db6XbAzroAnTQQQcddNBBBx30mrCfhRb9wxXib8F/pfwBHXTQQQcddNBBB73o/4+eax39/mf3L+iNQq/dcaw9MUtvv9rFzdoDQXR7a+5/0EEHHXTQQQcddNBBBx300hfql75IJnfxJbq41nqiRl9EUrvYWhM+6KCDDjrooIMOOuigg/73oNfeEKUTJXd7o4tj0RM6ak8Yqp0/LcEGHXTQQQcddNBBBx100EGvnXi1i2mlt1drHW/pCUjR+zv684AOOuiggw466KCDDjrooJeEnntD1Iabe4JG9I7ODbF2R127I4nOB9BBBx100EEHHXTQQQcd9JKJ9eyGjE7k3J+vtcQq3b7cy6Pbl3t/RA+EoIMOOuiggw466KCDDjrokVEaZukJKqU7xtoTUkrvv9oDlQkzoIMOOuiggw466KCDDnrL0FvfUbnb29r7S3dE0e2pnX+1BwbQQQcddNBBBx100EEHHfTIDZ870UpuuByJHT1BJrq4VHqCSu18K91xgw466KCDDjrooIMOOuigt5z4z/7/0om8tgkntTuq1gaa3PlWs32ggw466KCDDjrooIMO+t+DXrrYVDoxcrdn7R1hdKKX7qijJwS9TDEOdNBBBx100EEHHXTQQV8F9NKJGt3e6PfXLg5FQyld7Cy9vdaU36CDDjrooIMOOuiggw466KVhtFYcKw2/dKKWLp6V7thK30AHHXTQQQcddNBBBx100I8vFKU3bO5EioaU+/OU7ohKb8/ogSv3+0EHHXTQQQcddNBBBx100HPuyNpQc7+/teJO6eWtFeNyv/7Z9q+2GAc66KCDDjrooIMOOuigrxJ69sYWntDRenGtdDFpzYneQscPOuiggw466KCDDjrooIPeEvTSxaToYl/u1+duz6sVA1vLz9aKy6CDDjrooIMOOuiggw466GuC3lpi5IaQO3FKT3hZ2/qi8w900EEHHXTQQQcddNBBB/2VoEcvjy7GRSdua8Wk1op7ayq2gQ466KCDDjrooIMOOuig596wudf/bOK0VnyqnVjRHVXtCULRHUVpL6CDDjrooIMOOuiggw466CVv0e2JhlI6EVvfvqWLfdEDRU3YoIMOOuiggw466KCDDjroQog2A3QhQBdCgC6EAF0IAboQAnQhBOhCCNCFEKALAboQAnQhBOhCCNCFEKALIUAXQoAuhABdCNCFEK8a/wDTRDM9jWCzSQAAAABJRU5ErkJggg==\",\"network_status\":1,\"txn_status\":1,\"instruction\":\"\",\"response_code\":\"00\",\"txn_id\":\"sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b\"},\"isPrototypeQr\":false,\"netsConfirmed\":false,\"paymentAttemptId\":\"nets:0i0w59dx03zr\"}','pending',NULL,NULL,NULL,'2026-07-08 10:30:17','2026-07-08 10:30:17'),('nets:0lcpxo2j956q',1,'nets','0lcpxo2j956q','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506537935-a5c8a7d0\",\"checkoutId\":\"ORD-1783506537935-a5c8a7d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":27.5,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506535373\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"nets:0lcpxo2j956q\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.4,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"txnRetrievalRef\":\"0lcpxo2j956q\",\"netsQrData\":{\"txn_nets_qr_id\":30873,\"txn_retrieval_ref\":\"0lcpxo2j956q\",\"amt_in_dollars\":27.5,\"qr_code\":\"iVBORw0KGgoAAAANSUhEUgAAAPoAAAD6CAYAAACI7Fo9AAAMlklEQVR42u3c23WqQBQAUPrx01pswTrShi2kFn5Tj1cSrkEYVGRemH3WysII4gCzZ+Aw2JyFEG8fjV0gBOhCCNCFEKALIUAXQoAuhABdCAG6EAJ0IUAXQoAuhABdCAG6EAJ0IQToQgjQhRCgCwG6EAL0J1bWNFn/Upcv9eeXlndpeWKvr7bjtXZ971a/QQcddNBBBx100EEHHXTQY+7I2OtPDSV1eWpvaFI3PKnrT+r9UZMf0EEHHXTQQQcddNBBBx303BW1tmRb7oq8dntSw4ydjMqdnKutIQYddNBBBx100EEHHXTQQX8n6LkHONS2fWsbqtT7p/T+BR100EEHHXTQQQcddNBBBz3fgI/akkNrIeRuCN5t/tbqN+iggw466KCDDjrooIMOek0VPTaM0g1L6f2fuzy5k4m17R/QQQcddNBBBx100EEHHfSc0CWLzH/n+aUHYIFuvvmgg26++aCDbr75oG85Yifz1i6/trylk025B6iU7gg2XfdBBx100EEHHXTQQQcddNALQ8o9wCJ1xY4NIXdyKPXxLZnsinE8QQcddNBBBx100EEHHXTQU25Y7Pmxoeb+/NYhpW5It3a8SncMoIMOOuiggw466KCDDjroMQseu+KtLW/p8sQub274sdcfe/nYn0/d0IIOOuiggw466KCDDjrooKesiLmjtgEYsZcvDaM0vNwNc+qGIaUX0EEHHXTQQQcddNBBB/3vQU9d0VNXpNwDSnI3DKUbztTHJ/WAl9LJStBBBx100EEHHXTQQQcd9C1FbQMeaoNaO+zUMEqXL3bHBTrooIMOOuiggw466KCDXhOc3AMscn9/7P1bumEonbwrXZ9S1wfQQQcddNBBBx100EEHHfQ1FbHkhseoOKkrUmzYtZU/d7Jy68cPdNBBBx100EEHHXTQQQc9Z6QecJD7wJVu+LY2QCR1Q1VbQ5CzIwMddNBBBx100EEHHXTQQY9dMWqHu7VkT+yKGfv7czc8ucubEz7ooIMOOuiggw466KCDDnrpHV3bgYidbMoNv7bkV+nvL73/QAcddNBBBx100EEHHXTQY1as0t9XW/IkdUNV+njU3pDmbthABx100EEHHXTQQQcddNC3DL32ZFBuyLWVN3VyLXUyc2sDbEAHHXTQQQcddNBBBx100FPCLJ3cSr3jS1eUrScnYx//2uor6G8CXWSu3KCDDjrooIMOOuig54JWWzJG1A156fzY0GuuL6CDDjrooIMOOuigC9BBjw1/Lcwo3/9xuvwd+2n/dzi+vlMG62svf8fP9nz8aM+nftr9fxpNh/PvLdcOyzgu81b+v2zHqzBTdwSllwc9FfQL6LabXv7aZt9Pf18vjXZ3vK7j3K/j2BzPze4U5W9/+TvfKW83HW7P9PW+X37udWidadZ/7vbVVws66Lmg7/uKuO9x7q8V8/v1ktjtJ+s7Xip0c2h/sE6mHeB2NJ1f7j/0UJm39vp/I/Hdy4MOeh7ozaASjiAtOY3fHQe9+aBHvwF7CsA+BWBPl9sfTpOyTl8308bq5nUzgBd6nXP9/ec+T6DXDD02vNQPVUzicAz2kJOKfee6ctyj3/ZgzU+PfveUvH3y1L0dnLoPT5UDjdPsNoXmN0+8v+bz4fVM3jvnHxBTur6Cngl6+w19DvjovSehjyv86QK9S67tP9qZ6enB/N/pd3m7s5B+Ov67eX+Cr/k9Q5lZT/jzU7RzZWgf/T+8Rh+dBXTX66CDnqFHD/dMN68fNRx9Mu6mgfg8FTkW7eG3LNfyfDxfluE+eeXz9ytKoCG9rBt00JNBb8eV+QJzCrbvfXb7hz36pBJ/lIE+TTQ2y/INgcuBcZZ8fdmam1wI6IWgl97Q6LDvYmhueuB27hT+Tg/9e3ttf70NVgx64DKifaFHv9k/sbbl4zg6fQ/36EvrY+z6UfOAG9AXQ585Pf06/1bCwfz2Xs+2CySbKujRr6AW9eih22PNzyXBZ4SevWswD4MBNRFggQ76LIbJdfkQZje6bdSzD7PE89B/e/VTfx+9uzW2f3oanrds2wJnI4cFPfrHaZrIu9lXTWD+3LT/XLd/7jQUoIOevEcfJoVu8R4D94hnBtPspreQrrfXDutHxi2KXeA6+OO49ABMzwru3rYLTefuv/dnB6DXB730/OgHLnQbKXQNPleBR43C7TV6aMDMaPTb5HU/HQ6cObSvQQ81YoeF6+jG18/lKoKDZKYDbO7fvmzmz44yQEv9EA3oFUGf9Dhz19TB09HRYJrdtOf76dEHqGdfj3r98Si5hdCHt9eu5X3lYZ0uHzEz8i08CGZugMydz83czQAd9HQ9+hz0Qe82uVZ92KPHeahlUeyOU2QfK57K68AH7lJMp/uZ95s7DUYDOugpoQdOJ+9lya8Nw/S09Ad6YHjn5TOnr/P346ft52X61T2Kelm2e/z05v2ZZT77978WbuxkeO8Lp+6xo2ssdsfwPfpA2UAvBL04zNgHKjSo5MFItnY3c606GuYZ/d7zwmgD4+4XQe8GDi0cGfh02foG8wZ8YMBM6vpRvP6Bnhv6QpgPHxq5k8XPFYHRZ+2CU/dwPiLStgSSfN11OuigJ4M+QfsMzK/z9Fbb3L3jYiPjVmbdd6HBMrFGxp0ClxV6dNAT7eh2STJuHJ+3g2mmP1zxv0c/notEaNTfkqz7zLP63/tnzZj37i5F4IwI9ILQ1zYEuQfcLF7fYZolX3R6OsE0HUUXM+u+Pywt2+h235JG52v+Hvp4nPqS99ummX3mPzX0mh9SAT0x9MkIrqWn2rP3iJsR9NCvxyyY9q+fjdAjs4tPvR8+p798hFz4xyeal3pA0EF/qUd/NUsevlYf/MLM+DfihgNihr8ZN/f+/9+MW9SjBwayHF7ZtmZ2UExwWPD4DOnBqLrhPgcd9ETQI2XJv9rZH208NccA8ud67zU9+nn0yOzia/RRz357Ov74bsMzPfq48QG9EPTUyYzUDcnDuGZ/B6O3Xk00XZNzt+t76vfimrnfj2sH85Y9wdZ+nqbXzWuTaLvB8+MPR781o2UDT709+Lnn3A9NbakhAL2SFvcbW/ESbCtAB32T0AXooIMuQK8TeumHVFIvL+qGnnr52A/J/JmRcaAL0EEHXYAOOuigg54F+lrIqQ98yYcKRH3Qc9eft0nGgS5ABx10ATro9UNPfY2WuiLnrvi5vx/0SqHHbhhqO9C5B2iUrlipt7e25bcEH3TQQQcddNBBBx100EH/e9BrS9bUvv7cDV/s5FrpZFnq8tVWn0AHHXTQQQcddNBBBx100GNWzNgNxzsNaHjl+3Mv73jW1RGCDjrooIMOOuiggw664wl6zg1LXdHWfl/uZE7q5WNvf+rjmfv4pIa7mQEzoIMOOuiggw466KCDDvpbQI9dEWMPGMkNI/f2l4YaewDL1gb8pG4oQAcddNBBBx100EEHHXTQS8KIfSBjf39tDVvuipk7+ZW64c/dcIEOOuiggw466KCDDjrooOesyLEPdOn11ba/cjc8tSXrSkPN3RCCDjrooIMOOuiggw466KDHLHjqhiH38rn3R+0DRrYGM3fyE3TQQQcddNBBBx100EEHvWbopZNvuSt26mRT6YYi9fGIHbHrW8ntAR100EEHHXTQQQcddND/HvTaovaGIfX6UjcUtQ3wSd1RpG7oQAcddNBBBx100EEHHXTQc+742AcqdfKnNKzcDUHshrS2/ZW6Pte2ftBBBx100EEHHXTQQQf9b0OvbUfVBjk2pLXL547cA4BKN1Sl6w/ooIMOOuiggw466KCDDnrOilzbgJbaGrbcyczcA5Rq21+11RfQQQcddNBBBx100EEHHfQtNRyl11c7jNINdWn4sfffn03GgQ466KCDDjrooIMOOuhFoL9bsiN38m9txdhaMjL39m1t/4IOOuiggw466KCDDjrooMeEHr2wlR/I2iGXbthS14fa9l9NfkAHHXTQQQcddNBBBx100HNXpNqSZ7Fhxd7+1JBLJ2NrK9/ahgp00EEHHXTQQQcddNBBBx3017c3dflzw4ldsdfWr9INa+71gw466KCDDjrooIMOOuigbwl69J1T0YF6paKnbjhzN4SlO47SxwN00EEHHXTQQQcddNBBBz0m9NrWXzr5VXtFqx1K6uRm7PoHOuiggw466KCDDjrooINeEnpuGKUrbu7y5G44Yycja6sPpetrygAddNBBBx100EEHHXTQ/x50IUSdAboQoAshQBdCgC6EAF0IAboQAnQhBOhCCNCFAF0IAboQAnQhBOhCCNCFEKALIUAXQoAuBOhCiHeNf/x2Z1KlDn39AAAAAElFTkSuQmCC\",\"network_status\":1,\"txn_status\":1,\"instruction\":\"\",\"response_code\":\"00\",\"txn_id\":\"sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b\"},\"isPrototypeQr\":false,\"netsConfirmed\":false}','pending',NULL,NULL,NULL,'2026-07-08 10:29:32','2026-07-08 10:29:32'),('nets:PROTO-PROTO-1783506572405',1,'nets','PROTO-PROTO-1783506572405','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506537935-a5c8a7d0\",\"checkoutId\":\"ORD-1783506537935-a5c8a7d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":27.5,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506535373\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"nets:PROTO-PROTO-1783506572405\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.4,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"txnRetrievalRef\":\"PROTO-PROTO-1783506572405\",\"netsQrData\":{\"response_code\":\"00\",\"txn_status\":1,\"txn_retrieval_ref\":\"PROTO-PROTO-1783506572405\",\"qr_code\":\"NETSQR|TXN:PROTO-1783506572405|AMT:27.50|MERCHANT:Vaniday|REF:PROTO-PROTO-1783506572405\",\"prototype\":true},\"isPrototypeQr\":true,\"netsConfirmed\":true}','completed',35,'order-35',NULL,'2026-07-08 10:29:32','2026-07-08 10:29:32'),('paypal:6D777083VP435562C',1,'paypal','6D777083VP435562C','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506626249-be67751c\",\"checkoutId\":\"ORD-1783506626249-be67751c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":75.88,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"paypal:6D777083VP435562C\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":3.92,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"paypalOrderId\":\"6D777083VP435562C\",\"paypalStatus\":\"CREATED\"}','pending',NULL,NULL,NULL,'2026-07-08 10:30:44','2026-07-08 10:30:44'),('stripe:cs_test_a10hV5gjRnD3yXYesOI6PCfpRXHrbmHJW3JDhX9dtLJFaYCiWvm9qzf7mR',1,'stripe','cs_test_a10hV5gjRnD3yXYesOI6PCfpRXHrbmHJW3JDhX9dtLJFaYCiWvm9qzf7mR','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506495114-efba8ace\",\"checkoutId\":\"ORD-1783506495114-efba8ace\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506491537\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"stripe:cs_test_a10hV5gjRnD3yXYesOI6PCfpRXHrbmHJW3JDhX9dtLJFaYCiWvm9qzf7mR\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.9,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a10hV5gjRnD3yXYesOI6PCfpRXHrbmHJW3JDhX9dtLJFaYCiWvm9qzf7mR\"}','completed',33,'order-33',NULL,'2026-07-08 10:28:36','2026-07-08 10:28:48'),('stripe:cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj',1,'stripe','cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj','{\"kind\":\"order\",\"receiptId\":\"ORD-1780925605242-56a4c37f\",\"checkoutId\":\"ORD-1780925605242-56a4c37f\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":8.91,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780925387523\",\"selectedVoucherId\":\"9\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[{\"id\":9,\"userId\":1,\"sourceType\":\"reward_shop\",\"sourceReference\":\"12\",\"title\":\"$10 off\",\"detail\":\"lovely\",\"voucherValue\":9.99,\"remainingValue\":9.99,\"discountType\":\"fixed\",\"discountPercent\":0,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":12,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-A9207B14\",\"expiresAt\":null,\"createdAt\":\"2026-06-03T18:58:04.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9}],\"voucherRecommendation\":{\"voucher\":{\"id\":8,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"11\",\"title\":\"20% OFF Repair Shampoo\",\"detail\":\"20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":20,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":11,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-9ADE9738\",\"expiresAt\":\"2026-09-02T17:45:00.000Z\",\"createdAt\":\"2026-06-03T17:46:33.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9},\"discount\":3.78},\"smartVoucherMessage\":\"\",\"voucherMode\":\"product\",\"voucherId\":9,\"voucherCode\":\"RWD-A9207B14\",\"voucherTitle\":\"$10 off\",\"voucherDiscountType\":\"fixed\",\"voucherDiscountPercent\":0,\"voucherEligibleAmount\":18.9,\"voucherDiscount\":9.99,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj\",\"paymentAttemptId\":\"stripe:cs_test_a14BTL7ZFont8uitRSMQS4Vhqky1Y38mktYbkr3Ab8j3wl3ldAErpvUOvj\"}','completed',14,'order-14',NULL,'2026-06-08 13:33:50','2026-06-08 13:34:14'),('stripe:cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u',6,'stripe','cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u','{\"kind\":\"order\",\"receiptId\":\"ORD-1780825986336-adbae382\",\"checkoutId\":\"ORD-1780825986336-adbae382\",\"cartCheckout\":true,\"userId\":6,\"userName\":\"Angelo Casia\",\"userEmail\":\"angelomiguelcasia@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":17.95,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780825961460\",\"selectedVoucherId\":\"\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.95,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u\",\"paymentAttemptId\":\"stripe:cs_test_a17EeA6yARyZKxBdOdvPvU38masdtyLi5dx86O38XO9333dirJrmBTgB1u\"}','completed',13,'order-13',NULL,'2026-06-07 09:53:19','2026-06-07 09:54:16'),('stripe:cs_test_a1D0f4VHalb9jXtxFxkdrrywlUPMlhXS3jylsA4sjQZ7qThHcWf7l4AUR2',12,'stripe','cs_test_a1D0f4VHalb9jXtxFxkdrrywlUPMlhXS3jylsA4sjQZ7qThHcWf7l4AUR2','{\"kind\":\"order\",\"receiptId\":\"ORD-1783492926204-f5de89f8\",\"checkoutId\":\"ORD-1783492926204-f5de89f8\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":26.95,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783492889531\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.95,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1D0f4VHalb9jXtxFxkdrrywlUPMlhXS3jylsA4sjQZ7qThHcWf7l4AUR2\",\"paymentAttemptId\":\"stripe:cs_test_a1D0f4VHalb9jXtxFxkdrrywlUPMlhXS3jylsA4sjQZ7qThHcWf7l4AUR2\"}','completed',26,'order-26',NULL,'2026-07-08 06:42:52','2026-07-08 06:43:13'),('stripe:cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq',1,'stripe','cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq','{\"kind\":\"order\",\"receiptId\":\"ORD-1780930004681-e08f0a2d\",\"checkoutId\":\"ORD-1780930004681-e08f0a2d\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Delivery\",\"serviceName\":\"Cart checkout\",\"amount\":78.51,\"itemSubtotal\":83.6,\"shippingFee\":4.9,\"originalAmount\":88.5,\"items\":[{\"name\":\"Hydrating Face Mask\",\"type\":\"Product\",\"serviceId\":4,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"quantity\":2,\"price\":22.9,\"unitPrice\":22.9,\"lineTotal\":45.8,\"detail\":\"FreshGlow Spa\"},{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":37.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780929662424,1780929991675\",\"selectedVoucherId\":\"19\",\"useCashback\":false,\"fulfilment\":\"delivery\",\"pickupMerchantId\":\"\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"2\",\"name\":\"FreshGlow Spa\"},{\"id\":\"3\",\"name\":\"Urban Groom Barbers\"},{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"123 woodlands ave\",\"deliveryUnit\":\"#11-132\",\"deliveryPostal\":\"123432\",\"deliveryPhone\":\"91234556\",\"availableVouchers\":[{\"id\":19,\"userId\":1,\"sourceType\":\"reward_shop\",\"sourceReference\":\"12\",\"title\":\"$10 off\",\"detail\":\"lovely\",\"voucherValue\":9.99,\"remainingValue\":9.99,\"discountType\":\"fixed\",\"discountPercent\":0,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":12,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-097D7242\",\"expiresAt\":null,\"createdAt\":\"2026-06-08T14:45:53.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":37.8}],\"voucherRecommendation\":{\"voucher\":{\"id\":6,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"9\",\"title\":\"10% OFF Hydrating Face Mask\",\"detail\":\"10% off product voucher for Hydrating Face Mask. Redeem with 500 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":10,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":9,\"merchantId\":2,\"merchantName\":\"FreshGlow Spa\",\"linkedItemType\":\"product\",\"linkedItemId\":4,\"linkedItemName\":\"Hydrating Face Mask\",\"minimumSpend\":0,\"code\":\"RWD-547E3062\",\"expiresAt\":\"2026-08-31T17:09:00.000Z\",\"createdAt\":\"2026-06-03T17:29:06.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":45.8},\"discount\":4.58},\"smartVoucherMessage\":\"\",\"voucherMode\":\"product\",\"voucherId\":19,\"voucherCode\":\"RWD-097D7242\",\"voucherTitle\":\"$10 off\",\"voucherDiscountType\":\"fixed\",\"voucherDiscountPercent\":0,\"voucherEligibleAmount\":37.8,\"voucherDiscount\":9.99,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq\",\"paymentAttemptId\":\"stripe:cs_test_a1fnqMWv0zW2K0AFkelMJJ8sYDo4SAHGbYn4RjWGpPNUxJj1rBEE2V1gPq\"}','completed',16,'order-16',NULL,'2026-06-08 14:48:04','2026-06-08 14:48:17'),('stripe:cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc',1,'stripe','cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc','{\"kind\":\"order\",\"receiptId\":\"ORD-1780926660803-fff06848\",\"checkoutId\":\"ORD-1780926660803-fff06848\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":15.12,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1780926650344\",\"selectedVoucherId\":\"\",\"useCashback\":false,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":{\"voucher\":{\"id\":8,\"userId\":1,\"sourceType\":\"reward_shop_merchant\",\"sourceReference\":\"11\",\"title\":\"20% OFF Repair Shampoo\",\"detail\":\"20% off product voucher for Repair Shampoo. Redeem with 1000 VaniGlints.\",\"voucherValue\":0,\"remainingValue\":0,\"discountType\":\"percentage\",\"discountPercent\":20,\"status\":\"active\",\"bookingOnly\":false,\"firstBookingOnly\":false,\"voucherDefinitionId\":11,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"linkedItemType\":\"product\",\"linkedItemId\":1,\"linkedItemName\":\"Repair Shampoo\",\"minimumSpend\":0,\"code\":\"RWD-9ADE9738\",\"expiresAt\":\"2026-09-02T17:45:00.000Z\",\"createdAt\":\"2026-06-03T17:46:33.000Z\",\"redeemedAt\":null,\"usedBookingId\":null,\"usedTransactionId\":null,\"usedAt\":null,\"eligibleSubtotal\":18.9},\"discount\":3.78},\"smartVoucherMessage\":\"\",\"voucherMode\":\"\",\"voucherId\":8,\"voucherCode\":\"RWD-9ADE9738\",\"voucherTitle\":\"20% OFF Repair Shampoo\",\"voucherDiscountType\":\"percentage\",\"voucherDiscountPercent\":20,\"voucherEligibleAmount\":18.9,\"voucherDiscount\":3.78,\"cashbackRedeemed\":0,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc\",\"paymentAttemptId\":\"stripe:cs_test_a1hslDP9FtjW29EjLLCObDFv7DZUa4RMUIAFGjr9WHxJPl61hOh0Q8jNGc\"}','completed',15,'order-15',NULL,'2026-06-08 13:51:59','2026-06-08 13:52:12'),('stripe:cs_test_a1I8PgEqKQNo32T1QAvjRojxBL8NvBCNDypTh0zlDn24ebqksSNAk3M0Cq',12,'stripe','cs_test_a1I8PgEqKQNo32T1QAvjRojxBL8NvBCNDypTh0zlDn24ebqksSNAk3M0Cq','{\"kind\":\"order\",\"receiptId\":\"ORD-1783492926204-f5de89f8\",\"checkoutId\":\"ORD-1783492926204-f5de89f8\",\"cartCheckout\":true,\"userId\":12,\"userName\":\"Raphaela Lee\",\"userEmail\":\"raphaelalee24@gmail.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":26.95,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783492889531\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"No merchant product smart vouchers are available for this checkout.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.95,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"stripeSessionId\":\"cs_test_a1I8PgEqKQNo32T1QAvjRojxBL8NvBCNDypTh0zlDn24ebqksSNAk3M0Cq\",\"paymentAttemptId\":\"stripe:cs_test_a1I8PgEqKQNo32T1QAvjRojxBL8NvBCNDypTh0zlDn24ebqksSNAk3M0Cq\"}','pending',NULL,NULL,NULL,'2026-07-08 06:42:16','2026-07-08 06:42:16'),('wallet-1-1783505424984-e89fddad',1,'stripe',NULL,'{\"userId\":1,\"amount\":10,\"paymentMethod\":\"stripe\",\"transactionId\":1,\"walletTransactionId\":1,\"description\":\"Wallet top-up via Stripe\"}','pending',NULL,NULL,NULL,'2026-07-08 10:10:24','2026-07-08 10:10:24'),('wallet-1-1783505516912-bcefa633',1,'stripe',NULL,'{\"userId\":1,\"amount\":100,\"paymentMethod\":\"stripe\",\"transactionId\":2,\"walletTransactionId\":2,\"description\":\"Wallet top-up via Stripe\"}','pending',NULL,NULL,NULL,'2026-07-08 10:11:56','2026-07-08 10:11:56'),('wallet:ORD-1783506246267-d0f7bbf7-1783506256955',1,'wallet','ORD-1783506246267-d0f7bbf7-1783506256955','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506246267-d0f7bbf7\",\"checkoutId\":\"ORD-1783506246267-d0f7bbf7\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":16.53,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":2.37,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\",\"paymentAttemptId\":\"wallet:ORD-1783506246267-d0f7bbf7-1783506256955\"}','completed',28,'order-28',NULL,'2026-07-08 10:24:16','2026-07-08 10:24:17'),('wallet:ORD-1783506246267-d0f7bbf7-1783506266521',1,'wallet','ORD-1783506246267-d0f7bbf7-1783506266521','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506246267-d0f7bbf7\",\"checkoutId\":\"ORD-1783506246267-d0f7bbf7\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18.07,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"wallet:ORD-1783506246267-d0f7bbf7-1783506266521\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.83,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\"}','completed',29,'order-29',NULL,'2026-07-08 10:24:26','2026-07-08 10:24:26'),('wallet:ORD-1783506246267-d0f7bbf7-1783506471578',1,'wallet','ORD-1783506246267-d0f7bbf7-1783506471578','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506246267-d0f7bbf7\",\"checkoutId\":\"ORD-1783506246267-d0f7bbf7\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"wallet:ORD-1783506246267-d0f7bbf7-1783506471578\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.9,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\"}','completed',30,'order-30',NULL,'2026-07-08 10:27:51','2026-07-08 10:27:51'),('wallet:ORD-1783506246267-d0f7bbf7-1783506481849',1,'wallet','ORD-1783506246267-d0f7bbf7-1783506481849','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506246267-d0f7bbf7\",\"checkoutId\":\"ORD-1783506246267-d0f7bbf7\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783505578809\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"wallet:ORD-1783506246267-d0f7bbf7-1783506481849\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.9,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\"}','completed',31,'order-31',NULL,'2026-07-08 10:28:01','2026-07-08 10:28:02'),('wallet:ORD-1783506495114-efba8ace-1783506498989',1,'wallet','ORD-1783506495114-efba8ace-1783506498989','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506495114-efba8ace\",\"checkoutId\":\"ORD-1783506495114-efba8ace\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":18,\"itemSubtotal\":18.9,\"shippingFee\":0,\"originalAmount\":18.9,\"items\":[{\"name\":\"Repair Shampoo\",\"type\":\"Product\",\"serviceId\":1,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":18.9,\"unitPrice\":18.9,\"lineTotal\":18.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506491537\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.9,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\",\"paymentAttemptId\":\"wallet:ORD-1783506495114-efba8ace-1783506498989\"}','completed',32,'order-32',NULL,'2026-07-08 10:28:18','2026-07-08 10:28:19'),('wallet:ORD-1783506537935-a5c8a7d0-1783506541346',1,'wallet','ORD-1783506537935-a5c8a7d0-1783506541346','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506537935-a5c8a7d0\",\"checkoutId\":\"ORD-1783506537935-a5c8a7d0\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":28,\"itemSubtotal\":28.9,\"shippingFee\":0,\"originalAmount\":28.9,\"items\":[{\"name\":\"Scalp Treatment Serum\",\"type\":\"Product\",\"serviceId\":2,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":1,\"price\":28.9,\"unitPrice\":28.9,\"lineTotal\":28.9,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506535373\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":0.9,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\",\"paymentAttemptId\":\"wallet:ORD-1783506537935-a5c8a7d0-1783506541346\"}','completed',34,'order-34',NULL,'2026-07-08 10:29:01','2026-07-08 10:29:01'),('wallet:ORD-1783506626249-be67751c-1783506630458',1,'wallet','ORD-1783506626249-be67751c-1783506630458','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506626249-be67751c\",\"checkoutId\":\"ORD-1783506626249-be67751c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":78.42,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":1.38,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\",\"paymentAttemptId\":\"wallet:ORD-1783506626249-be67751c-1783506630458\"}','completed',36,'order-36',NULL,'2026-07-08 10:30:30','2026-07-08 10:30:30'),('wallet:ORD-1783506626249-be67751c-1783506687483',1,'wallet','ORD-1783506626249-be67751c-1783506687483','{\"kind\":\"order\",\"receiptId\":\"ORD-1783506626249-be67751c\",\"checkoutId\":\"ORD-1783506626249-be67751c\",\"cartCheckout\":true,\"userId\":1,\"userName\":\"mary\",\"userEmail\":\"mary@mary.com\",\"merchantName\":\"Any merchant\",\"serviceName\":\"Cart checkout\",\"amount\":75.88,\"itemSubtotal\":79.8,\"shippingFee\":0,\"originalAmount\":79.8,\"items\":[{\"name\":\"Hair Care Bundle Set\",\"type\":\"Product\",\"serviceId\":6,\"merchantId\":1,\"merchantName\":\"Vaniday Beauty Studio\",\"quantity\":2,\"price\":39.9,\"unitPrice\":39.9,\"lineTotal\":79.8,\"detail\":\"Vaniday Beauty Studio\"}],\"selectedItemIds\":\"1783506603225\",\"selectedVoucherId\":\"none\",\"useCashback\":true,\"fulfilment\":\"pickup\",\"pickupMerchantId\":\"any\",\"pickupMerchantName\":\"\",\"pickupMerchantOptions\":[{\"id\":\"1\",\"name\":\"Vaniday Beauty Studio\"}],\"deliveryAddress\":\"\",\"deliveryUnit\":\"\",\"deliveryPostal\":\"\",\"deliveryPhone\":\"\",\"paymentAttemptId\":\"wallet:ORD-1783506626249-be67751c-1783506687483\",\"availableVouchers\":[],\"voucherRecommendation\":null,\"smartVoucherMessage\":\"This voucher does not match any eligible products in your cart.\",\"voucherMode\":\"\",\"cashbackRedeemed\":3.92,\"campaignCashback\":{\"total\":0,\"breakdown\":[]},\"redeemPointsRequested\":0,\"paymentMethod\":\"wallet\"}','completed',37,'order-37',NULL,'2026-07-08 10:31:27','2026-07-08 10:31:27');
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
INSERT INTO `products` VALUES (1,1,12,'Repair Shampoo',18.90,35,NULL,'Hair repair shampoo for dry and damaged hair.',NULL,NULL,'2026-06-03 12:32:10','2026-07-08 10:28:48',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(2,1,12,'Scalp Treatment Serum',28.90,26,NULL,'Serum for scalp care and hair growth support.',NULL,NULL,'2026-06-03 12:32:10','2026-07-08 10:29:32',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(3,1,17,'Gel Nail Polish',15.90,40,NULL,'Long-lasting gel polish for nails.',NULL,NULL,'2026-06-03 12:32:10','2026-06-04 10:15:48',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(4,2,10,'Hydrating Face Mask',22.90,33,NULL,'Moisturising mask for facial care.',NULL,NULL,'2026-06-03 12:32:10','2026-06-08 14:48:17',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(5,2,9,'Aromatherapy Massage Oil',19.90,25,NULL,'Relaxing massage oil for body treatment.',NULL,NULL,'2026-06-03 12:32:10','2026-06-04 16:27:45',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(6,1,6,'Hair Care Bundle Set',39.90,15,NULL,'Bundle set with shampoo and treatment serum.',NULL,NULL,'2026-06-03 12:32:10','2026-07-08 10:32:09',1,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(7,1,10,'EFFACLAR ULTRA CONCENTRATED SERUM',50.00,1,NULL,'Effaclar Ultra Concentrated Serum is a powerful treatment that helps to minimize the appearance of pores and reduce sebum production. Formulated with salicylic acid and glycolic acid, this serum exfoliates the skin to reveal a smoother, more even-toned complexion.','Salicylic Acid, Glycolic Acid, Caffeine, Glycerin, Panthenol, Green Tea Extract','Apply 2-3 drops to the face and neck after cleansing and toning. Gently massage into the skin until absorbed. Follow up with your daily moisturizer.','2026-06-03 13:06:04','2026-06-04 16:27:45',0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
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
  `show_in_flash_deals` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`promotion_id`),
  KEY `idx_promotions_salon` (`salon_id`),
  KEY `idx_promotions_service` (`service_id`),
  KEY `idx_promotions_product` (`product_id`),
  KEY `idx_promotions_spin_active` (`spin_eligible`,`status`,`start_date`,`end_date`),
  KEY `idx_promotions_type_status` (`type`,`status`),
  KEY `idx_promotions_dates` (`start_date`,`end_date`),
  CONSTRAINT `fk_promotions_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_promotions_salon` FOREIGN KEY (`salon_id`) REFERENCES `salons` (`salon_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_promotions_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`service_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `promotions`
--

LOCK TABLES `promotions` WRITE;
/*!40000 ALTER TABLE `promotions` DISABLE KEYS */;
INSERT INTO `promotions` VALUES (1,1,1,NULL,'First Trial Facial Glow','first_trial','percentage',30.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','30% off for first-time facial customers.','Valid once per customer for this salon.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 07:55:19','2026-04-30 07:55:19'),(2,1,2,NULL,'Happy Hour Hair Treatment','happy_hour','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','15% off selected weekday off-peak slots.','Valid Monday to Thursday, 10:00 AM to 4:00 PM only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 07:55:19','2026-04-30 10:12:36'),(21,1,1,NULL,'First Trial Hair Refresh','first_trial','percentage',25.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','First-time customer hair refresh offer.','Valid once per customer for this salon.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(22,1,2,NULL,'Happy Hour Midday Facial','happy_hour','percentage',15.00,'2026-04-30 00:00:00','2026-06-30 00:00:00',NULL,'inactive','Weekday facial discount during quieter hours.','Valid Monday to Thursday, 11:00 AM to 4:00 PM only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-05-01 18:10:48'),(23,1,3,NULL,'1 For 1 Nail Treats','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Bring a friend for a shared nail session.','Subject to same-time slot availability.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(24,2,4,NULL,'First Trial Body Glow','first_trial','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Introductory spa body treatment deal.','Valid once per customer for this merchant.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(25,2,5,NULL,'Happy Hour Afternoon Body Scrub','happy_hour','percentage',10.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Off-peak spa savings for flexible schedules.','Weekday afternoons only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(26,2,4,NULL,'1 For 1 Wellness Escape','one_for_one','percentage',20.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book one wellness session and enjoy two.','Best used for pair bookings.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(27,3,6,NULL,'First Trial Grooming Cut','first_trial','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Try this barber service at an intro price.','New customers only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(28,3,7,NULL,'Happy Hour Quick Fade','happy_hour','percentage',5.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Small weekday discount for quick trims.','Valid during listed hours only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(29,3,6,NULL,'1 For 1 Grooming Duo','one_for_one','percentage',15.00,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Book together and enjoy better value.','Limited daily slots.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(30,1,NULL,NULL,'Featured Beauty Studio May','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured salon placement for May.','Homepage and featured salon visibility only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(31,2,NULL,NULL,'Featured Spa Escape','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured spa listing campaign.','Featured listing only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36'),(32,3,NULL,NULL,'Featured Barber Spotlight','featured','tag_only',NULL,'2026-05-01 00:00:00','2026-06-30 23:59:59',NULL,'active','Featured merchant visibility campaign.','Featured listing only.',0,NULL,0.00,NULL,NULL,NULL,0,'2026-04-30 10:09:20','2026-04-30 10:12:36');
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
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_history`
--

LOCK TABLES `purchase_history` WRITE;
/*!40000 ALTER TABLE `purchase_history` DISABLE KEYS */;
INSERT INTO `purchase_history` VALUES (13,'order-23',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',9.36,'Apple Pay','paid','2026-06-11 13:12:40','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,9.54,0,0.00,18.90,0.00),(15,'order-24',1,'product','Repair Shampoo, Scalp Treatment Serum','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}, {\"name\": \"Scalp Treatment Serum\", \"type\": \"Product\", \"price\": 28.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 28.9, \"serviceId\": 2, \"unitPrice\": 28.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',47.33,'Apple Pay','paid','2026-06-11 13:23:22','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,47.80,0.47,0,0.00,47.80,0.00),(16,'order-25',12,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.90,'Apple Pay','paid','2026-07-08 06:30:46','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.00,0,0.00,18.90,0.00),(17,'order-26',12,'product','Scalp Treatment Serum','[{\"name\": \"Scalp Treatment Serum\", \"type\": \"Product\", \"price\": 28.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 28.9, \"serviceId\": 2, \"unitPrice\": 28.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',26.95,'Stripe','paid','2026-07-08 06:43:13','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,28.90,1.95,0,0.00,28.90,0.00),(18,'order-27',12,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',17.55,'PayNow','paid','2026-07-08 06:51:11','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,1.35,0,0.00,18.90,0.00),(21,'order-28',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',16.53,'E-wallet','paid','2026-07-08 10:24:17','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,2.37,0,0.00,18.90,0.00),(22,'order-29',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.07,'E-wallet','paid','2026-07-08 10:24:27','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.83,0,0.00,18.90,0.00),(23,'order-30',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.00,'E-wallet','paid','2026-07-08 10:27:52','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.90,0,0.00,18.90,0.00),(24,'order-31',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.00,'E-wallet','paid','2026-07-08 10:28:02','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.90,0,0.00,18.90,0.00),(25,'order-32',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.00,'E-wallet','paid','2026-07-08 10:28:19','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.90,0,0.00,18.90,0.00),(26,'order-33',1,'product','Repair Shampoo','[{\"name\": \"Repair Shampoo\", \"type\": \"Product\", \"price\": 18.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 18.9, \"serviceId\": 1, \"unitPrice\": 18.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',18.00,'Stripe','paid','2026-07-08 10:28:49','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,18.90,0.90,0,0.00,18.90,0.00),(27,'order-34',1,'product','Scalp Treatment Serum','[{\"name\": \"Scalp Treatment Serum\", \"type\": \"Product\", \"price\": 28.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 28.9, \"serviceId\": 2, \"unitPrice\": 28.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',28.00,'E-wallet','paid','2026-07-08 10:29:01','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,28.90,0.90,0,0.00,28.90,0.00),(28,'order-35',1,'product','Scalp Treatment Serum','[{\"name\": \"Scalp Treatment Serum\", \"type\": \"Product\", \"price\": 28.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 1, \"lineTotal\": 28.9, \"serviceId\": 2, \"unitPrice\": 28.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',27.50,'NETS QR','paid','2026-07-08 10:29:33','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,28.90,1.40,0,0.00,28.90,0.00),(29,'order-36',1,'product','Hair Care Bundle Set x2','[{\"name\": \"Hair Care Bundle Set\", \"type\": \"Product\", \"price\": 39.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 2, \"lineTotal\": 79.8, \"serviceId\": 6, \"unitPrice\": 39.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',78.42,'E-wallet','paid','2026-07-08 10:30:31','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,79.80,1.38,0,0.00,79.80,0.00),(30,'order-37',1,'product','Hair Care Bundle Set x2','[{\"name\": \"Hair Care Bundle Set\", \"type\": \"Product\", \"price\": 39.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 2, \"lineTotal\": 79.8, \"serviceId\": 6, \"unitPrice\": 39.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',75.88,'E-wallet','paid','2026-07-08 10:31:28','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,79.80,3.92,0,0.00,79.80,0.00),(31,'order-38',1,'product','Hair Care Bundle Set x2','[{\"name\": \"Hair Care Bundle Set\", \"type\": \"Product\", \"price\": 39.9, \"detail\": \"Vaniday Beauty Studio\", \"quantity\": 2, \"lineTotal\": 79.8, \"serviceId\": 6, \"unitPrice\": 39.9, \"merchantId\": 1, \"merchantName\": \"Vaniday Beauty Studio\"}]',76.01,'PayNow','paid','2026-07-08 10:32:09','processing','none',0.00,NULL,'pickup','any','Any merchant','pending_pickup',NULL,79.80,3.79,0,0.00,79.80,0.00);
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
INSERT INTO `salons` VALUES (1,3,'Vaniday Beauty Studio',NULL,NULL,NULL,NULL,'Orchard','Hair styling, facials, and beauty treatments.',NULL,0,NULL,0,NULL,NULL,41.11,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21'),(2,4,'FreshGlow Spa',NULL,NULL,NULL,NULL,'Tampines','Relaxing spa and body treatments.',NULL,0,NULL,0,NULL,NULL,13.89,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21'),(3,5,'Urban Groom Barbers',NULL,NULL,NULL,NULL,'Woodlands','Haircuts, fades, and grooming services.',NULL,0,NULL,0,NULL,NULL,50.00,15.00,'approved','2026-04-29 22:12:21',2,'2026-04-29 22:12:21','Seed merchant approved.','2026-04-29 22:12:21');
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
INSERT INTO `services` VALUES (1,1,1,'Hair Cut','Classic haircut and styling consultation.',45,35.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(2,1,2,'Hydrating Facial','Moisturising facial for dry or dull skin.',60,68.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(3,1,3,'Gel Manicure','Long-lasting gel manicure service.',60,55.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(4,2,4,'Aromatherapy Massage','Relaxing full-body aromatherapy massage.',90,98.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(5,2,4,'Body Scrub','Body exfoliation and spa care treatment.',60,72.00,0,0,0.00,'unisex',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(6,3,5,'Classic Haircut','Classic men haircut.',30,28.00,0,0,0.00,'male',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(7,3,5,'Skin Fade','Detailed fade haircut.',45,38.00,0,0,0.00,'male',999,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(8,1,1,'Ladies Haircut','Haircut and styling for women.',60,45.00,0,0,0.00,'female',1,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(9,1,1,'Hair Wash and Blow Dry','Wash, blow dry, and basic styling.',45,35.00,0,0,0.00,'female',2,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(10,1,1,'Ladies Hair Colour','Hair colouring service for women.',120,120.00,0,0,0.00,'female',3,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(11,1,3,'Classic Manicure','Basic nail care and polish.',45,30.00,0,0,0.00,'female',4,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL),(12,1,3,'Gel Pedicure','Long-lasting gel pedicure treatment.',60,45.00,0,0,0.00,'female',5,NULL,0,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `services` ENABLE KEYS */;
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
INSERT INTO `spin_settings` VALUES (1,1,30,8,6,4,'2026-07-08 02:41:52');
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_messages`
--

LOCK TABLES `support_messages` WRITE;
/*!40000 ALTER TABLE `support_messages` DISABLE KEYS */;
INSERT INTO `support_messages` VALUES (1,1,1,'customer','Initial screenshot attached.','/uploads/support/support-1783493656535-f7ca17db840540f9968d.png','2026-07-08 06:54:16');
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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `support_requests`
--

LOCK TABLES `support_requests` WRITE;
/*!40000 ALTER TABLE `support_requests` DISABLE KEYS */;
INSERT INTO `support_requests` VALUES (1,1,3,2,'order_refund','order','23','order-23','merchant_approved','approved','pending','Refund dispute','spillage',NULL,'ok approved',NULL,9.36,9.36,0.00,0,1,'refund-policy-2026-05','processing','2026-07-08 06:54:16','2026-07-08 06:57:22',NULL);
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
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transactions`
--

LOCK TABLES `transactions` WRITE;
/*!40000 ALTER TABLE `transactions` DISABLE KEYS */;
INSERT INTO `transactions` VALUES (1,1,89.00,'paid','Card payment','2026-05-01 10:09:33',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(2,1,32.00,'paid','Card payment','2026-05-01 10:19:33',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(3,1,22.00,'paid','Card payment','2026-05-01 10:28:14',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(4,1,28.00,'paid','Card payment','2026-05-01 10:32:11',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(5,1,28.00,'paid','Card payment','2026-05-01 10:35:55',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(6,1,28.00,'paid','Card payment','2026-05-01 10:49:39',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(7,1,28.00,'paid','card','2026-05-01 16:56:04',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(8,1,35.00,'paid','card','2026-05-01 17:25:03',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(9,1,68.00,'paid','card','2026-05-01 17:44:28',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(10,1,68.00,'paid','card','2026-05-01 17:48:20',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,0.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(11,1,32.00,'paid','Apple Pay','2026-06-03 13:46:00',NULL,NULL,NULL,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,32.00,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(12,6,18.90,'paid','Stripe','2026-06-07 09:15:40',NULL,1,1,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(13,6,17.95,'paid','Stripe','2026-06-07 09:54:16',NULL,2,2,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.95,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(14,1,8.91,'paid','Stripe','2026-06-08 13:34:14',NULL,3,3,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(15,1,15.12,'paid','Stripe','2026-06-08 13:52:11',NULL,4,4,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(16,1,78.51,'paid','Stripe','2026-06-08 14:48:17',NULL,5,5,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,88.50,0.00,'SGD',NULL,NULL,NULL,NULL,NULL,NULL,NULL),(23,1,9.36,'paid','Apple Pay','2026-06-11 13:12:39',NULL,9,10,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,9.54,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(24,1,47.33,'paid','Apple Pay','2026-06-11 13:23:22',NULL,10,11,'delivered',NULL,'2026-06-11 21:23:56','none',0.00,NULL,'pending_pickup',NULL,47.80,0.47,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(25,12,18.90,'paid','Apple Pay','2026-07-08 06:30:45',NULL,12,12,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.00,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(26,12,26.95,'paid','Stripe','2026-07-08 06:43:13',NULL,13,13,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,28.90,1.95,'SGD','stripe','pi_3TqpCF3rE7JjJM0H0A2CgG5n','cs_test_a1D0f4VHalb9jXtxFxkdrrywlUPMlhXS3jylsA4sjQZ7qThHcWf7l4AUR2',NULL,NULL,NULL,NULL),(27,12,17.55,'paid','PayNow','2026-07-08 06:51:10',NULL,14,14,'delivered',NULL,'2026-07-08 14:52:52','none',0.00,NULL,'pending_pickup',NULL,18.90,1.35,'SGD','hitpay','a2353162-56b4-4520-b5d6-7ca3443b6a7b','a2353162-56b4-4520-b5d6-7ca3443b6a7b',NULL,NULL,NULL,NULL),(28,1,16.53,'paid','E-wallet','2026-07-08 10:24:16',NULL,15,15,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,2.37,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(29,1,18.07,'paid','E-wallet','2026-07-08 10:24:26',NULL,16,16,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.83,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(30,1,18.00,'paid','E-wallet','2026-07-08 10:27:51',NULL,17,17,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.90,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(31,1,18.00,'paid','E-wallet','2026-07-08 10:28:01',NULL,18,18,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.90,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(32,1,18.00,'paid','E-wallet','2026-07-08 10:28:19',NULL,19,19,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.90,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(33,1,18.00,'paid','Stripe','2026-07-08 10:28:48',NULL,20,20,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,18.90,0.90,'SGD','stripe','pi_3Tqsif3rE7JjJM0H1fvaBfFd','cs_test_a10hV5gjRnD3yXYesOI6PCfpRXHrbmHJW3JDhX9dtLJFaYCiWvm9qzf7mR',NULL,NULL,NULL,NULL),(34,1,28.00,'paid','E-wallet','2026-07-08 10:29:01',NULL,21,21,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,28.90,0.90,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(35,1,27.50,'paid','NETS QR','2026-07-08 10:29:32',NULL,22,22,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,28.90,1.40,'SGD','nets',NULL,NULL,NULL,NULL,NULL,NULL),(36,1,78.42,'paid','E-wallet','2026-07-08 10:30:30',NULL,23,23,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,79.80,1.38,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(37,1,75.88,'paid','E-wallet','2026-07-08 10:31:27',NULL,24,24,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,79.80,3.92,'SGD','direct',NULL,NULL,NULL,NULL,NULL,NULL),(38,1,76.01,'paid','PayNow','2026-07-08 10:32:08',NULL,25,25,'processing',NULL,NULL,'none',0.00,NULL,'pending_pickup',NULL,79.80,3.79,'SGD','hitpay','a235804e-e1b3-47a4-80c3-742244b644d3','a235804e-e1b3-47a4-80c3-742244b644d3',NULL,NULL,NULL,NULL);
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

-- Dump completed on 2026-07-08 18:34:27


-- ---------------------------------------------------------------------------
-- Production refund/payment workflow upgrade appended by Codex
-- ---------------------------------------------------------------------------

-- Vaniday production refund/payment workflow upgrade
-- Safe to run on the existing database. It preserves existing tables/data and adds the
-- missing structure for direct merchant refund review, payment allocations, refund attempts,
-- wallet refunds, and audit-ready provider references.

CREATE DATABASE IF NOT EXISTS `vaniday_booking_system`
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE `vaniday_booking_system`;

SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_column_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN `', p_column_name, '` ', p_column_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS add_index_if_missing$$
CREATE PROCEDURE add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS add_fk_if_missing$$
CREATE PROCEDURE add_fk_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_constraint_name VARCHAR(64),
    IN p_constraint_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND CONSTRAINT_NAME = p_constraint_name
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `', p_constraint_name, '` ', p_constraint_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DROP PROCEDURE IF EXISTS add_check_if_missing$$
CREATE PROCEDURE add_check_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_constraint_name VARCHAR(64),
    IN p_constraint_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND CONSTRAINT_NAME = p_constraint_name
          AND CONSTRAINT_TYPE = 'CHECK'
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `', p_constraint_name, '` ', p_constraint_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
DELIMITER ;

-- ---------------------------------------------------------------------------
-- Payments: keep existing transactions table, make it provider-safe and split-aware.
-- payment_method = customer-facing method, payment_provider = processor/system.
-- ---------------------------------------------------------------------------

ALTER TABLE `transactions`
    MODIFY COLUMN `payment_status` ENUM(
        'pending',
        'processing',
        'paid',
        'failed',
        'cancelled',
        'partially_refunded',
        'refunded'
    ) NOT NULL DEFAULT 'pending';

CALL add_column_if_missing('transactions', 'merchant_id', 'INT DEFAULT NULL AFTER user_id');
CALL add_column_if_missing('transactions', 'gross_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount');
CALL add_column_if_missing('transactions', 'discount_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER gross_amount');
CALL add_column_if_missing('transactions', 'voucher_discount_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_amount');
CALL add_column_if_missing('transactions', 'wallet_amount_used', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER voucher_discount_amount');
CALL add_column_if_missing('transactions', 'cashback_amount_used', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER wallet_amount_used');
CALL add_column_if_missing('transactions', 'loyalty_points_used', 'INT NOT NULL DEFAULT 0 AFTER cashback_amount_used');
CALL add_column_if_missing('transactions', 'loyalty_points_value', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER loyalty_points_used');
CALL add_column_if_missing('transactions', 'external_payment_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER loyalty_points_value');
CALL add_column_if_missing('transactions', 'paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER external_payment_amount');
CALL add_column_if_missing('transactions', 'remaining_refundable_amount', 'DECIMAL(10,2) GENERATED ALWAYS AS (GREATEST(`paid_amount` - `refunded_amount`, 0.00)) STORED AFTER refunded_amount');
CALL add_column_if_missing('transactions', 'payment_date', 'DATETIME DEFAULT NULL AFTER created_at');
CALL add_column_if_missing('transactions', 'provider_transaction_id', 'VARCHAR(190) DEFAULT NULL AFTER provider_payment_id');
CALL add_column_if_missing('transactions', 'provider_order_id', 'VARCHAR(190) DEFAULT NULL AFTER provider_transaction_id');
CALL add_column_if_missing('transactions', 'provider_charge_id', 'VARCHAR(190) DEFAULT NULL AFTER provider_order_id');
CALL add_column_if_missing('transactions', 'provider_metadata_json', 'LONGTEXT DEFAULT NULL AFTER provider_capture_id');
CALL add_column_if_missing('transactions', 'updated_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER refunded_by');

UPDATE `transactions`
SET
    `gross_amount` = CASE WHEN `gross_amount` = 0 THEN COALESCE(NULLIF(`original_amount`, 0), `total_amount`) ELSE `gross_amount` END,
    `cashback_amount_used` = CASE WHEN `cashback_amount_used` = 0 THEN COALESCE(`cashback_used`, 0) ELSE `cashback_amount_used` END,
    `paid_amount` = CASE WHEN `paid_amount` = 0 THEN `total_amount` ELSE `paid_amount` END,
    `external_payment_amount` = CASE
        WHEN `external_payment_amount` = 0
         AND LOWER(COALESCE(`payment_method`, '')) NOT IN ('e-wallet', 'ewallet', 'wallet')
        THEN `total_amount`
        ELSE `external_payment_amount`
    END,
    `wallet_amount_used` = CASE
        WHEN `wallet_amount_used` = 0
         AND LOWER(COALESCE(`payment_method`, '')) IN ('e-wallet', 'ewallet', 'wallet')
        THEN `total_amount`
        ELSE `wallet_amount_used`
    END,
    `payment_date` = CASE WHEN `payment_date` IS NULL AND `payment_status` = 'paid' THEN `created_at` ELSE `payment_date` END,
    `payment_provider` = CASE
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('e-wallet', 'ewallet', 'wallet') AND (`payment_provider` IS NULL OR `payment_provider` = 'direct') THEN 'internal_wallet'
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('cashback', 'cashback wallet') AND (`payment_provider` IS NULL OR `payment_provider` = 'direct') THEN 'cashback_wallet'
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('paynow') AND (`payment_provider` IS NULL OR `payment_provider` = 'direct') THEN 'hitpay'
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('nets qr', 'nets_qr') AND (`payment_provider` IS NULL OR `payment_provider` = 'direct') THEN 'nets'
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('stripe', 'card', 'card payment', 'apple pay') AND (`payment_provider` IS NULL OR `payment_provider` = 'direct') THEN 'stripe'
        ELSE `payment_provider`
    END;

CALL add_index_if_missing('transactions', 'idx_transactions_merchant', 'INDEX `idx_transactions_merchant` (`merchant_id`)');
CALL add_index_if_missing('transactions', 'idx_transactions_payment_status', 'INDEX `idx_transactions_payment_status` (`payment_status`)');
CALL add_index_if_missing('transactions', 'idx_transactions_refund_status', 'INDEX `idx_transactions_refund_status` (`refund_status`)');
CALL add_index_if_missing('transactions', 'idx_transactions_provider_transaction', 'INDEX `idx_transactions_provider_transaction` (`payment_provider`, `provider_transaction_id`)');
CALL add_index_if_missing('transactions', 'idx_transactions_provider_capture', 'INDEX `idx_transactions_provider_capture` (`payment_provider`, `provider_capture_id`)');
CALL add_index_if_missing('transactions', 'uq_transactions_provider_payment', 'UNIQUE KEY `uq_transactions_provider_payment` (`payment_provider`, `provider_payment_id`)');
CALL add_fk_if_missing('transactions', 'fk_transactions_merchant_user', 'FOREIGN KEY (`merchant_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL');

CALL add_check_if_missing('transactions', 'chk_transactions_amounts_nonnegative', 'CHECK (`total_amount` >= 0 AND `gross_amount` >= 0 AND `paid_amount` >= 0 AND `refunded_amount` >= 0)');
CALL add_check_if_missing('transactions', 'chk_transactions_refund_not_over_paid', 'CHECK (`refunded_amount` <= `paid_amount`)');

-- ---------------------------------------------------------------------------
-- Payment source allocation: required for split payments, wallet/cashback returns,
-- loyalty restoration, voucher discounts, and partial refund accounting.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `payment_allocations` (
  `allocation_id` INT NOT NULL AUTO_INCREMENT,
  `transaction_id` INT NOT NULL,
  `source_type` ENUM('external','wallet','cashback','loyalty_points','voucher','discount') NOT NULL,
  `payment_method` VARCHAR(50) DEFAULT NULL,
  `payment_provider` VARCHAR(40) DEFAULT NULL,
  `source_reference_id` VARCHAR(190) DEFAULT NULL,
  `allocated_amount` DECIMAL(10,2) NOT NULL,
  `refunded_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `remaining_refundable_amount` DECIMAL(10,2) GENERATED ALWAYS AS (GREATEST(`allocated_amount` - `refunded_amount`, 0.00)) STORED,
  `metadata_json` LONGTEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`allocation_id`),
  UNIQUE KEY `uq_payment_allocation_source` (`transaction_id`, `source_type`, `source_reference_id`),
  KEY `idx_payment_allocations_transaction` (`transaction_id`),
  KEY `idx_payment_allocations_source` (`source_type`, `payment_provider`),
  CONSTRAINT `fk_payment_allocations_transaction`
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_payment_allocation_amounts`
    CHECK (`allocated_amount` >= 0 AND `refunded_amount` >= 0 AND `refunded_amount` <= `allocated_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO `payment_allocations`
    (`transaction_id`, `source_type`, `payment_method`, `payment_provider`, `source_reference_id`, `allocated_amount`)
SELECT
    `transaction_id`,
    CASE
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('e-wallet', 'ewallet', 'wallet') THEN 'wallet'
        ELSE 'external'
    END,
    `payment_method`,
    `payment_provider`,
    COALESCE(`provider_payment_id`, `provider_capture_id`, `provider_session_id`, CONCAT('transaction-', `transaction_id`)),
    CASE
        WHEN LOWER(COALESCE(`payment_method`, '')) IN ('e-wallet', 'ewallet', 'wallet') THEN `wallet_amount_used`
        ELSE `external_payment_amount`
    END
FROM `transactions`
WHERE `payment_status` IN ('paid', 'partially_refunded', 'refunded')
  AND (
      `external_payment_amount` > 0
      OR `wallet_amount_used` > 0
      OR `total_amount` > 0
  );

INSERT IGNORE INTO `payment_allocations`
    (`transaction_id`, `source_type`, `payment_method`, `payment_provider`, `source_reference_id`, `allocated_amount`)
SELECT
    `transaction_id`,
    'cashback',
    'cashback',
    'cashback_wallet',
    CONCAT('cashback-', `transaction_id`),
    `cashback_amount_used`
FROM `transactions`
WHERE `cashback_amount_used` > 0;

INSERT IGNORE INTO `payment_allocations`
    (`transaction_id`, `source_type`, `payment_method`, `payment_provider`, `source_reference_id`, `allocated_amount`)
SELECT
    `transaction_id`,
    'discount',
    'discount',
    'internal_discount',
    CONCAT('discount-', `transaction_id`),
    GREATEST(`gross_amount` - `paid_amount` - `cashback_amount_used`, 0.00)
FROM `transactions`
WHERE GREATEST(`gross_amount` - `paid_amount` - `cashback_amount_used`, 0.00) > 0;

-- ---------------------------------------------------------------------------
-- Booking/order payment status: keep business status separate from payment status.
-- ---------------------------------------------------------------------------

CALL add_column_if_missing('bookings', 'payment_status', "ENUM('unpaid','pending','paid','partially_refunded','refunded','payment_failed') NOT NULL DEFAULT 'pending' AFTER `status`");
CALL add_column_if_missing('bookings', 'paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `payment_status`');
CALL add_column_if_missing('bookings', 'refunded_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `paid_amount`');
CALL add_column_if_missing('bookings', 'remaining_refundable_amount', 'DECIMAL(10,2) GENERATED ALWAYS AS (GREATEST(`paid_amount` - `refunded_amount`, 0.00)) STORED AFTER `refunded_amount`');
CALL add_index_if_missing('bookings', 'idx_bookings_payment_status', 'INDEX `idx_bookings_payment_status` (`payment_status`)');

UPDATE `bookings` b
LEFT JOIN `transactions` t ON t.`transaction_id` = b.`transaction_id`
SET
    b.`payment_status` = CASE
        WHEN t.`payment_status` IN ('refunded', 'partially_refunded') THEN t.`payment_status`
        WHEN t.`payment_status` = 'paid' OR b.`status` = 'paid' THEN 'paid'
        WHEN t.`payment_status` = 'failed' THEN 'payment_failed'
        ELSE b.`payment_status`
    END,
    b.`paid_amount` = CASE WHEN b.`paid_amount` = 0 THEN COALESCE(t.`paid_amount`, t.`total_amount`, 0) ELSE b.`paid_amount` END,
    b.`refunded_amount` = CASE WHEN b.`refunded_amount` = 0 THEN COALESCE(t.`refunded_amount`, 0) ELSE b.`refunded_amount` END;

CALL add_column_if_missing('orders', 'payment_status', "ENUM('unpaid','pending','paid','partially_refunded','refunded','payment_failed') NOT NULL DEFAULT 'paid' AFTER `order_status`");
CALL add_column_if_missing('orders', 'paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `total_amount`');
CALL add_column_if_missing('orders', 'remaining_refundable_amount', 'DECIMAL(10,2) GENERATED ALWAYS AS (GREATEST(`paid_amount` - `refunded_amount`, 0.00)) STORED AFTER `refunded_amount`');
CALL add_index_if_missing('orders', 'idx_orders_payment_status', 'INDEX `idx_orders_payment_status` (`payment_status`)');

UPDATE `orders` o
LEFT JOIN `transactions` t ON t.`transaction_id` = o.`transaction_id`
SET
    o.`payment_status` = CASE
        WHEN t.`payment_status` IN ('refunded', 'partially_refunded') THEN t.`payment_status`
        WHEN t.`payment_status` = 'failed' THEN 'payment_failed'
        WHEN t.`payment_status` = 'paid' THEN 'paid'
        ELSE o.`payment_status`
    END,
    o.`paid_amount` = CASE WHEN o.`paid_amount` = 0 THEN COALESCE(t.`paid_amount`, o.`total_amount`, 0) ELSE o.`paid_amount` END;

-- ---------------------------------------------------------------------------
-- Refund requests: improve existing support_requests instead of creating a duplicate.
-- This table is the customer refund request / merchant decision record.
-- ---------------------------------------------------------------------------

ALTER TABLE `support_requests`
    MODIFY COLUMN `status` VARCHAR(40) NOT NULL DEFAULT 'pending_merchant_review';

CALL add_column_if_missing('support_requests', 'booking_id', 'INT DEFAULT NULL AFTER `receipt_id`');
CALL add_column_if_missing('support_requests', 'order_id', 'INT DEFAULT NULL AFTER `booking_id`');
CALL add_column_if_missing('support_requests', 'order_item_id', 'INT DEFAULT NULL AFTER `order_id`');
CALL add_column_if_missing('support_requests', 'payment_transaction_id', 'INT DEFAULT NULL AFTER `order_item_id`');
CALL add_column_if_missing('support_requests', 'target_label', 'VARCHAR(255) DEFAULT NULL AFTER `payment_transaction_id`');
CALL add_column_if_missing('support_requests', 'payment_method', 'VARCHAR(50) DEFAULT NULL AFTER `target_label`');
CALL add_column_if_missing('support_requests', 'payment_provider', 'VARCHAR(40) DEFAULT NULL AFTER `payment_method`');
CALL add_column_if_missing('support_requests', 'supporting_evidence_path', 'VARCHAR(255) DEFAULT NULL AFTER `requested_change`');
CALL add_column_if_missing('support_requests', 'merchant_rejection_reason', 'TEXT DEFAULT NULL AFTER `merchant_note`');
CALL add_column_if_missing('support_requests', 'merchant_internal_notes', 'TEXT DEFAULT NULL AFTER `merchant_rejection_reason`');
CALL add_column_if_missing('support_requests', 'reviewed_by', 'INT DEFAULT NULL AFTER `merchant_internal_notes`');
CALL add_column_if_missing('support_requests', 'reviewed_at', 'DATETIME DEFAULT NULL AFTER `reviewed_by`');
CALL add_column_if_missing('support_requests', 'refunded_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `approved_refund_amount`');
CALL add_column_if_missing('support_requests', 'provider_refund_id', 'VARCHAR(190) DEFAULT NULL AFTER `delivery_status`');
CALL add_column_if_missing('support_requests', 'provider_refund_status', 'VARCHAR(40) DEFAULT NULL AFTER `provider_refund_id`');
CALL add_column_if_missing('support_requests', 'failure_reason', 'TEXT DEFAULT NULL AFTER `provider_refund_status`');
CALL add_column_if_missing('support_requests', 'submitted_at', 'DATETIME DEFAULT NULL AFTER `failure_reason`');
CALL add_column_if_missing('support_requests', 'processed_at', 'DATETIME DEFAULT NULL AFTER `submitted_at`');
CALL add_column_if_missing('support_requests', 'active_refund_key', "VARCHAR(255) GENERATED ALWAYS AS (CASE WHEN `request_type` IN ('order_refund','booking_refund') AND `status` IN ('pending_merchant_review','approved','refund_processing','refund_failed','manual_refund_required') THEN CONCAT(COALESCE(`payment_transaction_id`,0), ':', `target_type`, ':', `target_id`) ELSE NULL END) STORED AFTER `processed_at`");

UPDATE `support_requests`
SET
    `status` = CASE
        WHEN `status` IN ('pending_admin_review', 'forwarded_to_merchant', 'admin_approved') THEN 'pending_merchant_review'
        WHEN `status` = 'merchant_approved' THEN 'approved'
        WHEN `status` = 'merchant_declined' THEN 'rejected'
        WHEN `status` = 'resolved_rejected' THEN 'rejected'
        WHEN `status` = 'resolved_approved' AND `refunded_amount` > 0 THEN 'refunded'
        WHEN `status` = 'resolved_approved' AND `refunded_amount` = 0 THEN 'approved'
        ELSE `status`
    END,
    `admin_decision` = CASE
        WHEN `status` IN ('pending_admin_review', 'forwarded_to_merchant', 'admin_approved') THEN 'not_required'
        ELSE `admin_decision`
    END,
    `submitted_at` = COALESCE(`submitted_at`, `created_at`);

UPDATE `support_requests` sr
LEFT JOIN `transactions` t
    ON sr.`target_type` = 'order'
   AND CAST(sr.`target_id` AS UNSIGNED) = t.`transaction_id`
LEFT JOIN `orders` o
    ON o.`transaction_id` = t.`transaction_id`
SET
    sr.`payment_transaction_id` = COALESCE(sr.`payment_transaction_id`, t.`transaction_id`),
    sr.`order_id` = COALESCE(sr.`order_id`, o.`order_id`),
    sr.`payment_method` = COALESCE(sr.`payment_method`, t.`payment_method`),
    sr.`payment_provider` = COALESCE(sr.`payment_provider`, t.`payment_provider`)
WHERE sr.`target_type` = 'order';

UPDATE `support_requests` sr
LEFT JOIN `bookings` b
    ON sr.`target_type` = 'booking'
   AND CAST(sr.`target_id` AS UNSIGNED) = b.`booking_id`
LEFT JOIN `transactions` t
    ON t.`transaction_id` = b.`transaction_id`
SET
    sr.`booking_id` = COALESCE(sr.`booking_id`, b.`booking_id`),
    sr.`payment_transaction_id` = COALESCE(sr.`payment_transaction_id`, t.`transaction_id`),
    sr.`payment_method` = COALESCE(sr.`payment_method`, t.`payment_method`),
    sr.`payment_provider` = COALESCE(sr.`payment_provider`, t.`payment_provider`)
WHERE sr.`target_type` = 'booking';

CALL add_index_if_missing('support_requests', 'idx_support_payment_transaction', 'INDEX `idx_support_payment_transaction` (`payment_transaction_id`)');
CALL add_index_if_missing('support_requests', 'idx_support_booking', 'INDEX `idx_support_booking` (`booking_id`)');
CALL add_index_if_missing('support_requests', 'idx_support_order', 'INDEX `idx_support_order` (`order_id`)');
CALL add_index_if_missing('support_requests', 'idx_support_reviewed_by', 'INDEX `idx_support_reviewed_by` (`reviewed_by`)');
CALL add_index_if_missing('support_requests', 'uq_support_active_refund', 'UNIQUE KEY `uq_support_active_refund` (`active_refund_key`)');
CALL add_fk_if_missing('support_requests', 'fk_support_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('support_requests', 'fk_support_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('support_requests', 'fk_support_order_item', 'FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`order_item_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('support_requests', 'fk_support_payment_transaction', 'FOREIGN KEY (`payment_transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('support_requests', 'fk_support_reviewed_by', 'FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL');
CALL add_check_if_missing('support_requests', 'chk_support_refund_amounts', 'CHECK (`refund_amount` >= 0 AND `approved_refund_amount` >= 0 AND `refunded_amount` >= 0 AND `approved_refund_amount` <= `refund_amount`)');

-- ---------------------------------------------------------------------------
-- Refund transactions: improve existing payment_refunds as the actual refund
-- attempt ledger. Multiple attempts/retries are preserved.
-- ---------------------------------------------------------------------------

CALL add_column_if_missing('payment_refunds', 'refund_request_id', 'INT DEFAULT NULL AFTER `refund_id`');
CALL add_column_if_missing('payment_refunds', 'payment_method', 'VARCHAR(50) DEFAULT NULL AFTER `refund_reason`');
CALL add_column_if_missing('payment_refunds', 'provider_status', 'VARCHAR(40) DEFAULT NULL AFTER `provider_refund_id`');
CALL add_column_if_missing('payment_refunds', 'internal_status', "ENUM('pending','processing','succeeded','failed','cancelled','manual_required') NOT NULL DEFAULT 'pending' AFTER `provider_status`");
CALL add_column_if_missing('payment_refunds', 'attempt_number', 'INT NOT NULL DEFAULT 1 AFTER `internal_status`');
CALL add_column_if_missing('payment_refunds', 'idempotency_key', 'VARCHAR(190) DEFAULT NULL AFTER `attempt_number`');
CALL add_column_if_missing('payment_refunds', 'failure_code', 'VARCHAR(80) DEFAULT NULL AFTER `idempotency_key`');
CALL add_column_if_missing('payment_refunds', 'failure_reason', 'TEXT DEFAULT NULL AFTER `failure_code`');
CALL add_column_if_missing('payment_refunds', 'processed_at', 'DATETIME DEFAULT NULL AFTER `failure_reason`');

UPDATE `payment_refunds` pr
LEFT JOIN `transactions` t ON t.`transaction_id` = pr.`transaction_id`
SET
    pr.`payment_method` = COALESCE(pr.`payment_method`, t.`payment_method`),
    pr.`payment_provider` = COALESCE(pr.`payment_provider`, t.`payment_provider`),
    pr.`internal_status` = CASE
        WHEN pr.`refund_status` IN ('succeeded', 'refunded') THEN 'succeeded'
        WHEN pr.`refund_status` IN ('manual_required') THEN 'manual_required'
        WHEN pr.`refund_status` IN ('failed', 'refund_failed') THEN 'failed'
        ELSE pr.`internal_status`
    END,
    pr.`provider_status` = COALESCE(pr.`provider_status`, pr.`refund_status`),
    pr.`processed_at` = CASE
        WHEN pr.`processed_at` IS NULL AND pr.`refund_status` IN ('succeeded','refunded','manual_required') THEN pr.`updated_at`
        ELSE pr.`processed_at`
    END;

CALL add_index_if_missing('payment_refunds', 'idx_payment_refunds_request', 'INDEX `idx_payment_refunds_request` (`refund_request_id`)');
CALL add_index_if_missing('payment_refunds', 'idx_payment_refunds_internal_status', 'INDEX `idx_payment_refunds_internal_status` (`internal_status`)');
CALL add_index_if_missing('payment_refunds', 'uq_payment_refunds_idempotency', 'UNIQUE KEY `uq_payment_refunds_idempotency` (`idempotency_key`)');
CALL add_index_if_missing('payment_refunds', 'uq_payment_refunds_request_attempt', 'UNIQUE KEY `uq_payment_refunds_request_attempt` (`refund_request_id`, `attempt_number`)');
CALL add_fk_if_missing('payment_refunds', 'fk_payment_refunds_request', 'FOREIGN KEY (`refund_request_id`) REFERENCES `support_requests` (`request_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('payment_refunds', 'fk_payment_refunds_merchant', 'FOREIGN KEY (`merchant_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('payment_refunds', 'fk_payment_refunds_refunded_by', 'FOREIGN KEY (`refunded_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('payment_refunds', 'fk_payment_refunds_booking', 'FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('payment_refunds', 'fk_payment_refunds_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE SET NULL');
CALL add_check_if_missing('payment_refunds', 'chk_payment_refunds_amount_positive', 'CHECK (`refund_amount` > 0)');

-- Per-source refund allocation ledger. This is how wallet/cashback/loyalty/external
-- portions can be refunded independently without overwriting previous failed attempts.
CREATE TABLE IF NOT EXISTS `refund_allocation_transactions` (
  `refund_allocation_id` INT NOT NULL AUTO_INCREMENT,
  `refund_id` INT NOT NULL,
  `refund_request_id` INT DEFAULT NULL,
  `payment_allocation_id` INT NOT NULL,
  `transaction_id` INT NOT NULL,
  `source_type` ENUM('external','wallet','cashback','loyalty_points','voucher','discount') NOT NULL,
  `payment_method` VARCHAR(50) DEFAULT NULL,
  `payment_provider` VARCHAR(40) DEFAULT NULL,
  `refund_amount` DECIMAL(10,2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'SGD',
  `internal_status` ENUM('pending','processing','succeeded','failed','cancelled','manual_required') NOT NULL DEFAULT 'pending',
  `provider_refund_id` VARCHAR(190) DEFAULT NULL,
  `wallet_transaction_id` INT DEFAULT NULL,
  `loyalty_transaction_id` INT DEFAULT NULL,
  `failure_reason` TEXT DEFAULT NULL,
  `processed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`refund_allocation_id`),
  UNIQUE KEY `uq_refund_allocation_once` (`refund_id`, `payment_allocation_id`),
  KEY `idx_refund_alloc_request` (`refund_request_id`),
  KEY `idx_refund_alloc_transaction` (`transaction_id`),
  KEY `idx_refund_alloc_wallet_txn` (`wallet_transaction_id`),
  KEY `idx_refund_alloc_loyalty_txn` (`loyalty_transaction_id`),
  CONSTRAINT `fk_refund_alloc_refund`
    FOREIGN KEY (`refund_id`) REFERENCES `payment_refunds` (`refund_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_refund_alloc_request`
    FOREIGN KEY (`refund_request_id`) REFERENCES `support_requests` (`request_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_refund_alloc_payment_allocation`
    FOREIGN KEY (`payment_allocation_id`) REFERENCES `payment_allocations` (`allocation_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_refund_alloc_transaction`
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_refund_alloc_wallet_txn`
    FOREIGN KEY (`wallet_transaction_id`) REFERENCES `e_wallet_transactions` (`transaction_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_refund_alloc_loyalty_txn`
    FOREIGN KEY (`loyalty_transaction_id`) REFERENCES `loyalty_transactions` (`loyalty_transaction_id`) ON DELETE SET NULL,
  CONSTRAINT `chk_refund_alloc_amount_positive`
    CHECK (`refund_amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- E-wallet refund handling. Existing e_wallets/e_wallet_transactions are reused.
-- ---------------------------------------------------------------------------

ALTER TABLE `e_wallet_transactions`
    MODIFY COLUMN `transaction_type` ENUM(
        'TOPUP','PAYMENT','REFUND','CASHBACK','ADJUSTMENT','WITHDRAWAL',
        'top_up','payment','refund','cashback','adjustment','withdrawal'
    ) NOT NULL,
    MODIFY COLUMN `payment_method` ENUM(
        'STRIPE','PAYPAL','PAYNOW','NETS_QR','EWALLET','SYSTEM',
        'stripe','paypal','paynow','nets_qr','wallet','cashback','system','internal_wallet'
    ) DEFAULT 'SYSTEM',
    MODIFY COLUMN `status` ENUM('PENDING','COMPLETED','FAILED','CANCELLED','pending','completed','failed','cancelled') DEFAULT 'PENDING';

CALL add_column_if_missing('e_wallet_transactions', 'refund_request_id', 'INT DEFAULT NULL AFTER `user_id`');
CALL add_column_if_missing('e_wallet_transactions', 'payment_transaction_id', 'INT DEFAULT NULL AFTER `refund_request_id`');
CALL add_column_if_missing('e_wallet_transactions', 'refund_id', 'INT DEFAULT NULL AFTER `payment_transaction_id`');
CALL add_column_if_missing('e_wallet_transactions', 'idempotency_key', 'VARCHAR(190) DEFAULT NULL AFTER `payment_attempt_id`');
CALL add_column_if_missing('e_wallet_transactions', 'updated_at', 'TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');
CALL add_index_if_missing('e_wallet_transactions', 'idx_wallet_refund_request', 'INDEX `idx_wallet_refund_request` (`refund_request_id`)');
CALL add_index_if_missing('e_wallet_transactions', 'idx_wallet_payment_transaction', 'INDEX `idx_wallet_payment_transaction` (`payment_transaction_id`)');
CALL add_index_if_missing('e_wallet_transactions', 'uq_wallet_refund_once', 'UNIQUE KEY `uq_wallet_refund_once` (`refund_id`)');
CALL add_index_if_missing('e_wallet_transactions', 'uq_wallet_idempotency', 'UNIQUE KEY `uq_wallet_idempotency` (`idempotency_key`)');
CALL add_fk_if_missing('e_wallet_transactions', 'fk_wallet_txn_refund_request', 'FOREIGN KEY (`refund_request_id`) REFERENCES `support_requests` (`request_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('e_wallet_transactions', 'fk_wallet_txn_payment_transaction', 'FOREIGN KEY (`payment_transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('e_wallet_transactions', 'fk_wallet_txn_payment_refund', 'FOREIGN KEY (`refund_id`) REFERENCES `payment_refunds` (`refund_id`) ON DELETE SET NULL');

-- ---------------------------------------------------------------------------
-- Loyalty/cashback restoration and reversal references.
-- Existing loyalty ledger is reused; add refund/payment links for audit.
-- ---------------------------------------------------------------------------

CALL add_column_if_missing('loyalty_transactions', 'refund_request_id', 'INT DEFAULT NULL AFTER `user_id`');
CALL add_column_if_missing('loyalty_transactions', 'payment_transaction_id', 'INT DEFAULT NULL AFTER `refund_request_id`');
CALL add_column_if_missing('loyalty_transactions', 'refund_id', 'INT DEFAULT NULL AFTER `payment_transaction_id`');
CALL add_column_if_missing('loyalty_transactions', 'metadata_json', 'LONGTEXT DEFAULT NULL AFTER `reward_discount`');
CALL add_index_if_missing('loyalty_transactions', 'idx_loyalty_refund_request', 'INDEX `idx_loyalty_refund_request` (`refund_request_id`)');
CALL add_index_if_missing('loyalty_transactions', 'idx_loyalty_payment_transaction', 'INDEX `idx_loyalty_payment_transaction` (`payment_transaction_id`)');
CALL add_index_if_missing('loyalty_transactions', 'idx_loyalty_refund', 'INDEX `idx_loyalty_refund` (`refund_id`)');
CALL add_fk_if_missing('loyalty_transactions', 'fk_loyalty_refund_request', 'FOREIGN KEY (`refund_request_id`) REFERENCES `support_requests` (`request_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('loyalty_transactions', 'fk_loyalty_payment_transaction', 'FOREIGN KEY (`payment_transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE SET NULL');
CALL add_fk_if_missing('loyalty_transactions', 'fk_loyalty_payment_refund', 'FOREIGN KEY (`refund_id`) REFERENCES `payment_refunds` (`refund_id`) ON DELETE SET NULL');

-- ---------------------------------------------------------------------------
-- Purchase history receipt/payment display support.
-- Existing purchase_history is reused so reopened receipts keep provider,
-- allocation and refund context.
-- ---------------------------------------------------------------------------

CALL add_column_if_missing('purchase_history', 'payment_provider', 'VARCHAR(40) DEFAULT NULL AFTER `payment_method`');
CALL add_column_if_missing('purchase_history', 'payment_method_label', 'VARCHAR(120) DEFAULT NULL AFTER `payment_provider`');
CALL add_column_if_missing('purchase_history', 'payment_breakdown_json', 'LONGTEXT DEFAULT NULL AFTER `payment_method_label`');
CALL add_column_if_missing('purchase_history', 'payment_transaction_id', 'INT DEFAULT NULL AFTER `payment_breakdown_json`');
CALL add_column_if_missing('purchase_history', 'provider_payment_reference', 'VARCHAR(190) DEFAULT NULL AFTER `payment_transaction_id`');
CALL add_column_if_missing('purchase_history', 'remaining_paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER `refunded_amount`');
CALL add_index_if_missing('purchase_history', 'idx_purchase_history_payment_transaction', 'INDEX `idx_purchase_history_payment_transaction` (`payment_transaction_id`)');
CALL add_fk_if_missing('purchase_history', 'fk_purchase_history_payment_transaction', 'FOREIGN KEY (`payment_transaction_id`) REFERENCES `transactions` (`transaction_id`) ON DELETE SET NULL');

UPDATE `purchase_history` ph
LEFT JOIN `transactions` t
    ON t.`transaction_id` = ph.`payment_transaction_id`
    OR ph.`receipt_id` = CONCAT('order-', t.`transaction_id`)
SET
    ph.`payment_method` = COALESCE(t.`payment_method`, ph.`payment_method`),
    ph.`payment_provider` = COALESCE(t.`payment_provider`, ph.`payment_provider`),
    ph.`payment_transaction_id` = COALESCE(ph.`payment_transaction_id`, t.`transaction_id`),
    ph.`provider_payment_reference` = COALESCE(
        ph.`provider_payment_reference`,
        t.`provider_transaction_id`,
        t.`provider_capture_id`,
        t.`provider_payment_id`,
        t.`provider_session_id`
    ),
    ph.`payment_status` = COALESCE(t.`payment_status`, ph.`payment_status`),
    ph.`refund_status` = COALESCE(t.`refund_status`, ph.`refund_status`),
    ph.`refunded_amount` = GREATEST(ph.`refunded_amount`, COALESCE(t.`refunded_amount`, 0)),
    ph.`remaining_paid_amount` = GREATEST(COALESCE(t.`paid_amount`, ph.`total_amount`) - GREATEST(ph.`refunded_amount`, COALESCE(t.`refunded_amount`, 0)), 0)
WHERE ph.`purchase_type` = 'product';

-- ---------------------------------------------------------------------------
-- Accounting sync helpers for existing successful refunds.
-- Future application code should update these atomically in one DB transaction.
-- ---------------------------------------------------------------------------

UPDATE `transactions` t
SET
    t.`payment_status` = CASE
        WHEN t.`refunded_amount` > 0 AND t.`refunded_amount` >= t.`paid_amount` THEN 'refunded'
        WHEN t.`refunded_amount` > 0 THEN 'partially_refunded'
        ELSE t.`payment_status`
    END,
    t.`refund_status` = CASE
        WHEN t.`refunded_amount` > 0 AND t.`refunded_amount` >= t.`paid_amount` THEN 'refunded'
        WHEN t.`refunded_amount` > 0 THEN 'partially_refunded'
        ELSE t.`refund_status`
    END
WHERE t.`payment_status` IN ('paid', 'partially_refunded', 'refunded');

UPDATE `orders` o
JOIN `transactions` t ON t.`transaction_id` = o.`transaction_id`
SET
    o.`payment_status` = CASE
        WHEN t.`payment_status` IN ('refunded', 'partially_refunded') THEN t.`payment_status`
        ELSE o.`payment_status`
    END,
    o.`refund_status` = CASE
        WHEN t.`refund_status` IN ('refunded', 'partially_refunded') THEN t.`refund_status`
        ELSE o.`refund_status`
    END,
    o.`refunded_amount` = GREATEST(o.`refunded_amount`, t.`refunded_amount`);

UPDATE `bookings` b
JOIN `transactions` t ON t.`transaction_id` = b.`transaction_id`
SET
    b.`payment_status` = CASE
        WHEN t.`payment_status` IN ('refunded', 'partially_refunded') THEN t.`payment_status`
        ELSE b.`payment_status`
    END,
    b.`refund_status` = CASE
        WHEN t.`refund_status` IN ('refunded', 'partially_refunded') THEN t.`refund_status`
        ELSE b.`refund_status`
    END,
    b.`refunded_amount` = GREATEST(b.`refunded_amount`, t.`refunded_amount`);

-- Database constraints cannot fully enforce cross-row partial-refund totals or provider
-- API success. The Node.js refund service must still validate:
-- 1. logged-in customer owns the booking/order,
-- 2. logged-in merchant owns the related booking/order/product,
-- 3. payment_transaction_id is paid/partially_refunded before refund,
-- 4. requested/approved/refund amounts are > 0 and <= remaining_refundable_amount,
-- 5. refund allocation sums do not exceed payment allocation balances,
-- 6. wallet/cashback/loyalty restoration only happens after successful refund,
-- 7. provider idempotency keys are reused on retries.

SET FOREIGN_KEY_CHECKS = 1;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS add_fk_if_missing;
DROP PROCEDURE IF EXISTS add_check_if_missing;
