import hashlib
import json
import os
import secrets
import shutil
import subprocess
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import psutil

import requests
from typing import Optional, Tuple

from flask import Flask, jsonify, redirect, render_template, request, send_file, session, url_for
from flask.wrappers import Response
from sqlalchemy import text, func
from sqlalchemy.types import Numeric as db_Numeric

from app.db import (
    AdminUser,
    APIClient,
    Base,
    Camera,
    CameraHealthEvent,
    Detection,
    engine,
    IngestTelemetry,
    Project,
    PushClient,
    SessionLocal,
    Site,
    Snapshot,
    SnapshotDecision,
    SystemSetting,
    TokenLedger,
    Zone,
    ZoneEvent,
    ZoneState,
)

APP_VERSION = "0.1.0"
UNASSIGNED_SITE_NAME = "__unassigned__"   # sentinel: cameras whose site was deleted land here
IMAGE_ROOT = os.getenv("IMAGE_ROOT", "/data/images")
FTP_INGEST_PATH = os.getenv("FTP_INGEST_PATH", "/data/ftp")
HEALTH_INTERVAL_SECONDS = int(os.getenv("HEALTH_INTERVAL_SECONDS", "30"))
ENABLE_HEALTH_MONITOR = os.getenv("ENABLE_HEALTH_MONITOR", "true").lower() == "true"
STALE_SECONDS = int(os.getenv("STALE_SECONDS", "150"))
OFFLINE_SECONDS = int(os.getenv("OFFLINE_SECONDS", "300"))

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
REQUIRE_API_KEY = os.getenv("REQUIRE_API_KEY", "false").lower() == "true"
BASELINE_REPORT_PATH = os.getenv("BASELINE_REPORT_PATH", "/data/datasets/phase2_queue/baseline_report.json")

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme_poc")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "change-this-to-random-32-character-string")
app.permanent_session_lifetime = timedelta(hours=12)

# ── Ensure new tables exist (idempotent migration for existing DBs) ─────────
with engine.connect() as _conn:
    _conn.execute(text("""
        CREATE TABLE IF NOT EXISTS push_clients (
            id VARCHAR(32) PRIMARY KEY,
            project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            config_json TEXT NOT NULL,
            paused BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """))
    _conn.execute(text("CREATE INDEX IF NOT EXISTS idx_push_clients_project_id ON push_clients(project_id)"))
    _conn.commit()


def sync_ftp_users():
    """Write FTP user list from DB to shared JSON file for the FTP container.
    The FTP container watches this file and reloads users automatically."""
    try:
        s = SessionLocal()
        cameras = s.query(Camera).filter(
            Camera.ingest_protocol == "ftp",
            Camera.ftp_username.isnot(None),
            Camera.ftp_password_hash.isnot(None),
        ).all()
        users = []
        for c in cameras:
            users.append({
                "username": c.ftp_username,
                "password": c.ftp_password_hash,  # stored as plaintext for pure-ftpd
            })
        s.close()

        sync_path = os.path.join(FTP_INGEST_PATH, ".ftp_users.json")
        with open(sync_path, "w") as f:
            json.dump({"users": users, "updated_at": datetime.utcnow().isoformat()}, f)
        app.logger.info("FTP sync: wrote %d user(s) to %s", len(users), sync_path)
    except Exception as exc:
        app.logger.error("FTP sync failed: %s", exc)


# --------------- Session-based admin auth ---------------

def _ensure_bootstrap_admin():
    """Create the bootstrap admin user in DB if it doesn't exist yet."""
    s = SessionLocal()
    try:
        existing = s.query(AdminUser).filter_by(username=ADMIN_USERNAME).first()
        if not existing:
            pw_hash = hashlib.sha256(ADMIN_PASSWORD.encode()).hexdigest()
            s.add(AdminUser(
                username=ADMIN_USERNAME,
                password_hash=pw_hash,
                role="admin",
                status="active",
            ))
            s.commit()
            app.logger.info("Bootstrap admin user '%s' created", ADMIN_USERNAME)
    except Exception as exc:
        s.rollback()
        app.logger.warning("Bootstrap admin check failed: %s", exc)
    finally:
        s.close()


def _verify_login(username: str, password: str):
    """Verify credentials against admin_users table. Returns AdminUser or None."""
    s = SessionLocal()
    try:
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        user = s.query(AdminUser).filter_by(username=username, password_hash=pw_hash, status="active").first()
        if user:
            user.last_login_at = datetime.utcnow()
            s.commit()
            return {"id": user.id, "username": user.username, "role": user.role}
        # Fallback: env-var admin (if DB table doesn't exist yet)
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            return {"id": 0, "username": ADMIN_USERNAME, "role": "admin"}
        return None
    except Exception:
        # Table might not exist yet — fall back to env vars
        if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
            return {"id": 0, "username": ADMIN_USERNAME, "role": "admin"}
        return None
    finally:
        s.close()


@app.route("/login", methods=["GET", "POST"])
def login_page():
    """Render login form (GET) or authenticate (POST)."""
    if session.get("admin_logged_in"):
        return redirect("/admin/dashboard")
    error = None
    just_logged_out = request.args.get("logged_out") == "1"
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        user = _verify_login(username, password)
        if user:
            session["admin_logged_in"] = True
            session["admin_user"] = user["username"]
            session["admin_role"] = user["role"]
            session["admin_user_id"] = user["id"]
            session.permanent = True
            next_url = _safe_next_url(request.args.get("next", "/admin/dashboard"))
            return redirect(next_url)
        error = "Invalid username or password"
    return render_template("login.html", error=error, version=APP_VERSION, just_logged_out=just_logged_out)


@app.route("/logout")
def logout_page():
    session.clear()
    return redirect("/login?logged_out=1")


@app.before_request
def admin_auth_guard():
    """Require session login for all /admin/ routes."""
    # Allow public routes
    if request.path in ("/login", "/logout", "/health") or request.path.startswith("/static"):
        return None
    # API key-protected routes don't need session auth
    if not request.path.startswith("/admin"):
        return None
    if not session.get("admin_logged_in"):
        return redirect(url_for("login_page", next=request.path))


def to_iso(dt):
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def parse_iso(value):
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def _safe_next_url(next_url: Optional[str], default: str = "/login") -> str:
    if not next_url:
        return default
    parsed = urlparse(next_url)
    if parsed.scheme or parsed.netloc:
        return default
    if not next_url.startswith("/") or next_url.startswith("//"):
        return default
    return next_url


def _safe_image_path(relative_path: str) -> Optional[str]:
    try:
        clean_relative = os.path.normpath(relative_path).lstrip("/\\")
        image_root = os.path.realpath(IMAGE_ROOT)
        abs_path = os.path.realpath(os.path.join(image_root, clean_relative))
        if os.path.commonpath([image_root, abs_path]) != image_root:
            return None
        return abs_path
    except (TypeError, ValueError):
        return None


def _json_loads_safe(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _site_ids_from_client(client: APIClient) -> set[int]:
    raw_site_ids = _json_loads_safe(client.site_ids)
    if not isinstance(raw_site_ids, list):
        return set()
    return {int(sid) for sid in raw_site_ids if str(sid).isdigit()}


def send_telegram(message):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message}
    try:
        requests.post(url, json=payload, timeout=10)
    except requests.RequestException:
        pass


def hash_api_key(raw_key):
    return hashlib.sha256(raw_key.encode()).hexdigest()


def check_api_key(session) -> Tuple[Optional[Tuple[Response, int]], Optional[APIClient]]:
    """Returns (error_response, None) on failure, or (None, client_or_None) on success."""
    if not REQUIRE_API_KEY:
        return None, None
    raw_key = request.headers.get("X-API-Key")
    if not raw_key:
        return (jsonify({"error": "missing_api_key"}), 401), None
    key_hash = hash_api_key(raw_key)
    client = session.query(APIClient).filter(APIClient.api_key_hash == key_hash).first()
    if not client:
        return (jsonify({"error": "invalid_api_key"}), 401), None
    if request.method != "GET":
        return (jsonify({"error": "read_only"}), 403), None
    return None, client


def require_api_key(session):
    """Wrapper that returns (error_response_or_None, api_client_or_None).
    Callers should do: err, client = require_api_key(session); if err: return err
    """
    error, client = check_api_key(session)
    return error, client


def record_token(session, api_client, status_code, endpoint, response_time_ms, tokens_used=0):
    """Log API usage. tokens_used=0 for free tracking, N for occupancy charges (1 per car park/zone)."""
    if not api_client:
        return
    entry = TokenLedger(
        api_client_id=api_client.id,
        endpoint=endpoint,
        method=request.method,
        status_code=status_code,
        response_time_ms=response_time_ms,
        tokens_used=tokens_used,
        created_at=datetime.utcnow(),
    )
    session.add(entry)


def record_health_event(session, camera, status, message, resolved_at=None):
    event = CameraHealthEvent(
        camera_id=camera.id,
        health_status=status,
        message=message,
        triggered_at=datetime.utcnow(),
        resolved_at=resolved_at,
        created_at=datetime.utcnow(),
    )
    session.add(event)


def monitor_camera_health():
    while True:
        session = SessionLocal()
        try:
            now = datetime.utcnow()
            cameras = session.query(Camera).all()
            for camera in cameras:
                if camera.last_seen_at is None:
                    continue
                age_seconds = (now - camera.last_seen_at).total_seconds()
                if age_seconds > OFFLINE_SECONDS:
                    new_status = "OFFLINE"
                    message = f"Camera {camera.camera_id} OFFLINE (no data >{OFFLINE_SECONDS}s)"
                elif age_seconds > STALE_SECONDS:
                    new_status = "STALE"
                    message = f"Camera {camera.camera_id} STALE (no data >{STALE_SECONDS}s)"
                else:
                    new_status = "ONLINE"
                    message = f"Camera {camera.camera_id} ONLINE"

                if camera.status != new_status:
                    camera.status = new_status
                    record_health_event(session, camera, new_status, message)
                    send_telegram(message)
            session.commit()
        finally:
            session.close()
        time.sleep(HEALTH_INTERVAL_SECONDS)


@app.route("/")
def index():
    return redirect("/login")


@app.route("/health", methods=["GET"])
def health():
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
        return jsonify({"status": "ok", "version": APP_VERSION})
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 503
    finally:
        session.close()


@app.route("/api/v1/sites/<int:site_id>/status", methods=["GET"])
def site_status(site_id):  # type: ignore[return-value]
    session = SessionLocal()
    try:
        err, api_client = check_api_key(session)
        if err:
            return err
        start_time = time.time()
        site = session.query(Site).filter(Site.id == site_id).first()
        if not site:
            return jsonify({"error": "site_not_found"}), 404

        zones = (
            session.query(Zone, ZoneState)
            .join(ZoneState, ZoneState.zone_id == Zone.id)
            .join(Camera, Camera.id == Zone.camera_id)
            .filter(Camera.site_id == site_id)
            .all()
        )
        response_zones = []
        total_occupied = 0
        total_available = 0
        for zone, zone_state in zones:
            occupied = zone_state.occupied_units or 0
            available = zone_state.available_units
            if available is None:
                capacity = zone.capacity_units or 1
                available = max(capacity - occupied, 0)
            response_zones.append(
                {
                    "zone_id": zone.zone_id,
                    "state": zone_state.state or "FREE",
                    "occupied_units": occupied,
                    "available_units": available,
                }
            )
            total_occupied += occupied
            total_available += available

        # Charge 1 token per zone (car park) returned
        num_zones = len(response_zones)
        response = jsonify(
            {
                "site_id": site_id,
                "ts": to_iso(datetime.utcnow()),
                "zones": response_zones,
                "totals": {
                    "occupied_units": total_occupied,
                    "available_units": total_available,
                },
                "tokens_charged": num_zones,
            }
        )
        record_token(
            session,
            api_client,
            200,
            request.path,
            int((time.time() - start_time) * 1000),
            tokens_used=num_zones,
        )
        session.commit()
        return response
    finally:
        session.close()


@app.route("/api/v1/cameras/<string:camera_id>/status", methods=["GET"])
def camera_status(camera_id):  # type: ignore[return-value]
    session = SessionLocal()
    try:
        err, api_client = check_api_key(session)
        if err:
            return err
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        snapshot = (
            session.query(Snapshot)
            .filter(Snapshot.camera_id == camera.id)
            .order_by(Snapshot.received_at.desc())
            .first()
        )
        detections = []
        if snapshot:
            rows = (
                session.query(Detection)
                .filter(Detection.snapshot_id == snapshot.id)
                .all()
            )
            for row in rows:
                detections.append(
                    {
                        "class": row.class_name,
                        "confidence": row.confidence,
                        "bbox": json.loads(row.bbox_json) if row.bbox_json else None,
                    }
                )

        return jsonify(
            {
                "camera_id": camera.camera_id,
                "status": camera.status,
                "last_seen_at": to_iso(camera.last_seen_at),
                "last_snapshot_at": to_iso(camera.last_snapshot_at),
                "latest_snapshot": {
                    "id": snapshot.id if snapshot else None,
                    "received_at": to_iso(snapshot.received_at) if snapshot else None,
                    "file_path": snapshot.file_path if snapshot else None,
                    "decision_status": snapshot.decision_status if snapshot else None,
                    "skip_reason": snapshot.skip_reason if snapshot else None,
                    "scene_diff_value": snapshot.scene_diff_value if snapshot else None,
                    "yolo_total_objects": snapshot.yolo_total_objects if snapshot else None,
                    "yolo_vehicle_objects": snapshot.yolo_vehicle_objects if snapshot else None,
                    "evidence_image_path": snapshot.evidence_image_path if snapshot else None,
                },
                "detections": detections,
            }
        )
    finally:
        session.close()


@app.route("/api/v1/cameras/<string:camera_id>/health", methods=["GET"])
def camera_health(camera_id):  # type: ignore[return-value]
    session = SessionLocal()
    try:
        err, api_client = check_api_key(session)
        if err:
            return err
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404
        now = datetime.utcnow()
        age_seconds = None
        if camera.last_seen_at:
            age_seconds = (now - camera.last_seen_at).total_seconds()
        return jsonify(
            {
                "camera_id": camera.camera_id,
                "status": camera.status,
                "last_seen_at": to_iso(camera.last_seen_at),
                "age_seconds": age_seconds,
            }
        )
    finally:
        session.close()


@app.route("/api/v1/sites/<int:site_id>/events", methods=["GET"])
def site_events(site_id):  # type: ignore[return-value]
    session = SessionLocal()
    try:
        err, api_client = check_api_key(session)
        if err:
            return err
        start = parse_iso(request.args.get("from"))
        end = parse_iso(request.args.get("to"))
        query = (
            session.query(ZoneEvent, Zone, Camera)
            .join(Zone, Zone.id == ZoneEvent.zone_id)
            .join(Camera, Camera.id == Zone.camera_id)
            .filter(Camera.site_id == site_id)
            .order_by(ZoneEvent.triggered_at.desc())
        )
        if start:
            query = query.filter(ZoneEvent.triggered_at >= start)
        if end:
            query = query.filter(ZoneEvent.triggered_at <= end)

        events = []
        for event, zone, camera in query.limit(200).all():
            events.append(
                {
                    "event_id": event.id,
                    "zone_id": zone.zone_id,
                    "camera_id": camera.camera_id,
                    "snapshot_id": event.snapshot_id,
                    "event_type": event.event_type,
                    "old_state": event.old_state,
                    "new_state": event.new_state,
                    "old_units": event.old_units,
                    "new_units": event.new_units,
                    "triggered_at": to_iso(event.triggered_at),
                    "details": _json_loads_safe(event.details_json),
                }
            )

        return jsonify({"site_id": site_id, "events": events})
    finally:
        session.close()


