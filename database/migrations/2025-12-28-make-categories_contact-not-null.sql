-- Migration: Make Categories_Contact.Contact NOT NULL
-- 2025-12-28

-- 1) Convert any existing NULL Contact values to empty string
UPDATE Categories_Contact
SET Contact = ''
WHERE Contact IS NULL;

-- 2) Ensure Contact column does not allow NULLs going forward.
-- If the column is TEXT, MySQL does not allow a DEFAULT for TEXT — so we only set NOT NULL.
-- If you'd prefer a VARCHAR with a default empty string, change the type below.

ALTER TABLE Categories_Contact
  MODIFY Contact TEXT NOT NULL;

-- Optional (uncomment to switch to VARCHAR if you prefer):
-- ALTER TABLE Categories_Contact
--   MODIFY Contact VARCHAR(2000) NOT NULL DEFAULT '';

-- Note: Run this migration on your MySQL server (example):
-- mysql -u <user> -p <database> < 2025-12-28-make-categories_contact-not-null.sql
