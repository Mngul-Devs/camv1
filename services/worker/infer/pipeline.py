import hashlib
import json
import logging
import os
import shutil
import time
import traceback
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple
from zoneinfo import ZoneInfo
import numpy as np
from PIL import Image, ImageDraw, UnidentifiedImageError

from db import Detection, Snapshot, SnapshotDecision, SystemSetting, Zone, ZoneEvent, ZoneState
from geometry import overlap_ratio, point_in_polygon
from infer.zonecls.zone_classifier import ZoneClassifier
from yolo_processor import YoloProcessor

log = logging.getLogger(__name__)

VALID_CLASSES = {"car", "truck", "motorcycle", "bicycle", "bus"}

# Env-var defaults (used before first DB refresh and as fallback)
_DEFAULT_OPERATING_START    = int(os.getenv("OPERATING_HOURS_START", "0"))
_DEFAULT_OPERATING_END      = int(os.getenv("OPERATING_HOURS_END",   "24"))
_DEFAULT_SCENE_DIFF_THRESHOLD = float(os.getenv("SCENE_DIFF_THRESHOLD", "6.0"))

# Timezone for operating-hours check — must match the camera's local timezone.
# Defaults to Asia/Kuala_Lumpur (UTC+8). Override with CAMERA_TZ env var.
_CAMERA_TZ = ZoneInfo(os.getenv("CAMERA_TZ", "Asia/Kuala_Lumpur"))

# Thumbnail size used for perceptual diff (smaller = faster, 32 is plenty)
_THUMB = (32, 32)
_EVIDENCE_OVERLAY_ENABLED = os.getenv("EVIDENCE_OVERLAY_ENABLED", "false").lower() == "true"


