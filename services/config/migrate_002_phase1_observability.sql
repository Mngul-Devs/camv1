-- Phase 1 observability migration
-- Safe to run multiple times

ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS decision_status VARCHAR(30);
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS skip_reason VARCHAR(50);
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS scene_diff_value FLOAT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS yolo_total_objects INT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS yolo_vehicle_objects INT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS evidence_image_path VARCHAR(255);

ALTER TABLE zone_events ADD COLUMN IF NOT EXISTS details_json TEXT;

CREATE TABLE IF NOT EXISTS snapshot_decisions (
    id SERIAL PRIMARY KEY,
    camera_id INT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    snapshot_id INT REFERENCES snapshots(id) ON DELETE SET NULL,
    incoming_file_path VARCHAR(255),
    file_hash VARCHAR(64),
    decision_status VARCHAR(30) NOT NULL,
    skip_reason VARCHAR(50),
    scene_diff_value FLOAT,
    yolo_total_objects INT,
    yolo_vehicle_objects INT,
    zone_decision_json TEXT,
    evidence_image_path VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshot_decisions_camera_id ON snapshot_decisions(camera_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_decisions_snapshot_id ON snapshot_decisions(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_decisions_created_at ON snapshot_decisions(created_at DESC);