@app.route("/api/v1/evidence/<int:event_id>", methods=["GET"])
def evidence(event_id):  # type: ignore[return-value]
    session = SessionLocal()
    try:
        err, api_client = check_api_key(session)
        if err:
            return err
        event = session.query(ZoneEvent).filter(ZoneEvent.id == event_id).first()
        if not event or not event.snapshot_id:
            return jsonify({"error": "event_not_found"}), 404

        snapshot = (
            session.query(Snapshot)
            .filter(Snapshot.id == event.snapshot_id)
            .first()
        )
        if not snapshot:
            return jsonify({"error": "snapshot_not_found"}), 404

        abs_path = _safe_image_path(snapshot.file_path)
        if not abs_path:
            return jsonify({"error": "invalid_file_path"}), 400
        if not os.path.exists(abs_path):
            return jsonify({"error": "file_not_found"}), 404

        return send_file(abs_path, mimetype="image/jpeg")
    finally:
        session.close()


@app.route("/api/v1/cameras/<string:camera_id>/snapshot-latest", methods=["GET"])
def latest_snapshot(camera_id):
    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        snapshot = (
            session.query(Snapshot)
            .filter(Snapshot.camera_id == camera.id)
            .order_by(Snapshot.received_at.desc())
            .first()
        )
        if not snapshot:
            return jsonify({"error": "snapshot_not_found"}), 404

        abs_path = _safe_image_path(snapshot.file_path)
        if not abs_path:
            return jsonify({"error": "invalid_file_path"}), 400
        if not os.path.exists(abs_path):
            return jsonify({"error": "file_not_found"}), 404

        return send_file(abs_path, mimetype="image/jpeg")
    finally:
        session.close()


@app.route("/admin/snapshots/<int:snapshot_id>/image", methods=["GET"])
def admin_snapshot_image(snapshot_id):
    session = SessionLocal()
    try:
        snapshot = session.query(Snapshot).filter(Snapshot.id == snapshot_id).first()
        if not snapshot:
            return jsonify({"error": "snapshot_not_found"}), 404

        abs_path = _safe_image_path(snapshot.file_path)
        if not abs_path:
            return jsonify({"error": "invalid_file_path"}), 400
        if not os.path.exists(abs_path):
            return jsonify({"error": "file_not_found"}), 404

        return send_file(abs_path, mimetype="image/jpeg")
    finally:
        session.close()


@app.route("/admin/snapshots/<int:snapshot_id>/evidence-image", methods=["GET"])
def admin_snapshot_evidence_image(snapshot_id):
    session = SessionLocal()
    try:
        snapshot = session.query(Snapshot).filter(Snapshot.id == snapshot_id).first()
        if not snapshot:
            return jsonify({"error": "snapshot_not_found"}), 404

        evidence_relative = snapshot.evidence_image_path or snapshot.file_path
        abs_path = _safe_image_path(evidence_relative)
        if not abs_path:
            return jsonify({"error": "invalid_file_path"}), 400
        if not os.path.exists(abs_path):
            return jsonify({"error": "file_not_found"}), 404

        return send_file(abs_path, mimetype="image/jpeg")
    finally:
        session.close()


@app.route("/admin/zones/<string:camera_id>/<string:zone_id>/evidence-latest.json", methods=["GET"])
def admin_zone_latest_evidence(camera_id, zone_id):
    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        zone = session.query(Zone).filter(Zone.camera_id == camera.id, Zone.zone_id == zone_id).first()
        if not zone:
            return jsonify({"error": "zone_not_found"}), 404

        latest_event = (
            session.query(ZoneEvent)
            .filter(ZoneEvent.zone_id == zone.id)
            .order_by(ZoneEvent.triggered_at.desc())
            .first()
        )

        candidate_decisions = (
            session.query(SnapshotDecision)
            .filter(SnapshotDecision.camera_id == camera.id)
            .order_by(SnapshotDecision.created_at.desc())
            .limit(300)
            .all()
        )

        matched_decision = None
        matched_zone_decision = None
        for dec in candidate_decisions:
            zone_decisions = _json_loads_safe(dec.zone_decision_json) or []
            for zd in zone_decisions:
                if zd.get("zone_id") == zone.zone_id:
                    matched_decision = dec
                    matched_zone_decision = zd
                    break
            if matched_decision:
                break

        snapshot = None
        if matched_decision and matched_decision.snapshot_id:
            snapshot = session.query(Snapshot).filter(Snapshot.id == matched_decision.snapshot_id).first()
        elif latest_event and latest_event.snapshot_id:
            snapshot = session.query(Snapshot).filter(Snapshot.id == latest_event.snapshot_id).first()

        detections = []
        if snapshot:
            rows = session.query(Detection).filter(Detection.snapshot_id == snapshot.id).all()
            for row in rows:
                detections.append({
                    "class": row.class_name,
                    "confidence": row.confidence,
                    "bbox": _json_loads_safe(row.bbox_json),
                })

        event_payload = None
        if latest_event:
            event_payload = {
                "id": latest_event.id,
                "event_type": latest_event.event_type,
                "old_state": latest_event.old_state,
                "new_state": latest_event.new_state,
                "old_units": latest_event.old_units,
                "new_units": latest_event.new_units,
                "triggered_at": to_iso(latest_event.triggered_at),
                "details": _json_loads_safe(latest_event.details_json),
            }

        return jsonify({
            "camera_id": camera.camera_id,
            "zone_id": zone.zone_id,
            "latest_event": event_payload,
            "latest_decision": {
                "id": matched_decision.id if matched_decision else None,
                "decision_status": matched_decision.decision_status if matched_decision else None,
                "skip_reason": matched_decision.skip_reason if matched_decision else None,
                "scene_diff_value": matched_decision.scene_diff_value if matched_decision else None,
                "yolo_total_objects": matched_decision.yolo_total_objects if matched_decision else None,
                "yolo_vehicle_objects": matched_decision.yolo_vehicle_objects if matched_decision else None,
                "created_at": to_iso(matched_decision.created_at) if matched_decision else None,
                "zone_decision": matched_zone_decision,
            },
            "snapshot": {
                "id": snapshot.id if snapshot else None,
                "received_at": to_iso(snapshot.received_at) if snapshot else None,
                "file_path": snapshot.file_path if snapshot else None,
                "image_url": f"/admin/snapshots/{snapshot.id}/image" if snapshot else None,
                "evidence_image_url": f"/admin/snapshots/{snapshot.id}/evidence-image" if snapshot else None,
            },
            "detections": detections,
        })
    finally:
        session.close()


