# Today's Plan — CamPark Cloud Deployment

---

## What Happened (April 6)

| Attempt | Result | Reason |
|---|---|---|
| Local SFTP port 2222 | ❌ | ISP blocks inbound |
| Local SFTP port 8022 | ❌ | ISP blocks inbound |
| Local FTP | ❌ | Same ISP wall |
| SFTP container (LAN) | ✅ | Auth + upload confirmed |

**Decision**: Oracle Cloud Always Free VM (A1.Flex — 4 OCPU / 24GB, $0 forever) as public SFTP endpoint. Training stays local on PC (AMD GPU).

---

## Architecture

```
VIGI / Dahua camera
    ↓ SFTP port 8022
Oracle Cloud VM (Always Free, public IP)
    ├── campark-sftp   ← accepts camera uploads
    ├── campark-worker ← YOLO filter, hard samples only
    ├── campark-api    ← admin UI + REST API
    └── postgres       ← metadata only
            ↓ hard samples (5-10%)
        Cloudflare R2  ← temp landing, 3-day auto-delete
            ↓
        Local PC
            ├── Label Studio (labeling)
            └── YOLOv8 training (AMD GPU, 8pm–5am)
                    ↓
                best.pt → R2 models/ → VM pulls updated model
```

---

## ✅ Stage 0 — DONE

- SFTP Docker service built (`services/sftp/`)
- Chroot fix applied, LAN upload confirmed
- Dual dirs per user: `upload/` (VIGI) + `incoming/` (Dahua)
- Worker accepts `.jpg` and `.jpeg` (PIL format-agnostic)

---

## Stage 1 — Oracle VM Setup (YOU do this in Console)

1. Create VM: **A1.Flex, 4 OCPU, 24GB RAM, Ubuntu 22.04, 50GB boot**
2. Download SSH private key when prompted
3. Add Security List Ingress Rules (TCP): **22, 8022, 8000, 80, 443**
4. Share public IP → I run deployment

---

## Stage 2 — Deploy Stack to Oracle VM (I do this)

```bash
# 1. SSH in
ssh -i <key.pem> ubuntu@<oracle-ip>

# 2. Fix Oracle OS firewall (required — Console rules alone not enough)
sudo iptables -I INPUT -p tcp --dport 8022 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8000 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# 3. Install Docker
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ubuntu

# 4. Clone + configure
git clone https://github.com/Mngul-Devs/camv1.git
cd camv1
cp .env.example .env
# edit .env: set FTP_PUBLICHOST=<oracle-ip>, SFTP_PORT=8022

# 5. Start stack
docker compose up -d
docker compose logs sftp --tail 20
```

---

## Stage 3 — Camera Config

**VIGI:**
- Mode: SFTP, Server: `<oracle-ip>`, Port: `8022`
- Upload path: Save to root directory → lands in `upload/`

**Dahua:**
- Mode: SFTP, Server: `<oracle-ip>`, Port: `8022`
- Remote path: `/incoming` → lands in `incoming/`

**Verify:** camera Test button → success → check `docker compose logs worker -f`

---

## Stage 4 — R2 Integration (worker extension)

- `services/worker/r2_client.py` — boto3 S3-compatible R2 client
- After YOLO: conf 0.35–0.65 → upload to R2 `raw/{camera_id}/{date}/`
- Add `r2_key`, `r2_uploaded_at` to `snapshots` table
- R2 lifecycle: 3-day auto-delete on `raw/` prefix (Cloudflare dashboard)

---

## Stage 5 — Local Training Loop

- Label Studio (local) → label R2 images → export YOLO format
- `services/trainer/train.py` → `model.train(device='dml')` AMD GPU via torch-directml
- Scheduler: 8pm daily, triggers if >100 new labeled images
- Upload `best.pt` → R2 `models/v{N}/` → VM worker reloads

**Goal: 90% mAP** through iterative labeling cycles.

---

## Next Action

**Waiting for Oracle VM public IP.** Share it and deployment starts immediately.
