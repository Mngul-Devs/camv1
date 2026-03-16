"""
RTSP snapshot adapter — periodic frame grab from RTSP stream.

Used as a fallback for cameras that support RTSP but not FTP or LAPI.
Uses ffmpeg (subprocess) to grab a single frame, so no heavy OpenCV dependency.

This adapter is useful for:
- Cameras with only RTSP output
- Testing with RTSP simulators
- Any camera brand that supports RTSP (almost all IP cameras)
"""

import asyncio
import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger("ingestion.rtsp")


class RtspSnapshotAdapter:
    """Periodically grabs a frame from an RTSP stream and saves it as a JPEG."""

    def __init__(
        self,
        camera_id: str,
        rtsp_url: str,
        ingest_path: str = "/data/ftp",
        interval: float = 10.0,
        timeout: float = 10.0,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.ingest_path = ingest_path
        self.interval = interval
        self.timeout = timeout
        self.username = username
        self.password = password
        self._task: Optional[asyncio.Task] = None
        self._running = False

    @property
    def incoming_dir(self) -> Path:
        p = Path(self.ingest_path) / self.camera_id / "incoming"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def effective_url(self) -> str:
        """Build RTSP URL with credentials if provided."""
        if self.username and self.password and "://" in self.rtsp_url:
            scheme, rest = self.rtsp_url.split("://", 1)
            return f"{scheme}://{self.username}:{self.password}@{rest}"
        return self.rtsp_url

    def grab_snapshot(self) -> Optional[Path]:
        """
        Grab a single frame from the RTSP stream using ffmpeg.
        Returns the path to the saved JPEG, or None on failure.
        """
        ts_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"rtsp_{ts_str}.jpg"
        dest = self.incoming_dir / filename

        cmd = [
            "ffmpeg",
            "-rtsp_transport", "tcp",
            "-i", self.effective_url,
            "-frames:v", "1",
            "-q:v", "2",  # High quality JPEG
            "-y",
            str(dest),
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=self.timeout,
            )
            if result.returncode == 0 and dest.exists() and dest.stat().st_size > 100:
                log.info("[%s] RTSP snapshot saved: %s (%d bytes)",
                         self.camera_id, filename, dest.stat().st_size)
                return dest
            else:
                log.warning("[%s] RTSP ffmpeg failed (rc=%d): %s",
                            self.camera_id, result.returncode,
                            result.stderr.decode()[:200] if result.stderr else "")
                if dest.exists():
                    dest.unlink()
                return None
        except subprocess.TimeoutExpired:
            log.warning("[%s] RTSP snapshot timed out (%.1fs)", self.camera_id, self.timeout)
            return None
        except FileNotFoundError:
            log.error("[%s] ffmpeg not found — install ffmpeg to use RTSP adapter", self.camera_id)
            return None
        except Exception as exc:
            log.exception("[%s] RTSP snapshot error: %s", self.camera_id, exc)
            return None

    async def _poll_loop(self):
        """Async loop: grab snapshots at the configured interval."""
        log.info("[%s] RTSP polling started: url=%s interval=%.1fs",
                 self.camera_id, self.rtsp_url, self.interval)
        while self._running:
            try:
                # Run ffmpeg in a thread to avoid blocking the event loop
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self.grab_snapshot)
            except Exception as exc:
                log.exception("[%s] RTSP poll error: %s", self.camera_id, exc)
            await asyncio.sleep(self.interval)

    async def start(self):
        """Start the polling loop."""
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self):
        """Stop the polling loop."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("[%s] RTSP polling stopped", self.camera_id)


class HttpSnapshotAdapter:
    """
    HTTP snapshot adapter — periodic snapshot from camera's HTTP snapshot URL.

    Many cameras expose a snapshot endpoint like:
      http://IP/cgi-bin/snapshot.cgi
      http://IP/ISAPI/Streaming/channels/1/picture
      http://IP/snap.jpg

    This is the simplest adapter: just HTTP GET → save JPEG.
    """

    def __init__(
        self,
        camera_id: str,
        snapshot_url: str,
        ingest_path: str = "/data/ftp",
        interval: float = 10.0,
        timeout: float = 10.0,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.camera_id = camera_id
        self.snapshot_url = snapshot_url
        self.ingest_path = ingest_path
        self.interval = interval
        self.timeout = timeout
        self.username = username
        self.password = password
        self._task: Optional[asyncio.Task] = None
        self._running = False

    @property
    def incoming_dir(self) -> Path:
        p = Path(self.ingest_path) / self.camera_id / "incoming"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def grab_snapshot(self) -> Optional[Path]:
        """Grab snapshot via HTTP GET."""
        import requests
        from requests.auth import HTTPDigestAuth

        ts_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"http_{ts_str}.jpg"
        dest = self.incoming_dir / filename

        try:
            auth = None
            if self.username and self.password:
                auth = HTTPDigestAuth(self.username, self.password)

            resp = requests.get(
                self.snapshot_url,
                auth=auth,
                timeout=self.timeout,
                stream=True,
            )
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            if "image" not in content_type and len(resp.content) < 100:
                log.warning("[%s] HTTP snapshot not an image: %s",
                            self.camera_id, content_type)
                return None

            with open(dest, "wb") as f:
                f.write(resp.content)

            log.info("[%s] HTTP snapshot saved: %s (%d bytes)",
                     self.camera_id, filename, dest.stat().st_size)
            return dest
        except Exception as exc:
            log.warning("[%s] HTTP snapshot error: %s", self.camera_id, exc)
            if dest.exists():
                dest.unlink()
            return None

    async def _poll_loop(self):
        log.info("[%s] HTTP snapshot polling started: url=%s interval=%.1fs",
                 self.camera_id, self.snapshot_url, self.interval)
        while self._running:
            try:
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, self.grab_snapshot)
            except Exception as exc:
                log.exception("[%s] HTTP snapshot error: %s", self.camera_id, exc)
            await asyncio.sleep(self.interval)

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("[%s] HTTP snapshot polling stopped", self.camera_id)
