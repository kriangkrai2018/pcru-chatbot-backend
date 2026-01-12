-- ตารางสำหรับ Google OAuth Login
-- ใช้สำหรับผูกบัญชี Google กับ AdminUsers และ Officers

CREATE TABLE IF NOT EXISTS `GoogleOAuth` (
  `GoogleOAuthID` int(11) NOT NULL AUTO_INCREMENT,
  `GoogleID` varchar(255) NOT NULL COMMENT 'Google Account ID (sub)',
  `GoogleEmail` varchar(255) NOT NULL COMMENT 'Email จาก Google Account',
  `GoogleName` varchar(255) DEFAULT NULL COMMENT 'ชื่อจาก Google Account',
  `GooglePicture` varchar(512) DEFAULT NULL COMMENT 'รูปโปรไฟล์จาก Google',
  `UserType` ENUM('admin', 'officer') NOT NULL COMMENT 'ประเภทผู้ใช้ที่ผูกกับ Google',
  `AdminUserID` int(3) DEFAULT NULL COMMENT 'FK to AdminUsers (สำหรับ Super Admin, Admin)',
  `OfficerID` int(11) DEFAULT NULL COMMENT 'FK to Officers',
  `IsActive` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'สถานะการใช้งาน',
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`GoogleOAuthID`),
  UNIQUE KEY `uk_google_id` (`GoogleID`),
  UNIQUE KEY `uk_admin_user` (`AdminUserID`),
  UNIQUE KEY `uk_officer` (`OfficerID`),
  KEY `idx_google_email` (`GoogleEmail`),
  CONSTRAINT `fk_google_oauth_admin` FOREIGN KEY (`AdminUserID`) REFERENCES `AdminUsers` (`AdminUserID`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_google_oauth_officer` FOREIGN KEY (`OfficerID`) REFERENCES `Officers` (`OfficerID`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ตารางสำหรับ Google OAuth Login';

-- เพิ่ม CHECK constraint (MySQL 8.0+) เพื่อให้แน่ใจว่า AdminUserID หรือ OfficerID ต้องมีค่าอย่างน้อยหนึ่งอัน
-- สำหรับ MySQL เวอร์ชันต่ำกว่า 8.0 อาจต้องใช้ TRIGGER แทน
-- ALTER TABLE `GoogleOAuth` ADD CONSTRAINT `chk_user_id` CHECK (
--   (UserType = 'admin' AND AdminUserID IS NOT NULL AND OfficerID IS NULL) OR
--   (UserType = 'officer' AND OfficerID IS NOT NULL AND AdminUserID IS NULL)
-- );
