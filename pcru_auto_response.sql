-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: project.3bbddns.com
-- Generation Time: Dec 22, 2025 at 03:17 AM
-- Server version: 10.4.28-MariaDB
-- PHP Version: 8.2.4

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `pcru_auto_response`
--

-- --------------------------------------------------------

--
-- Table structure for table `AdminUsers`
--

CREATE TABLE `AdminUsers` (
  `AdminUserID` int(3) NOT NULL,
  `AdminName` varchar(255) NOT NULL,
  `AdminEmail` varchar(255) NOT NULL,
  `AdminPassword` varchar(255) DEFAULT NULL,
  `ParentAdminID` int(11) DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `AdminUsers`
--

INSERT INTO `AdminUsers` (`AdminUserID`, `AdminName`, `AdminEmail`, `AdminPassword`, `ParentAdminID`, `CreatedAt`, `UpdatedAt`) VALUES
(1001, 'admin', 'kriangkrai20181@gmail.com', '12345678A', 1001, '2025-12-21 13:57:56', '2025-12-22 00:16:34'),
(1002, 'นายเกรียงไกร คงเมือง', 'kriangkrai2018@gmail.com', '12345678A', 1001, '2025-12-21 13:57:56', '2025-12-22 00:16:36');

-- --------------------------------------------------------

--
-- Table structure for table `AnswersKeywords`
--

CREATE TABLE `AnswersKeywords` (
  `ID` int(11) NOT NULL,
  `QuestionsAnswersID` int(11) NOT NULL,
  `KeywordID` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Categories`
--

CREATE TABLE `Categories` (
  `CategoriesID` varchar(50) NOT NULL,
  `CategoriesName` varchar(255) NOT NULL,
  `ParentCategoriesID` varchar(50) DEFAULT NULL,
  `OfficerID` int(11) DEFAULT NULL,
  `CategoriesPDF` text DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `Categories`
--

INSERT INTO `Categories` (`CategoriesID`, `CategoriesName`, `ParentCategoriesID`, `OfficerID`, `CategoriesPDF`, `CreatedAt`, `UpdatedAt`) VALUES
('1', 'ทุนการศึกษา', '1', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:21'),
('1-1', 'ทุนเรียนดี', '1', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 14:08:44', '2025-12-22 00:22:35'),
('1-2', 'ทุนความสามารถพิเศษ', '1', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 14:08:44', '2025-12-22 00:22:33'),
('1-3', 'ทุนสร้างชื่อเสียง', '1', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 14:08:44', '2025-12-22 00:22:25'),
('1-4', 'ทุนช่วยเหลือนักศึกษาต่างชาติ', '1', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 14:08:44', '2025-12-22 00:22:23'),
('2', 'บริการนักศึกษา', '2', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:28'),
('2-1', 'ทำบัตรนักศึกษา', '2', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:46'),
('2-2', 'ขอเอกสารทางการศึกษา', '2', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:48'),
('2-3', 'แจ้งจบการศึกษา', '2', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:49'),
('2-4', 'การขอรับรองสถานะนักศึกษา', '2', 3001, 'https://academic.pcru.ac.th/songsermv1/data-form/190902095453.pdf', '2025-12-21 13:57:56', '2025-12-22 00:21:50'),
('3', 'หอพัก', '3', 3001, NULL, '2025-12-21 13:57:56', '2025-12-22 00:22:59'),
('4', 'ข่าวสาร', '4', 3001, NULL, '2025-12-21 13:57:56', '2025-12-22 00:22:55');

-- --------------------------------------------------------

--
-- Table structure for table `ChatLogHasAnswers`
--

CREATE TABLE `ChatLogHasAnswers` (
  `ChatLogID` int(11) NOT NULL,
  `UserQuery` text NOT NULL,
  `QuestionsAnswersID` int(11) DEFAULT NULL,
  `Confidence` decimal(5,4) DEFAULT NULL,
  `Status` varchar(50) DEFAULT 'answered',
  `Timestamp` datetime DEFAULT current_timestamp(),
  `SessionID` varchar(255) DEFAULT NULL,
  `UserAgent` varchar(512) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ChatLogNoAnswers`
--

CREATE TABLE `ChatLogNoAnswers` (
  `ChatLogID` int(11) NOT NULL,
  `UserQuery` text NOT NULL,
  `Status` varchar(50) DEFAULT 'no_answer',
  `Timestamp` datetime DEFAULT current_timestamp(),
  `SessionID` varchar(255) DEFAULT NULL,
  `UserAgent` varchar(512) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `ChatLogNoAnswers`
--

INSERT INTO `ChatLogNoAnswers` (`ChatLogID`, `UserQuery`, `Status`, `Timestamp`, `SessionID`, `UserAgent`) VALUES
(1, 'ทุนเรียนดี', '0', '2025-12-21 20:46:48', NULL, NULL),
(2, 'ทุนความสามารถพิเศษ', '0', '2025-12-21 20:46:50', NULL, NULL),
(3, 'ทุนสร้างชื่อเสียง', '0', '2025-12-21 20:46:52', NULL, NULL),
(4, 'แนะแนว', '0', '2025-12-21 20:47:46', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `Feedbacks`
--

CREATE TABLE `Feedbacks` (
  `FeedbackID` int(11) NOT NULL,
  `ChatLogID` int(11) NOT NULL,
  `FeedbackValue` tinyint(1) NOT NULL,
  `FeedbackDate` datetime DEFAULT current_timestamp(),
  `Handled` tinyint(1) DEFAULT 0,
  `Reason` varchar(255) DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `IntentDomainTerms`
--

CREATE TABLE `IntentDomainTerms` (
  `TermID` int(11) NOT NULL,
  `Term` varchar(255) NOT NULL,
  `Domain` varchar(50) NOT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `IntentHints`
--

CREATE TABLE `IntentHints` (
  `HintID` int(11) NOT NULL,
  `HintText` varchar(255) NOT NULL,
  `IntentType` enum('count','other') NOT NULL DEFAULT 'count',
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Keywords`
--

CREATE TABLE `Keywords` (
  `KeywordID` int(11) NOT NULL,
  `KeywordText` varchar(255) NOT NULL,
  `NormalizedText` varchar(255) NOT NULL,
  `OfficerID` int(11) DEFAULT NULL,
  `HitCount` int(11) DEFAULT 0,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `KeywordSynonyms`
--

CREATE TABLE `KeywordSynonyms` (
  `SynonymID` int(11) NOT NULL,
  `InputWord` varchar(255) NOT NULL,
  `TargetKeywordID` int(11) NOT NULL,
  `SimilarityScore` decimal(3,2) NOT NULL DEFAULT 0.80,
  `RoleDescription` varchar(100) DEFAULT 'คำพ้อง',
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `NegativeKeywords`
--

CREATE TABLE `NegativeKeywords` (
  `NegativeKeywordID` int(11) NOT NULL,
  `Word` varchar(100) NOT NULL,
  `WeightModifier` float NOT NULL DEFAULT -1,
  `Description` varchar(255) DEFAULT NULL,
  `IsActive` tinyint(1) NOT NULL DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Officers`
--

CREATE TABLE `Officers` (
  `OfficerID` int(11) NOT NULL,
  `OfficerName` varchar(255) DEFAULT NULL,
  `Email` varchar(255) DEFAULT NULL,
  `Role` varchar(100) DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `OrgID` int(11) DEFAULT NULL,
  `OfficerPhone` varchar(64) DEFAULT NULL,
  `OfficerPassword` varchar(255) DEFAULT NULL,
  `AdminUserID` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `Officers`
--

INSERT INTO `Officers` (`OfficerID`, `OfficerName`, `Email`, `Role`, `CreatedAt`, `UpdatedAt`, `OrgID`, `OfficerPhone`, `OfficerPassword`, `AdminUserID`) VALUES
(3001, 'นางสาววิพาดา…', 'st651102064124@pcru.ac.th', '1', '2025-12-21 13:57:56', '2025-12-22 00:20:27', 2, '811112222', '12345678A', 1001),
(3002, 'นางสาวดวงใจ ปรีดา', 'fawfwafwa@gmail.com', '1', '2025-12-21 13:57:56', '2025-12-22 00:19:08', 2, '823334444', '$2b$10$TrTSp0ohS7pWzq1nFiLPDe7wlyxILzOHGLx0mR5AjkXegDr1kn/ZO', 1001),
(3003, 'นายภาคภูมิ ภูมิใจ', 'Pakpoom.p@org.com', '1', '2025-12-21 13:57:56', '2025-12-22 00:19:11', 2, '835556666', '$2b$10$9vYqjm2YxHprCFADbWypUuKlh30UEZwq50JPFvc24R.w76RUKHjcG', 1001),
(3004, 'นางสาววิมลรัตน์ ฤกษ์สันต์', 'Wimomrat.s@org.com', '1', '2025-12-21 13:57:56', '2025-12-22 00:19:44', 1, '847778888', '$2b$10$Zm5fJbk2PvcUBFpdhBrES.23NUEk/T3UB.stHCwFknlVY.DJmrnsO', 1001),
(3005, 'นายเฉลิมชัย โชคดี', 'Chalermchai.c@org.com', '0', '2025-12-21 13:57:56', '2025-12-22 00:19:18', 1, '859990000', '$2b$10$84x.Wm21sBWU9jQJ/yPka.WscvrHr1obZanH/T1Om7XcTbMif1Ngy', 1001);

-- --------------------------------------------------------

--
-- Table structure for table `Organizations`
--

CREATE TABLE `Organizations` (
  `OrgID` int(11) NOT NULL,
  `OrgName` varchar(255) NOT NULL,
  `OrgDescription` text DEFAULT NULL,
  `AdminUserID` int(11) DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `Organizations`
--

INSERT INTO `Organizations` (`OrgID`, `OrgName`, `OrgDescription`, `AdminUserID`, `CreatedAt`, `UpdatedAt`) VALUES
(1, 'สำนักส่งเสริมวิชาการและงานทะเบียน', 'ดูแลการเรียนการสอนและงานทะเบียนทั้งหมด', 1002, '2025-12-21 13:57:56', '2025-12-21 14:08:44'),
(2, 'กองพัฒนานักศึกษา', 'ดูแลกิจกรรม สวัสดิการ ทุน และวินัยนักศึกษา', 1002, '2025-12-21 13:57:56', '2025-12-22 00:17:48');

-- --------------------------------------------------------

--
-- Table structure for table `QuestionsAnswers`
--

CREATE TABLE `QuestionsAnswers` (
  `QuestionsAnswersID` int(11) NOT NULL,
  `QuestionTitle` varchar(255) NOT NULL,
  `QuestionText` text NOT NULL,
  `CategoriesID` varchar(50) DEFAULT NULL,
  `ReviewDate` date DEFAULT NULL,
  `OfficerID` int(11) DEFAULT NULL,
  `IsActive` tinyint(1) DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `Stopwords`
--

CREATE TABLE `Stopwords` (
  `StopwordID` int(11) NOT NULL,
  `StopwordText` varchar(100) NOT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `Stopwords`
--

INSERT INTO `Stopwords` (`StopwordID`, `StopwordText`, `CreatedAt`, `UpdatedAt`) VALUES
(1, 'และ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(2, 'หรือ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(3, 'แต่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(4, 'แล้ว', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(5, 'ก็', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(6, 'จึง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(7, 'ดังนั้น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(8, 'เพราะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(9, 'เนื่องจาก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(10, 'เพื่อ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(11, 'โดย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(12, 'ซึ่ง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(13, 'อัน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(14, 'ที่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(15, 'ว่า', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(16, 'คือ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(17, 'ครับ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(18, 'ค่ะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(19, 'จ้า', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(20, 'จ๊ะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(21, 'นะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(22, 'ละ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(23, 'หรอ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(24, 'เหรอ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(25, 'หนอ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(26, 'เถิด', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(27, 'เถอะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(28, 'สิ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(29, 'ซิ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(30, 'เป็น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(31, 'มี', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(32, 'ได้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(33, 'อยู่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(34, 'ไป', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(35, 'มา', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(36, 'ให้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(37, 'ถึง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(38, 'จาก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(39, 'กับ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(40, 'แก่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(41, 'แด่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(42, 'ของ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(43, 'ใน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(44, 'ไม่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(45, 'ไม่ได้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(46, 'ไม่ใช่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(47, 'มิ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(48, 'มิได้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(49, 'อะไร', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(50, 'ไหน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(51, 'เมื่อไร', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(52, 'อย่างไร', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(53, 'ทำไม', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(54, 'ใช่ไหม', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(55, 'นี้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(56, 'นั้น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(57, 'โน้น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(58, 'เหล่านี้', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(59, 'เหล่านั้น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(60, 'ฉัน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(61, 'ผม', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(62, 'ดิฉัน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(63, 'เรา', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(64, 'เขา', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(65, 'เธอ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(66, 'มัน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(67, 'ท่าน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(68, 'คุณ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(69, 'ทุก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(70, 'หลาย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(71, 'บาง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(72, 'บางส่วน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(73, 'ทั้ง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(74, 'ทั้งหมด', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(75, 'ส่วนใหญ่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(76, 'แต่ละ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(77, 'อีก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(78, 'อื่น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(79, 'อื่นๆ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(80, 'ไปยัง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(81, 'ต่อ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(82, 'เกี่ยวกับ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(83, 'ระหว่าง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(84, 'ตาม', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(85, 'ตั้งแต่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(86, 'จนถึง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(87, 'ภายใน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(88, 'ภายนอก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(89, 'ข้างใน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(90, 'ข้างนอก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(91, 'กำลัง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(92, 'อยาก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(93, 'ต้อง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(94, 'ควร', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(95, 'ต้องการ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(96, 'จำเป็น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(97, 'เคย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(98, 'เมื่อ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(99, 'ตอน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(100, 'ขณะ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(101, 'เวลา', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(102, 'ครั้ง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(103, 'คราว', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(104, 'มาก', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(105, 'น้อย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(106, 'เล็กน้อย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(107, 'ค่อนข้าง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(108, 'ค่อย', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(109, 'ยิ่ง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(110, 'เกิน', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(111, 'พอ', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(112, 'เพียง', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(113, 'แค่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(114, 'เท่านั้น', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(115, 'เพียงแต่', '2025-12-21 13:40:29', '2025-12-21 13:40:29'),
(116, 'เลย', '2025-12-21 13:40:29', '2025-12-21 13:40:29');

-- --------------------------------------------------------

--
-- Table structure for table `SuggestedIntentHints`
--

CREATE TABLE `SuggestedIntentHints` (
  `ID` int(11) NOT NULL,
  `QuestionsAnswersID` int(11) DEFAULT NULL,
  `IntentType` varchar(50) NOT NULL,
  `HintText` varchar(100) NOT NULL,
  `Confidence` decimal(5,4) DEFAULT 0.0000,
  `Occurrences` int(11) DEFAULT 1,
  `Source` varchar(50) DEFAULT 'background',
  `Status` enum('pending','approved','rejected') DEFAULT 'pending',
  `Meta` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`Meta`)),
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `SuggestedThaiWordPatterns`
--

CREATE TABLE `SuggestedThaiWordPatterns` (
  `ID` int(11) NOT NULL,
  `Word` varchar(255) NOT NULL,
  `SuggestedType` varchar(50) DEFAULT 'general',
  `Frequency` int(11) DEFAULT 1,
  `SuccessCount` int(11) DEFAULT 0,
  `TotalAttempts` int(11) DEFAULT 0,
  `AvgConfidence` decimal(5,4) DEFAULT 0.0000,
  `SuccessRate` decimal(5,2) DEFAULT 0.00,
  `Status` enum('pending','approved','rejected','expired') DEFAULT 'pending',
  `FirstSeen` datetime DEFAULT current_timestamp(),
  `LastSeen` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `CreatedAt` datetime DEFAULT current_timestamp(),
  `UpdatedAt` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ThaiWordPatternConfig`
--

CREATE TABLE `ThaiWordPatternConfig` (
  `ConfigKey` varchar(100) NOT NULL,
  `ConfigValue` text NOT NULL,
  `Description` text DEFAULT NULL,
  `UpdatedAt` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `AdminUsers`
--
ALTER TABLE `AdminUsers`
  ADD PRIMARY KEY (`AdminUserID`),
  ADD UNIQUE KEY `AdminEmail` (`AdminEmail`);

--
-- Indexes for table `AnswersKeywords`
--
ALTER TABLE `AnswersKeywords`
  ADD PRIMARY KEY (`ID`),
  ADD UNIQUE KEY `uq_qa_keyword` (`QuestionsAnswersID`,`KeywordID`),
  ADD KEY `idx_keywordid` (`KeywordID`);

--
-- Indexes for table `Categories`
--
ALTER TABLE `Categories`
  ADD PRIMARY KEY (`CategoriesID`),
  ADD KEY `idx_parent` (`ParentCategoriesID`),
  ADD KEY `idx_parentcategoriesid` (`ParentCategoriesID`),
  ADD KEY `idx_officerid` (`OfficerID`);

--
-- Indexes for table `ChatLogHasAnswers`
--
ALTER TABLE `ChatLogHasAnswers`
  ADD PRIMARY KEY (`ChatLogID`),
  ADD KEY `idx_questionsanswers` (`QuestionsAnswersID`),
  ADD KEY `idx_timestamp` (`Timestamp`);

--
-- Indexes for table `ChatLogNoAnswers`
--
ALTER TABLE `ChatLogNoAnswers`
  ADD PRIMARY KEY (`ChatLogID`),
  ADD KEY `idx_timestamp` (`Timestamp`);

--
-- Indexes for table `Feedbacks`
--
ALTER TABLE `Feedbacks`
  ADD PRIMARY KEY (`FeedbackID`),
  ADD KEY `fk_feedback_chatlog` (`ChatLogID`);

--
-- Indexes for table `IntentDomainTerms`
--
ALTER TABLE `IntentDomainTerms`
  ADD PRIMARY KEY (`TermID`),
  ADD UNIQUE KEY `uniq_term_domain` (`Term`,`Domain`);

--
-- Indexes for table `IntentHints`
--
ALTER TABLE `IntentHints`
  ADD PRIMARY KEY (`HintID`),
  ADD UNIQUE KEY `uniq_hint_intent` (`HintText`,`IntentType`);

--
-- Indexes for table `Keywords`
--
ALTER TABLE `Keywords`
  ADD PRIMARY KEY (`KeywordID`),
  ADD UNIQUE KEY `uniq_normalizedtext` (`NormalizedText`),
  ADD KEY `idx_keywordtext` (`KeywordText`),
  ADD KEY `idx_officer` (`OfficerID`),
  ADD KEY `idx_officerid` (`OfficerID`);

--
-- Indexes for table `KeywordSynonyms`
--
ALTER TABLE `KeywordSynonyms`
  ADD PRIMARY KEY (`SynonymID`),
  ADD UNIQUE KEY `unique_input_target` (`InputWord`,`TargetKeywordID`),
  ADD KEY `idx_input_word` (`InputWord`),
  ADD KEY `idx_target_keyword` (`TargetKeywordID`),
  ADD KEY `idx_similarity_score` (`SimilarityScore`),
  ADD KEY `idx_is_active` (`IsActive`);

--
-- Indexes for table `NegativeKeywords`
--
ALTER TABLE `NegativeKeywords`
  ADD PRIMARY KEY (`NegativeKeywordID`),
  ADD UNIQUE KEY `Word` (`Word`),
  ADD KEY `idx_word` (`Word`),
  ADD KEY `idx_active` (`IsActive`);

--
-- Indexes for table `Officers`
--
ALTER TABLE `Officers`
  ADD PRIMARY KEY (`OfficerID`),
  ADD KEY `idx_orgid` (`OrgID`),
  ADD KEY `idx_adminuserid` (`AdminUserID`);

--
-- Indexes for table `Organizations`
--
ALTER TABLE `Organizations`
  ADD PRIMARY KEY (`OrgID`),
  ADD UNIQUE KEY `OrgName` (`OrgName`),
  ADD KEY `idx_adminuserid` (`AdminUserID`);

--
-- Indexes for table `QuestionsAnswers`
--
ALTER TABLE `QuestionsAnswers`
  ADD PRIMARY KEY (`QuestionsAnswersID`),
  ADD KEY `idx_categories` (`CategoriesID`),
  ADD KEY `idx_officer_qa` (`OfficerID`),
  ADD KEY `idx_officerid` (`OfficerID`);

--
-- Indexes for table `Stopwords`
--
ALTER TABLE `Stopwords`
  ADD PRIMARY KEY (`StopwordID`),
  ADD UNIQUE KEY `StopwordText` (`StopwordText`),
  ADD KEY `idx_stopword_text` (`StopwordText`);

--
-- Indexes for table `SuggestedIntentHints`
--
ALTER TABLE `SuggestedIntentHints`
  ADD PRIMARY KEY (`ID`),
  ADD UNIQUE KEY `uq_suggest_qahint` (`QuestionsAnswersID`,`IntentType`,`HintText`),
  ADD KEY `idx_status` (`Status`),
  ADD KEY `idx_qaid` (`QuestionsAnswersID`),
  ADD KEY `idx_questionsanswersid` (`QuestionsAnswersID`);

--
-- Indexes for table `SuggestedThaiWordPatterns`
--
ALTER TABLE `SuggestedThaiWordPatterns`
  ADD PRIMARY KEY (`ID`),
  ADD UNIQUE KEY `Word` (`Word`),
  ADD KEY `idx_word` (`Word`),
  ADD KEY `idx_status` (`Status`),
  ADD KEY `idx_frequency` (`Frequency`),
  ADD KEY `idx_avg_confidence` (`AvgConfidence`),
  ADD KEY `idx_last_seen` (`LastSeen`);

--
-- Indexes for table `ThaiWordPatternConfig`
--
ALTER TABLE `ThaiWordPatternConfig`
  ADD PRIMARY KEY (`ConfigKey`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `AdminUsers`
--
ALTER TABLE `AdminUsers`
  MODIFY `AdminUserID` int(3) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1003;

--
-- AUTO_INCREMENT for table `AnswersKeywords`
--
ALTER TABLE `AnswersKeywords`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=259;

--
-- AUTO_INCREMENT for table `ChatLogHasAnswers`
--
ALTER TABLE `ChatLogHasAnswers`
  MODIFY `ChatLogID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `ChatLogNoAnswers`
--
ALTER TABLE `ChatLogNoAnswers`
  MODIFY `ChatLogID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `Feedbacks`
--
ALTER TABLE `Feedbacks`
  MODIFY `FeedbackID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `IntentDomainTerms`
--
ALTER TABLE `IntentDomainTerms`
  MODIFY `TermID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `IntentHints`
--
ALTER TABLE `IntentHints`
  MODIFY `HintID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Keywords`
--
ALTER TABLE `Keywords`
  MODIFY `KeywordID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=49;

--
-- AUTO_INCREMENT for table `KeywordSynonyms`
--
ALTER TABLE `KeywordSynonyms`
  MODIFY `SynonymID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `NegativeKeywords`
--
ALTER TABLE `NegativeKeywords`
  MODIFY `NegativeKeywordID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `Officers`
--
ALTER TABLE `Officers`
  MODIFY `OfficerID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3006;

--
-- AUTO_INCREMENT for table `Organizations`
--
ALTER TABLE `Organizations`
  MODIFY `OrgID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `QuestionsAnswers`
--
ALTER TABLE `QuestionsAnswers`
  MODIFY `QuestionsAnswersID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- AUTO_INCREMENT for table `Stopwords`
--
ALTER TABLE `Stopwords`
  MODIFY `StopwordID` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=147;

--
-- AUTO_INCREMENT for table `SuggestedIntentHints`
--
ALTER TABLE `SuggestedIntentHints`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `SuggestedThaiWordPatterns`
--
ALTER TABLE `SuggestedThaiWordPatterns`
  MODIFY `ID` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `AnswersKeywords`
--
ALTER TABLE `AnswersKeywords`
  ADD CONSTRAINT `fk_ak_keyword` FOREIGN KEY (`KeywordID`) REFERENCES `Keywords` (`KeywordID`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_ak_qa` FOREIGN KEY (`QuestionsAnswersID`) REFERENCES `QuestionsAnswers` (`QuestionsAnswersID`) ON DELETE CASCADE;

--
-- Constraints for table `Categories`
--
ALTER TABLE `Categories`
  ADD CONSTRAINT `fk_categories_officer` FOREIGN KEY (`OfficerID`) REFERENCES `Officers` (`OfficerID`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_categories_parent` FOREIGN KEY (`ParentCategoriesID`) REFERENCES `Categories` (`CategoriesID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `ChatLogHasAnswers`
--
ALTER TABLE `ChatLogHasAnswers`
  ADD CONSTRAINT `fk_cl_qa` FOREIGN KEY (`QuestionsAnswersID`) REFERENCES `QuestionsAnswers` (`QuestionsAnswersID`) ON DELETE SET NULL;

--
-- Constraints for table `Feedbacks`
--
ALTER TABLE `Feedbacks`
  ADD CONSTRAINT `fk_feedback_chatlog` FOREIGN KEY (`ChatLogID`) REFERENCES `ChatLogHasAnswers` (`ChatLogID`) ON DELETE CASCADE;

--
-- Constraints for table `Keywords`
--
ALTER TABLE `Keywords`
  ADD CONSTRAINT `fk_keywords_officer` FOREIGN KEY (`OfficerID`) REFERENCES `Officers` (`OfficerID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `KeywordSynonyms`
--
ALTER TABLE `KeywordSynonyms`
  ADD CONSTRAINT `fk_synonym_target_keyword` FOREIGN KEY (`TargetKeywordID`) REFERENCES `Keywords` (`KeywordID`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `Officers`
--
ALTER TABLE `Officers`
  ADD CONSTRAINT `fk_officers_org` FOREIGN KEY (`OrgID`) REFERENCES `Organizations` (`OrgID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `Organizations`
--
ALTER TABLE `Organizations`
  ADD CONSTRAINT `fk_org_adminuser` FOREIGN KEY (`AdminUserID`) REFERENCES `AdminUsers` (`AdminUserID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `QuestionsAnswers`
--
ALTER TABLE `QuestionsAnswers`
  ADD CONSTRAINT `fk_qa_categories` FOREIGN KEY (`CategoriesID`) REFERENCES `Categories` (`CategoriesID`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_qa_officer` FOREIGN KEY (`OfficerID`) REFERENCES `Officers` (`OfficerID`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `SuggestedIntentHints`
--
ALTER TABLE `SuggestedIntentHints`
  ADD CONSTRAINT `fk_suggestedhint_qa` FOREIGN KEY (`QuestionsAnswersID`) REFERENCES `QuestionsAnswers` (`QuestionsAnswersID`) ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
