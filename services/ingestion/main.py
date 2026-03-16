"""
CamPark Ingestion Service — multi-protocol camera ingestion orchestrator.

Reads camera configurations from the database and starts the appropriate
ingestion adapter for each camera:

  - ftp       → No adapter needed (cameras push to FTP server directly)
  - lapi_ws   → LAPI WebSocket server (camera connects TO us, ideal for 4G)
  - rtsp      → RTSP snapshot polling (periodic ffmpeg grab)
  - http_snap → HTTP snapshot polling (periodic HTTP GET)
  - onvif     → Future: ONVIF event subscription

The FTP path remains the universal "drop zone" — all adapters save snapshots
to data/ftp/<camera_id>/incoming/, and the existing worker picks them up.

Architecture:
                          ┌─────────────────────────┐
  Dahua (FTP) ──FTP────►  │   FTP Server (pure-ftpd) │──┐
                          └─────────────────────────┘  │
                                                        │  data/ftp/<cam>/incoming/
  Uniarch (4G) ──WS───►  ┌─────────────────────────┐  │
                          │   LAPI WS Server         │──┤
                          └─────────────────────────┘  │     ┌────────────┐
                                                        ├────►│   Worker    │──► DB
  Any (RTSP) ◄──RTSP──   ┌─────────────────────────┐  │     │  (YOLO +   │
                          │   RTSP Snapshot Poller   │──┤     │  ZoneCls)  │
                          └─────────────────────────┘  │     └────────────┘
                                                        │
  Any (HTTP) ◄──HTTP──   ┌─────────────────────────┐  │
                          │   HTTP Snapshot Poller   │──┘
                          └─────────────────────────┘
"""

import asyncio
import json
import logging
import os
import signal
import sys
import time
from typing import Optional

from sqlalchemy import create_engine, String, Text, ForeignKey
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column,
    scoped_session, sessionmaker,
)
from datetime import datetime

from lapi_ws import LapiWebSocketServer
from rtsp_adapter import RtspSnapshotAdapter, HttpSnapshotAdapter

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("ingestion")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://campark:changeme_poc@postgres:5432/campark",
)
FTP_INGEST_PATH = os.getenv("FTP_INGEST_PATH", "/data/ftp")
LAPI_WS_HOST = os.getenv("LAPI_WS_HOST", "0.0.0.0")
LAPI_WS_PORT = int(os.getenv("LAPI_WS_PORT", "8765"))
RTSP_INTERVAL = float(os.getenv("RTSP_INTERVAL", "10.0"))
HTTP_SNAP_INTERVAL = float(os.getenv("HTTP_SNAP_INTERVAL", "10.0"))
DB_POLL_INTERVAL = float(os.getenv("DB_POLL_INTERVAL", "30.0"))

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = scoped_session(
    sessionmaker(bind=engine, autocommit=False, autoflush=False)
)


# Minimal ORM just for reading camera configs
class Base(DeclarativeBase):
    pass


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
    connection_config: Mapped[Optional[str]] = mapped_column(Text, default=None)
    lapi_device_code: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    lapi_secret: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    lapi_ws_port: Mapped[Optional[int]] = mapped_column(default=None)
    status: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(default=None)


