import logging
import os
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from PIL import Image

from db import Camera, IngestTelemetry, SessionLocal, SystemSetting
from infer.pipeline import InferencePipeline

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("worker")

FTP_INGEST_PATH   = os.getenv("FTP_INGEST_PATH",   "/data/ftp")
IMAGE_ROOT        = os.getenv("IMAGE_ROOT",         "/data/images")
YOLO_CONFIDENCE   = float(os.getenv("YOLO_CONFIDENCE",   "0.80"))
YOLO_MODEL        = os.getenv("YOLO_MODEL",          "yolov8n.pt")
OVERLAP_THRESHOLD = float(os.getenv("OVERLAP_THRESHOLD", "0.15"))
POLL_INTERVAL     = float(os.getenv("POLL_INTERVAL",     "1.0"))
YOLO_ENABLED      = os.getenv("YOLO_ENABLED", "false").lower() == "true"

# How many cameras to process in parallel.
# Rule of thumb: 2× CPU cores.  Override with WORKER_THREADS env var.
WORKER_THREADS = int(os.getenv("WORKER_THREADS", str(min(os.cpu_count() or 2, 16))))
MAX_FILES_PER_CAMERA_PER_CYCLE = int(os.getenv("MAX_FILES_PER_CAMERA_PER_CYCLE", "50"))
PROCESS_NEWEST_FIRST = os.getenv("PROCESS_NEWEST_FIRST", "true").lower() == "true"
DROP_OLD_FRAMES_WHEN_BACKLOG = os.getenv("DROP_OLD_FRAMES_WHEN_BACKLOG", "false").lower() == "true"
KEEP_LATEST_FILES = int(os.getenv("KEEP_LATEST_FILES", "20"))
# Max time gap between files (seconds) to consider them part of the same camera burst/event.
BURST_WINDOW_SECONDS = float(os.getenv("BURST_WINDOW_SECONDS", "30.0"))


def _watch_dir(camera: Camera) -> Path:
    """Return the root directory to scan for new images for this camera.

    Scans the entire FTP user home directory recursively so that any upload
    path works automatically:
      - Dahua / Uniarch: uploads to  /incoming/  subdir (chroot root = home)
      - VIGI / Generic:  uploads to  /           (FTP root = home root)
      - Any other subdir: also handled by rglob
    """
    if camera.ingest_protocol == "ftp" and camera.ftp_username:
        ingest_id = camera.ftp_username
    else:
        ingest_id = camera.ftp_username or camera.camera_id.lower()
    return Path(FTP_INGEST_PATH) / ingest_id


def _detect_image_format(path: Path) -> Optional[str]:
    """Return PIL image format (JPEG, PNG, BMP, etc.) via fast header-only probe.
    Returns None if the file is not a recognized image format."""
    try:
        with Image.open(path) as img:
            return img.format  # type: ignore[return-value]
    except Exception:
        return None


def _upsert_setting(session, key: str, value: str, updated_at: datetime) -> None:
    """Upsert a row in system_settings."""
    setting = session.query(SystemSetting).filter(SystemSetting.key == key).first()
    if setting:
        setting.value = value
        setting.updated_at = updated_at
    else:
        session.add(SystemSetting(key=key, value=value, updated_at=updated_at))


