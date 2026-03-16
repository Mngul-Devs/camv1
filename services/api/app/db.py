import os
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, scoped_session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://campark:changeme_poc@postgres:5432/campark",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = scoped_session(
    sessionmaker(bind=engine, autocommit=False, autoflush=False)
)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(255))
    location: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    latitude: Mapped[Optional[float]] = mapped_column(default=None)
    longitude: Mapped[Optional[float]] = mapped_column(default=None)
    city: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    camera_id: Mapped[str] = mapped_column(String(50))
    name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    brand: Mapped[Optional[str]] = mapped_column(String(100), default=None)
    model: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    ingest_protocol: Mapped[str] = mapped_column(String(30), default="ftp")
    ftp_username: Mapped[Optional[str]] = mapped_column(String(100), default=None)
    ftp_password_hash: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    connection_config: Mapped[Optional[str]] = mapped_column(Text, default=None)
    lapi_device_code: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    lapi_secret: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    lapi_ws_port: Mapped[Optional[int]] = mapped_column(default=None)
    last_snapshot_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    status: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    zone_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[Optional[str]] = mapped_column(Text, default=None)
    polygon_json: Mapped[str] = mapped_column(Text)
    capacity_units: Mapped[Optional[int]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class ZoneState(Base):
    __tablename__ = "zone_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    occupied_units: Mapped[Optional[int]] = mapped_column(default=None)
    available_units: Mapped[Optional[int]] = mapped_column(default=None)
    state: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    last_change_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class Snapshot(Base):
    __tablename__ = "snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    file_path: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    width: Mapped[Optional[int]] = mapped_column(default=None)
    height: Mapped[Optional[int]] = mapped_column(default=None)
    received_at: Mapped[datetime] = mapped_column()
    processed_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    decision_status: Mapped[Optional[str]] = mapped_column(String(30), default=None)
    skip_reason: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    scene_diff_value: Mapped[Optional[float]] = mapped_column(default=None)
    yolo_total_objects: Mapped[Optional[int]] = mapped_column(default=None)
    yolo_vehicle_objects: Mapped[Optional[int]] = mapped_column(default=None)
    evidence_image_path: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("snapshots.id"))
    class_name: Mapped[Optional[str]] = mapped_column("class", String(50), default=None)
    confidence: Mapped[Optional[float]] = mapped_column(default=None)
    bbox_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class ZoneEvent(Base):
    __tablename__ = "zone_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    snapshot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("snapshots.id"), default=None)
    old_state: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    new_state: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    old_units: Mapped[Optional[int]] = mapped_column(default=None)
    new_units: Mapped[Optional[int]] = mapped_column(default=None)
    event_type: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    details_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    triggered_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class SnapshotDecision(Base):
    __tablename__ = "snapshot_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    snapshot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("snapshots.id"), default=None)
    incoming_file_path: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    file_hash: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    decision_status: Mapped[str] = mapped_column(String(30))
    skip_reason: Mapped[Optional[str]] = mapped_column(String(50), default=None)
    scene_diff_value: Mapped[Optional[float]] = mapped_column(default=None)
    yolo_total_objects: Mapped[Optional[int]] = mapped_column(default=None)
    yolo_vehicle_objects: Mapped[Optional[int]] = mapped_column(default=None)
    zone_decision_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    evidence_image_path: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    error_message: Mapped[Optional[str]] = mapped_column(Text, default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class CameraHealthEvent(Base):
    __tablename__ = "camera_health_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    health_status: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    message: Mapped[Optional[str]] = mapped_column(Text, default=None)
    triggered_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class APIClient(Base):
    __tablename__ = "api_clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    api_key_hash: Mapped[str] = mapped_column(String(255))
    site_ids: Mapped[Optional[str]] = mapped_column(Text, default=None)
    scope: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    rate_limit_per_minute: Mapped[Optional[int]] = mapped_column(default=None)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class TokenLedger(Base):
    __tablename__ = "token_ledger"

    id: Mapped[int] = mapped_column(primary_key=True)
    api_client_id: Mapped[Optional[int]] = mapped_column(ForeignKey("api_clients.id"), default=None)
    endpoint: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    method: Mapped[Optional[str]] = mapped_column(String(10), default=None)
    status_code: Mapped[Optional[int]] = mapped_column(default=None)
    response_time_ms: Mapped[Optional[int]] = mapped_column(default=None)
    tokens_used: Mapped[Optional[int]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default="viewer")
    status: Mapped[str] = mapped_column(String(20), default="active")
    last_login_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class PushClient(Base):
    __tablename__ = "push_clients"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, default=None)
    config_json: Mapped[str] = mapped_column(Text)
    paused: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
    updated_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class IngestTelemetry(Base):
    __tablename__ = "ingest_telemetry"

    id: Mapped[int] = mapped_column(primary_key=True)
    camera_id: Mapped[int] = mapped_column(ForeignKey("cameras.id"))
    original_filename: Mapped[str] = mapped_column(Text)
    file_extension: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    detected_format: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(default=None)
    arrived_at: Mapped[datetime] = mapped_column()
    burst_group_id: Mapped[Optional[str]] = mapped_column(String(16), default=None)
    burst_rank: Mapped[Optional[int]] = mapped_column(default=None)
    burst_size: Mapped[Optional[int]] = mapped_column(default=None)
    created_at: Mapped[Optional[datetime]] = mapped_column(default=None)
