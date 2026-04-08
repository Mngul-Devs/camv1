# CamPark — Copilot Repo Instructions

Auto-loaded every session. No need to re-explain the project.

---

## What This Is

Smart parking monitoring system. VIGI + Dahua cameras upload snapshots via SFTP → Docker worker runs YOLOv8 detection → zones marked occupied/free → admin dashboard shows live status.

**Goal: 90% mAP** through iterative YOLO fine-tuning on parking lot-specific data (fisheye, diagonal, various car types).

---

## Repo & Git

- **Repo**: `https://github.com/Mngul-Devs/camv1.git`
- **Branch**: `main`
- **SSH remote** (use this, not HTTPS): `git@github-mngul:Mngul-Devs/camv1.git`
- **SSH alias** in `~/.ssh/config`: `github-mngul` → key `id_ed25519_mngul_devs`
- Always push with: `git push origin main` (remote already set to SSH)
- `docs/` is in `.gitignore` — force-add with `git add -f docs/` if needed

---

## Directory Layout

```
c:\camperk\
├── docker-compose.yml          # Production services (no override)
├── docker-compose.override.yml # Dev-only: Vite HMR, gunicorn --reload, label-studio
├── .env                        # Local secrets — never commit
├── .env.example                # Template — commit this
├── scripts/
│   ├── oracle-setup.sh         # First-boot Oracle VM setup (iptables + Docker)
│   └── deploy.sh               # Deploy/update: --first-run --ip <ip>
├── services/
│   ├── sftp/                   # SFTP ingestion (atmoz/sftp based)
│   ├── ftp/                    # Legacy FTP (kept as fallback, disabled on cloud)
│   ├── worker/                 # YOLO inference pipeline
│   ├── api/                    # Flask admin UI + REST API
│   ├── caddy/                  # HTTPS reverse proxy
│   ├── ingestion/              # (reserved)
│   └── config/
│       ├── init.sql            # Fresh DB schema
│       ├── migrate_001_*.sql
│       ├── migrate_002_*.sql
│       └── migrate_003_r2_hard_samples.sql
├── frontend/                   # Vite + React + Tailwind admin UI
├── data/
│   ├── ftp/                    # Camera uploads land here (mounted into sftp + worker)
│   │   ├── cam001/upload/      # VIGI uploads ("save to root dir" + sshd_config /upload)
│   │   ├── cam001/incoming/    # Dahua uploads (remote path /incoming)
│   │   └── cam002/...
│   └── images/                 # Processed snapshots with evidence overlays
├── models/                     # YOLO models (yolov8n.pt, future best.pt)
└── docs/                       # Planning docs (gitignored — force-add if needed)
    ├── 2026-04-06/Todayplan.md # Current active plan
    └── 2026-04-09/ORACLE_R2_SETUP_GUIDE.md
```

---

## Docker Services

| Container | Purpose | Port |
|---|---|---|
| `campark-sftp` | Camera SFTP ingestion | `8022:22` |
| `campark-ftp` | Legacy FTP fallback | `21:21` (disabled on cloud) |
| `campark-worker` | YOLO inference + R2 upload | internal |
| `campark-api` | Flask admin UI + REST | `8000:8000` |
| `campark-frontend-v6` | React dashboard | internal (behind Caddy) |
| `campark-caddy` | HTTPS reverse proxy | `80:80`, `443:443` |
| `campark-db` | PostgreSQL 15 | `127.0.0.1:5432` |

**Key docker commands:**
```bash
# Production (skip override.yml)
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.yml logs <service> --tail 30
docker compose -f docker-compose.yml build <service>

# Dev (includes override.yml automatically)
docker compose up -d

# Rebuild one service
docker compose build sftp; docker compose up sftp -d --force-recreate
```

---

## SFTP Service (`services/sftp/`)

- Base image: `atmoz/sftp:latest`
- Users read from `FTP_USERS` env var: `cam001:pass1,cam002:pass2`
- **Chroot requirement**: `/home` must be `root:root 755` — handled in `entrypoint.sh`
- `sshd_config` forces all users into `/upload` subdir automatically (`ForceCommand internal-sftp -d /upload`)
- Each user gets two dirs:
  - `data/ftp/{user}/upload/` — VIGI "save to root directory"
  - `data/ftp/{user}/incoming/` — Dahua remote path `/incoming`
- Volume: `./data/ftp:/home`
- "Refusing non-sftp session" in logs = normal (shell blocked by design)

**Test SFTP:**
```powershell
sftp -P 8022 cam001@<server-ip>
```

---

## Worker Pipeline (`services/worker/`)

**Flow:** rglob `data/ftp/` → PIL format detection → perceptual diff (32×32 thumb, delta ≥ 6.0) → YOLO confidence ≥ 0.50 → zone overlap check → Snapshot + Detection DB rows → R2 upload if hard sample

**Key files:**
- `main.py` — file scanner, thread pool per camera, telemetry
- `infer/pipeline.py` — full inference pipeline (dedup → perceptual diff → YOLO → zones → R2)
- `yolo_processor.py` — YOLO wrapper (ultralytics 8.0.110)
- `r2_client.py` — Cloudflare R2 uploader (boto3, no-op if R2 env vars unset)
- `db.py` — SQLAlchemy ORM models
- `requirements.txt` — `ultralytics, boto3, Pillow, SQLAlchemy, psycopg2-binary, numpy, onnxruntime`

