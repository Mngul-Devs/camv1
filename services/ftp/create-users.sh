#!/bin/bash
# ============================================================
# CamPark FTP User Sync
# ============================================================
# Reads users from TWO sources:
#   1. /home/.ftp_users.json  (written by API on camera add/delete)
#   2. FTP_USERS env var      (fallback / bootstrap)
#
# Each user gets:
#   - Home directory: /home/{username}
#   - Subdirectory:   /home/{username}/incoming
#   - Chrooted to their own home (no cross-camera access)
# ============================================================

set -e

SYNC_FILE="/home/.ftp_users.json"
PASSWD_FILE="/etc/pure-ftpd/passwd/pureftpd.passwd"
PDB_FILE="/etc/pure-ftpd/pureftpd.pdb"
USER_COUNT=0

mkdir -p /etc/pure-ftpd/passwd
# Clear old passwd file for clean rebuild
> "$PASSWD_FILE"

create_user() {
    local username="$1"
    local password="$2"
    local HOME_DIR="/home/$username"

    mkdir -p "$HOME_DIR/incoming"

    (echo "$password"; echo "$password") | pure-pw useradd "$username" -u 1001 -g 1001 \
        -d "$HOME_DIR" -f "$PASSWD_FILE" 2>/dev/null || \
    (echo "$password"; echo "$password") | pure-pw usermod "$username" -u 1001 -g 1001 \
        -d "$HOME_DIR" -f "$PASSWD_FILE" 2>/dev/null || true

    chown -R 1001:1001 "$HOME_DIR"
    chmod 755 "$HOME_DIR"
    chmod 755 "$HOME_DIR/incoming"

    echo "  + User '$username' -> $HOME_DIR/incoming"
    USER_COUNT=$((USER_COUNT + 1))
}

echo "=== CamPark FTP User Sync ==="

# --- Source 1: DB sync file (written by API) ---
if [ -f "$SYNC_FILE" ]; then
    echo "Reading users from $SYNC_FILE ..."
    # Parse JSON: extract username:password pairs
    # The file format is: {"users":[{"username":"x","password":"y"},...],...}
    PAIRS=$(grep -oP '"username"\s*:\s*"[^"]*"' "$SYNC_FILE" | sed 's/"username"\s*:\s*"//;s/"//' | \
        paste -d: - <(grep -oP '"password"\s*:\s*"[^"]*"' "$SYNC_FILE" | sed 's/"password"\s*:\s*"//;s/"//'))

    while IFS=: read -r username password; do
        if [ -n "$username" ] && [ -n "$password" ]; then
            create_user "$username" "$password"
        fi
    done <<< "$PAIRS"
fi

# --- Source 2: FTP_USERS env var (fallback / bootstrap) ---
if [ -n "$FTP_USERS" ]; then
    echo "Reading users from FTP_USERS env var (fallback) ..."
    IFS=',' read -ra USER_PAIRS <<< "$FTP_USERS"
    for pair in "${USER_PAIRS[@]}"; do
        IFS=':' read -r username password <<< "$pair"
        if [ -n "$username" ] && [ -n "$password" ]; then
            create_user "$username" "$password"
        fi
    done
fi

if [ "$USER_COUNT" -eq 0 ]; then
    echo "WARNING: No FTP users configured."
    echo "Add cameras via the admin panel or set FTP_USERS env var."
fi

# Rebuild PureDB
pure-pw mkdb "$PDB_FILE" -f "$PASSWD_FILE"

echo "=== $USER_COUNT FTP user(s) configured ==="