def _process_camera(pipeline: InferencePipeline, camera: Camera) -> int:
    """Process all pending images for one camera. Returns number of files handled."""
    incoming = _watch_dir(camera)
    if not incoming.exists():
        return 0

    # ---- Scan ALL files (format-agnostic — accept any brand, any extension) ----
    all_raw: List[Path] = [
        f for f in incoming.rglob("*")
        if f.is_file() and ".quarantine" not in f.parts
    ]
    if not all_raw:
        return 0

    # ---- Probe each file: stat + PIL header check ----
    ext_counter: Counter = Counter()
    file_infos: List[Dict] = []
    for f in all_raw:
        try:
            stat = f.stat()
        except OSError:
            continue
        fmt = _detect_image_format(f)
        ext_counter[f.suffix.lower() or "(none)"] += 1
        file_infos.append({
            "path": f,
            "mtime": stat.st_mtime,
            "size": stat.st_size,
            "fmt": fmt,
            "ext": f.suffix.lower(),
        })

    total_queue = len(file_infos)
    image_files = [fi for fi in file_infos if fi["fmt"] is not None]
    unknown_count = total_queue - len(image_files)

    # Always log FTP queue state — this is the primary observability signal
    log.info(
        "[%s] ftp_queue=%d images=%d unknown=%d exts=%s",
        camera.camera_id, total_queue, len(image_files), unknown_count, dict(ext_counter),
    )
    if unknown_count > 0:
        bad_names = [fi["path"].name for fi in file_infos if fi["fmt"] is None][:5]
        log.warning("[%s] non-image files in FTP dir (first 5): %s", camera.camera_id, bad_names)

    if not image_files:
        return 0

    # ---- Burst grouping: bucket each file by its 30s time slot ----
    # Each 30-second wall-clock window is one "burst event".
    # Within a bucket, the largest file = mother (rank 1), others = siblings.
    from collections import defaultdict as _dd
    buckets: Dict[str, List[Dict]] = _dd(list)
    for fi in image_files:
        bucket_id = f"{int(fi['mtime'] / BURST_WINDOW_SECONDS):08x}"
        fi["burst_group_id"] = bucket_id
        buckets[bucket_id].append(fi)

    for bucket_id, group in buckets.items():
        group.sort(key=lambda fi: fi["size"], reverse=True)  # largest = mother
        for rank, fi in enumerate(group, 1):
            fi["burst_rank"] = rank
            fi["burst_size"] = len(group)

    # ---- Apply processing order + per-cycle cap ----
    flat: List[Dict] = list(image_files)
    flat.sort(key=lambda fi: fi["mtime"], reverse=PROCESS_NEWEST_FIRST)

    backlog = len(flat)
    if backlog > MAX_FILES_PER_CAMERA_PER_CYCLE:
        log.warning("[%s] backlog=%d exceeds per-cycle cap=%d", camera.camera_id, backlog, MAX_FILES_PER_CAMERA_PER_CYCLE)

    if DROP_OLD_FRAMES_WHEN_BACKLOG and backlog > KEEP_LATEST_FILES:
        kept = flat[:KEEP_LATEST_FILES]
        dropped = flat[KEEP_LATEST_FILES:]
        for fi in dropped:
            try:
                fi["path"].unlink(missing_ok=True)
            except Exception:
                pass
        log.warning("[%s] dropped %d old frame(s), kept latest %d", camera.camera_id, len(dropped), len(kept))
        flat = kept

    flat = flat[:MAX_FILES_PER_CAMERA_PER_CYCLE]

    session = SessionLocal()
    try:
        from db import Camera as CameraModel
        cam = session.query(CameraModel).filter(CameraModel.id == camera.id).first()
        if cam is None:
            return 0

        now = datetime.utcnow()

        # Publish FTP queue depth so admin dashboard can read it without filesystem access
        _upsert_setting(session, f"ftp_pending_{cam.id}", str(total_queue), now)

        # ---- Record arrival telemetry + run pipeline for each file ----
        for fi in flat:
            session.add(IngestTelemetry(
                camera_id=cam.id,
                original_filename=str(fi["path"]),
                file_extension=fi["ext"] or None,
                detected_format=fi["fmt"],
                file_size_bytes=fi["size"],
                arrived_at=datetime.utcfromtimestamp(fi["mtime"]),
                burst_group_id=fi.get("burst_group_id"),
                burst_rank=fi.get("burst_rank"),
                burst_size=fi.get("burst_size"),
                created_at=now,
            ))
            pipeline.process_snapshot(session, cam, str(fi["path"]))

        session.commit()
        return len(flat)
    except Exception as exc:
        session.rollback()
        log.exception("[%s] camera processing error: %s", camera.camera_id, exc)
        return 0
    finally:
        session.close()


def run_worker():
    pipeline = InferencePipeline(
        image_root=IMAGE_ROOT,
        yolo_enabled=YOLO_ENABLED,
        yolo_model=YOLO_MODEL,
        yolo_confidence=YOLO_CONFIDENCE,
        overlap_threshold=OVERLAP_THRESHOLD,
    )

    print("CamPark worker started")
    log.info(
        "Zone classifier mode=%s  YOLO=%s  threads=%d  poll=%.1fs  newest_first=%s  cap_per_camera=%d",
        os.getenv("ZONECLS_MODE", "placeholder"),
        YOLO_ENABLED,
        WORKER_THREADS,
        POLL_INTERVAL,
        PROCESS_NEWEST_FIRST,
        MAX_FILES_PER_CAMERA_PER_CYCLE,
    )
    log.info("Operating hours seeded from env: %s–%s:00 (can be overridden in admin → System → Settings)",
             pipeline.operating_start, pipeline.operating_end)

    executor = ThreadPoolExecutor(max_workers=WORKER_THREADS)

    while True:
        # Fetch camera list once per cycle in a short-lived session
        list_session = SessionLocal()
        try:
            cameras = list_session.query(Camera).all()
            # Refresh runtime settings from DB so changes take effect without restart
            pipeline.refresh_settings(list_session)
        finally:
            list_session.close()

        if cameras:
            futures = {
                executor.submit(_process_camera, pipeline, cam): cam.camera_id
                for cam in cameras
            }
            total_files = 0
            for future in as_completed(futures):
                cam_id = futures[future]
                try:
                    n = future.result()
                    total_files += n
                    if n:
                        log.debug("[%s] processed %d file(s)", cam_id, n)
                except Exception as exc:
                    log.exception("[%s] future error: %s", cam_id, exc)

            if total_files:
                log.info("Cycle complete: %d camera(s), %d file(s) processed",
                         len(cameras), total_files)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run_worker()