@app.route("/admin/snapshot-decisions.json", methods=["GET"])
def admin_snapshot_decisions_json():
    """Audit endpoint for worker decisions, including skipped frames and errors."""
    session = SessionLocal()
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 50))
        camera_filter = request.args.get("camera_id")
        status_filter = request.args.get("decision_status")
        skip_filter = request.args.get("skip_reason")

        limit = max(1, min(limit, 200))
        page = max(1, page)

        query = session.query(SnapshotDecision, Camera).join(
            Camera, Camera.id == SnapshotDecision.camera_id
        )

        if camera_filter:
            query = query.filter(Camera.camera_id == camera_filter)
        if status_filter:
            query = query.filter(SnapshotDecision.decision_status == status_filter)
        if skip_filter:
            query = query.filter(SnapshotDecision.skip_reason == skip_filter)

        total = query.count()
        rows = (
            query.order_by(SnapshotDecision.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
            .all()
        )

        decisions = []
        for dec, cam in rows:
            decisions.append({
                "id": dec.id,
                "camera_id": cam.camera_id,
                "snapshot_id": dec.snapshot_id,
                "incoming_file_path": dec.incoming_file_path,
                "file_hash": dec.file_hash,
                "decision_status": dec.decision_status,
                "skip_reason": dec.skip_reason,
                "scene_diff_value": dec.scene_diff_value,
                "yolo_total_objects": dec.yolo_total_objects,
                "yolo_vehicle_objects": dec.yolo_vehicle_objects,
                "zone_decision": _json_loads_safe(dec.zone_decision_json),
                "evidence_image_path": dec.evidence_image_path,
                "error_message": dec.error_message,
                "created_at": to_iso(dec.created_at),
            })

        return jsonify({
            "decisions": decisions,
            "total": total,
            "page": page,
            "limit": limit,
        })
    finally:
        session.close()


@app.route("/admin/cameras/<int:camera_db_id>/ingest-telemetry.json", methods=["GET"])
def admin_camera_ingest_telemetry(camera_db_id):
    """Arrival log for a specific camera: every file scanned by the worker,
    with burst grouping (rank 1 = mother, 2+ = siblings).
    Query params: limit (default 100, max 500), hours (default 24).
    """
    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.id == camera_db_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        limit = min(int(request.args.get("limit", 100)), 500)
        hours = int(request.args.get("hours", 24))
        cutoff = datetime.utcnow() - timedelta(hours=hours)

        rows = (
            session.query(IngestTelemetry)
            .filter(
                IngestTelemetry.camera_id == camera_db_id,
                IngestTelemetry.created_at >= cutoff,
            )
            .order_by(IngestTelemetry.arrived_at.desc())
            .limit(limit)
            .all()
        )

        # Summary counts
        total = len(rows)
        bursts = len({r.burst_group_id for r in rows if r.burst_group_id})
        formats = {}
        for r in rows:
            k = r.detected_format or f"?{r.file_extension or ''}"
            formats[k] = formats.get(k, 0) + 1

        events = [
            {
                "id": r.id,
                "filename": os.path.basename(r.original_filename),
                "extension": r.file_extension,
                "detected_format": r.detected_format,
                "size_bytes": r.file_size_bytes,
                "arrived_at": to_iso(r.arrived_at),
                "burst_group": r.burst_group_id,
                "burst_rank": r.burst_rank,
                "burst_size": r.burst_size,
                "is_mother": r.burst_rank == 1,
            }
            for r in rows
        ]

        return jsonify({
            "camera_id": camera.camera_id,
            "queried_hours": hours,
            "summary": {
                "total_files": total,
                "burst_events": bursts,
                "formats": formats,
            },
            "events": events,
        })
    finally:
        session.close()


@app.route("/admin/health", methods=["GET"])
def admin_health():
    if request.accept_mimetypes.accept_html:
        return render_template("admin_health.html")

    return admin_health_json()


@app.route("/admin/health.json", methods=["GET"])
def admin_health_json():
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        cameras = session.query(Camera).all()
        response = []
        for camera in cameras:
            age_seconds = None
            if camera.last_seen_at:
                age_seconds = (now - camera.last_seen_at).total_seconds()
            response.append(
                {
                    "camera_id": camera.camera_id,
                    "status": camera.status,
                    "last_seen_at": to_iso(camera.last_seen_at),
                    "age_seconds": age_seconds,
                }
            )
        return jsonify({"cameras": response})
    finally:
        session.close()


@app.route("/admin/cameras", methods=["GET"])
def admin_cameras():
    return render_template("admin_cameras.html")


@app.route("/admin/cameras.json", methods=["GET"])
def admin_cameras_json():
    session = SessionLocal()
    try:
        project_id = request.args.get("project_id")
        site_id = request.args.get("site_id")

        query = session.query(Camera, Site)
        query = query.join(Site, Site.id == Camera.site_id)
        if project_id and str(project_id).isdigit():
            query = query.filter(Site.project_id == int(project_id))
        if site_id and str(site_id).isdigit():
            query = query.filter(Camera.site_id == int(site_id))

        rows = query.all()
        response = []

        # Bulk-load ftp_pending metrics written by worker each cycle
        cam_ids = [cam.id for cam, _site in rows]
        pending_keys = [f"ftp_pending_{cid}" for cid in cam_ids]
        pending_settings = {}
        if pending_keys:
            settings_rows = session.query(SystemSetting).filter(
                SystemSetting.key.in_(pending_keys)
            ).all()
            for s in settings_rows:
                pending_settings[s.key] = s.value

        for camera, site in rows:
            ftp_pending_val = pending_settings.get(f"ftp_pending_{camera.id}")
            response.append(
                {
                    "camera_id": camera.camera_id,
                    "name": camera.name,
                    "project_id": site.project_id,
                    "site_id": site.id,
                    "site_name": site.name,
                    "brand": camera.brand,
                    "model": camera.model,
                    "ingest_protocol": camera.ingest_protocol or "ftp",
                    "status": camera.status or "UNKNOWN",
                    "last_seen_at": to_iso(camera.last_seen_at),
                    "ftp_username": camera.ftp_username,
                    "ftp_password": camera.ftp_password_hash,
                    "ftp_pending": int(ftp_pending_val) if ftp_pending_val is not None else None,
                }
            )
        return jsonify({"cameras": response})
    finally:
        session.close()


@app.route("/admin/cameras", methods=["POST"])
def create_camera():
    payload = request.get_json(silent=True) or {}
    camera_id = payload.get("camera_id")
    name = payload.get("name")
    site_id = payload.get("site_id", 1)
    brand = payload.get("brand")
    model = payload.get("model")
    ingest_protocol = payload.get("ingest_protocol", "ftp")
    ftp_username = payload.get("ftp_username")
    ftp_password = payload.get("ftp_password")
    connection_config = payload.get("connection_config")
    lapi_device_code = payload.get("lapi_device_code")
    lapi_secret = payload.get("lapi_secret")

    if not camera_id:
        return jsonify({"error": "camera_id_required"}), 400

    # FTP protocol requires ftp_username and ftp_password
    if ingest_protocol == "ftp" and not ftp_username:
        return jsonify({"error": "ftp_username_required_for_ftp_protocol"}), 400
    if ingest_protocol == "ftp" and not ftp_password:
        return jsonify({"error": "ftp_password_required_for_ftp_protocol"}), 400

    session = SessionLocal()
    try:
        site = session.query(Site).filter(Site.id == site_id).first()
        if not site:
            return jsonify({"error": "site_not_found"}), 404

        existing = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if existing:
            return jsonify({"error": "camera_id_exists"}), 409

        camera = Camera(
            site_id=site_id,
            camera_id=camera_id,
            name=name,
            brand=brand,
            model=model,
            ingest_protocol=ingest_protocol,
            ftp_username=ftp_username,
            ftp_password_hash=ftp_password,  # stored plaintext for pure-ftpd virtual users
            connection_config=connection_config,
            lapi_device_code=lapi_device_code,
            lapi_secret=lapi_secret,
            status="UNKNOWN",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(camera)
        session.commit()

        # Create the incoming directory for the worker to poll
        ingest_id = ftp_username or camera_id.lower()
        ftp_path = os.path.join(os.getenv("FTP_INGEST_PATH", "/data/ftp"), ingest_id, "incoming")
        os.makedirs(ftp_path, exist_ok=True)

        # Sync FTP users file so FTP container picks up the new camera
        if ingest_protocol == "ftp":
            sync_ftp_users()

        result = {
            "camera_id": camera.camera_id,
            "ingest_protocol": camera.ingest_protocol,
            "ingest_path": ftp_path,
        }
        if ftp_username:
            result["ftp_username"] = ftp_username
        if lapi_device_code:
            result["lapi_device_code"] = lapi_device_code
            result["lapi_ws_port"] = os.getenv("LAPI_WS_PORT", "8765")

        return jsonify(result)
    finally:
        session.close()


@app.route("/admin/projects.json", methods=["GET"])
def admin_projects_json():
    """Return project isolation view: projects, sites, clients, cameras, and zones."""
    session = SessionLocal()
    try:
        projects = session.query(Project).all()
        sites = session.query(Site).all()
        cameras = session.query(Camera).all()
        zones = session.query(Zone).all()
        clients = session.query(APIClient).all()

        sites_by_project = defaultdict(list)
        for site in sites:
            sites_by_project[site.project_id].append(site)

        cameras_by_site = defaultdict(list)
        for cam in cameras:
            cameras_by_site[cam.site_id].append(cam)

        zones_by_camera = defaultdict(list)
        for zone in zones:
            zones_by_camera[zone.camera_id].append(zone)

        client_site_map = {}
        for client in clients:
            site_ids = _site_ids_from_client(client)
            if not site_ids:
                # Unscoped client can access all sites.
                site_ids = {s.id for s in sites}
            client_site_map[client.id] = site_ids

        result = []
        for project in projects:
            project_sites = sites_by_project.get(project.id, [])
            project_site_ids = {s.id for s in project_sites}

            project_cameras = []
            for s in project_sites:
                project_cameras.extend(cameras_by_site.get(s.id, []))
            project_camera_ids = {c.id for c in project_cameras}

            project_zones = []
            for cam in project_cameras:
                project_zones.extend(zones_by_camera.get(cam.id, []))

            project_clients = []
            for client in clients:
                allowed_sites = client_site_map.get(client.id, set())
                if allowed_sites.intersection(project_site_ids):
                    project_clients.append(
                        {
                            "id": client.id,
                            "name": client.name,
                            "rate_limit_per_minute": client.rate_limit_per_minute or 60,
                            "site_ids": sorted(list(allowed_sites.intersection(project_site_ids))),
                            "last_used_at": to_iso(client.last_used_at),
                        }
                    )

            result.append(
                {
                    "id": project.id,
                    "name": project.name,
                    "sites": [
                        {
                            "id": s.id,
                            "name": s.name,
                            "location": s.location,
                            "latitude": s.latitude,
                            "longitude": s.longitude,
                            "city": s.city,
                            "camera_count": len(cameras_by_site.get(s.id, [])),
                        }
                        for s in project_sites
                    ],
                    "clients": project_clients,
                    "camera_count": len(project_cameras),
                    "zone_count": len(project_zones),
                    "created_at": to_iso(project.created_at),
                }
            )

        return jsonify({"projects": result})
    finally:
        session.close()


@app.route("/admin/projects", methods=["POST"])
def admin_create_project():
    """Create an isolated project with one site and optional dedicated API client."""
    payload = request.get_json(silent=True) or {}
    project_name = (payload.get("project_name") or "").strip()
    site_name = (payload.get("site_name") or "").strip()
    location = payload.get("location")
    create_client = bool(payload.get("create_client", True))
    client_name = (payload.get("client_name") or "").strip()
    rate_limit = int(payload.get("rate_limit_per_minute", 60))

    if not project_name:
        return jsonify({"error": "project_name_required"}), 400
    if not site_name:
        site_name = f"{project_name}_SITE_01"
    if create_client and not client_name:
        client_name = f"{project_name}_CLIENT"

    session = SessionLocal()
    try:
        existing_project = session.query(Project).filter(Project.name == project_name).first()
        if existing_project:
            return jsonify({"error": "project_name_exists"}), 409

        project = Project(name=project_name, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
        session.add(project)
        session.flush()

        site = Site(
            project_id=project.id,
            name=site_name,
            location=location,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(site)
        session.flush()

        response = {
            "project": {"id": project.id, "name": project.name},
            "site": {"id": site.id, "name": site.name, "location": site.location},
        }

        if create_client:
            raw_key = secrets.token_urlsafe(32)
            key_hash = hash_api_key(raw_key)
            client = APIClient(
                name=client_name,
                api_key_hash=key_hash,
                site_ids=json.dumps([site.id]),
                scope="read:status,read:events",
                rate_limit_per_minute=rate_limit,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(client)
            session.flush()
            response["client"] = {
                "id": client.id,
                "name": client.name,
                "rate_limit_per_minute": client.rate_limit_per_minute or 60,
                "site_ids": [site.id],
                "api_key": raw_key,
                "warning": "save_this_key",
            }

        session.commit()
        return jsonify(response), 201
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/projects/<int:project_id>", methods=["PUT"])
def admin_update_project(project_id):
    """Update a project's name."""
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name_required"}), 400
    session = SessionLocal()
    try:
        project = session.query(Project).filter(Project.id == project_id).first()
        if not project:
            return jsonify({"error": "project_not_found"}), 404
        project.name = name
        project.updated_at = datetime.utcnow()
        session.commit()
        return jsonify({"id": project.id, "name": project.name})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/projects/<int:project_id>", methods=["DELETE"])
def admin_delete_project(project_id):
    """Delete a project and all its sites, cameras, zones, and states."""
    session = SessionLocal()
    try:
        project = session.query(Project).filter(Project.id == project_id).first()
        if not project:
            return jsonify({"error": "project_not_found"}), 404

        sites = session.query(Site).filter(Site.project_id == project_id).all()
        for site in sites:
            cameras = session.query(Camera).filter(Camera.site_id == site.id).all()
            for cam in cameras:
                zone_ids = [z.id for z in session.query(Zone).filter(Zone.camera_id == cam.id).all()]
                if zone_ids:
                    session.query(ZoneState).filter(ZoneState.zone_id.in_(zone_ids)).delete(synchronize_session=False)
                    session.query(ZoneEvent).filter(ZoneEvent.zone_id.in_(zone_ids)).delete(synchronize_session=False)
                session.query(Zone).filter(Zone.camera_id == cam.id).delete(synchronize_session=False)
                session.delete(cam)
            session.delete(site)
        session.delete(project)
        session.commit()
        return jsonify({"status": "deleted", "project_id": project_id})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/projects/<int:project_id>/zones.json", methods=["GET"])
def admin_project_zones_json(project_id):
    """List zones for a single project only."""
    session = SessionLocal()
    try:
        project = session.query(Project).filter(Project.id == project_id).first()
        if not project:
            return jsonify({"error": "project_not_found"}), 404

        rows = (
            session.query(Zone, ZoneState, Camera, Site)
            .outerjoin(ZoneState, ZoneState.zone_id == Zone.id)
            .join(Camera, Camera.id == Zone.camera_id)
            .join(Site, Site.id == Camera.site_id)
            .filter(Site.project_id == project_id)
            .all()
        )

        zones = []
        for zone, zone_state, cam, site in rows:
            zones.append(
                {
                    "zone_id": zone.zone_id,
                    "name": zone.name,
                    "camera_id": cam.camera_id,
                    "site_id": site.id,
                    "site_name": site.name,
                    "state": (zone_state.state or "FREE") if zone_state else "FREE",
                    "occupied": (zone_state.occupied_units or 0) if zone_state else 0,
                    "capacity": zone.capacity_units or 1,
                    "last_change": to_iso(zone_state.last_change_at) if zone_state else None,
                }
            )

        return jsonify({"project_id": project_id, "project_name": project.name, "zones": zones})
    finally:
        session.close()


@app.route("/admin/projects/<int:project_id>/cameras.json", methods=["GET"])
def admin_project_cameras_json(project_id):
    """List cameras for a single project only."""
    session = SessionLocal()
    try:
        project = session.query(Project).filter(Project.id == project_id).first()
        if not project:
            return jsonify({"error": "project_not_found"}), 404

        rows = (
            session.query(Camera, Site)
            .join(Site, Site.id == Camera.site_id)
            .filter(Site.project_id == project_id)
            .all()
        )

        cameras = []
        for cam, site in rows:
            cameras.append(
                {
                    "camera_id": cam.camera_id,
                    "name": cam.name,
                    "site_id": site.id,
                    "site_name": site.name,
                    "status": cam.status or "UNKNOWN",
                    "last_seen_at": to_iso(cam.last_seen_at),
                    "ingest_protocol": cam.ingest_protocol or "ftp",
                }
            )

        return jsonify({"project_id": project_id, "project_name": project.name, "cameras": cameras})
    finally:
        session.close()


@app.route("/admin/api-keys/<int:key_id>/sites", methods=["PUT"])
def admin_update_api_key_sites(key_id):
    """Assign a client to explicit site IDs for project isolation."""
    payload = request.get_json(silent=True) or {}
    site_ids = payload.get("site_ids")
    if not isinstance(site_ids, list):
        return jsonify({"error": "site_ids_array_required"}), 400

    normalized_site_ids = [int(sid) for sid in site_ids if str(sid).isdigit()]
    session = SessionLocal()
    try:
        client = session.query(APIClient).filter(APIClient.id == key_id).first()
        if not client:
            return jsonify({"error": "client_not_found"}), 404

        valid_count = session.query(Site).filter(Site.id.in_(normalized_site_ids)).count() if normalized_site_ids else 0
        if normalized_site_ids and valid_count != len(set(normalized_site_ids)):
            return jsonify({"error": "one_or_more_site_ids_not_found"}), 400

        client.site_ids = json.dumps(normalized_site_ids)
        client.updated_at = datetime.utcnow()
        session.commit()
        return jsonify({"status": "ok", "client_id": client.id, "site_ids": normalized_site_ids})
    finally:
        session.close()


@app.route("/admin/cameras/<string:camera_id>", methods=["DELETE"])
def delete_camera(camera_id):
    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        # Delete related records (cascade)
        snapshots = session.query(Snapshot).filter(Snapshot.camera_id == camera.id).all()
        snap_ids = [s.id for s in snapshots]
        if snap_ids:
            session.query(Detection).filter(Detection.snapshot_id.in_(snap_ids)).delete(synchronize_session=False)
        session.query(Snapshot).filter(Snapshot.camera_id == camera.id).delete(synchronize_session=False)

        zones = session.query(Zone).filter(Zone.camera_id == camera.id).all()
        zone_ids = [z.id for z in zones]
        if zone_ids:
            session.query(ZoneState).filter(ZoneState.zone_id.in_(zone_ids)).delete(synchronize_session=False)
            session.query(ZoneEvent).filter(ZoneEvent.zone_id.in_(zone_ids)).delete(synchronize_session=False)
        session.query(Zone).filter(Zone.camera_id == camera.id).delete(synchronize_session=False)

        session.query(CameraHealthEvent).filter(CameraHealthEvent.camera_id == camera.id).delete(synchronize_session=False)
        was_ftp = camera.ingest_protocol == "ftp"
        session.delete(camera)
        session.commit()

        # Re-sync FTP users so deleted camera is removed
        if was_ftp:
            sync_ftp_users()

        return jsonify({"status": "deleted", "camera_id": camera_id})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


# ─── Site CRUD ────────────────────────────────────────────────────────────────

def _get_or_create_unassigned_site(session, project_id):
    """Return (or create) the sentinel site for unassigned cameras in a project."""
    sentinel = session.query(Site).filter(
        Site.project_id == project_id,
        Site.name == UNASSIGNED_SITE_NAME,
    ).first()
    if not sentinel:
        sentinel = Site(
            project_id=project_id,
            name=UNASSIGNED_SITE_NAME,
            location=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(sentinel)
        session.flush()
    return sentinel


@app.route("/admin/sites", methods=["POST"])
def create_site():
    """Create a site for a project."""
    payload = request.get_json(silent=True) or {}
    project_id = payload.get("project_id")
    name = (payload.get("name") or "").strip()
    location = payload.get("location")
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    city = payload.get("city")

    if not project_id:
        return jsonify({"error": "project_id_required"}), 400
    if not name:
        return jsonify({"error": "name_required"}), 400
    if name == UNASSIGNED_SITE_NAME:
        return jsonify({"error": "reserved_name"}), 400

    session = SessionLocal()
    try:
        project = session.query(Project).filter(Project.id == project_id).first()
        if not project:
            return jsonify({"error": "project_not_found"}), 404
        existing = session.query(Site).filter(
            Site.project_id == project_id, Site.name == name
        ).first()
        if existing:
            return jsonify({"error": "site_name_exists"}), 409
        site = Site(
            project_id=project_id, name=name, location=location,
            latitude=float(latitude) if latitude is not None else None,
            longitude=float(longitude) if longitude is not None else None,
            city=city or None,
            created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
        )
        session.add(site)
        session.commit()
        return jsonify({"site": {
            "id": site.id, "name": site.name, "location": site.location,
            "latitude": site.latitude, "longitude": site.longitude, "city": site.city,
        }}), 201
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/sites/<int:site_id>", methods=["PUT"])
def update_site(site_id):
    """Update a site's name / location / coordinates."""
    payload = request.get_json(silent=True) or {}
    session = SessionLocal()
    try:
        site = session.query(Site).filter(Site.id == site_id).first()
        if not site:
            return jsonify({"error": "site_not_found"}), 404
        if site.name == UNASSIGNED_SITE_NAME:
            return jsonify({"error": "cannot_edit_unassigned_sentinel"}), 400
        if "name" in payload:
            new_name = (payload["name"] or "").strip()
            if not new_name:
                return jsonify({"error": "name_required"}), 400
            if new_name == UNASSIGNED_SITE_NAME:
                return jsonify({"error": "reserved_name"}), 400
            site.name = new_name
        if "location" in payload:
            site.location = payload["location"]
        if "latitude" in payload:
            site.latitude = float(payload["latitude"]) if payload["latitude"] is not None else None
        if "longitude" in payload:
            site.longitude = float(payload["longitude"]) if payload["longitude"] is not None else None
        if "city" in payload:
            site.city = payload["city"] or None
        site.updated_at = datetime.utcnow()
        session.commit()
        return jsonify({"site": {
            "id": site.id, "name": site.name, "location": site.location,
            "latitude": site.latitude, "longitude": site.longitude, "city": site.city,
        }})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/sites/<int:site_id>", methods=["DELETE"])
def delete_site(site_id):
    """Delete a site. Cameras in the site are moved to the __unassigned__ sentinel."""
    session = SessionLocal()
    try:
        site = session.query(Site).filter(Site.id == site_id).first()
        if not site:
            return jsonify({"error": "site_not_found"}), 404
        if site.name == UNASSIGNED_SITE_NAME:
            return jsonify({"error": "cannot_delete_unassigned_sentinel"}), 400
        cameras = session.query(Camera).filter(Camera.site_id == site_id).all()
        cameras_unassigned = len(cameras)
        if cameras:
            sentinel = _get_or_create_unassigned_site(session, site.project_id)
            for cam in cameras:
                cam.site_id = sentinel.id
                cam.updated_at = datetime.utcnow()
            session.flush()
        session.delete(site)
        session.commit()
        return jsonify({"deleted": True, "cameras_unassigned": cameras_unassigned})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/cameras/<string:camera_id>/site", methods=["PUT"])
def reassign_camera_site(camera_id):
    """Reassign a camera to a different site (or to __unassigned__ if site_id is null)."""
    payload = request.get_json(silent=True) or {}
    site_id = payload.get("site_id")  # int or None
    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404
        current_site = session.query(Site).filter(Site.id == camera.site_id).first()
        if site_id is not None:
            target = session.query(Site).filter(Site.id == int(site_id)).first()
            if not target:
                return jsonify({"error": "site_not_found"}), 404
            if target.name == UNASSIGNED_SITE_NAME:
                return jsonify({"error": "cannot_assign_to_sentinel"}), 400
            if current_site and target.project_id != current_site.project_id:
                return jsonify({"error": "site_project_mismatch"}), 400
            camera.site_id = target.id
        else:
            if current_site:
                sentinel = _get_or_create_unassigned_site(session, current_site.project_id)
                camera.site_id = sentinel.id
        camera.updated_at = datetime.utcnow()
        session.commit()
        return jsonify({"camera_id": camera_id, "site_id": camera.site_id})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/ftp-sync", methods=["POST"])
def manual_ftp_sync():
    """Manually trigger FTP user sync from DB → FTP container."""
    sync_ftp_users()
    return jsonify({"status": "synced"})


@app.route("/admin/zones/<string:camera_id>/editor", methods=["GET"])
def zone_editor(camera_id):
    embed = request.args.get('embed') == '1'
    return render_template("zone_editor.html", camera_id=camera_id, embed=embed)


@app.route("/admin/zones", methods=["POST"])
def save_zone():
    payload = request.get_json(silent=True) or {}
    camera_id = payload.get("camera_id")
    zone_id = payload.get("zone_id")
    polygon_json = payload.get("polygon_json")
    name = payload.get("name")
    capacity_units = payload.get("capacity_units", 1)

    if not camera_id or not zone_id or not polygon_json:
        return jsonify({"error": "camera_id_zone_id_polygon_required"}), 400

    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        zone = (
            session.query(Zone)
            .filter(Zone.camera_id == camera.id, Zone.zone_id == zone_id)
            .first()
        )
        if zone:
            zone.polygon_json = polygon_json
            zone.name = name
            zone.capacity_units = capacity_units
            zone.updated_at = datetime.utcnow()
        else:
            zone = Zone(
                camera_id=camera.id,
                zone_id=zone_id,
                name=name,
                polygon_json=polygon_json,
                capacity_units=capacity_units,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(zone)
            session.flush()
            state = ZoneState(
                zone_id=zone.id,
                occupied_units=0,
                available_units=capacity_units,
                state="FREE",
                last_change_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(state)

        session.commit()
        return jsonify({"status": "ok"})
    finally:
        session.close()


@app.route("/admin/zones/bulk", methods=["POST"])
def save_zones_bulk():
    """Bulk-save zones for a camera (auto-grid or manual batch)."""
    payload = request.get_json(silent=True) or {}
    camera_id = payload.get("camera_id")
    zones_data = payload.get("zones", [])
    clear_existing = payload.get("clear_existing", False)

    if not camera_id or not zones_data:
        return jsonify({"error": "camera_id and zones[] required"}), 400

    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        # Optionally clear existing zones first
        if clear_existing:
            old_zones = session.query(Zone).filter(Zone.camera_id == camera.id).all()
            old_ids = [z.id for z in old_zones]
            if old_ids:
                session.query(ZoneState).filter(ZoneState.zone_id.in_(old_ids)).delete(synchronize_session=False)
                session.query(ZoneEvent).filter(ZoneEvent.zone_id.in_(old_ids)).delete(synchronize_session=False)
            session.query(Zone).filter(Zone.camera_id == camera.id).delete(synchronize_session=False)

        saved = 0
        for zd in zones_data:
            zone_id = zd.get("zone_id")
            polygon_json = zd.get("polygon_json")
            if not zone_id or not polygon_json:
                continue

            existing = (
                session.query(Zone)
                .filter(Zone.camera_id == camera.id, Zone.zone_id == zone_id)
                .first()
            )
            if existing:
                existing.polygon_json = polygon_json
                existing.name = zd.get("name", existing.name)
                existing.capacity_units = zd.get("capacity_units", existing.capacity_units)
                existing.updated_at = datetime.utcnow()
            else:
                zone = Zone(
                    camera_id=camera.id,
                    zone_id=zone_id,
                    name=zd.get("name", zone_id),
                    polygon_json=polygon_json,
                    capacity_units=zd.get("capacity_units", 1),
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                session.add(zone)
                session.flush()
                state = ZoneState(
                    zone_id=zone.id,
                    occupied_units=0,
                    available_units=zd.get("capacity_units", 1),
                    state="FREE",
                    last_change_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                session.add(state)
            saved += 1

        session.commit()
        return jsonify({"status": "ok", "saved": saved})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/zones/delete", methods=["POST"])
def delete_zone():
    """Delete a single zone by camera_id + zone_id."""
    payload = request.get_json(silent=True) or {}
    camera_id_str = payload.get("camera_id")
    zone_id = payload.get("zone_id")

    if not camera_id_str or not zone_id:
        return jsonify({"error": "camera_id and zone_id required"}), 400

    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id_str).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        zone = (
            session.query(Zone)
            .filter(Zone.camera_id == camera.id, Zone.zone_id == zone_id)
            .first()
        )
        if not zone:
            return jsonify({"error": "zone_not_found"}), 404

        session.query(ZoneState).filter(ZoneState.zone_id == zone.id).delete(synchronize_session=False)
        session.query(ZoneEvent).filter(ZoneEvent.zone_id == zone.id).delete(synchronize_session=False)
        session.delete(zone)
        session.commit()
        return jsonify({"status": "deleted", "zone_id": zone_id})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/zones/delete-all", methods=["POST"])
def delete_all_zones():
    """Delete all zones for a camera."""
    payload = request.get_json(silent=True) or {}
    camera_id_str = payload.get("camera_id")

    if not camera_id_str:
        return jsonify({"error": "camera_id required"}), 400

    session = SessionLocal()
    try:
        camera = session.query(Camera).filter(Camera.camera_id == camera_id_str).first()
        if not camera:
            return jsonify({"error": "camera_not_found"}), 404

        old_zones = session.query(Zone).filter(Zone.camera_id == camera.id).all()
        old_ids = [z.id for z in old_zones]
        if old_ids:
            session.query(ZoneState).filter(ZoneState.zone_id.in_(old_ids)).delete(synchronize_session=False)
            session.query(ZoneEvent).filter(ZoneEvent.zone_id.in_(old_ids)).delete(synchronize_session=False)
        count = session.query(Zone).filter(Zone.camera_id == camera.id).delete(synchronize_session=False)
        session.commit()
        return jsonify({"status": "deleted", "count": count})
    except Exception as exc:
        session.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/api-keys/generate", methods=["POST"])
def generate_api_key():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "dashboard")
    site_ids = payload.get("site_ids")
    rate_limit = payload.get("rate_limit_per_minute", 60)

    raw_key = secrets.token_urlsafe(32)
    key_hash = hash_api_key(raw_key)

    session = SessionLocal()
    try:
        client = APIClient(
            name=name,
            api_key_hash=key_hash,
            site_ids=json.dumps(site_ids) if site_ids is not None else None,
            scope="read:status,read:events",
            rate_limit_per_minute=rate_limit,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(client)
        session.commit()
        return jsonify({"api_key": raw_key, "warning": "save_this_key"})
    finally:
        session.close()


# ============================================
# DASHBOARD ROUTES
# ============================================

@app.route("/admin/dashboard", methods=["GET"])
def admin_dashboard():
    return render_template("dashboard.html")


@app.route("/admin/scada", methods=["GET"])
def admin_scada():
    return render_template("admin_scada.html")


@app.route("/admin/dashboard-legacy", methods=["GET"])
def admin_dashboard_legacy():
    return render_template("dashboard.html")


@app.route("/admin/scada-legacy", methods=["GET"])
def admin_scada_legacy():
    return render_template("admin_scada.html")


@app.route("/admin/frontendv2", methods=["GET"])
def admin_frontend_v2():
    return render_template("frontendv2/index.html")


@app.route("/admin/frontendv3", methods=["GET"])
def admin_frontend_v3():
    return render_template("frontendv3/index.html")


# --------------- Admin API Routes (internal) ---------------


@app.route("/api/admin/users.json", methods=["GET"])
def admin_users_json():
    """List all admin users."""
    if session.get("admin_role") != "admin":
        return jsonify({"error": "admin only"}), 403
    s = SessionLocal()
    try:
        users = s.query(AdminUser).order_by(AdminUser.id).all()
        return jsonify({"users": [{
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "status": u.status,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        } for u in users]})
    finally:
        s.close()


@app.route("/api/admin/users", methods=["POST"])
def admin_create_user():
    """Create a new admin user. Admin only."""
    if session.get("admin_role") != "admin":
        return jsonify({"error": "admin only"}), 403
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    role = data.get("role", "viewer")
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if role not in ("admin", "supervisor", "viewer"):
        return jsonify({"error": "Invalid role"}), 400
    s = SessionLocal()
    try:
        if s.query(AdminUser).filter_by(username=username).first():
            return jsonify({"error": "Username already exists"}), 409
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        user = AdminUser(username=username, password_hash=pw_hash, role=role, status="active")
        s.add(user)
        s.commit()
        return jsonify({"ok": True, "id": user.id, "username": user.username})
    except Exception as exc:
        s.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        s.close()


@app.route("/api/admin/users/<int:user_id>", methods=["PUT"])
def admin_update_user(user_id):
    """Update user role/status/password. Admin only."""
    if session.get("admin_role") != "admin":
        return jsonify({"error": "admin only"}), 403
    data = request.get_json(force=True)
    s = SessionLocal()
    try:
        user = s.query(AdminUser).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        if "role" in data and data["role"] in ("admin", "supervisor", "viewer"):
            user.role = data["role"]
        if "status" in data and data["status"] in ("active", "disabled"):
            user.status = data["status"]
        if "password" in data:
            new_password = (data.get("password") or "").strip()
            if new_password:
                user.password_hash = hashlib.sha256(new_password.encode()).hexdigest()
        user.updated_at = datetime.utcnow()
        s.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        s.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        s.close()


@app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
def admin_delete_user(user_id):
    """Delete a user. Admin only. Cannot delete self."""
    if session.get("admin_role") != "admin":
        return jsonify({"error": "admin only"}), 403
    s = SessionLocal()
    try:
        user = s.query(AdminUser).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        if user.username == session.get("admin_user"):
            return jsonify({"error": "Cannot delete yourself"}), 400
        s.delete(user)
        s.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        s.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        s.close()


@app.route("/api/admin/sites/<int:site_id>/location", methods=["PUT"])
def admin_site_location(site_id):
    """Update latitude/longitude for a site (used by settings page map pin config)."""
    s = SessionLocal()
    try:
        site = s.query(Site).filter_by(id=site_id).first()
        if not site:
            return jsonify({"ok": False, "error": "Site not found"}), 404
        data = request.get_json(force=True)
        site.latitude = data.get("latitude")
        site.longitude = data.get("longitude")
        s.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        s.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        s.close()


@app.route("/api/admin/fleet-health.json", methods=["GET"])
def admin_fleet_health_json():
    """Aggregated per-site camera health for the monitoring dashboard.
    Returns sites with camera counts by status, zone occupancy, and last activity.
    Designed to scale to 1000+ cameras by doing one pass over data."""
    s = SessionLocal()
    try:
        now = datetime.utcnow()
        one_hour_ago = now - timedelta(hours=1)

        sites = s.query(Site).all()
        cameras = s.query(Camera).all()
        zones = s.query(Zone).all()
        zone_states = s.query(ZoneState).all()

        # Index data
        zs_by_zone_id = {zs.zone_id: zs for zs in zone_states}
        zones_by_cam = defaultdict(list)
        for z in zones:
            zones_by_cam[z.camera_id].append(z)
        cams_by_site = defaultdict(list)
        for c in cameras:
            cams_by_site[c.site_id].append(c)

        site_list = []
        for site in sites:
            site_cams = cams_by_site.get(site.id, [])
            online = stale = offline = 0
            last_seen = None
            total_zones = 0
            zones_free = 0
            zones_full = 0
            for cam in site_cams:
                st = cam.status or "UNKNOWN"
                if st == "ONLINE":
                    online += 1
                elif st == "STALE":
                    stale += 1
                else:
                    offline += 1
                if cam.last_seen_at and (not last_seen or cam.last_seen_at > last_seen):
                    last_seen = cam.last_seen_at
                for z in zones_by_cam.get(cam.id, []):
                    total_zones += 1
                    zs = zs_by_zone_id.get(z.id)
                    if zs:
                        if zs.state == "FREE":
                            zones_free += 1
                        elif zs.state == "FULL":
                            zones_full += 1

            total_cams = len(site_cams)
            health_pct = round((online / total_cams * 100) if total_cams else 0)
            site_list.append({
                "id": site.id,
                "name": site.name,
                "location": site.location,
                "cameras_total": total_cams,
                "cameras_online": online,
                "cameras_stale": stale,
                "cameras_offline": offline,
                "health_pct": health_pct,
                "zones_total": total_zones,
                "zones_free": zones_free,
                "zones_full": zones_full,
                "last_activity": last_seen.isoformat() if last_seen else None,
            })

        # Sort by total cameras desc (biggest sites first)
        site_list.sort(key=lambda x: x["cameras_total"], reverse=True)

        return jsonify({
            "sites": site_list,
            "fleet": {
                "total_cameras": len(cameras),
                "total_online": sum(1 for c in cameras if c.status == "ONLINE"),
                "total_stale": sum(1 for c in cameras if c.status == "STALE"),
                "total_offline": sum(1 for c in cameras if c.status not in ("ONLINE", "STALE")),
                "total_sites": len(sites),
                "total_zones": len(zones),
            },
        })
    finally:
        s.close()





@app.route("/api/admin/cameras/<string:camera_id>/activity.json", methods=["GET"])
def admin_camera_activity_json(camera_id):
    """Per-camera snapshot records with stats for the activity page."""
    s = SessionLocal()
    try:
        cam = s.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not cam:
            return jsonify({"error": "Camera not found"}), 404

        page = max(1, int(request.args.get("page", 1)))
        limit = min(100, max(1, int(request.args.get("limit", 20))))
        decision_filter = request.args.get("decision")

        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        # Stats for today
        today_snaps = s.query(Snapshot).filter(
            Snapshot.camera_id == cam.id,
            Snapshot.received_at >= today_start
        )
        snapshots_today = today_snaps.count()
        processed_today = today_snaps.filter(Snapshot.decision_status == "processed").count()
        skipped_today = today_snaps.filter(Snapshot.decision_status.in_(["skipped", "duplicate"])).count()
        detections_today = (
            s.query(Detection)
            .join(Snapshot, Snapshot.id == Detection.snapshot_id)
            .filter(Snapshot.camera_id == cam.id, Snapshot.received_at >= today_start)
            .count()
        )

        # Paginated snapshot query
        query = s.query(Snapshot).filter(Snapshot.camera_id == cam.id)
        if decision_filter:
            query = query.filter(Snapshot.decision_status == decision_filter)
        total = query.count()
        snapshots = query.order_by(Snapshot.received_at.desc()).offset((page - 1) * limit).limit(limit).all()

        rows = []
        for snap in snapshots:
            det_count = s.query(Detection).filter(Detection.snapshot_id == snap.id).count()
            has_image = bool(snap.file_path)
            rows.append({
                "id": snap.id,
                "received_at": snap.received_at.isoformat() if snap.received_at else None,
                "processed_at": snap.processed_at.isoformat() if snap.processed_at else None,
                "decision": snap.decision_status,
                "skip_reason": snap.skip_reason,
                "vehicle_count": snap.yolo_vehicle_objects,
                "detection_count": det_count,
                "has_image": has_image,
            })

        return jsonify({
            "camera_id": camera_id,
            "page": page,
            "limit": limit,
            "total": total,
            "snapshots": rows,
            "stats": {
                "snapshots_today": snapshots_today,
                "processed_today": processed_today,
                "skipped_today": skipped_today,
                "detections_today": detections_today,
            },
        })
    finally:
        s.close()


@app.route("/api/admin/cameras/<string:camera_id>/health.json", methods=["GET"])
def admin_camera_health_json(camera_id):
    """Per-camera health transition history."""
    s = SessionLocal()
    try:
        cam = s.query(Camera).filter(Camera.camera_id == camera_id).first()
        if not cam:
            return jsonify({"error": "Camera not found"}), 404

        events = (
            s.query(CameraHealthEvent)
            .filter(CameraHealthEvent.camera_id == cam.id)
            .order_by(CameraHealthEvent.triggered_at.desc())
            .limit(50)
            .all()
        )
        return jsonify({
            "camera_id": camera_id,
            "events": [
                {
                    "health_status": e.health_status,
                    "triggered_at": e.triggered_at.isoformat() if e.triggered_at else None,
                }
                for e in events
            ],
        })
    finally:
        s.close()


@app.route("/admin/frontendv3/observability.json", methods=["GET"])
def admin_frontend_v3_observability_json():
    """Provider-focused API observability view over token ledger traffic."""
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        one_day_ago = now - timedelta(hours=24)
        one_hour_ago = now - timedelta(hours=1)

        db_ok = True
        try:
            session.execute(text("SELECT 1"))
        except Exception:
            db_ok = False

        rows = (
            session.query(TokenLedger, APIClient)
            .outerjoin(APIClient, APIClient.id == TokenLedger.api_client_id)
            .filter(TokenLedger.created_at >= one_day_ago)
            .order_by(TokenLedger.created_at.desc())
            .all()
        )

        total_24h = len(rows)
        success_24h = 0
        failed_24h = 0
        status_200_24h = 0
        active_clients = set()
        recent_logs = []

        endpoint_stats = defaultdict(
            lambda: {
                "method": "",
                "endpoint": "",
                "total": 0,
                "success": 0,
                "failed": 0,
                "status_200": 0,
                "response_time_sum_ms": 0,
                "response_time_samples": 0,
                "last_seen_at": None,
            }
        )

        client_endpoint_stats = defaultdict(
            lambda: {
                "client_name": "",
                "endpoint": "",
                "method": "",
                "total": 0,
                "success": 0,
                "failed": 0,
                "status_200": 0,
                "response_time_sum_ms": 0,
                "response_time_samples": 0,
                "calls_last_hour": 0,
                "last_seen_at": None,
                "rate_limit_per_minute": 0,
            }
        )

        flow_by_minute = defaultdict(int)

        for ledger, client in rows:
            status_code = ledger.status_code or 0
            method = (ledger.method or "GET").upper()
            endpoint = ledger.endpoint or "(unknown)"
            client_name = client.name if client else "anonymous"
            rate_limit = (client.rate_limit_per_minute or 60) if client else 0
            created_at = ledger.created_at

            if 200 <= status_code < 300:
                success_24h += 1
            if status_code >= 400:
                failed_24h += 1
            if status_code == 200:
                status_200_24h += 1
            if client_name:
                active_clients.add(client_name)

            ep = endpoint_stats[(method, endpoint)]
            ep["method"] = method
            ep["endpoint"] = endpoint
            ep["total"] += 1
            if 200 <= status_code < 300:
                ep["success"] += 1
            if status_code >= 400:
                ep["failed"] += 1
            if status_code == 200:
                ep["status_200"] += 1
            if ledger.response_time_ms is not None:
                ep["response_time_sum_ms"] += ledger.response_time_ms
                ep["response_time_samples"] += 1
            if not ep["last_seen_at"] or (created_at and created_at > ep["last_seen_at"]):
                ep["last_seen_at"] = created_at

            cep = client_endpoint_stats[(client_name, method, endpoint)]
            cep["client_name"] = client_name
            cep["endpoint"] = endpoint
            cep["method"] = method
            cep["rate_limit_per_minute"] = rate_limit
            cep["total"] += 1
            if 200 <= status_code < 300:
                cep["success"] += 1
            if status_code >= 400:
                cep["failed"] += 1
            if status_code == 200:
                cep["status_200"] += 1
            if ledger.response_time_ms is not None:
                cep["response_time_sum_ms"] += ledger.response_time_ms
                cep["response_time_samples"] += 1
            if created_at and created_at >= one_hour_ago:
                cep["calls_last_hour"] += 1
            if not cep["last_seen_at"] or (created_at and created_at > cep["last_seen_at"]):
                cep["last_seen_at"] = created_at

            if created_at and created_at >= one_hour_ago:
                bucket = created_at.replace(second=0, microsecond=0)
                flow_by_minute[bucket] += 1

            if len(recent_logs) < 200:
                recent_logs.append(
                    {
                        "at": to_iso(created_at),
                        "client_name": client_name,
                        "method": method,
                        "endpoint": endpoint,
                        "status_code": status_code,
                        "response_time_ms": ledger.response_time_ms,
                        "tokens_used": ledger.tokens_used or 0,
                    }
                )

        endpoint_rows = []
        for row in endpoint_stats.values():
            total = row["total"] or 1
            avg_ms = (
                row["response_time_sum_ms"] / row["response_time_samples"]
                if row["response_time_samples"]
                else None
            )
            endpoint_rows.append(
                {
                    "method": row["method"],
                    "endpoint": row["endpoint"],
                    "total": row["total"],
                    "success": row["success"],
                    "failed": row["failed"],
                    "status_200": row["status_200"],
                    "success_rate_pct": round((row["success"] / total) * 100, 2),
                    "status_200_rate_pct": round((row["status_200"] / total) * 100, 2),
                    "avg_response_time_ms": round(avg_ms, 1) if avg_ms is not None else None,
                    "last_seen_at": to_iso(row["last_seen_at"]),
                }
            )

        endpoint_rows.sort(key=lambda x: x["total"], reverse=True)

        client_endpoint_rows = []
        for row in client_endpoint_stats.values():
            total = row["total"] or 1
            avg_ms = (
                row["response_time_sum_ms"] / row["response_time_samples"]
                if row["response_time_samples"]
                else None
            )
            rate_limit = row["rate_limit_per_minute"] or 0
            calls_per_minute = round(row["calls_last_hour"] / 60, 3)
            rateflow_pct = round((calls_per_minute / rate_limit) * 100, 2) if rate_limit else 0
            client_endpoint_rows.append(
                {
                    "client_name": row["client_name"],
                    "method": row["method"],
                    "endpoint": row["endpoint"],
                    "total": row["total"],
                    "success": row["success"],
                    "failed": row["failed"],
                    "status_200": row["status_200"],
                    "success_rate_pct": round((row["success"] / total) * 100, 2),
                    "status_200_rate_pct": round((row["status_200"] / total) * 100, 2),
                    "avg_response_time_ms": round(avg_ms, 1) if avg_ms is not None else None,
                    "calls_last_hour": row["calls_last_hour"],
                    "calls_per_minute": calls_per_minute,
                    "rate_limit_per_minute": rate_limit,
                    "rateflow_pct": rateflow_pct,
                    "last_seen_at": to_iso(row["last_seen_at"]),
                }
            )

        client_endpoint_rows.sort(key=lambda x: x["total"], reverse=True)

        flow_points = []
        minute_cursor = one_hour_ago.replace(second=0, microsecond=0)
        end_minute = now.replace(second=0, microsecond=0)
        while minute_cursor <= end_minute:
            flow_points.append(
                {
                    "minute": to_iso(minute_cursor),
                    "requests": flow_by_minute.get(minute_cursor, 0),
                }
            )
            minute_cursor += timedelta(minutes=1)

        overall_success_rate = round((success_24h / total_24h) * 100, 2) if total_24h else 0
        overall_status_200_rate = round((status_200_24h / total_24h) * 100, 2) if total_24h else 0

        return jsonify(
            {
                "window": {
                    "from": to_iso(one_day_ago),
                    "to": to_iso(now),
                },
                "health": {
                    "api_status": "up",
                    "db_status": "up" if db_ok else "down",
                },
                "kpis": {
                    "total_requests_24h": total_24h,
                    "success_requests_24h": success_24h,
                    "failed_requests_24h": failed_24h,
                    "status_200_requests_24h": status_200_24h,
                    "success_rate_pct": overall_success_rate,
                    "status_200_rate_pct": overall_status_200_rate,
                    "active_clients_24h": len(active_clients),
                    "tracked_endpoints_24h": len(endpoint_rows),
                },
                "endpoints": endpoint_rows,
                "client_endpoints": client_endpoint_rows,
                "flow_last_hour": flow_points,
                "recent_logs": recent_logs,
            }
        )
    finally:
        session.close()


@app.route("/admin/dashboard.json", methods=["GET"])
def admin_dashboard_json():
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        one_hour_ago = now - timedelta(hours=1)
        one_day_ago = now - timedelta(hours=24)

        # Totals
        projects = session.query(Project).count()
        sites = session.query(Site).count()
        cameras = session.query(Camera).all()
        zones = session.query(Zone).all()
        zone_states = session.query(ZoneState).all()

        cam_online = sum(1 for c in cameras if c.status == "ONLINE")
        cam_stale = sum(1 for c in cameras if c.status == "STALE")
        cam_offline = sum(1 for c in cameras if c.status in ("OFFLINE", "UNKNOWN", None))

        zones_free = sum(1 for zs in zone_states if zs.state == "FREE")
        zones_full = sum(1 for zs in zone_states if zs.state == "FULL")

        events_1h = session.query(ZoneEvent).filter(ZoneEvent.triggered_at >= one_hour_ago).count()
        events_24h = session.query(ZoneEvent).filter(ZoneEvent.triggered_at >= one_day_ago).count()

        # System metrics
        snapshots_1h = session.query(Snapshot).filter(Snapshot.received_at >= one_hour_ago).count()
        snapshots_total = session.query(Snapshot).count()
        pending_queue = session.query(Snapshot).filter(Snapshot.processed_at.is_(None)).count()

        tokens_today = session.query(TokenLedger).filter(
            TokenLedger.created_at >= now.replace(hour=0, minute=0, second=0)
        ).count()

        # Disk usage
        try:
            disk = shutil.disk_usage("/")
            disk_total_gb = round(disk.total / (1024**3), 1)
            disk_used_gb = round(disk.used / (1024**3), 1)
            disk_free_gb = round(disk.free / (1024**3), 1)
            disk_used_str = f"{disk_used_gb} GB / {disk_total_gb} GB"
            disk_free_str = f"{disk_free_gb} GB"
        except Exception:
            disk_used_str = "N/A"
            disk_free_str = "N/A"

        # Snapshot disk usage (images folder)
        try:
            result = subprocess.run(
                ["du", "-sb", IMAGE_ROOT],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                snap_bytes = int(result.stdout.split()[0])
                if snap_bytes >= 1024**3:
                    snap_disk_str = f"{round(snap_bytes / (1024**3), 2)} GB"
                else:
                    snap_disk_str = f"{round(snap_bytes / (1024**2), 1)} MB"
            else:
                snap_disk_str = "0 MB"
        except Exception:
            snap_disk_str = "N/A"

        # Camera details
        camera_list = []
        for cam in cameras[:10]:
            snaps = session.query(Snapshot).filter(
                Snapshot.camera_id == cam.id,
                Snapshot.received_at >= one_hour_ago
            ).count()
            camera_list.append({
                "camera_id": cam.camera_id,
                "name": cam.name,
                "status": cam.status or "UNKNOWN",
                "last_seen_at": to_iso(cam.last_seen_at),
                "snapshots_1h": snaps,
            })

        # Recent events
        recent_events = session.query(ZoneEvent, Zone).join(Zone, ZoneEvent.zone_id == Zone.id).order_by(
            ZoneEvent.triggered_at.desc()
        ).limit(10).all()

        events_list = []
        for evt, z in recent_events:
            events_list.append({
                "zone_id": z.zone_id,
                "old_state": evt.old_state,
                "new_state": evt.new_state,
                "triggered_at": to_iso(evt.triggered_at),
            })

        return jsonify({
            "totals": {
                "projects": projects,
                "sites": sites,
                "cameras": len(cameras),
                "cameras_online": cam_online,
                "cameras_stale": cam_stale,
                "cameras_offline": cam_offline,
                "zones": len(zones),
                "zones_free": zones_free,
                "zones_full": zones_full,
                "events_1h": events_1h,
                "events_24h": events_24h,
                "snapshots_total": snapshots_total,
            },
            "system": {
                "ftp_rate_hour": snapshots_1h,
                "queue_pending": pending_queue,
                "queue_delay_sec": 0,
                "disk_used": disk_used_str,
                "disk_free": disk_free_str,
                "snap_disk": snap_disk_str,
                "tokens_today": tokens_today,
            },
            "cameras": camera_list,
            "recent_events": events_list,
        })
    finally:
        session.close()


@app.route("/admin/frontendv2/clients.json", methods=["GET"])
def admin_frontend_v2_clients_json():
    """Client-centric monitoring payload for the new command center UI."""
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        one_hour_ago = now - timedelta(hours=1)
        one_day_ago = now - timedelta(hours=24)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        clients = session.query(APIClient).all()
        cameras = session.query(Camera).all()
        sites = session.query(Site).all()
        site_name_by_id = {s.id: s.name for s in sites}

        cameras_by_site = {}
        for cam in cameras:
            cameras_by_site.setdefault(cam.site_id, []).append(cam)

        result = []
        for client in clients:
            raw_site_ids = _json_loads_safe(client.site_ids)
            if isinstance(raw_site_ids, list) and raw_site_ids:
                site_ids = {int(sid) for sid in raw_site_ids if str(sid).isdigit()}
            else:
                # If no explicit site mapping, treat as global read client.
                site_ids = {s.id for s in sites}

            client_cameras = []
            for sid in site_ids:
                client_cameras.extend(cameras_by_site.get(sid, []))
            camera_db_ids = [cam.id for cam in client_cameras]

            calls_today = session.query(TokenLedger).filter(
                TokenLedger.api_client_id == client.id,
                TokenLedger.created_at >= today_start,
            ).count()
            tokens_today = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
                TokenLedger.api_client_id == client.id,
                TokenLedger.created_at >= today_start,
            ).scalar() or 0

            online = sum(1 for cam in client_cameras if cam.status == "ONLINE")
            stale = sum(1 for cam in client_cameras if cam.status == "STALE")
            offline = sum(1 for cam in client_cameras if cam.status in ("OFFLINE", "UNKNOWN", None))

            # Cars detected in the last 24h. Keep class matching flexible.
            cars_detected_24h = 0
            bandwidth_bytes_24h = 0
            if camera_db_ids:
                cars_detected_24h = (
                    session.query(Detection)
                    .join(Snapshot, Detection.snapshot_id == Snapshot.id)
                    .filter(
                        Snapshot.camera_id.in_(camera_db_ids),
                        Snapshot.received_at >= one_day_ago,
                        func.lower(Detection.class_name).in_(["car", "vehicle"]),
                    )
                    .count()
                )

                snapshots = session.query(Snapshot).filter(
                    Snapshot.camera_id.in_(camera_db_ids),
                    Snapshot.received_at >= one_day_ago,
                ).all()
                for snap in snapshots:
                    abs_path = _safe_image_path(snap.file_path)
                    if abs_path and os.path.exists(abs_path):
                        try:
                            bandwidth_bytes_24h += os.path.getsize(abs_path)
                        except OSError:
                            pass

            last_call = (
                session.query(TokenLedger.created_at)
                .filter(TokenLedger.api_client_id == client.id)
                .order_by(TokenLedger.created_at.desc())
                .limit(1)
                .scalar()
            )

            result.append({
                "id": client.id,
                "name": client.name,
                "sites": [site_name_by_id[sid] for sid in sorted(site_ids) if sid in site_name_by_id],
                "status": "online" if calls_today > 0 else "idle",
                "enabled": True,
                "rate_limit_per_minute": client.rate_limit_per_minute or 60,
                "last_call_at": to_iso(last_call),
                "last_used_at": to_iso(client.last_used_at),
                "calls_today": calls_today,
                "tokens_today": int(tokens_today),
                "cars_detected_24h": cars_detected_24h,
                "bandwidth_bytes_24h": bandwidth_bytes_24h,
                # Placeholder until resource telemetry is tracked per client server-side.
                "cpu_percent": None,
                "ram_mb": None,
                "activity_1h": session.query(TokenLedger).filter(
                    TokenLedger.api_client_id == client.id,
                    TokenLedger.created_at >= one_hour_ago,
                ).count(),
                "camera_totals": {
                    "total": len(client_cameras),
                    "online": online,
                    "stale": stale,
                    "offline": offline,
                },
            })

        return jsonify({"clients": result})
    finally:
        session.close()


@app.route("/admin/frontendv2/snapshots/search.json", methods=["GET"])
def admin_frontend_v2_snapshot_search_json():
    """Search snapshots by exact time range and optional camera/client filter."""
    session = SessionLocal()
    try:
        from_iso = request.args.get("from")
        to_iso_value = request.args.get("to")
        camera_id = request.args.get("camera_id")
        client_id = request.args.get("client_id")
        limit = max(1, min(int(request.args.get("limit", 120)), 500))

        if not from_iso or not to_iso_value:
            return jsonify({"error": "from_and_to_required"}), 400

        start = parse_iso(from_iso)
        end = parse_iso(to_iso_value)
        if not start or not end:
            return jsonify({"error": "invalid_datetime"}), 400
        if end <= start:
            return jsonify({"error": "invalid_range"}), 400

        query = session.query(Snapshot, Camera).join(Camera, Camera.id == Snapshot.camera_id)
        query = query.filter(Snapshot.received_at >= start, Snapshot.received_at <= end)

        if camera_id:
            query = query.filter(Camera.camera_id == camera_id)

        if client_id:
            client = session.query(APIClient).filter(APIClient.id == int(client_id)).first()
            if client:
                raw_site_ids = _json_loads_safe(client.site_ids)
                if isinstance(raw_site_ids, list) and raw_site_ids:
                    site_ids = [int(sid) for sid in raw_site_ids if str(sid).isdigit()]
                    if site_ids:
                        query = query.filter(Camera.site_id.in_(site_ids))

        rows = query.order_by(Snapshot.received_at.desc()).limit(limit).all()
        snapshots = []
        for snap, cam in rows:
            detections_count = session.query(Detection).filter(Detection.snapshot_id == snap.id).count()
            snapshots.append({
                "snapshot_id": snap.id,
                "camera_id": cam.camera_id,
                "camera_name": cam.name,
                "received_at": to_iso(snap.received_at),
                "processed_at": to_iso(snap.processed_at),
                "decision_status": snap.decision_status,
                "skip_reason": snap.skip_reason,
                "yolo_vehicle_objects": snap.yolo_vehicle_objects,
                "detections_count": detections_count,
                "image_url": f"/admin/snapshots/{snap.id}/image",
                "evidence_image_url": f"/admin/snapshots/{snap.id}/evidence-image",
            })

        return jsonify({
            "from": to_iso(start),
            "to": to_iso(end),
            "count": len(snapshots),
            "snapshots": snapshots,
        })
    finally:
        session.close()


@app.route("/admin/dashboard-detections.json", methods=["GET"])
def admin_dashboard_detections_json():
    """Detection stats for the dashboard chart: hourly buckets with count, avg/min/max confidence."""
    session = SessionLocal()
    try:
        hours = int(request.args.get("hours", 24))
        hours = min(hours, 168)  # cap at 7 days
        now = datetime.utcnow()
        since = now - timedelta(hours=hours)

        # Join detections with snapshots to get time info
        rows = (
            session.query(
                func.date_trunc("hour", Snapshot.received_at).label("bucket"),
                Detection.class_name,
                func.count(Detection.id).label("count"),
                func.round(func.avg(Detection.confidence).cast(db_Numeric), 3).label("avg_conf"),
                func.round(func.min(Detection.confidence).cast(db_Numeric), 3).label("min_conf"),
                func.round(func.max(Detection.confidence).cast(db_Numeric), 3).label("max_conf"),
            )
            .join(Snapshot, Detection.snapshot_id == Snapshot.id)
            .filter(Snapshot.received_at >= since)
            .group_by("bucket", Detection.class_name)
            .order_by(text("bucket"))
            .all()
        )

        buckets = {}
        for row in rows:
            ts = row.bucket.isoformat() + "Z" if row.bucket else None
            if ts not in buckets:
                buckets[ts] = {"time": ts, "classes": {}}
            buckets[ts]["classes"][row.class_name or "unknown"] = {
                "count": row.count,
                "avg_conf": float(row.avg_conf) if row.avg_conf else 0,
                "min_conf": float(row.min_conf) if row.min_conf else 0,
                "max_conf": float(row.max_conf) if row.max_conf else 0,
            }

        # Also get overall totals
        totals = (
            session.query(
                Detection.class_name,
                func.count(Detection.id).label("count"),
                func.round(func.avg(Detection.confidence).cast(db_Numeric), 3).label("avg_conf"),
                func.round(func.min(Detection.confidence).cast(db_Numeric), 3).label("min_conf"),
                func.round(func.max(Detection.confidence).cast(db_Numeric), 3).label("max_conf"),
            )
            .join(Snapshot, Detection.snapshot_id == Snapshot.id)
            .filter(Snapshot.received_at >= since)
            .group_by(Detection.class_name)
            .all()
        )

        total_map = {}
        for t in totals:
            total_map[t.class_name or "unknown"] = {
                "count": t.count,
                "avg_conf": float(t.avg_conf) if t.avg_conf else 0,
                "min_conf": float(t.min_conf) if t.min_conf else 0,
                "max_conf": float(t.max_conf) if t.max_conf else 0,
            }

        # Snapshots per hour for throughput line
        snap_rows = (
            session.query(
                func.date_trunc("hour", Snapshot.received_at).label("bucket"),
                func.count(Snapshot.id).label("count"),
            )
            .filter(Snapshot.received_at >= since)
            .group_by("bucket")
            .order_by(text("bucket"))
            .all()
        )
        snap_buckets = [{"time": r.bucket.isoformat() + "Z", "count": r.count} for r in snap_rows]

        return jsonify({
            "hours": hours,
            "detection_buckets": list(buckets.values()),
            "totals_by_class": total_map,
            "snapshot_throughput": snap_buckets,
        })
    finally:
        session.close()


@app.route("/admin/dashboard-baseline.json", methods=["GET"])
def admin_dashboard_baseline_json():
    path = request.args.get("path") or BASELINE_REPORT_PATH
    try:
        if not os.path.exists(path):
            return jsonify({
                "status": "missing",
                "message": "baseline report not found",
                "path": path,
            }), 404

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        return jsonify({
            "status": "ok",
            "path": path,
            "report": data,
        })
    except (OSError, json.JSONDecodeError) as exc:
        return jsonify({
            "status": "error",
            "path": path,
            "message": str(exc),
        }), 500


@app.route("/admin/cameras-detail.json", methods=["GET"])
def admin_cameras_detail_json():
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        one_hour_ago = now - timedelta(hours=1)

        cameras = session.query(Camera).all()
        # Pre-fetch site names for efficient lookup
        site_map = {s.id: s.name for s in session.query(Site).all()}
        result = []
        for cam in cameras:
            zone_count = session.query(Zone).filter(Zone.camera_id == cam.id).count()
            snaps_1h = session.query(Snapshot).filter(
                Snapshot.camera_id == cam.id,
                Snapshot.received_at >= one_hour_ago
            ).count()
            latest_snap = session.query(Snapshot).filter(
                Snapshot.camera_id == cam.id
            ).order_by(Snapshot.received_at.desc()).first()

            result.append({
                "camera_id": cam.camera_id,
                "name": cam.name,
                "brand": cam.brand,
                "model": cam.model,
                "site_id": cam.site_id,
                "site_name": site_map.get(cam.site_id, ""),
                "ingest_protocol": cam.ingest_protocol or "ftp",
                "status": cam.status or "UNKNOWN",
                "ftp_username": cam.ftp_username,
                "ftp_password": cam.ftp_password_hash or "",
                "ftp_password_set": bool(cam.ftp_password_hash),
                "last_seen_at": to_iso(cam.last_seen_at),
                "last_inference": to_iso(latest_snap.processed_at) if latest_snap else None,
                "snapshots_1h": snaps_1h,
                "zone_count": zone_count,
                "has_snapshot": latest_snap is not None,
            })
        ext_ip = os.environ.get("EXTERNAL_IP", os.environ.get("FTP_PUBLICHOST", "<server-ip>"))
        return jsonify({"cameras": result, "ftp_server": ext_ip, "ftp_port": 21, "ftp_remote_dir": "incoming"})
    finally:
        session.close()


@app.route("/admin/zones", methods=["GET"])
def admin_zones():
    return render_template("admin_zones.html")


@app.route("/admin/zones.json", methods=["GET"])
def admin_zones_json():
    """Public-facing zones endpoint for dashboards and the YOLO worker.
    Returns only real parking spaces (no meta sentinels).
    Uses LEFT OUTER JOIN so zones missing a ZoneState row are still returned."""
    session = SessionLocal()
    try:
        camera_filter = request.args.get("camera_id")
        state_filter = request.args.get("state")
        project_filter = request.args.get("project_id")
        site_filter = request.args.get("site_id")

        query = session.query(Zone, ZoneState, Camera).outerjoin(
            ZoneState, ZoneState.zone_id == Zone.id
        ).join(Camera, Camera.id == Zone.camera_id).join(Site, Site.id == Camera.site_id)

        if camera_filter:
            query = query.filter(Camera.camera_id == camera_filter)
        if state_filter:
            query = query.filter(ZoneState.state == state_filter)
        if project_filter and str(project_filter).isdigit():
            query = query.filter(Site.project_id == int(project_filter))
        if site_filter and str(site_filter).isdigit():
            query = query.filter(Camera.site_id == int(site_filter))

        rows = query.all()

        zones = []
        total_occupied = 0
        total_capacity = 0
        count_free = 0
        count_partial = 0
        count_full = 0

        for z, zs, cam in rows:
            capacity = z.capacity_units or 1
            occupied = (zs.occupied_units or 0) if zs else 0
            total_occupied += occupied
            total_capacity += capacity

            state = (zs.state or "FREE") if zs else "FREE"
            if state == "FREE":
                count_free += 1
            elif state == "PARTIAL":
                count_partial += 1
            elif state == "FULL":
                count_full += 1

            # Meta-sentinel zones are real spaces; display zone_id as name
            display_name = z.zone_id if (z.name and z.name.startswith("__campark_meta__")) else z.name

            zones.append({
                "zone_id": z.zone_id,
                "name": display_name,
                "camera_id": cam.camera_id,
                "polygon_json": z.polygon_json,
                "state": state,
                "occupied": occupied,
                "capacity": capacity,
                "last_change": to_iso(zs.last_change_at) if zs else None,
            })

        return jsonify({
            "zones": zones,
            "summary": {
                "free": count_free,
                "partial": count_partial,
                "full": count_full,
                "total_occupied": total_occupied,
                "total_capacity": total_capacity,
            },
        })
    finally:
        session.close()


@app.route("/admin/zones/editor-raw.json", methods=["GET"])
def admin_zones_editor_raw():
    """Raw zones endpoint for the zone editor only.
    Returns all rows including __campark_meta__ sentinels for perfect lane round-trip."""
    session = SessionLocal()
    try:
        camera_filter = request.args.get("camera_id")
        query = session.query(Zone, Camera).join(Camera, Camera.id == Zone.camera_id)
        if camera_filter:
            query = query.filter(Camera.camera_id == camera_filter)
        rows = query.all()

        zones = []
        for z, cam in rows:
            zones.append({
                "zone_id": z.zone_id,
                "name": z.name,
                "camera_id": cam.camera_id,
                "polygon_json": z.polygon_json,
                "capacity": z.capacity_units or 1,
            })

        return jsonify({"zones": zones})
    finally:
        session.close()


@app.route("/admin/events", methods=["GET"])
def admin_events():
    return render_template("admin_events.html")


# ── Outbound push proxy ───────────────────────────────────────────────────────
# Proxies requests from the API Console to external client endpoints.
# Auth guard is handled automatically by admin_auth_guard() for /admin/* routes.
# SSRF protection blocks requests to private / loopback IP ranges.

import ipaddress as _ipaddress

_BLOCKED_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"})
_BLOCKED_NETS = [
    _ipaddress.ip_network("10.0.0.0/8"),
    _ipaddress.ip_network("172.16.0.0/12"),
    _ipaddress.ip_network("192.168.0.0/16"),
    _ipaddress.ip_network("169.254.0.0/16"),   # link-local
    _ipaddress.ip_network("100.64.0.0/10"),    # shared address space
    _ipaddress.ip_network("::1/128"),
    _ipaddress.ip_network("fc00::/7"),         # unique local IPv6
    _ipaddress.ip_network("fe80::/10"),        # link-local IPv6
]
_ALLOWED_METHODS = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"})
# Headers that must never be forwarded to external servers
_STRIP_HEADERS = frozenset({
    "host", "cookie", "authorization", "x-forwarded-for", "x-real-ip",
    "x-forwarded-host", "x-forwarded-proto", "forwarded",
})
_MAX_RESPONSE_BYTES = 512 * 1024  # 512 KB


@app.route("/admin/outbound/proxy", methods=["POST"])
def outbound_proxy():
    """Server-side proxy used by the API Console for external endpoint testing.

    Accepts JSON body::

        {
          "method":  "POST",
          "url":     "https://client.example.com/webhook",
          "headers": {"Authorization": "Bearer …"},
          "body":    { … }   // JSON object, string, or null
        }

    Returns proxied response details as JSON.
    """
    payload = request.get_json(silent=True) or {}
    method = str(payload.get("method", "POST")).upper()
    url = str(payload.get("url", "")).strip()
    req_headers = payload.get("headers") or {}
    req_body = payload.get("body")

    # ── Validate method ───────────────────────────────────────────────────────
    if method not in _ALLOWED_METHODS:
        return jsonify({"error": "invalid_method", "detail": f"Must be one of {sorted(_ALLOWED_METHODS)}"}), 400

    # ── Validate URL ──────────────────────────────────────────────────────────
    if not url:
        return jsonify({"error": "url_required"}), 400
    try:
        parsed = urlparse(url)
    except Exception:
        return jsonify({"error": "invalid_url"}), 400

    if parsed.scheme not in ("http", "https"):
        return jsonify({"error": "url_must_use_http_or_https"}), 400

    hostname = (parsed.hostname or "").lower().strip("[]")
    if not hostname:
        return jsonify({"error": "url_missing_hostname"}), 400

    if hostname in _BLOCKED_HOSTS:
        return jsonify({"error": "url_targets_blocked_host"}), 403

    # Block raw private / loopback IPs
    try:
        ip = _ipaddress.ip_address(hostname)
        for net in _BLOCKED_NETS:
            if ip in net:
                return jsonify({"error": "url_targets_private_network"}), 403
    except ValueError:
        pass  # Not a raw IP — hostname DNS resolution happens at request time

    # ── Build safe headers ────────────────────────────────────────────────────
    safe_headers: dict = {
        k: v for k, v in (req_headers if isinstance(req_headers, dict) else {}).items()
        if k.lower() not in _STRIP_HEADERS
    }
    safe_headers.setdefault("User-Agent", "CamPark-Console/1.0")

    # ── Dispatch ──────────────────────────────────────────────────────────────
    t0 = time.time()
    try:
        kwargs: dict = {
            "headers": safe_headers,
            "timeout": 10,
            "allow_redirects": True,
            "stream": True,
        }
        if req_body is not None and method not in ("GET", "HEAD"):
            if isinstance(req_body, (dict, list)):
                kwargs["json"] = req_body
                safe_headers.setdefault("Content-Type", "application/json")
            else:
                kwargs["data"] = str(req_body)

        fn = getattr(requests, method.lower())
        resp = fn(url, **kwargs)
        ms = int((time.time() - t0) * 1000)

        # Cap response body to avoid memory abuse
        raw = b""
        for chunk in resp.iter_content(chunk_size=8192):
            raw += chunk
            if len(raw) >= _MAX_RESPONSE_BYTES:
                break
        resp.close()

        ct = resp.headers.get("content-type", "")
        try:
            body_str = raw.decode("utf-8", errors="replace")
        except Exception:
            body_str = repr(raw)

        # Strip hop-by-hop headers before forwarding
        skip = {"transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailers"}
        resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in skip}

        return jsonify({
            "status": resp.status_code,
            "status_text": resp.reason,
            "headers": resp_headers,
            "body": body_str,
            "content_type": ct,
            "size": len(raw),
            "ms": ms,
            "ok": resp.ok,
        })

    except requests.exceptions.Timeout:
        return jsonify({
            "error": "request_timeout",
            "detail": "The upstream server did not respond within 10 seconds.",
            "ms": int((time.time() - t0) * 1000),
        }), 504

    except requests.exceptions.SSLError as exc:
        return jsonify({
            "error": "ssl_error",
            "detail": str(exc),
            "ms": int((time.time() - t0) * 1000),
        }), 502

    except requests.exceptions.ConnectionError as exc:
        return jsonify({
            "error": "connection_failed",
            "detail": str(exc),
            "ms": int((time.time() - t0) * 1000),
        }), 502

    except Exception as exc:
        return jsonify({
            "error": "proxy_error",
            "detail": str(exc),
            "ms": int((time.time() - t0) * 1000),
        }), 500


# ──────────────────────────────────────────────────────────────────────────────
# Push Console — client CRUD (v6 Push Console backend)
# ──────────────────────────────────────────────────────────────────────────────

@app.route("/admin/push-clients.json", methods=["GET"])
def push_clients_list():
    if not session.get("admin"):
        return jsonify({"error": "unauthorized"}), 401
    project_id = request.args.get("project_id", type=int)
    db = SessionLocal()
    try:
        q = db.query(PushClient)
        if project_id:
            q = q.filter(PushClient.project_id == project_id)
        clients = q.order_by(PushClient.created_at.desc()).all()
        return jsonify({"clients": [
            {
                "id": c.id,
                "project_id": c.project_id,
                "name": c.name,
                "description": c.description,
                "config_json": c.config_json,
                "paused": c.paused,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in clients
        ]})
    finally:
        db.close()


@app.route("/admin/push-clients", methods=["POST"])
def push_clients_create():
    if not session.get("admin"):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    project_id = data.get("project_id")
    config = data.get("config_json")
    if not project_id or not config:
        return jsonify({"error": "project_id and config_json required"}), 400
    db = SessionLocal()
    try:
        cfg = json.loads(config) if isinstance(config, str) else config
        client_id = cfg.get("id") or f"cli_{secrets.token_hex(4)}"
        client = PushClient(
            id=client_id,
            project_id=int(project_id),
            name=cfg.get("name", "Unnamed"),
            description=cfg.get("description") or None,
            config_json=json.dumps(cfg) if not isinstance(config, str) else config,
            paused=bool(cfg.get("paused", False)),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(client)
        db.commit()
        return jsonify({"id": client.id, "status": "created"}), 201
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@app.route("/admin/push-clients/<client_id>", methods=["PUT"])
def push_clients_update(client_id):
    if not session.get("admin"):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    db = SessionLocal()
    try:
        client = db.query(PushClient).filter_by(id=client_id).first()
        if not client:
            return jsonify({"error": "not_found"}), 404
        if "config_json" in data:
            cfg = data["config_json"]
            client.config_json = json.dumps(cfg) if not isinstance(cfg, str) else cfg
        if "paused" in data:
            client.paused = bool(data["paused"])
        if "name" in data:
            client.name = data["name"]
        if "description" in data:
            client.description = data.get("description") or None
        client.updated_at = datetime.utcnow()
        db.commit()
        return jsonify({"id": client.id, "status": "updated"})
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@app.route("/admin/push-clients/<client_id>", methods=["DELETE"])
def push_clients_delete(client_id):
    if not session.get("admin"):
        return jsonify({"error": "unauthorized"}), 401
    db = SessionLocal()
    try:
        client = db.query(PushClient).filter_by(id=client_id).first()
        if not client:
            return jsonify({"error": "not_found"}), 404
        db.delete(client)
        db.commit()
        return jsonify({"status": "deleted"})
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@app.route("/admin/decisions", methods=["GET"])
def admin_decisions():
    return render_template("admin_decisions.html")


@app.route("/admin/events.json", methods=["GET"])
def admin_events_json():
    session = SessionLocal()
    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 20))
        camera_filter = request.args.get("camera_id")
        zone_filter = request.args.get("zone_id")
        event_type = request.args.get("event_type")
        date_filter = request.args.get("date")

        query = session.query(ZoneEvent, Zone, Camera).join(
            Zone, ZoneEvent.zone_id == Zone.id
        ).join(Camera, Camera.id == Zone.camera_id)

        if camera_filter:
            query = query.filter(Camera.camera_id == camera_filter)
        if zone_filter:
            query = query.filter(Zone.zone_id == zone_filter)
        if event_type:
            query = query.filter(ZoneEvent.event_type == event_type)
        if date_filter:
            try:
                dt = datetime.strptime(date_filter, "%Y-%m-%d")
                query = query.filter(
                    ZoneEvent.triggered_at >= dt,
                    ZoneEvent.triggered_at < dt + timedelta(days=1)
                )
            except ValueError:
                pass

        total = query.count()
        rows = query.order_by(ZoneEvent.triggered_at.desc()).offset((page - 1) * limit).limit(limit).all()

        events = []
        for evt, z, cam in rows:
            events.append({
                "id": evt.id,
                "camera_id": cam.camera_id,
                "zone_id": z.zone_id,
                "event_type": evt.event_type or "OCCUPANCY_CHANGE",
                "old_state": evt.old_state,
                "new_state": evt.new_state,
                "old_units": evt.old_units,
                "new_units": evt.new_units,
                "triggered_at": to_iso(evt.triggered_at),
                "has_snapshot": evt.snapshot_id is not None,
                "details": _json_loads_safe(evt.details_json),
            })

        return jsonify({"events": events, "total": total, "page": page, "limit": limit})
    finally:
        session.close()


@app.route("/admin/tokens", methods=["GET"])
def admin_tokens():
    return render_template("admin_tokens.html")


@app.route("/admin/tokens/summary.json", methods=["GET"])
def admin_tokens_summary():
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        week_start = today_start - timedelta(days=7)
        month_start = today_start - timedelta(days=30)

        from sqlalchemy import func

        # Tokens charged (sum of tokens_used, i.e. 1 per car park)
        tokens_today = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
            TokenLedger.created_at >= today_start
        ).scalar()
        tokens_yesterday = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
            TokenLedger.created_at >= yesterday_start,
            TokenLedger.created_at < today_start
        ).scalar()
        tokens_week = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
            TokenLedger.created_at >= week_start
        ).scalar()
        tokens_month = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
            TokenLedger.created_at >= month_start
        ).scalar()

        # API calls (count of rows regardless of tokens)
        calls_today = session.query(TokenLedger).filter(TokenLedger.created_at >= today_start).count()
        calls_week = session.query(TokenLedger).filter(TokenLedger.created_at >= week_start).count()
        calls_month = session.query(TokenLedger).filter(TokenLedger.created_at >= month_start).count()

        active_clients = session.query(TokenLedger.api_client_id).filter(
            TokenLedger.created_at >= today_start
        ).distinct().count()

        return jsonify({
            "tokens_today": int(tokens_today),
            "tokens_yesterday": int(tokens_yesterday),
            "tokens_week": int(tokens_week),
            "tokens_month": int(tokens_month),
            "calls_today": calls_today,
            "calls_week": calls_week,
            "calls_month": calls_month,
            "active_clients": active_clients,
        })
    finally:
        session.close()


@app.route("/admin/tokens/by-client.json", methods=["GET"])
def admin_tokens_by_client():
    session = SessionLocal()
    try:
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=7)
        month_start = today_start - timedelta(days=30)

        from sqlalchemy import func

        clients = session.query(APIClient).all()
        result = []
        for c in clients:
            # Tokens charged (sum)
            tokens_today = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
                TokenLedger.api_client_id == c.id,
                TokenLedger.created_at >= today_start
            ).scalar()
            tokens_week = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
                TokenLedger.api_client_id == c.id,
                TokenLedger.created_at >= week_start
            ).scalar()
            tokens_month = session.query(func.coalesce(func.sum(TokenLedger.tokens_used), 0)).filter(
                TokenLedger.api_client_id == c.id,
                TokenLedger.created_at >= month_start
            ).scalar()
            # API calls (count)
            calls_today = session.query(TokenLedger).filter(
                TokenLedger.api_client_id == c.id,
                TokenLedger.created_at >= today_start
            ).count()
            calls_week = session.query(TokenLedger).filter(
                TokenLedger.api_client_id == c.id,
                TokenLedger.created_at >= week_start
            ).count()

            result.append({
                "id": c.id,
                "name": c.name,
                "tokens_today": int(tokens_today),
                "tokens_week": int(tokens_week),
                "tokens_month": int(tokens_month),
                "calls_today": calls_today,
                "calls_week": calls_week,
                "rate_limit": c.rate_limit_per_minute or 60,
                "rate_usage_pct": 0,
                "last_used": to_iso(c.last_used_at),
            })

        return jsonify({"clients": result})
    finally:
        session.close()


@app.route("/admin/tokens/ledger.json", methods=["GET"])
def admin_tokens_ledger():
    session = SessionLocal()
    try:
        limit = int(request.args.get("limit", 50))
        client_id = request.args.get("client_id")
        endpoint = request.args.get("endpoint")
        date_filter = request.args.get("date")

        query = session.query(TokenLedger, APIClient).outerjoin(
            APIClient, APIClient.id == TokenLedger.api_client_id
        )

        if client_id:
            query = query.filter(TokenLedger.api_client_id == int(client_id))
        if endpoint:
            query = query.filter(TokenLedger.endpoint.like(f"%{endpoint}%"))
        if date_filter:
            try:
                dt = datetime.strptime(date_filter, "%Y-%m-%d")
                query = query.filter(
                    TokenLedger.created_at >= dt,
                    TokenLedger.created_at < dt + timedelta(days=1)
                )
            except ValueError:
                pass

        rows = query.order_by(TokenLedger.created_at.desc()).limit(limit).all()

        entries = []
        for t, c in rows:
            entries.append({
                "id": t.id,
                "client_name": c.name if c else None,
                "endpoint": t.endpoint,
                "method": t.method,
                "status_code": t.status_code,
                "response_time_ms": t.response_time_ms,
                "tokens_used": t.tokens_used,
                "created_at": to_iso(t.created_at),
            })

        return jsonify({"entries": entries})
    finally:
        session.close()


@app.route("/admin/integrations", methods=["GET"])
def admin_integrations():
    return render_template("admin_integrations.html")


@app.route("/admin/api-keys.json", methods=["GET"])
def admin_api_keys_json():
    session = SessionLocal()
    try:
        clients = session.query(APIClient).all()
        result = []
        for c in clients:
            result.append({
                "id": c.id,
                "name": c.name,
                "site_ids": c.site_ids,
                "rate_limit": c.rate_limit_per_minute or 60,
                "last_used_at": to_iso(c.last_used_at),
                "created_at": to_iso(c.created_at),
            })
        return jsonify({"keys": result})
    finally:
        session.close()


@app.route("/admin/api-keys/<int:key_id>", methods=["DELETE"])
def admin_delete_api_key(key_id):
    session = SessionLocal()
    try:
        client = session.query(APIClient).filter(APIClient.id == key_id).first()
        if client:
            session.delete(client)
            session.commit()
        return jsonify({"status": "ok"})
    finally:
        session.close()


@app.route("/admin/system", methods=["GET"])
def admin_system():
    return render_template("admin_system.html")


@app.route("/admin/system/services.json", methods=["GET"])
def admin_system_services():
    session = SessionLocal()
    services = []
    try:
        # Check DB
        session.execute(text("SELECT 1"))
        services.append({"name": "PostgreSQL Database", "status": "up", "details": "Connected"})

        # API is running (we are here)
        services.append({"name": "API Server (Flask)", "status": "up", "details": f"v{APP_VERSION}"})

        # Worker status (check recent snapshots processed)
        recent = session.query(Snapshot).filter(
            Snapshot.processed_at >= datetime.utcnow() - timedelta(minutes=10)
        ).count()
        if recent > 0:
            services.append({"name": "Zone Classifier Worker", "status": "up", "details": f"{recent} processed (10m)"})
        else:
            services.append({"name": "Zone Classifier Worker", "status": "degraded", "details": "No recent processing"})

        # FTP (check recent snapshots received)
        received = session.query(Snapshot).filter(
            Snapshot.received_at >= datetime.utcnow() - timedelta(minutes=10)
        ).count()
        if received > 0:
            services.append({"name": "FTP Ingest", "status": "up", "details": f"{received} received (10m)"})
        else:
            services.append({"name": "FTP Ingest", "status": "degraded", "details": "No recent uploads"})
    except Exception:
        services.append({"name": "PostgreSQL Database", "status": "down", "details": "Connection failed"})
    finally:
        session.close()

    return jsonify({"services": services})


@app.route("/admin/system/resources.json", methods=["GET"])
def admin_system_resources():
    session = SessionLocal()
    try:
        # Database stats
        db_rows = session.query(Snapshot).count()
        img_count = db_rows

        # Images on disk
        img_path = os.path.join(IMAGE_ROOT)
        img_size = "N/A"
        try:
            total_size = 0
            for root, dirs, files in os.walk(img_path):
                for f in files:
                    total_size += os.path.getsize(os.path.join(root, f))
            img_size = f"{total_size / (1024*1024):.1f} MB"
        except Exception:
            pass

        # Queue
        pending = session.query(Snapshot).filter(Snapshot.processed_at.is_(None)).count()

        return jsonify({
            "disk": {"percent": 25, "used": "N/A", "total": "N/A"},
            "database": {"size": "N/A", "rows": db_rows},
            "images": {"count": img_count, "size": img_size},
            "queue": {"pending": pending, "rate": 0},
        })
    finally:
        session.close()


@app.route("/admin/system/config.json", methods=["GET"])
def admin_system_config():
    yolo_enabled = os.getenv("YOLO_ENABLED", "false").lower() == "true"
    return jsonify({
        "config": {
            "Detection Mode": "YOLO + Overlap" if yolo_enabled else os.getenv("ZONECLS_MODE", "placeholder"),
            "YOLO Enabled": str(yolo_enabled),
            "YOLO Model": os.getenv("YOLO_MODEL", "yolov8n.pt"),
            "YOLO Confidence": os.getenv("YOLO_CONFIDENCE", "0.50"),
            "Overlap Threshold": os.getenv("OVERLAP_THRESHOLD", "0.30"),
            "Poll Interval": os.getenv("POLL_INTERVAL", "1.0") + "s",
            "Image Root": IMAGE_ROOT,
            "Require API Key": os.getenv("REQUIRE_API_KEY", "false"),
        },
        "alerts": {
            "telegram_enabled": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID),
            "telegram_token_suffix": TELEGRAM_BOT_TOKEN[-6:] if TELEGRAM_BOT_TOKEN else None,
            "telegram_chat_id": TELEGRAM_CHAT_ID,
            "stale_seconds": STALE_SECONDS,
            "offline_seconds": OFFLINE_SECONDS,
            "health_interval": HEALTH_INTERVAL_SECONDS,
        },
    })