class InferencePipeline:
    def __init__(
        self,
        image_root: str,
        yolo_enabled: bool,
        yolo_model: str,
        yolo_confidence: float,
        overlap_threshold: float,
    ):
        self.image_root = image_root
        self.yolo_enabled = yolo_enabled
        self.zone_classifier = ZoneClassifier.from_env()
        self.pending_states = {}
        self.yolo_processor = None
        if self.yolo_enabled:
            self.yolo_processor = YoloProcessor(
                model_path=yolo_model,
                confidence=yolo_confidence,
                overlap_threshold=overlap_threshold,
            )
        # Per-camera perceptual fingerprints: camera_id -> np.ndarray (32x32 uint8)
        self._last_thumb: Dict[int, np.ndarray] = {}

        # Runtime settings — seeded from env, refreshed from DB each worker cycle
        self.operating_start    = _DEFAULT_OPERATING_START
        self.operating_end      = _DEFAULT_OPERATING_END
        self.scene_diff_threshold = _DEFAULT_SCENE_DIFF_THRESHOLD

    # ------------------------------------------------------------------
    # Settings refresh (called once per worker cycle from main.py)
    # ------------------------------------------------------------------

    def refresh_settings(self, session) -> None:
        """Re-read operating hours and scene diff threshold from system_settings table."""
        try:
            rows = session.query(SystemSetting).filter(
                SystemSetting.key.in_([
                    "operating_hours_start",
                    "operating_hours_end",
                    "scene_diff_threshold",
                ])
            ).all()
            settings = {r.key: r.value for r in rows}
            self.operating_start      = int(settings.get("operating_hours_start",   str(_DEFAULT_OPERATING_START)))
            self.operating_end        = int(settings.get("operating_hours_end",     str(_DEFAULT_OPERATING_END)))
            self.scene_diff_threshold = float(settings.get("scene_diff_threshold",  str(_DEFAULT_SCENE_DIFF_THRESHOLD)))
        except Exception as exc:  # DB unavailable — keep previous values
            log.warning("refresh_settings failed, keeping previous values: %s", exc)

    # ------------------------------------------------------------------
    # Perceptual diff helpers
    # ------------------------------------------------------------------

    def _thumb_of(self, image: Image.Image) -> np.ndarray:
        """Downsample image to a small grayscale thumbnail for fast comparison."""
        return np.array(image.resize(_THUMB, Image.BILINEAR).convert("L"), dtype=np.float32)

    def _scene_changed(self, camera_id: int, thumb: np.ndarray) -> Tuple[bool, float]:
        """Return (changed, mean_pixel_delta). Updates stored thumbnail on change."""
        if self.scene_diff_threshold <= 0:
            return True, 255.0  # disabled — always process
        prev = self._last_thumb.get(camera_id)
        if prev is None:
            # First image ever for this camera — always process
            self._last_thumb[camera_id] = thumb
            return True, 255.0
        diff = float(np.mean(np.abs(thumb - prev)))
        if diff >= self.scene_diff_threshold:
            return True, diff
        return False, diff

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def process_snapshot(self, session, camera, file_path):
        if not _file_is_stable(file_path):
            return

        file_hash = _sha256_file(file_path)
        if file_hash is None:
            _record_snapshot_decision(
                session,
                camera_id=camera.id,
                decision_status="ERROR",
                skip_reason="HASH_FAILED",
                incoming_file_path=file_path,
                error_message="Cannot compute SHA256",
            )
            return
        existing = session.query(Snapshot).filter(Snapshot.file_hash == file_hash).first()
        if existing:
            _record_snapshot_decision(
                session,
                camera_id=camera.id,
                snapshot_id=existing.id,
                decision_status="SKIPPED",
                skip_reason="DUPLICATE_HASH",
                incoming_file_path=file_path,
                file_hash=file_hash,
            )
            _quarantine(file_path)
            return

        now = datetime.utcnow()

        # ---- Operating hours gate ----
        # Use camera's local timezone (CAMERA_TZ env var, default Asia/Kuala_Lumpur)
        local_hour = datetime.now(tz=_CAMERA_TZ).hour
        in_hours = self.operating_start <= local_hour < self.operating_end
        if not in_hours:
            # Outside operating window — record heartbeat, skip inference
            camera.last_seen_at = now
            camera.status = "ONLINE"
            _record_snapshot_decision(
                session,
                camera_id=camera.id,
                decision_status="SKIPPED",
                skip_reason="OUTSIDE_HOURS",
                incoming_file_path=file_path,
                file_hash=file_hash,
            )
            _discard(file_path)  # remove file, nothing to store
            log.debug("[%s] Outside operating hours (%02d:00 — window %02d–%02d) — heartbeat only",
                      camera.camera_id, local_hour, self.operating_start, self.operating_end)
            return

        try:
            image = Image.open(file_path)
            image.verify()
            image = Image.open(file_path).convert("RGB")
        except (UnidentifiedImageError, OSError, SyntaxError) as exc:
            log.warning("Corrupt image %s – moving to quarantine: %s", file_path, exc)
            _record_snapshot_decision(
                session,
                camera_id=camera.id,
                decision_status="SKIPPED",
                skip_reason="CORRUPT_IMAGE",
                incoming_file_path=file_path,
                file_hash=file_hash,
                error_message=str(exc),
            )
            _quarantine(file_path)
            return
        width, height = image.size

        # ---- Perceptual diff — smart skip ----
        thumb = self._thumb_of(image)
        changed, delta = self._scene_changed(camera.id, thumb)
        if not changed:
            # Scene is static — update heartbeat only, discard image
            camera.last_seen_at = now
            camera.status = "ONLINE"
            _record_snapshot_decision(
                session,
                camera_id=camera.id,
                decision_status="SKIPPED",
                skip_reason="SCENE_UNCHANGED",
                incoming_file_path=file_path,
                file_hash=file_hash,
                scene_diff_value=delta,
            )
            _discard(file_path)
            log.debug("[%s] Scene unchanged (diff=%.2f < %.2f) — heartbeat only",
                      camera.camera_id, delta, self.scene_diff_threshold)
            return

        log.info("[%s] Scene changed (diff=%.2f) — running inference",
                 camera.camera_id, delta)

        date_folder = now.strftime("%Y%m%d")
        dest_dir = os.path.join(self.image_root, camera.camera_id, date_folder)
        _ensure_dir(dest_dir)
        # Ensure the camera and date directories are world-readable so the SSH
        # user can SCP snapshots directly without sudo.
        for _d in [os.path.join(self.image_root, camera.camera_id), dest_dir]:
            try:
                os.chmod(_d, 0o755)
            except OSError:
                pass

        # Rename to a clean ISO-timestamp filename so files are:
        #   (a) sortable by time,  (b) have no shell-glob characters (no brackets),
        #   (c) carry the full HH:MM:SS so you can tell the hour.
        # Format: HHMMSS_R.jpg  or  HHMMSS_M.jpg  (R=scheduled, M=motion)
        _orig_name = os.path.basename(file_path)
        _type_tag = "M" if "[M]" in _orig_name else "R"
        _ext = os.path.splitext(_orig_name)[1].lower() or ".jpg"
        _clean_name = now.strftime("%H%M%S") + "_" + _type_tag + _ext
        dest_path = os.path.join(dest_dir, _clean_name)
        shutil.move(file_path, dest_path)
        # Fix ownership so host SSH user can read/SCP without sudo.
        try:
            os.chmod(dest_path, 0o644)
        except OSError:
            pass

        relative_path = os.path.relpath(dest_path, self.image_root)

        snapshot = Snapshot(
            camera_id=camera.id,
            file_path=relative_path,
            file_hash=file_hash,
            width=width,
            height=height,
            received_at=now,
            created_at=now,
        )
        session.add(snapshot)

        camera.last_seen_at = now
        camera.last_snapshot_at = now
        camera.status = "ONLINE"

        session.flush()

        # ---- Camera-specific tuning overrides ----
        camera_yolo_conf = None
        camera_overlap_threshold = None
        connection_config = {}
        if getattr(camera, "connection_config", None):
            try:
                connection_config = json.loads(camera.connection_config) or {}
                if not isinstance(connection_config, dict):
                    connection_config = {}
            except (TypeError, ValueError):
                connection_config = {}
        conf_override = connection_config.get("yolo_confidence_override")
        overlap_override = connection_config.get("overlap_threshold_override")
        if isinstance(conf_override, (int, float)):
            camera_yolo_conf = float(conf_override)
        if isinstance(overlap_override, (int, float)):
            camera_overlap_threshold = float(overlap_override)

        # ---- Run YOLO detection (if enabled) ----
        all_detections = []
        vehicle_detections = []
        if self.yolo_enabled and self.yolo_processor:
            all_detections = self.yolo_processor.detect(dest_path, confidence=camera_yolo_conf)
            vehicle_detections = [d for d in all_detections if d["class"] in VALID_CLASSES]
            log.info("[%s] YOLO detected %d vehicles (%d total objects)",
                     camera.camera_id, len(vehicle_detections), len(all_detections))

        snapshot.decision_status = "PROCESSED"
        snapshot.skip_reason = None
        snapshot.scene_diff_value = delta
        # Update baseline only after confirmed processing (prevents blurry burst
        # frames from poisoning the perceptual-diff baseline).
        self._last_thumb[camera.id] = thumb
        snapshot.yolo_total_objects = len(all_detections)
        snapshot.yolo_vehicle_objects = len(vehicle_detections)
        evidence_relative_path = relative_path

        # ---- Zone occupancy ----
        zones = session.query(Zone).filter(Zone.camera_id == camera.id).all()
        zone_decisions = []
        for zone in zones:
            # __campark_meta__ zones are real parking spaces whose name field
            # carries lane-editor metadata.  Process them normally for occupancy.
            zone_polygon = json.loads(zone.polygon_json)
            zone_debug = {
                "zone_id": zone.zone_id,
                "method": "yolo" if (self.yolo_enabled and self.yolo_processor) else "zonecls",
            }

            if self.yolo_enabled and self.yolo_processor:
                # YOLO-based zone occupancy: count vehicles overlapping this zone
                zone_polygon_px = [
                    [pt[0] / 100.0 * width, pt[1] / 100.0 * height]
                    for pt in zone_polygon
                ]
                effective_overlap_threshold = (
                    camera_overlap_threshold
                    if camera_overlap_threshold is not None
                    else self.yolo_processor.overlap_threshold
                )
                overlap_details = []
                zone_vehicles = []
                for det in vehicle_detections:
                    ratio = overlap_ratio(zone_polygon_px, det["bbox"])
                    x1, y1, x2, y2 = det["bbox"]
                    cx = (x1 + x2) / 2.0
                    cy = (y1 + y2) / 2.0
                    center_in_zone = point_in_polygon(cx, cy, zone_polygon_px)
                    accepted = (ratio >= effective_overlap_threshold) or center_in_zone
                    overlap_details.append({
                        "class": det["class"],
                        "confidence": det["confidence"],
                        "overlap_ratio": round(ratio, 4),
                        "center_in_zone": center_in_zone,
                        "accepted": accepted,
                    })
                    if accepted:
                        zone_vehicles.append(det)
                    elif ratio > 0.05:
                        # Log near-miss detections for tuning overlap threshold
                        log.debug("[%s] Zone %s: near-miss %s (conf=%.2f overlap=%.4f center_in=%s, threshold=%.2f)",
                                  camera.camera_id, zone.zone_id, det["class"],
                                  det["confidence"], ratio, center_in_zone, effective_overlap_threshold)
                occupied_units = len(zone_vehicles)
                zone_debug["overlap_threshold"] = effective_overlap_threshold
                zone_debug["yolo_confidence_used"] = (
                    camera_yolo_conf if camera_yolo_conf is not None else self.yolo_processor.confidence
                )
                zone_debug["overlap_details"] = overlap_details
                log.info("[%s] Zone %s: %d vehicle(s) detected (capacity=%d)",
                         camera.camera_id, zone.zone_id, occupied_units, zone.capacity_units or 1)
            else:
                # Fallback: ZoneClassifier (placeholder or ONNX)
                prediction = self.zone_classifier.predict_zone_occupied(image, zone_polygon)
                occupied_units = 1 if prediction.occupied else 0
                zone_debug["zonecls"] = {
                    "occupied": bool(prediction.occupied),
                    "confidence": float(getattr(prediction, "confidence", 1.0)),
                }

            capacity = zone.capacity_units or 1
            occupied_units = min(occupied_units, capacity)  # cap at capacity
            state = _zone_state_label(occupied_units, capacity)

            zone_debug["capacity"] = capacity
            zone_debug["occupied_units"] = occupied_units
            zone_debug["state"] = state
            zone_debug["polygon"] = zone_polygon
            zone_decisions.append(zone_debug)

            zone_state = session.query(ZoneState).filter(ZoneState.zone_id == zone.id).first()
            if not zone_state:
                zone_state = ZoneState(
                    zone_id=zone.id,
                    occupied_units=occupied_units,
                    available_units=max(capacity - occupied_units, 0),
                    state=state,
                    last_change_at=now,
                    updated_at=now,
                )
                session.add(zone_state)
                continue

            if zone_state.occupied_units != occupied_units:
                pending = self.pending_states.get(zone.id)
                if pending and pending["units"] == occupied_units:
                    pending["count"] += 1
                else:
                    self.pending_states[zone.id] = {"units": occupied_units, "count": 1}

                # Asymmetric confirmation: harder to go FREE (5 frames) than FULL (2 frames)
                # This prevents false-negative flip-flops on borderline detections
                going_free = occupied_units == 0
                required_frames = 5 if going_free else 2
                if self.pending_states[zone.id]["count"] < required_frames:
                    log.debug("[%s] Zone %s: pending %s (%d/%d frames)",
                              camera.camera_id, zone.zone_id,
                              "FREE" if going_free else "FULL",
                              self.pending_states[zone.id]["count"], required_frames)
                    continue

                self.pending_states.pop(zone.id, None)

                old_units = zone_state.occupied_units or 0
                if old_units <= 0 and occupied_units > 0:
                    event_type = "CAR_IN"
                elif old_units > 0 and occupied_units <= 0:
                    event_type = "CAR_OUT"
                else:
                    event_type = "OCCUPANCY_CHANGE"

                event_details = {
                    "zone_id": zone.zone_id,
                    "camera_id": camera.camera_id,
                    "old_units": old_units,
                    "new_units": occupied_units,
                    "capacity": capacity,
                    "state": state,
                    "decision": zone_debug,
                }

                event = ZoneEvent(
                    zone_id=zone.id,
                    snapshot_id=snapshot.id,
                    old_state=zone_state.state,
                    new_state=state,
                    old_units=zone_state.occupied_units,
                    new_units=occupied_units,
                    event_type=event_type,
                    details_json=json.dumps(event_details),
                    triggered_at=now,
                    created_at=now,
                )
                zone_state.occupied_units = occupied_units
                zone_state.available_units = max(capacity - occupied_units, 0)
                zone_state.state = state
                zone_state.last_change_at = now
                zone_state.updated_at = now
                session.add(event)
            else:
                self.pending_states.pop(zone.id, None)

        # ---- Store YOLO detections as evidence ----
        for det in vehicle_detections:
            det_row = Detection(
                snapshot_id=snapshot.id,
                class_name=det["class"],
                confidence=det["confidence"],
                bbox_json=self.yolo_processor.to_bbox_json(det, width, height),
                created_at=now,
            )
            session.add(det_row)

        if _EVIDENCE_OVERLAY_ENABLED:
            overlay_abs_path = _overlay_path_for(dest_path)
            if _write_evidence_overlay(
                image=image,
                zone_decisions=zone_decisions,
                detections=vehicle_detections,
                image_width=width,
                image_height=height,
                output_path=overlay_abs_path,
            ):
                evidence_relative_path = os.path.relpath(overlay_abs_path, self.image_root)

        snapshot.evidence_image_path = evidence_relative_path

        _record_snapshot_decision(
            session,
            camera_id=camera.id,
            snapshot_id=snapshot.id,
            decision_status="PROCESSED",
            incoming_file_path=file_path,
            file_hash=file_hash,
            scene_diff_value=delta,
            yolo_total_objects=len(all_detections),
            yolo_vehicle_objects=len(vehicle_detections),
            zone_decision_json=json.dumps(zone_decisions),
            evidence_image_path=evidence_relative_path,
        )

        snapshot.processed_at = datetime.utcnow()


