-- migrate_003_r2_hard_samples.sql
-- Adds R2 object storage columns to snapshots table.
-- Run once on existing deployments; safe to re-run (IF NOT EXISTS checks).
-- New deployments get these columns from init.sql automatically.

ALTER TABLE snapshots
    ADD COLUMN IF NOT EXISTS r2_key VARCHAR(512),
    ADD COLUMN IF NOT EXISTS r2_uploaded_at TIMESTAMP;

-- Index for querying unlabeled hard samples in Label Studio sync script
CREATE INDEX IF NOT EXISTS idx_snapshots_r2_key ON snapshots(r2_key)
    WHERE r2_key IS NOT NULL;
