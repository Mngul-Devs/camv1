#!/bin/bash
# CamPark SFTP entrypoint
# Reads FTP_USERS env var (format: "user1:pass1,user2:pass2")
# Creates each user's home dir under /home/{username}
# Delegates to atmoz/sftp's original entrypoint which reads /etc/sftp/users.conf

set -e
chown root:root /home
chmod 755 /home


USERS_CONF_ARGS=()

if [ -z "$FTP_USERS" ]; then
    echo "[SFTP] WARNING: FTP_USERS is not set. No users will be created."
else
    echo "[SFTP] Provisioning users from FTP_USERS..."
    IFS=',' read -ra PAIRS <<< "$FTP_USERS"
    for PAIR in "${PAIRS[@]}"; do
        USERNAME="${PAIR%%:*}"
        PASSWORD="${PAIR#*:}"
        if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
            echo "[SFTP] Skipping invalid entry: $PAIR"
            continue
        fi
        # atmoz/sftp entrypoint accepts args in format: user:pass:::homedir
        # The ::: means no UID/GID override; start dir is /upload (set via sshd_config ForceCommand)
        # We create both upload/ (VIGI "save to root") and incoming/ (Dahua custom path)
        USERS_CONF_ARGS+=("${USERNAME}:${PASSWORD}:::upload")
        # Also create incoming/ for Dahua cameras (set remote path to /incoming)
        mkdir -p "/home/${USERNAME}/incoming"
        chown 1000:1000 "/home/${USERNAME}/incoming"
        chmod 755 "/home/${USERNAME}/incoming"
        echo "[SFTP] + User '$USERNAME' -> /home/${USERNAME}/upload (VIGI) + /home/${USERNAME}/incoming (Dahua)"
    done
fi

# Hand off to atmoz/sftp's original entrypoint with user args
exec /entrypoint "${USERS_CONF_ARGS[@]}"