def _discard(file_path):
    """Remove a file quietly (used for out-of-hours / unchanged frames)."""
    try:
        os.remove(file_path)
    except OSError:
        pass


def _sha256_file(path):
    try:
        hasher = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(8192), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    except (FileNotFoundError, PermissionError) as exc:
        log.warning("Cannot hash %s: %s", path, exc)
        return None


def _file_is_stable(path):
    try:
        size1 = os.path.getsize(path)
        time.sleep(0.2)
        size2 = os.path.getsize(path)
        return size1 == size2 and size1 > 0
    except (FileNotFoundError, PermissionError):
        return False


def _quarantine(file_path):
    """Move bad files out of incoming so the worker doesn't retry them forever."""
    quarantine_dir = os.path.join(os.path.dirname(file_path), ".quarantine")
    os.makedirs(quarantine_dir, exist_ok=True)
    dest = os.path.join(quarantine_dir, os.path.basename(file_path))
    try:
        shutil.move(file_path, dest)
        log.info("Quarantined %s -> %s", file_path, dest)
    except OSError as exc:
        log.warning("Failed to quarantine %s: %s", file_path, exc)


def _ensure_dir(path):
    os.makedirs(path, mode=0o755, exist_ok=True)


def _zone_state_label(occupied, capacity):
    if occupied <= 0:
        return "FREE"
    if occupied >= capacity:
        return "FULL"
    return "PARTIAL"


