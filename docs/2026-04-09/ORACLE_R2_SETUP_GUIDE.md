# Oracle Cloud VM + Cloudflare R2 Setup Guide

> Date: 2026-04-09
> Context: ISP blocks all inbound ports. Oracle Always Free VM is the public SFTP relay.
> Cameras connect to Oracle VM → worker filters frames → hard samples go to Cloudflare R2 → labeled locally → YOLO training on AMD GPU.

---

## Part 1 — Oracle Cloud Always Free VM

### Step 1 — Sign in to Oracle Cloud

1. Go to [cloud.oracle.com](https://cloud.oracle.com)
2. Click **Sign In** → enter your tenancy name → sign in

---

### Step 2 — Create the VM

1. Top-left hamburger menu → **Compute** → **Instances** → **Create Instance**
2. Fill in:

| Field | Value |
|---|---|
| **Name** | `campark-sftp` |
| **Image** | Ubuntu 22.04 Minimal (click *Edit* → Ubuntu → 22.04) |
| **Shape** | VM.Standard.A1.Flex (click *Edit* → **Ampere** tab → A1.Flex) |
| **OCPUs** | `4` |
| **Memory** | `24 GB` |
| **Boot volume** | `50 GB` |

3. **SSH Keys** — under *Add SSH keys*:
   - Upload your `id_ed25519.pub`, or
   - Paste the public key text, or
   - Let Oracle generate a key pair → **download the private key now** (only shown once)

4. Click **Create**. Wait ~2 minutes for status to show **RUNNING**.
5. Note the **Public IP address** — you will use this everywhere.

---

### Step 3 — Open Firewall Ports in Oracle Console

Oracle's VCN Security Lists block all inbound traffic by default. You must add rules here AND on the VM's iptables (both required).

1. On the Instance page → click the **Subnet** link → **Security List** → **Default Security List for vcn-...**
2. Click **Add Ingress Rules** and add these 4 rules one by one:

| Source CIDR | IP Protocol | Port | Description |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `22` | SSH (your access) |
| `0.0.0.0/0` | TCP | `8022` | SFTP — camera uploads |
| `0.0.0.0/0` | TCP | `8000` | API / Admin UI |
| `0.0.0.0/0` | TCP | `80` | HTTP |
| `0.0.0.0/0` | TCP | `443` | HTTPS |

3. Click **Save**.

---

### Step 4 — SSH into the VM

```powershell
# Windows PowerShell
ssh -i C:\Users\amirl\.ssh\<your-key>.pem ubuntu@<oracle-public-ip>
```

If you used `id_ed25519`:
```powershell
ssh ubuntu@<oracle-public-ip>
```

---

### Step 5 — Configure iptables (REQUIRED on Oracle)

Oracle injects its own iptables rules that reject everything. Console Security List rules alone are not enough.

```bash
# Install persistence
sudo apt-get update -y
sudo apt-get install -y iptables-persistent netfilter-persistent

# Open required ports
sudo iptables -I INPUT 1 -p tcp --dport 8022 -j ACCEPT
sudo iptables -I INPUT 2 -p tcp --dport 8000 -j ACCEPT
sudo iptables -I INPUT 3 -p tcp --dport 80   -j ACCEPT
sudo iptables -I INPUT 4 -p tcp --dport 443  -j ACCEPT

# Save (survives reboot)
sudo netfilter-persistent save
```

Verify:
```bash
sudo iptables -L INPUT -n --line-numbers | head -20
```

---

### Step 6 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo systemctl enable docker
sudo systemctl start docker
```

**Log out and back in** so the docker group takes effect:
```bash
exit
ssh ubuntu@<oracle-public-ip>
docker ps   # should work without sudo
```

---

### Step 7 — Deploy the CamPark Stack

```bash
# Install git
sudo apt-get install -y git

# Clone the repo
git clone https://github.com/Mngul-Devs/camv1.git
cd camv1

# Create .env from template
cp .env.example .env
nano .env
```

**Minimum edits in `.env`:**

```env
FTP_PUBLICHOST=<oracle-public-ip>
SFTP_PORT=8022

POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://campark:<strong-password>@postgres:5432/campark

ADMIN_PASSWORD=<strong-password>

# Generate with: python3 -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY=<32-char-random-hex>
```

Start the stack (skip the dev override file):
```bash
docker compose -f docker-compose.yml up -d
```

Check SFTP is running:
```bash
docker compose -f docker-compose.yml logs sftp --tail 30
```

Expected output:
```
[SFTP] + User 'cam001' -> /home/cam001/upload (VIGI) + /home/cam001/incoming (Dahua)
[SFTP] + User 'cam002' -> /home/cam002/upload (VIGI) + /home/cam002/incoming (Dahua)
```

---

### Step 8 — Verify SFTP from your PC

```powershell
# From Windows PowerShell
sftp -P 8022 cam001@<oracle-public-ip>
# Enter password from FTP_USERS env var
sftp> put test.txt
sftp> bye
```

Then on the VM confirm:
```bash
ls ~/camv1/data/ftp/cam001/upload/
# test.txt should be there
```

---

### Step 9 — Configure Cameras

**VIGI:**
| Field | Value |
|---|---|
| Transfer Mode | SFTP |
| Server Address | `<oracle-public-ip>` |
| Port | `8022` |
| Username / Password | `cam001` / your password |
| Save Path | Save to root directory |

**Dahua / Uniarch:**
| Field | Value |
|---|---|
| Transfer Mode | SFTP |
| Server Address | `<oracle-public-ip>` |
| Port | `8022` |
| Remote Path | `/incoming` |

---

## Part 2 — Cloudflare R2 Bucket

### Step 1 — Create the bucket

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → your account
2. Left sidebar → **R2 Object Storage** → **Create bucket**
3. Fill in:
   - **Name**: `campark-raw`
   - **Location**: Auto (or Asia Pacific for lower latency)
4. Click **Create bucket**

---

### Step 2 — Set lifecycle rule (auto-delete raw frames)

1. Open `campark-raw` → **Settings** tab → **Object lifecycle rules**
2. Click **Add rule**:
   - **Name**: `delete-raw-3days`
   - **Prefix filter**: `raw/`
   - **Action**: Expire after `3` days
3. Save

This ensures raw snapshots are automatically deleted 3 days after upload. Labeled training data in `training/` is NOT under `raw/` so it is kept permanently.

---

### Step 3 — Create R2 API token

1. R2 main page → **Manage R2 API Tokens** (top right)
2. **Create API token**:
   - **Token name**: `campark-worker`
   - **Permissions**: Object Read & Write
   - **Bucket scope**: Specific bucket → `campark-raw`
3. Click **Create API token**
4. Save these values — **shown only once**:

| Variable | Where to find |
|---|---|
| Account ID | URL of Cloudflare dashboard or top of R2 page |
| Access Key ID | Token creation page |
| Secret Access Key | Token creation page |
| Endpoint URL | `https://<account-id>.r2.cloudflarestorage.com` |

---

### Step 4 — Add R2 credentials to `.env` on Oracle VM

```bash
nano ~/camv1/.env
```

Fill in:
```env
R2_ACCOUNT_ID=<your-account-id>
R2_ACCESS_KEY_ID=<access-key-id>
R2_SECRET_ACCESS_KEY=<secret-access-key>
R2_BUCKET_NAME=campark-raw
R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com

# Hard-sample confidence band (frames YOLO is unsure about → label these)
R2_CONF_LOW=0.35
R2_CONF_HIGH=0.65
```

Restart the worker to pick up the new env vars:
```bash
cd ~/camv1
docker compose -f docker-compose.yml up -d worker
docker compose -f docker-compose.yml logs worker --tail 20
```

---

## Verification Checklist

| Check | Command / Action | Expected |
|---|---|---|
| VM reachable | `ping <oracle-ip>` | Replies |
| SFTP port open | `sftp -P 8022 cam001@<oracle-ip>` | Password prompt |
| Stack running | `docker compose ps` | All containers Up |
| Camera upload | VIGI Test button | Success |
| Worker picks up file | `docker compose logs worker -f` | `[cam001] Scene changed` |
| R2 upload (hard sample arrives) | R2 bucket → Objects | `raw/cam001/...` file appears |
| R2 lifecycle | Wait 3+ days | `raw/` objects auto-deleted |

---

## Quick Reference — Daily Use

```bash
# SSH into VM
ssh ubuntu@<oracle-ip>

# Check stack status
cd ~/camv1
docker compose -f docker-compose.yml ps

# Watch live worker logs
docker compose -f docker-compose.yml logs worker -f

# Pull latest code + redeploy
git pull
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d

# Run DB migration (after code updates that add columns)
docker compose -f docker-compose.yml exec postgres \
  psql -U campark -d campark -f /docker-entrypoint-initdb.d/migrate_003_r2_hard_samples.sql
```
