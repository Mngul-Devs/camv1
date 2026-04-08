"""
r2_client.py — Cloudflare R2 upload for hard-sample YOLO frames.

Hard samples = frames where max vehicle detection confidence falls in
[R2_CONF_LOW, R2_CONF_HIGH] (default 0.35–0.65). These are ambiguous frames
that benefit most from human labeling.

If R2 env vars are not set, all methods are no-ops (returns None).
Requires: boto3  (add to requirements.txt)
"""
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# R2 credentials — all optional; if missing, upload is silently skipped.
_ACCOUNT_ID    = os.getenv("R2_ACCOUNT_ID", "")
_ACCESS_KEY    = os.getenv("R2_ACCESS_KEY_ID", "")
_SECRET_KEY    = os.getenv("R2_SECRET_ACCESS_KEY", "")
_BUCKET        = os.getenv("R2_BUCKET_NAME", "campark-raw")
_ENDPOINT      = os.getenv("R2_ENDPOINT_URL", "")

# Confidence band that defines a "hard sample"
_CONF_LOW  = float(os.getenv("R2_CONF_LOW",  "0.35"))
_CONF_HIGH = float(os.getenv("R2_CONF_HIGH", "0.65"))

_client = None  # lazy-initialised boto3 client


def _is_configured() -> bool:
    return bool(_ACCOUNT_ID and _ACCESS_KEY and _SECRET_KEY and _ENDPOINT)


def _get_client():
    global _client
    if _client is not None:
        return _client
    if not _is_configured():
        return None
    try:
        import boto3
        _client = boto3.client(
            "s3",
            endpoint_url=_ENDPOINT,
            aws_access_key_id=_ACCESS_KEY,
            aws_secret_access_key=_SECRET_KEY,
            region_name="auto",
        )
        return _client
    except Exception as exc:
        log.warning("R2: failed to create boto3 client: %s", exc)
        return None


def is_hard_sample(detections: list) -> bool:
    """Return True if the frame's max vehicle confidence is in the hard-sample band."""
    if not detections:
        return False
    max_conf = max(d["confidence"] for d in detections)
    return _CONF_LOW <= max_conf <= _CONF_HIGH


def upload_hard_sample(
    local_path: str,
    camera_id: str,
    snapshot_id: int,
) -> Optional[str]:
    """Upload a frame to R2 raw/ prefix. Returns R2 object key on success, None on skip/error.

    Key format: raw/{camera_id}/{YYYY-MM-DD}/{snapshot_id}_{filename}
    """
    client = _get_client()
    if client is None:
        return None  # R2 not configured — silent no-op

    try:
        filename = Path(local_path).name
        date_prefix = datetime.utcnow().strftime("%Y-%m-%d")
        key = f"raw/{camera_id}/{date_prefix}/{snapshot_id}_{filename}"

        client.upload_file(
            Filename=local_path,
            Bucket=_BUCKET,
            Key=key,
            ExtraArgs={"ContentType": "image/jpeg"},
        )
        log.info("R2: uploaded hard sample → %s/%s", _BUCKET, key)
        return key
    except Exception as exc:
        log.warning("R2: upload failed for %s: %s", local_path, exc)
        return None
