#!/usr/bin/env bash
# Daily restic backup to Hetzner Object Storage.
# Run via systemd timer on the server (see cloud-init/pilot.yaml).
#
# Phase 2: Postgres-aware. Takes a logical pg_dump of the live cluster
# BEFORE the restic snapshot, then restic backs up the dump file (which
# is a transactionally consistent point-in-time export). The raw
# /mnt/data/postgres datadir is excluded — file-system snapshots of a
# running cluster are torn at best, undecodeable at worst.
#
# Recovery key + any future app-state files in /mnt/data/app/data ARE
# included (they're append-only or operator-managed).
#
# Configuration: environment variables in /etc/restic/env. Expected:
#   RESTIC_REPOSITORY        e.g. s3:s3.eu-central-003.hetznerobjects.com/varlens-pilot-backup
#   RESTIC_PASSWORD          generated via `openssl rand -base64 32`
#   AWS_ACCESS_KEY_ID        Hetzner Object Storage access key
#   AWS_SECRET_ACCESS_KEY    Hetzner Object Storage secret key
#   HEARTBEAT_URL            optional: Uptime Kuma push URL for success ping
#   BACKUP_PATHS             space-separated, default: /mnt/data
#   RETENTION_KEEP_DAILY     default: 7
#   RETENTION_KEEP_WEEKLY    default: 4
#   RETENTION_KEEP_MONTHLY   default: 6
#   POSTGRES_USER            default: varlens (matches compose default)
#   POSTGRES_DB              default: varlens

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/restic/env}"
LOG_FILE="/var/log/restic-backup.log"
PG_DUMP_DIR="/mnt/data/postgres-dumps"
PG_DUMP_LOCAL_RETENTION_DAYS=7

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
POSTGRES_USER="${POSTGRES_USER:-varlens}"
POSTGRES_DB="${POSTGRES_DB:-varlens}"

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

# Phase 2 quiesce: logical pg_dump BEFORE restic snapshots. Two reasons:
#   1. Postgres' on-disk state is constantly changing under concurrent
#      writers. A file-system snapshot of $PGDATA captures torn pages
#      and a WAL state inconsistent with the data files. pg_dump runs
#      against the live cluster and produces a transactionally consistent
#      logical export that restic can safely snapshot.
#   2. The custom format (-Fc) is the canonical pg_restore input — it
#      compresses, supports parallel restore, and survives across
#      Postgres major versions.
mkdir -p "$PG_DUMP_DIR"
PG_DUMP_FILE="$PG_DUMP_DIR/varlens-$(date -u +%Y%m%dT%H%M%SZ).dump"

if docker ps --format '{{.Names}}' | grep -q '^postgres$'; then
    log "Running pg_dump → $PG_DUMP_FILE"
    if ! docker exec postgres pg_dump \
        --format=custom \
        --no-owner --no-acl \
        --compress=6 \
        -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$PG_DUMP_FILE"; then
        log "ERROR: pg_dump failed"
        rm -f "$PG_DUMP_FILE"
        heartbeat "?status=down&msg=pg-dump-failed"
        exit 4
    fi
    PG_DUMP_BYTES="$(stat -c%s "$PG_DUMP_FILE" 2>/dev/null || echo 0)"
    if [ "$PG_DUMP_BYTES" -lt 100 ]; then
        log "ERROR: pg_dump produced suspiciously small file ($PG_DUMP_BYTES bytes)"
        rm -f "$PG_DUMP_FILE"
        heartbeat "?status=down&msg=pg-dump-empty"
        exit 5
    fi
    log "pg_dump succeeded ($PG_DUMP_BYTES bytes)"
else
    log "ERROR: postgres container not running — refusing to back up without quiesce"
    heartbeat "?status=down&msg=pg-not-running"
    exit 6
fi

# Rotate local dumps. restic keeps offsite history per the retention
# policy below; the local copies are just the freshest snapshot the
# server has on hand for fast restore-without-network.
find "$PG_DUMP_DIR" -name 'varlens-*.dump' -type f -mtime +"$PG_DUMP_LOCAL_RETENTION_DAYS" -delete 2>/dev/null || true

# Initialize repo on first run.
if ! restic snapshots --no-lock --json >/dev/null 2>&1; then
    log "Repository not initialized, running restic init"
    if ! restic init; then
        log "ERROR: restic init failed"
        heartbeat "?status=down&msg=init-failed"
        exit 2
    fi
fi

# restic snapshot. Excludes the raw PGDATA — only the consistent dump
# file (and the recovery-key dir, app artifacts) lands in offsite
# storage. PGDATA exclusion patterns work across BACKUP_PATHS values
# because restic exclusion is full-path-relative-to-snapshot-root.
# shellcheck disable=SC2086
if restic backup $BACKUP_PATHS \
    --tag "auto" \
    --tag "$(date +%Y-%m-%d)" \
    --exclude '/mnt/data/postgres' \
    --exclude '/mnt/data/postgres/**' \
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
