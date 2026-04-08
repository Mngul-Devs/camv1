#!/bin/bash
# =============================================================================
# oracle-setup.sh — First-boot setup for Oracle Cloud Always Free VM
# Run ONCE as ubuntu user on a fresh Ubuntu 22.04 instance.
#
# Usage:
#   chmod +x oracle-setup.sh
#   sudo ./oracle-setup.sh
# =============================================================================
set -euo pipefail

echo "=== CamPark Oracle VM Setup ==="
echo "Running as: $(whoami) on $(hostname)"

# -----------------------------------------------------------------------------
# 1. OS firewall (iptables) — Oracle adds its own iptables rules that block
#    everything by default. Console Security Lists alone are NOT enough.
# -----------------------------------------------------------------------------
echo ""
echo "[1/4] Configuring iptables..."

# Install persistence tool
apt-get update -qq
apt-get install -y -qq iptables-persistent netfilter-persistent

# Allow SFTP (camera uploads)
iptables -I INPUT 1 -p tcp --dport 8022 -j ACCEPT

# Allow API (admin UI)
iptables -I INPUT 2 -p tcp --dport 8000 -j ACCEPT

# Allow HTTP/HTTPS (Caddy reverse proxy)
iptables -I INPUT 3 -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 4 -p tcp --dport 443 -j ACCEPT

# Save so they survive reboot
netfilter-persistent save
echo "  iptables rules saved."

# -----------------------------------------------------------------------------
# 2. Docker Install
# -----------------------------------------------------------------------------
echo ""
echo "[2/4] Installing Docker..."

apt-get install -y -qq ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key + repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu
echo "  Docker installed. 'ubuntu' user added to docker group."

# -----------------------------------------------------------------------------
# 3. Git
# -----------------------------------------------------------------------------
echo ""
echo "[3/4] Installing git..."
apt-get install -y -qq git

# -----------------------------------------------------------------------------
# 4. Done
# -----------------------------------------------------------------------------
echo ""
echo "[4/4] Setup complete."
echo ""
echo "NEXT STEPS (run as ubuntu, NOT root):"
echo "   Log out and back in so docker group takes effect, then:"
echo ""
echo "   git clone https://github.com/Mngul-Devs/camv1.git"
echo "   cd camv1"
echo "   cp .env.example .env"
echo "   # Edit .env: set SFTP_PORT=8022, FTP_PUBLICHOST=<this-vm-public-ip>"
echo "   # Set POSTGRES_PASSWORD, ADMIN_PASSWORD, SECRET_KEY to strong values"
echo "   docker compose -f docker-compose.yml up -d"
echo "   docker compose -f docker-compose.yml logs sftp --tail 20"
echo ""
