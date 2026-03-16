"""
LAPI over WebSocket handler for Uniarch / Uniview / Dahua IPC cameras.

Ported from the Java AlarmSubscription demo (V5.05 protocol).

Flow:
  1. Camera connects to our WebSocket server
  2. Camera sends HTTP-like registration request (first message)
  3. We reply with 401 + Nonce (challenge)
  4. Camera sends second registration with HMAC-SHA256 Sign
  5. We verify, reply 200 (registered)
  6. Camera sends keepalive pings, we reply with keepalive responses
  7. We send subscription request for alarm events
  8. Camera pushes event notifications (with snapshot data)
  9. We save snapshot images to the FTP ingest path for the worker to pick up
"""

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import random
import string
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import websockets
from websockets.server import WebSocketServerProtocol

log = logging.getLogger("ingestion.lapi_ws")

# LAPI constants
NONCE_LENGTH = 32
LAPI_TIMEOUT = 10
KEEPALIVE_TIMEOUT = 60

# Subscription types
SUBSCRIBE_TYPE_ALL = 0       # Subscribe all events
SUBSCRIBE_TYPE_ALARM = 1
SUBSCRIBE_TYPE_EXCEPTION = 3


def _generate_nonce(length: int = NONCE_LENGTH) -> str:
    """Generate random nonce for HMAC challenge."""
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))


def _hmac_sha256_sign(secret: str, vendor: str, device_type: str,
                      device_code: str, algorithm: str, nonce: str) -> str:
    """
    Compute HMAC-SHA256 signature per LAPI protocol.
    Message = "Vendor/DeviceType/DeviceCode/Algorithm/Nonce"
    """
    message = f"{vendor}/{device_type}/{device_code}/{algorithm}/{nonce}"
    sig = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return sig