@app.route("/admin/system/settings.json", methods=["GET"])
def admin_system_settings_get():
    """Return current runtime settings stored in the DB (falls back to env defaults)."""
    session = SessionLocal()
    try:
        rows = session.query(SystemSetting).all()
        db_vals = {r.key: r.value for r in rows}
    finally:
        session.close()

    defaults = {
        "operating_hours_start": os.getenv("OPERATING_HOURS_START", "6"),
        "operating_hours_end":   os.getenv("OPERATING_HOURS_END", "18"),
        "scene_diff_threshold":  os.getenv("SCENE_DIFF_THRESHOLD", "6.0"),
    }
    return jsonify({**defaults, **db_vals})


@app.route("/admin/system/settings", methods=["POST"])
def admin_system_settings_save():
    """Upsert one or more runtime settings.  Body: {key: value, ...}"""
    data = request.get_json(force=True) or {}
    allowed_keys = {"operating_hours_start", "operating_hours_end", "scene_diff_threshold"}
    session = SessionLocal()
    try:
        for key, value in data.items():
            if key not in allowed_keys:
                continue
            row = session.query(SystemSetting).filter(SystemSetting.key == key).first()
            if row:
                row.value = str(value)
                row.updated_at = datetime.utcnow()
            else:
                session.add(SystemSetting(key=key, value=str(value), updated_at=datetime.utcnow()))
        session.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        session.rollback()
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        session.close()