def _record_snapshot_decision(
    session,
    camera_id,
    decision_status,
    skip_reason=None,
    incoming_file_path=None,
    file_hash=None,
    snapshot_id=None,
    scene_diff_value=None,
    yolo_total_objects=None,
    yolo_vehicle_objects=None,
    zone_decision_json=None,
    evidence_image_path=None,
    error_message=None,
):
    row = SnapshotDecision(
        camera_id=camera_id,
        snapshot_id=snapshot_id,
        incoming_file_path=incoming_file_path,
        file_hash=file_hash,
        decision_status=decision_status,
        skip_reason=skip_reason,
        scene_diff_value=scene_diff_value,
        yolo_total_objects=yolo_total_objects,
        yolo_vehicle_objects=yolo_vehicle_objects,
        zone_decision_json=zone_decision_json,
        evidence_image_path=evidence_image_path,
        error_message=error_message,
        created_at=datetime.utcnow(),
    )
    session.add(row)


def _overlay_path_for(image_path):
    base, ext = os.path.splitext(image_path)
    return f"{base}.overlay{ext or '.jpg'}"


def _write_evidence_overlay(image, zone_decisions, detections, image_width, image_height, output_path):
    try:
        overlay = image.copy()
        draw = ImageDraw.Draw(overlay)

        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            draw.rectangle([x1, y1, x2, y2], outline=(59, 130, 246), width=3)
            label = f"{det['class']} {det['confidence']:.2f}"
            draw.text((x1 + 4, max(2, y1 - 14)), label, fill=(59, 130, 246))

        for zd in zone_decisions:
            polygon = zd.get("polygon") or []
            if len(polygon) < 3:
                continue
            points_px = [(pt[0] / 100.0 * image_width, pt[1] / 100.0 * image_height) for pt in polygon]
            state = (zd.get("state") or "UNKNOWN").upper()
            if state == "FULL":
                color = (239, 68, 68)
            elif state == "PARTIAL":
                color = (234, 179, 8)
            else:
                color = (34, 197, 94)
            draw.polygon(points_px, outline=color, width=3)
            p0 = points_px[0]
            title = f"{zd.get('zone_id', '?')} {state}"
            draw.text((p0[0] + 4, p0[1] + 4), title, fill=color)

        overlay.save(output_path, format="JPEG", quality=90)
        return True
    except Exception as exc:
        log.warning("Failed to write evidence overlay %s: %s", output_path, exc)
        return False
