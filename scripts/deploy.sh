#!/bin/bash
# =============================================================================
# deploy.sh — Deploy or update CamPark stack on Oracle VM
# Run as ubuntu user (after oracle-setup.sh has been run once).
#
# First deploy:
#   ./scripts/deploy.sh --first-run --ip <oracle-public-ip>
#
# Update (pull latest + recreate changed services):
#   ./scripts/deploy.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$HOME/camv1"
REPO_URL="https://github.com/Mngul-Devs/camv1.git"
COMPOSE_FLAGS="-f docker-compose.yml"  # skip override.yml (dev-only)
PUBLIC_IP=""
FIRST_RUN=false

# -----------------------------------------------------------------------------
# Parse args
# -----------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --first-run) FIRST_RUN=true; shift ;;
        --ip) PUBLIC_IP="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "=== CamPark Deploy ==="

# -----------------------------------------------------------------------------
# First-run: clone + configure .env
# -----------------------------------------------------------------------------
if $FIRST_RUN; then
    if [ -z "$PUBLIC_IP" ]; then
        echo "ERROR: --first-run requires --ip <oracle-public-ip>"
        exit 1
    fi

    echo "[1/3] Cloning repository..."
    if [ -d "$REPO_DIR" ]; then
        echo "  Directory $REPO_DIR already exists — pulling instead."
        cd "$REPO_DIR" && git pull
    else
        git clone "$REPO_URL" "$REPO_DIR"
    fi

    cd "$REPO_DIR"

    echo "[2/3] Creating .env from template..."
    if [ -f .env ]; then
        echo "  .env already exists — skipping template copy. Edit manually if needed."
    else
        cp .env.example .env

        # Patch the public IP automatically
        sed -i "s|FTP_PUBLICHOST=.*|FTP_PUBLICHOST=${PUBLIC_IP}|" .env

        # Generate random secrets
        POSTGRES_PASS=$(python3 -c "import secrets; print(secrets.token_hex(16))")
        ADMIN_PASS=$(python3 -c "import secrets; print(secrets.token_hex(12))")
        SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

        sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASS}|" .env
        sed -i "s|DATABASE_URL=postgresql://campark:.*@|DATABASE_URL=postgresql://campark:${POSTGRES_PASS}@|" .env
        sed -i "s|ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${ADMIN_PASS}|" .env
        sed -i "s|SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env

        echo ""
        echo "  .env created. Auto-generated credentials:"
        echo "  ADMIN_PASSWORD : ${ADMIN_PASS}"
        echo "  POSTGRES_PASSWORD: ${POSTGRES_PASS}"
        echo ""
        echo "  IMPORTANT: Save these — they will not be shown again."
    fi

    echo "[3/3] Starting stack..."
    docker compose $COMPOSE_FLAGS up -d
    docker compose $COMPOSE_FLAGS logs sftp --tail 20

    echo ""
    echo "Deploy complete."
    echo "  Admin UI : http://${PUBLIC_IP}:8000/admin"
    echo "  SFTP     : ${PUBLIC_IP}:8022"
    exit 0
fi

# -----------------------------------------------------------------------------
# Update: pull + recreate changed containers
# -----------------------------------------------------------------------------
if [ ! -d "$REPO_DIR" ]; then
    echo "ERROR: $REPO_DIR not found. Run with --first-run --ip <ip> first."
    exit 1
fi

cd "$REPO_DIR"

echo "[1/3] Pulling latest code..."
git pull

echo "[2/3] Rebuilding changed images..."
docker compose $COMPOSE_FLAGS build

echo "[3/3] Recreating changed containers..."
docker compose $COMPOSE_FLAGS up -d --remove-orphans

echo ""
echo "Update complete."
docker compose $COMPOSE_FLAGS ps