**Hard samples**: frames where max vehicle confidence ∈ [0.35, 0.65] → uploaded to R2 `raw/{camera_id}/{date}/` → auto-deleted after 3 days → labeled in Label Studio → used for YOLO fine-tuning

**Worker env vars that matter:**
```env
YOLO_CONFIDENCE=0.50
OVERLAP_THRESHOLD=0.15
SCENE_DIFF_THRESHOLD=6.0
R2_CONF_LOW=0.35
R2_CONF_HIGH=0.65
```

---

## Database (PostgreSQL 15)

**Connection** (inside stack): `postgresql://campark:<password>@postgres:5432/campark`

**Key tables:**
| Table | Purpose |
|---|---|
| `cameras` | camera config, status, `ftp_username` |
| `zones` | polygon definitions per camera |
| `snapshots` | one row per processed frame; has `r2_key`, `r2_uploaded_at` |
| `detections` | raw YOLO boxes (class, confidence, bbox_json) |
| `zone_events` | occupancy state changes |
| `snapshot_decisions` | every file seen (PROCESSED/SKIPPED/ERROR + reason) |
| `ingest_telemetry` | file format, burst grouping, file size per arrival |
| `system_settings` | key/value — operating hours, ftp_pending_{cam_id} |

**Migrations** — run manually on existing deploys:
```bash
docker compose exec postgres psql -U campark -d campark \
  -f /path/to/migrate_00X_*.sql
```

---

## Environment Variables — What to Set on New Deploy

```env
# Required
COMPOSE_PROJECT_NAME=camv1
POSTGRES_PASSWORD=<strong>
DATABASE_URL=postgresql://campark:<strong>@postgres:5432/campark
ADMIN_PASSWORD=<strong>
SECRET_KEY=<python3 -c "import secrets; print(secrets.token_hex(32))">
FTP_PUBLICHOST=<oracle-or-server-public-ip>
FTP_USERS=cam001:<pass>,cam002:<pass>
SFTP_PORT=8022

# R2 (fill in after creating bucket)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=campark-raw
R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
R2_CONF_LOW=0.35
R2_CONF_HIGH=0.65
```

---

## Infrastructure

| Layer | What | Notes |
|---|---|---|
| **SFTP relay** | Oracle Cloud Always Free A1.Flex | 4 OCPU / 24GB ARM Ubuntu 22.04. ISP blocks all inbound — Oracle VM is the public endpoint. |
| **Object storage** | Cloudflare R2 `campark-raw` | Free tier: 10GB / 1M Class A ops/month. `raw/` prefix: 3-day lifecycle. `training/` + `models/`: permanent. |
| **Training** | Local PC AMD GPU | `torch-directml` for `device='dml'`. Scheduled 8pm–5am. Trigger: >100 new labeled images. |
| **Labeling** | Label Studio (local Docker) | Port 8080 in `docker-compose.override.yml`. |

**Oracle VM — BOTH iptables AND Console Security List rules are required** (unlike GCP):
```bash
sudo iptables -I INPUT 1 -p tcp --dport 8022 -j ACCEPT
sudo iptables -I INPUT 2 -p tcp --dport 8000 -j ACCEPT
sudo iptables -I INPUT 3 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Camera Configuration

**VIGI:**
- Mode: SFTP, Port: `8022`, Upload: "Save to root directory"
- File lands in: `data/ftp/{user}/upload/`

**Dahua / Uniarch:**
- Mode: SFTP, Port: `8022`, Remote path: `/incoming`
- File lands in: `data/ftp/{user}/incoming/`

---

## SSH Hosts

| Alias | Host | User | Key |
|---|---|---|---|
| `campark` | `34.87.50.204` (old GCP) | `deepgpt805_gmail_com` | `id_ed25519_MeerulCam` |
| `github-mngul` | github.com | `git` | `id_ed25519_mngul_devs` |

---

## Known Issues / Gotchas

1. **`bad ownership or modes for chroot directory`** — `/home` inside container must be `root:root 755`. Solved in `entrypoint.sh` with `chown root:root /home && chmod 755 /home`.
2. **"Refusing non-sftp session"** — Normal. Shell is blocked by `ForceCommand`. Not an error.
3. **NAT hairpin** — Can't test own public IP from inside LAN. Use mobile hotspot or a VPS.
4. **Oracle iptables** — Console Security List alone does nothing. Must also run iptables commands on the VM. This has bitten us before.
5. **`docs/` is gitignored** — Use `git add -f docs/...` to force-add documentation files.
6. **`docker-compose.override.yml` is dev-only** — On Oracle VM always run `docker compose -f docker-compose.yml` (explicit, skips override).
7. **Worker scans recursively** — `rglob("*")` + PIL format detection. Works for any path structure. No worker changes needed when adding new camera brands.
8. **atmoz/sftp home dir format** — `username:password:::homedir` (3 colons = no UID/GID override).

---

## ML Pipeline Status

| Stage | Status |
|---|---|
| Camera → SFTP ingestion | ✅ LAN confirmed, Oracle VM pending |
| Worker YOLO filter | ✅ Running (yolov8n.pt CPU) |
| R2 hard-sample upload | ✅ Code done, needs R2 credentials |
| Label Studio integration | ⏳ Manual for now |
| YOLO fine-tuning | ⏳ After first labeled batch |
| Automated training loop | ⏳ Stage 5 |