class LapiCamera:
    """Represents a connected LAPI camera session."""

    def __init__(self, ws: WebSocketServerProtocol, secret: str,
                 camera_id: str, ingest_path: str):
        self.ws = ws
        self.secret = secret
        self.camera_id = camera_id
        self.ingest_path = ingest_path  # Where to drop snapshot JPGs

        self.registered = False
        self.device_code: Optional[str] = None
        self.device_type: Optional[str] = None
        self.vendor: Optional[str] = None
        self.nonce: Optional[str] = None
        self.subscription_id: Optional[str] = None
        self.cseq: int = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._keepalive_task: Optional[asyncio.Task] = None
        self._subscription_task: Optional[asyncio.Task] = None

    @property
    def incoming_dir(self) -> Path:
        p = Path(self.ingest_path) / self.camera_id / "incoming"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def next_cseq(self) -> int:
        self.cseq += 1
        return self.cseq

    # ---- Message building ----

    def _build_response(self, request_url: str, code: int,
                        code_str: str, cseq: int, data: Optional[dict] = None) -> str:
        msg = {
            "ResponseURL": request_url,
            "ResponseCode": code,
            "ResponseString": code_str,
            "Cseq": cseq,
        }
        if data is not None:
            msg["Data"] = data
        return json.dumps(msg)

    def _build_request(self, url: str, method: str, data: Optional[dict] = None) -> tuple[int, str]:
        cseq = self.next_cseq()
        msg = {
            "RequestURL": url,
            "Method": method,
            "Cseq": cseq,
        }
        if data is not None:
            msg["Data"] = data
        return cseq, json.dumps(msg)

    # ---- Registration (authentication) ----

    async def handle_registration(self, msg: dict) -> str:
        """
        Handle the two-step registration handshake.
        First request: reply 401 with Nonce challenge.
        Second request: verify HMAC sign, reply 200.
        """
        request_url = msg.get("RequestURL", "")
        cseq = msg.get("Cseq", 0)
        data = msg.get("Data", {})

        self.vendor = data.get("Vendor", "unknown")
        self.device_type = data.get("DeviceType", "IPC")
        self.device_code = data.get("DeviceCode", "unknown")

        sign = data.get("Sign")

        if not sign or not self.nonce:
            # First registration attempt → send 401 with nonce
            self.nonce = _generate_nonce()
            response_data = {
                "Nonce": self.nonce,
                "Algorithm": "HMAC-SHA256",
            }
            log.info("[%s] Registration step 1 — sending nonce challenge (device=%s)",
                     self.camera_id, self.device_code)
            return self._build_response(request_url, 401, "Not Authorized", cseq, response_data)
        else:
            # Second registration attempt → verify signature
            expected_sign = _hmac_sha256_sign(
                self.secret, self.vendor or "", self.device_type or "IPC",
                self.device_code or "", "HMAC-SHA256", self.nonce,
            )
            if sign.lower() == expected_sign.lower():
                self.registered = True
                log.info("[%s] Registration SUCCESS — device=%s vendor=%s",
                         self.camera_id, self.device_code, self.vendor)
                return self._build_response(request_url, 200, "Success", cseq)
            else:
                log.warning("[%s] Registration FAILED — signature mismatch (device=%s)",
                            self.camera_id, self.device_code)
                self.nonce = _generate_nonce()
                return self._build_response(
                    request_url, 401, "Not Authorized", cseq,
                    {"Nonce": self.nonce, "Algorithm": "HMAC-SHA256"},
                )

    # ---- Keepalive ----

    async def handle_keepalive(self, msg: dict) -> str:
        """Respond to camera keepalive with timestamp + timeout."""
        request_url = msg.get("RequestURL", "")
        cseq = msg.get("Cseq", 0)
        response_data = {
            "Timestamp": int(time.time()),
            "Timeout": KEEPALIVE_TIMEOUT,
        }
        log.debug("[%s] Keepalive from device", self.camera_id)
        return self._build_response(request_url, 200, "Success", cseq, response_data)

    # ---- Subscription management ----

    async def subscribe_alarms(self, duration: int = 300,
                               sub_type: int = SUBSCRIBE_TYPE_ALL):
        """Subscribe to alarm notifications from the camera."""
        if not self.registered:
            log.warning("[%s] Cannot subscribe — not registered yet", self.camera_id)
            return

        url = "/LAPI/V1.0/System/Event/Subscription"
        cseq, request_msg = self._build_request(url, "POST", {
            "Duration": duration,
            "Type": sub_type,
        })

        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[cseq] = future

        await self.ws.send(request_msg)
        log.info("[%s] Sent alarm subscription request (duration=%ds, type=%d)",
                 self.camera_id, duration, sub_type)

        try:
            response = await asyncio.wait_for(future, timeout=LAPI_TIMEOUT)
            if response.get("ResponseCode") == 200:
                data = response.get("Data", {})
                self.subscription_id = str(data.get("ID", ""))
                log.info("[%s] Subscription active — ID=%s",
                         self.camera_id, self.subscription_id)
                # Start refresh loop
                self._subscription_task = asyncio.create_task(
                    self._subscription_refresh_loop(url, duration)
                )
            else:
                log.warning("[%s] Subscription failed: %s",
                            self.camera_id, response)
        except asyncio.TimeoutError:
            log.error("[%s] Subscription request timed out", self.camera_id)
            self._pending.pop(cseq, None)

    async def _subscription_refresh_loop(self, url: str, duration: int):
        """Refresh subscription before it expires."""
        refresh_interval = max(duration - 30, 10)
        while True:
            await asyncio.sleep(refresh_interval)
            if not self.subscription_id:
                break
            try:
                cseq, request_msg = self._build_request(
                    f"{url}/{self.subscription_id}", "PUT",
                    {"Duration": duration},
                )
                future: asyncio.Future = asyncio.get_event_loop().create_future()
                self._pending[cseq] = future
                await self.ws.send(request_msg)
                response = await asyncio.wait_for(future, timeout=LAPI_TIMEOUT)
                if response.get("ResponseCode") == 200:
                    log.debug("[%s] Subscription refreshed", self.camera_id)
                else:
                    log.warning("[%s] Subscription refresh failed: %s",
                                self.camera_id, response)
            except (asyncio.TimeoutError, Exception) as exc:
                log.warning("[%s] Subscription refresh error: %s", self.camera_id, exc)

    # ---- Event notification handling ----

    async def handle_notification(self, msg: dict):
        """
        Handle alarm event notification pushed by the camera.
        Save any attached image data to the incoming directory.
        """
        request_url = msg.get("RequestURL", "")
        cseq = msg.get("Cseq", 0)
        data = msg.get("Data", {})

        event_type = data.get("EventType", "unknown")
        timestamp = data.get("Timestamp", int(time.time()))

        log.info("[%s] Event notification: type=%s ts=%s",
                 self.camera_id, event_type, timestamp)

        # Check for image data in the notification
        image_saved = False
        images = data.get("Images", data.get("ImageList", []))
        if isinstance(images, dict):
            images = [images]

        for i, img_item in enumerate(images):
            image_data = img_item.get("Data", img_item.get("ImageData", ""))
            if image_data:
                image_saved = self._save_image_data(
                    image_data, timestamp, event_type, i
                )

        # Also check for a single Image field
        if not image_saved and data.get("Image"):
            self._save_image_data(data["Image"], timestamp, event_type, 0)

        # Also handle raw binary snapshot if it follows
        if not image_saved and data.get("PicUrl"):
            log.info("[%s] Event has PicUrl=%s — snapshot may arrive separately",
                     self.camera_id, data["PicUrl"])

        # Reply to the notification
        response = self._build_response(request_url, 200, "Success", cseq)
        await self.ws.send(response)

    def _save_image_data(self, image_data: str, timestamp: int,
                         event_type: str, index: int) -> bool:
        """Decode base64 image data and save to incoming directory."""
        try:
            # Image data is typically base64 encoded
            if isinstance(image_data, str):
                # Strip data URI prefix if present
                if "," in image_data and image_data.startswith("data:"):
                    image_data = image_data.split(",", 1)[1]
                raw = base64.b64decode(image_data)
            elif isinstance(image_data, bytes):
                raw = image_data
            else:
                return False

            if len(raw) < 100:
                return False  # Too small to be a real image

            ts_str = datetime.fromtimestamp(timestamp).strftime("%Y%m%d_%H%M%S")
            filename = f"lapi_{ts_str}_{event_type}_{index}.jpg"
            dest = self.incoming_dir / filename

            with open(dest, "wb") as f:
                f.write(raw)

            log.info("[%s] Saved snapshot: %s (%d bytes)",
                     self.camera_id, filename, len(raw))
            return True
        except Exception as exc:
            log.warning("[%s] Failed to save image data: %s", self.camera_id, exc)
            return False

    # ---- Response handling ----

    def handle_response(self, msg: dict):
        """Handle a response to one of our requests (matched by Cseq)."""
        cseq = msg.get("Cseq")
        if cseq is not None and cseq in self._pending:
            future = self._pending.pop(cseq)
            if not future.done():
                future.set_result(msg)
        else:
            log.debug("[%s] Unmatched response Cseq=%s", self.camera_id, cseq)

    # ---- Main message dispatcher ----

    async def dispatch(self, raw_message: str):
        """Parse and dispatch an incoming WebSocket message."""
        try:
            msg = json.loads(raw_message)
        except json.JSONDecodeError:
            log.warning("[%s] Non-JSON message received: %s",
                        self.camera_id, raw_message[:200])
            return

        # Is it a response to one of our requests?
        if "ResponseURL" in msg or "ResponseCode" in msg:
            self.handle_response(msg)
            return

        request_url = msg.get("RequestURL", "")
        method = msg.get("Method", "")

        # Registration
        if "/LAPI/V1.0/System/Register" in request_url:
            reply = await self.handle_registration(msg)
            await self.ws.send(reply)
            if self.registered:
                # Auto-subscribe to alarms after successful registration
                asyncio.create_task(self.subscribe_alarms())
            return

        # Keepalive
        if "/LAPI/V1.0/System/KeepAlive" in request_url:
            reply = await self.handle_keepalive(msg)
            await self.ws.send(reply)
            return

        # Event Notification
        if "/LAPI/V1.0/System/Event/Notification" in request_url:
            await self.handle_notification(msg)
            return

        # Unknown request
        log.warning("[%s] Unknown LAPI request: %s %s",
                    self.camera_id, method, request_url)
        cseq = msg.get("Cseq", 0)
        reply = self._build_response(request_url, 200, "Success", cseq)
        await self.ws.send(reply)

    # ---- Binary frame handling ----

    async def handle_binary(self, data: bytes):
        """
        Handle binary WebSocket frame — typically a snapshot image
        pushed by the camera alongside an event.
        """
        if len(data) < 100:
            return

        ts_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"lapi_bin_{ts_str}.jpg"
        dest = self.incoming_dir / filename

        with open(dest, "wb") as f:
            f.write(data)

        log.info("[%s] Saved binary snapshot: %s (%d bytes)",
                 self.camera_id, filename, len(data))

    # ---- Cleanup ----

    def cleanup(self):
        if self._subscription_task and not self._subscription_task.done():
            self._subscription_task.cancel()
        for future in self._pending.values():
            if not future.done():
                future.cancel()
        self._pending.clear()


