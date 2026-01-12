const mysql = require('mysql2/promise');
const fs = require('fs');
require('dotenv').config();

async function run() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  
  const sql = `CREATE TABLE IF NOT EXISTS GoogleOAuth (
    GoogleOAuthID int(11) NOT NULL AUTO_INCREMENT,
    GoogleID varchar(255) NOT NULL,
    GoogleEmail varchar(255) NOT NULL,
    GoogleName varchar(255) DEFAULT NULL,
    GooglePicture varchar(512) DEFAULT NULL,
    UserType ENUM('admin', 'officer') NOT NULL,
    AdminUserID int(3) DEFAULT NULL,
    OfficerID int(11) DEFAULT NULL,
    IsActive tinyint(1) NOT NULL DEFAULT 1,
    CreatedAt timestamp NOT NULL DEFAULT current_timestamp(),
    UpdatedAt timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (GoogleOAuthID),
    UNIQUE KEY uk_google_id (GoogleID),
    UNIQUE KEY uk_admin_user (AdminUserID),
    UNIQUE KEY uk_officer (OfficerID),
    KEY idx_google_email (GoogleEmail),
    CONSTRAINT fk_google_oauth_admin FOREIGN KEY (AdminUserID) REFERENCES AdminUsers (AdminUserID) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_google_oauth_officer FOREIGN KEY (OfficerID) REFERENCES Officers (OfficerID) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  
  try {
    await pool.query(sql);
    console.log('✅ GoogleOAuth table created successfully!');
  } catch(e) {
    if (e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('ℹ️ Table already exists');
    } else {
      console.error('Error:', e.message);
    }
  }
  
  await pool.end();
}

run();
