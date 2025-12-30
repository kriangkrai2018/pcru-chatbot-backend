-- Migration: Create NegativeKeywords_Ignored table
-- Created: 2025-12-30

-- ตารางเก็บคำที่ User สั่งลบ (Blacklist สำหรับ Auto-add)
CREATE TABLE IF NOT EXISTS NegativeKeywords_Ignored (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Word VARCHAR(255) NOT NULL UNIQUE,
    DeletedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: ensure NegativeKeywords exists
CREATE TABLE IF NOT EXISTS NegativeKeywords (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    Word VARCHAR(255) NOT NULL UNIQUE,
    WeightModifier DECIMAL(5,2) DEFAULT -1.0,
    IsActive TINYINT(1) DEFAULT 1
);