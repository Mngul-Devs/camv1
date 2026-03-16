#!/bin/bash
# CamPark FTP entrypoint: create users, watch for changes, start pure-ftpd

SYNC_FILE="/home/.ftp_users.json"
PDB_FILE="/etc/pure-ftpd/pureftpd.pdb"
PASSWD_FILE="/etc/pure-ftpd/passwd/pureftpd.passwd"

# Initial user creation
/usr/local/bin/create-users.sh

# Background watcher: reload FTP users when sync file changes
(
    LAST_HASH=""
    while true; do
        sleep 10
        if [ -f "$SYNC_FILE" ]; then
            CURR_HASH=$(md5sum "$SYNC_FILE" 2>/dev/null | awk '{print $1}')
            if [ "$CURR_HASH" != "$LAST_HASH" ] && [ -n "$CURR_HASH" ]; then
                LAST_HASH="$CURR_HASH"
                echo "[FTP-SYNC] Detected change in $SYNC_FILE, reloading users..."
                /usr/local/bin/create-users.sh
            fi
        fi
    done
) &

# Start pure-ftpd with passive ports and chroot
exec /usr/sbin/pure-ftpd \
    -l puredb:$PDB_FILE \
    -E \
    -j \
    -R \
    -P "$PUBLICHOST" \
    -p "${FTP_PASSIVE_PORTS:-30000:30049}"