class LapiWebSocketServer:
    """
    WebSocket server that accepts connections from LAPI cameras.
    Each camera connects to this server (camera-initiated connection, ideal for 4G).
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8765,
                 camera_configs: Optional[dict] = None, ingest_path: str = "/data/ftp"):
        """
        Args:
            host: Bind address
            port: WebSocket listen port
            camera_configs: Dict mapping device_code → {camera_id, secret}
            ingest_path: Base path for saving incoming snapshots
        """
        self.host = host
        self.port = port
        self.camera_configs = camera_configs or {}
        self.ingest_path = ingest_path
        self.active_sessions: dict[str, LapiCamera] = {}
        self._server = None

    def add_camera(self, device_code: str, camera_id: str, secret: str):
        """Register a camera that's expected to connect."""
        self.camera_configs[device_code] = {
            "camera_id": camera_id,
            "secret": secret,
        }
        log.info("Registered LAPI camera: device_code=%s → camera_id=%s",
                 device_code, camera_id)

    async def _handle_connection(self, websocket: WebSocketServerProtocol, path: str = ""):
        """Handle a new WebSocket connection from a camera."""
        remote = websocket.remote_address
        log.info("New LAPI WebSocket connection from %s (path=%s)", remote, path)

        # We don't know which camera this is yet — create a temporary session
        # with a fallback config. It'll be identified during registration.
        temp_camera = LapiCamera(
            ws=websocket,
            secret="",  # Will be set during registration
            camera_id=f"unknown_{remote[0]}_{remote[1]}",
            ingest_path=self.ingest_path,
        )

        identified_camera: Optional[LapiCamera] = None

        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    target = identified_camera or temp_camera
                    await target.handle_binary(message)
                    continue

                # Try to identify the camera from registration data
                if not identified_camera:
                    try:
                        msg = json.loads(message)
                        if "/LAPI/V1.0/System/Register" in msg.get("RequestURL", ""):
                            device_code = msg.get("Data", {}).get("DeviceCode", "")
                            if device_code in self.camera_configs:
                                config = self.camera_configs[device_code]
                                identified_camera = LapiCamera(
                                    ws=websocket,
                                    secret=config["secret"],
                                    camera_id=config["camera_id"],
                                    ingest_path=self.ingest_path,
                                )
                                self.active_sessions[device_code] = identified_camera
                                log.info("Identified camera: device_code=%s → camera_id=%s",
                                         device_code, config["camera_id"])
                            else:
                                # Unknown device — accept with default secret
                                log.warning(
                                    "Unknown device_code=%s from %s — "
                                    "accepting with open registration (configure in admin!)",
                                    device_code, remote,
                                )
                                # Create a camera ID from the device code
                                fallback_id = f"LAPI_{device_code[-8:]}" if len(device_code) > 8 else f"LAPI_{device_code}"
                                identified_camera = LapiCamera(
                                    ws=websocket,
                                    secret="",  # No auth for unknown cameras
                                    camera_id=fallback_id,
                                    ingest_path=self.ingest_path,
                                )
                                identified_camera.registered = True  # Skip auth for discovery
                                self.active_sessions[device_code] = identified_camera
                    except json.JSONDecodeError:
                        pass

                target = identified_camera or temp_camera
                await target.dispatch(message)

        except websockets.exceptions.ConnectionClosed as exc:
            log.info("LAPI connection closed: %s (code=%s)", remote, exc.code)
        except Exception as exc:
            log.exception("LAPI connection error from %s: %s", remote, exc)
        finally:
            if identified_camera:
                identified_camera.cleanup()
                # Remove from active sessions
                for key, cam in list(self.active_sessions.items()):
                    if cam is identified_camera:
                        del self.active_sessions[key]
                        break
            temp_camera.cleanup()
            log.info("LAPI connection ended: %s", remote)

    async def start(self):
        """Start the WebSocket server."""
        self._server = await websockets.serve(
            self._handle_connection,
            self.host,
            self.port,
            max_size=10 * 1024 * 1024,  # 10MB max frame (for snapshot images)
            ping_interval=30,
            ping_timeout=10,
        )
        log.info("LAPI WebSocket server listening on ws://%s:%d", self.host, self.port)
        log.info("Registered %d camera(s): %s",
                 len(self.camera_configs),
                 list(self.camera_configs.keys()))

    async def stop(self):
        """Stop the WebSocket server."""
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        for cam in self.active_sessions.values():
            cam.cleanup()
        self.active_sessions.clear()
        log.info("LAPI WebSocket server stopped")
