#!/usr/bin/env bash
# Daily restic backup to Hetzner Object Storage.
# Run via systemd timer on the server (see cloud-init/pilot.yaml).
#
# Configuration: environment variables in /etc/restic/env (created once by the
# maintainer during initial setup). Expected variables:
#   RESTIC_REPOSITORY        e.g. s3:s3.eu-central-003.hetznerobjects.com/varlens-pilot-backup
#   RESTIC_PASSWORD          generated via `openssl rand -base64 32`
#   AWS_ACCESS_KEY_ID        Hetzner Object Storage access key
#   AWS_SECRET_ACCESS_KEY    Hetzner Object Storage secret key
#   HEARTBEAT_URL            optional: Uptime Kuma push URL for success ping
#   BACKUP_PATHS             space-separated, default: /mnt/data
#   RETENTION_KEEP_DAILY     default: 7
#   RETENTION_KEEP_WEEKLY    default: 4
#   RETENTION_KEEP_MONTHLY   default: 6

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/restic/env}"
LOG_FILE="/var/log/restic-backup.log"

if [ ! -f "$ENV_FILE" ]; then
    echo "$(date -Iseconds) ERROR: $ENV_FILE does not exist. Maintainer must create the file (see docs/backup.md)." | tee -a "$LOG_FILE" >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

BACKUP_PATHS="${BACKUP_PATHS:-/mnt/data}"
RETENTION_KEEP_DAILY="${RETENTION_KEEP_DAILY:-7}"
RETENTION_KEEP_WEEKLY="${RETENTION_KEEP_WEEKLY:-4}"
RETENTION_KEEP_MONTHLY="${RETENTION_KEEP_MONTHLY:-6}"

export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

log() {
    echo "$(date -Iseconds) $1" | tee -a "$LOG_FILE"
}

heartbeat() {
    if [ -n "${HEARTBEAT_URL:-}" ]; then
        curl -fsS --max-time 10 --retry 3 "$HEARTBEAT_URL$1" >/dev/null || log "Heartbeat push failed"
    fi
}

log "=== Backup run started ==="

# Initialize repo on first run.
if ! restic snapshots --no-lock --json >/dev/null 2>&1; then
    log "Repository not initialized, running restic init"
    if ! restic init; then
        log "ERROR: restic init failed"
        heartbeat "?status=down&msg=init-failed"
        exit 2
    fi
fi

# Run backup.
# shellcheck disable=SC2086
if restic backup $BACKUP_PATHS \
    --tag "auto" \
    --tag "$(date +%Y-%m-%d)" \
    2>&1 | tee -a "$LOG_FILE"; then
    log "Backup successful"
else
    log "ERROR: backup failed"
    heartbeat "?status=down&msg=backup-failed"
    exit 3
fi

# Clean up old snapshots according to retention policy.
if restic forget \
    --keep-daily "$RETENTION_KEEP_DAILY" \
    --keep-weekly "$RETENTION_KEEP_WEEKLY" \
    --keep-monthly "$RETENTION_KEEP_MONTHLY" \
    --prune \
    2>&1 | tee -a "$LOG_FILE"; then
    log "Retention applied"
else
    log "WARNING: forget/prune failed (backup itself was successful)"
fi

# Success heartbeat.
heartbeat "?status=up&msg=ok"

log "=== Backup run finished ==="