class IngestionOrchestrator:
    """
    Reads camera configs from DB, starts appropriate adapters.
    Dynamically adds/removes adapters when cameras are added/removed in admin UI.
    """

    def __init__(self):
        self.lapi_server: Optional[LapiWebSocketServer] = None
        self.rtsp_adapters: dict[str, RtspSnapshotAdapter] = {}
        self.http_adapters: dict[str, HttpSnapshotAdapter] = {}
        self.known_cameras: dict[str, dict] = {}  # camera_id → config snapshot
        self._running = False

    def _load_cameras(self) -> list[Camera]:
        session = SessionLocal()
        try:
            return session.query(Camera).all()
        finally:
            session.close()

    def _update_camera_status(self, camera_id: str, status: str):
        """Update camera status in DB."""
        session = SessionLocal()
        try:
            cam = session.query(Camera).filter(Camera.camera_id == camera_id).first()
            if cam:
                cam.status = status
                cam.last_seen_at = datetime.utcnow()
                session.commit()
        except Exception as exc:
            session.rollback()
            log.warning("Failed to update status for %s: %s", camera_id, exc)
        finally:
            session.close()

    async def _setup_lapi_server(self, cameras: list[Camera]):
        """Initialize or update the LAPI WebSocket server with camera configs."""
        lapi_cameras = [c for c in cameras if c.ingest_protocol == "lapi_ws"]

        if not lapi_cameras and not self.lapi_server:
            return

        if not self.lapi_server:
            self.lapi_server = LapiWebSocketServer(
                host=LAPI_WS_HOST,
                port=LAPI_WS_PORT,
                ingest_path=FTP_INGEST_PATH,
            )
            await self.lapi_server.start()

        # Register/update cameras
        for cam in lapi_cameras:
            device_code = cam.lapi_device_code or cam.camera_id
            secret = cam.lapi_secret or ""
            # Use camera_id as the FTP directory name for the worker
            ingest_id = cam.ftp_username or cam.camera_id.lower()
            self.lapi_server.add_camera(device_code, ingest_id, secret)
            log.info("LAPI camera registered: %s (device=%s)", cam.camera_id, device_code)

    async def _setup_rtsp_adapters(self, cameras: list[Camera]):
        """Start/stop RTSP adapters based on camera configs."""
        rtsp_cameras = {c.camera_id: c for c in cameras if c.ingest_protocol == "rtsp"}

        # Stop adapters for removed cameras
        for cam_id in list(self.rtsp_adapters.keys()):
            if cam_id not in rtsp_cameras:
                await self.rtsp_adapters[cam_id].stop()
                del self.rtsp_adapters[cam_id]
                log.info("Stopped RTSP adapter for removed camera: %s", cam_id)

        # Start adapters for new cameras
        for cam_id, cam in rtsp_cameras.items():
            if cam_id in self.rtsp_adapters:
                continue

            config = {}
            if cam.connection_config:
                try:
                    config = json.loads(cam.connection_config)
                except json.JSONDecodeError:
                    log.warning("Invalid connection_config for %s", cam_id)
                    continue

            rtsp_url = config.get("rtsp_url")
            if not rtsp_url:
                log.warning("No rtsp_url in connection_config for %s", cam_id)
                continue

            ingest_id = cam.ftp_username or cam.camera_id.lower()
            adapter = RtspSnapshotAdapter(
                camera_id=ingest_id,
                rtsp_url=rtsp_url,
                ingest_path=FTP_INGEST_PATH,
                interval=config.get("interval", RTSP_INTERVAL),
                username=config.get("username"),
                password=config.get("password"),
            )
            self.rtsp_adapters[cam_id] = adapter
            await adapter.start()
            log.info("Started RTSP adapter for %s: %s", cam_id, rtsp_url)

    async def _setup_http_adapters(self, cameras: list[Camera]):
        """Start/stop HTTP snapshot adapters."""
        http_cameras = {c.camera_id: c for c in cameras if c.ingest_protocol == "http_snap"}

        for cam_id in list(self.http_adapters.keys()):
            if cam_id not in http_cameras:
                await self.http_adapters[cam_id].stop()
                del self.http_adapters[cam_id]

        for cam_id, cam in http_cameras.items():
            if cam_id in self.http_adapters:
                continue

            config = {}
            if cam.connection_config:
                try:
                    config = json.loads(cam.connection_config)
                except json.JSONDecodeError:
                    continue

            snapshot_url = config.get("snapshot_url")
            if not snapshot_url:
                log.warning("No snapshot_url in connection_config for %s", cam_id)
                continue

            ingest_id = cam.ftp_username or cam.camera_id.lower()
            adapter = HttpSnapshotAdapter(
                camera_id=ingest_id,
                snapshot_url=snapshot_url,
                ingest_path=FTP_INGEST_PATH,
                interval=config.get("interval", HTTP_SNAP_INTERVAL),
                username=config.get("username"),
                password=config.get("password"),
            )
            self.http_adapters[cam_id] = adapter
            await adapter.start()
            log.info("Started HTTP snapshot adapter for %s", cam_id)

    async def sync_cameras(self):
        """Read cameras from DB and sync adapter state."""
        try:
            cameras = self._load_cameras()
            log.info("Loaded %d cameras from DB", len(cameras))

            # Count by protocol
            by_proto = {}
            for cam in cameras:
                proto = cam.ingest_protocol or "ftp"
                by_proto[proto] = by_proto.get(proto, 0) + 1
            log.info("Camera protocols: %s", by_proto)

            await self._setup_lapi_server(cameras)
            await self._setup_rtsp_adapters(cameras)
            await self._setup_http_adapters(cameras)

        except Exception as exc:
            log.exception("Failed to sync cameras: %s", exc)

    async def run(self):
        """Main loop — sync cameras periodically."""
        self._running = True

        print("CamPark Ingestion Service started")
        log.info("Ingestion service starting — DB poll every %.1fs", DB_POLL_INTERVAL)
        log.info("FTP ingest path: %s", FTP_INGEST_PATH)
        log.info("LAPI WS listen: %s:%d", LAPI_WS_HOST, LAPI_WS_PORT)

        # Initial sync
        await self.sync_cameras()

        # Periodic re-sync to pick up new cameras
        while self._running:
            await asyncio.sleep(DB_POLL_INTERVAL)
            await self.sync_cameras()

    async def shutdown(self):
        """Graceful shutdown."""
        self._running = False
        log.info("Shutting down ingestion service...")

        if self.lapi_server:
            await self.lapi_server.stop()

        for adapter in self.rtsp_adapters.values():
            await adapter.stop()
        for adapter in self.http_adapters.values():
            await adapter.stop()

        log.info("Ingestion service stopped")


async def main():
    orchestrator = IngestionOrchestrator()

    loop = asyncio.get_event_loop()

    def handle_signal():
        asyncio.create_task(orchestrator.shutdown())

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    try:
        await orchestrator.run()
    except asyncio.CancelledError:
        pass
    finally:
        await orchestrator.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
