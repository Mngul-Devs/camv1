-- Migration 001: Widen zones.name from VARCHAR(255) to TEXT
-- Required because __campark_meta__ sentinel blobs can exceed 255 characters.
-- Safe to run on a live PostgreSQL database.

ALTER TABLE zones ALTER COLUMN name TYPE TEXT;

-- Verify
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'zones' AND column_name = 'name';