@app.route("/admin/system/health-events.json", methods=["GET"])
def admin_system_health_events():
    session = SessionLocal()
    try:
        events = session.query(CameraHealthEvent, Camera).join(
            Camera, CameraHealthEvent.camera_id == Camera.id
        ).order_by(CameraHealthEvent.triggered_at.desc()).limit(20).all()

        result = []
        for evt, cam in events:
            result.append({
                "camera_id": cam.camera_id,
                "health_status": evt.health_status,
                "message": evt.message,
                "triggered_at": to_iso(evt.triggered_at),
            })

        return jsonify({"events": result})
    finally:
        session.close()


if ENABLE_HEALTH_MONITOR:
    monitor_thread = threading.Thread(target=monitor_camera_health, daemon=True)
    monitor_thread.start()

# Sync FTP users on startup
sync_ftp_users()

# ---- System metrics ring buffer (24 h of 5-min samples) ----
_METRICS_SAMPLE_INTERVAL = 300  # seconds
_system_metrics_buffer: deque = deque(maxlen=288)  # 288 × 5 min = 24 h
_gcs_bucket_cache: dict = {"size_bytes": None, "checked_at": 0.0}


def _get_gcs_bucket_size() -> int | None:
    """Return GCS bucket usage in bytes, cached for 5 min. Returns None if unavailable."""
    gcs_bucket = os.environ.get("GCS_BUCKET")
    if not gcs_bucket:
        return None
    now = time.time()
    if now - _gcs_bucket_cache["checked_at"] < 300 and _gcs_bucket_cache["size_bytes"] is not None:
        return _gcs_bucket_cache["size_bytes"]
    try:
        result = subprocess.run(
            ["gsutil", "du", "-s", f"gs://{gcs_bucket}"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and result.stdout.strip():
            size_bytes = int(result.stdout.strip().split()[0])
            _gcs_bucket_cache["size_bytes"] = size_bytes
            _gcs_bucket_cache["checked_at"] = now
            return size_bytes
    except Exception:
        pass
    return None


def _sample_system_metrics():
    """Collect a single system metrics snapshot and append to ring buffer."""
    try:
        mem = psutil.virtual_memory()
        disk_root = psutil.disk_usage("/")
        data_path = os.environ.get("DATA_PATH", "/data")
        try:
            disk_data = psutil.disk_usage(data_path)
            data_disk_pct = disk_data.percent
            data_disk_free_gb = round(disk_data.free / (1024 ** 3), 2)
            data_disk_total_gb = round(disk_data.total / (1024 ** 3), 2)
        except Exception:
            data_disk_pct = None
            data_disk_free_gb = None
            data_disk_total_gb = None
        sample = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "cpu_pct": psutil.cpu_percent(interval=1),
            "ram_pct": mem.percent,
            "ram_used_gb": round(mem.used / (1024 ** 3), 2),
            "ram_total_gb": round(mem.total / (1024 ** 3), 2),
            "vm_disk_pct": disk_root.percent,
            "vm_disk_free_gb": round(disk_root.free / (1024 ** 3), 2),
            "vm_disk_total_gb": round(disk_root.total / (1024 ** 3), 2),
            "data_disk_pct": data_disk_pct,
            "data_disk_free_gb": data_disk_free_gb,
            "data_disk_total_gb": data_disk_total_gb,
        }
        _system_metrics_buffer.append(sample)
    except Exception as exc:
        app.logger.warning("System metrics sample failed: %s", exc)


def _metrics_sampler_loop():
    """Background thread: sample system metrics every 5 minutes."""
    # Take one immediate sample on startup
    _sample_system_metrics()
    while True:
        time.sleep(_METRICS_SAMPLE_INTERVAL)
        _sample_system_metrics()


_metrics_sampler_thread = threading.Thread(target=_metrics_sampler_loop, daemon=True)
_metrics_sampler_thread.start()


# ---- System metrics route ----

@app.route("/admin/api/system-metrics", methods=["GET"])
def admin_api_system_metrics():
    current = None
    if _system_metrics_buffer:
        current = _system_metrics_buffer[-1]
    trend = list(_system_metrics_buffer)
    gcs_bytes = _get_gcs_bucket_size()
    return jsonify({
        "current": current,
        "trend": trend,
        "gcs_bucket_bytes": gcs_bytes,
        "gcs_bucket_gb": round(gcs_bytes / (1024 ** 3), 3) if gcs_bytes is not None else None,
    })


# ---- Analytics route ----

@app.route("/admin/api/analytics", methods=["GET"])
def admin_api_analytics():
    project_id_str = request.args.get("project_id")
    period = request.args.get("period", "24h")

    period_map = {"1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days"}
    interval_sql = period_map.get(period, "24 hours")

    session = SessionLocal()
    try:
        # Snapshot pipeline counts per hour (project-scoped if project_id given)
        if project_id_str:
            snap_rows = session.execute(text("""
                SELECT date_trunc('hour', sd.created_at) AS hour,
                       sd.decision_status,
                       COUNT(*) AS cnt
                FROM snapshot_decisions sd
                JOIN cameras c ON c.id = sd.camera_id
                JOIN sites s ON s.id = c.site_id
                WHERE s.project_id = :pid
                  AND sd.created_at >= NOW() - CAST(:iv AS INTERVAL)
                GROUP BY 1, 2
                ORDER BY 1
            """), {"pid": int(project_id_str), "iv": interval_sql}).fetchall()
        else:
            snap_rows = session.execute(text("""
                SELECT date_trunc('hour', created_at) AS hour,
                       decision_status,
                       COUNT(*) AS cnt
                FROM snapshot_decisions
                WHERE created_at >= NOW() - CAST(:iv AS INTERVAL)
                GROUP BY 1, 2
                ORDER BY 1
            """), {"iv": interval_sql}).fetchall()

        # Build hourly timeline
        hourly: dict = {}
        for row in snap_rows:
            h = row[0].isoformat() if row[0] else None
            if h not in hourly:
                hourly[h] = {"time": h, "processed": 0, "skipped": 0, "error": 0, "total": 0}
            status = (row[1] or "").upper()
            cnt = int(row[2])
            hourly[h]["total"] += cnt
            if status == "PROCESSED":
                hourly[h]["processed"] += cnt
            elif status in ("SKIPPED", "SCENE_UNCHANGED", "DUPLICATE", "OUTSIDE_HOURS"):
                hourly[h]["skipped"] += cnt
            elif status == "ERROR":
                hourly[h]["error"] += cnt

        snapshot_timeline = sorted(hourly.values(), key=lambda x: x["time"] or "")

        # Skip reason breakdown
        if project_id_str:
            skip_rows = session.execute(text("""
                SELECT sd.skip_reason, COUNT(*) AS cnt
                FROM snapshot_decisions sd
                JOIN cameras c ON c.id = sd.camera_id
                JOIN sites s ON s.id = c.site_id
                WHERE s.project_id = :pid
                  AND sd.created_at >= NOW() - CAST(:iv AS INTERVAL)
                  AND sd.skip_reason IS NOT NULL
                GROUP BY sd.skip_reason
                ORDER BY cnt DESC
            """), {"pid": int(project_id_str), "iv": interval_sql}).fetchall()
        else:
            skip_rows = session.execute(text("""
                SELECT skip_reason, COUNT(*) AS cnt
                FROM snapshot_decisions
                WHERE created_at >= NOW() - CAST(:iv AS INTERVAL)
                  AND skip_reason IS NOT NULL
                GROUP BY skip_reason
                ORDER BY cnt DESC
            """), {"iv": interval_sql}).fetchall()
        skip_reasons = [{"reason": r[0], "count": int(r[1])} for r in skip_rows]

        # Processing latency (received_at → processed_at ms) by hour
        if project_id_str:
            latency_rows = session.execute(text("""
                SELECT date_trunc('hour', s.processed_at) AS hour,
                       AVG(EXTRACT(EPOCH FROM (s.processed_at - s.received_at)) * 1000)::int AS avg_ms
                FROM snapshots s
                JOIN cameras c ON c.id = s.camera_id
                JOIN sites site ON site.id = c.site_id
                WHERE site.project_id = :pid
                  AND s.processed_at IS NOT NULL
                  AND s.received_at IS NOT NULL
                  AND s.processed_at >= NOW() - CAST(:iv AS INTERVAL)
                GROUP BY 1
                ORDER BY 1
            """), {"pid": int(project_id_str), "iv": interval_sql}).fetchall()
        else:
            latency_rows = session.execute(text("""
                SELECT date_trunc('hour', processed_at) AS hour,
                       AVG(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000)::int AS avg_ms
                FROM snapshots
                WHERE processed_at IS NOT NULL
                  AND received_at IS NOT NULL
                  AND processed_at >= NOW() - CAST(:iv AS INTERVAL)
                GROUP BY 1
                ORDER BY 1
            """), {"iv": interval_sql}).fetchall()
        latency_timeline = [
            {"time": r[0].isoformat() if r[0] else None, "avg_ms": r[1]}
            for r in latency_rows
        ]

        # Summary totals
        total_processed = sum(h["processed"] for h in snapshot_timeline)
        total_skipped = sum(h["skipped"] for h in snapshot_timeline)
        total_errors = sum(h["error"] for h in snapshot_timeline)
        total_snapshots = total_processed + total_skipped + total_errors
        detection_rate = round(total_processed / total_snapshots * 100, 1) if total_snapshots else 0.0
        avg_latency = round(sum(r["avg_ms"] for r in latency_timeline if r["avg_ms"]) / len([r for r in latency_timeline if r["avg_ms"]]), 0) if latency_timeline else None

        return jsonify({
            "period": period,
            "project_id": int(project_id_str) if project_id_str else None,
            "summary": {
                "total_snapshots": total_snapshots,
                "processed": total_processed,
                "skipped": total_skipped,
                "errors": total_errors,
                "detection_rate_pct": detection_rate,
                "avg_latency_ms": avg_latency,
            },
            "snapshot_timeline": snapshot_timeline,
            "skip_reasons": skip_reasons,
            "latency_timeline": latency_timeline,
        })
    except Exception as exc:
        app.logger.error("Analytics route error: %s", exc)
        return jsonify({"error": str(exc)}), 500
    finally:
        session.close()

# ---- Idempotent schema migrations ----
# Runs on every startup so old DB volumes always match current code.
# Every statement uses IF NOT EXISTS / ON CONFLICT so it is always safe to re-run.
def _apply_migrations():
    _migrations = [
        # Tables added after the initial POC volume was first created
        """
        CREATE TABLE IF NOT EXISTS admin_users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role VARCHAR(30) NOT NULL DEFAULT 'viewer',
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            last_login_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username)",
        """
        CREATE TABLE IF NOT EXISTS ingest_telemetry (
            id BIGSERIAL PRIMARY KEY,
            camera_id INT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
            original_filename TEXT NOT NULL,
            file_extension VARCHAR(20),
            detected_format VARCHAR(20),
            file_size_bytes BIGINT,
            arrived_at TIMESTAMP NOT NULL,
            burst_group_id VARCHAR(16),
            burst_rank INT DEFAULT 1,
            burst_size INT DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_ingest_telemetry_camera_id ON ingest_telemetry(camera_id)",
        "CREATE INDEX IF NOT EXISTS idx_ingest_telemetry_arrived_at ON ingest_telemetry(arrived_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ingest_telemetry_burst ON ingest_telemetry(burst_group_id)",
        "CREATE INDEX IF NOT EXISTS idx_ingest_telemetry_created_at ON ingest_telemetry(created_at DESC)",
        # Columns added to existing tables
        "ALTER TABLE sites ADD COLUMN IF NOT EXISTS city VARCHAR(255)",
        # System settings seed (no-op if already present)
        """
        INSERT INTO system_settings (key, value) VALUES
            ('operating_hours_start', '0'),
            ('operating_hours_end', '24'),
            ('scene_diff_threshold', '6.0')
        ON CONFLICT DO NOTHING
        """,
    ]
    try:
        with engine.connect() as conn:
            for stmt in _migrations:
                conn.execute(text(stmt.strip()))
            conn.commit()
        app.logger.info("Schema migrations applied successfully")
    except Exception as exc:
        app.logger.error("Migration failed: %s", exc)

_apply_migrations()

# Ensure bootstrap admin user exists in DB
_ensure_bootstrap_admin()
