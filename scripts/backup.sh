#!/usr/bin/env bash
# Tägliches restic-Backup nach Hetzner Object Storage.
# Wird per systemd-Timer auf dem Server ausgeführt (siehe cloud-init/pilot.yaml).
#
# Konfiguration: Umgebungs-Variablen in /etc/restic/env (vom Maintainer einmalig
# beim ersten Setup angelegt). Erwartete Variablen:
#   RESTIC_REPOSITORY        zum Beispiel s3:s3.eu-central-003.hetznerobjects.com/varlens-pilot-backup
#   RESTIC_PASSWORD          generiert per `openssl rand -base64 32`
#   AWS_ACCESS_KEY_ID        Hetzner Object Storage Access-Key
#   AWS_SECRET_ACCESS_KEY    Hetzner Object Storage Secret-Key
#   HEARTBEAT_URL            optional: Uptime-Kuma-Push-URL für Erfolgs-Ping
#   BACKUP_PATHS             space-separated, Default: /mnt/data
#   RETENTION_KEEP_DAILY     Default: 7
#   RETENTION_KEEP_WEEKLY    Default: 4
#   RETENTION_KEEP_MONTHLY   Default: 6

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/restic/env}"
LOG_FILE="/var/log/restic-backup.log"

if [ ! -f "$ENV_FILE" ]; then
    echo "$(date -Iseconds) FEHLER: $ENV_FILE existiert nicht. Maintainer muss die Datei anlegen (siehe docs/backup.md)." | tee -a "$LOG_FILE" >&2
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
        curl -fsS --max-time 10 --retry 3 "$HEARTBEAT_URL$1" >/dev/null || log "Heartbeat-Push fehlgeschlagen"
    fi
}

log "=== Backup-Lauf gestartet ==="

# Repo bei erstem Lauf initialisieren.
if ! restic snapshots --no-lock --json >/dev/null 2>&1; then
    log "Repository nicht initialisiert, führe restic init aus"
    if ! restic init; then
        log "FEHLER: restic init fehlgeschlagen"
        heartbeat "?status=down&msg=init-failed"
        exit 2
    fi
fi

# Backup ausführen.
# shellcheck disable=SC2086
if restic backup $BACKUP_PATHS \
    --tag "auto" \
    --tag "$(date +%Y-%m-%d)" \
    2>&1 | tee -a "$LOG_FILE"; then
    log "Backup erfolgreich"
else
    log "FEHLER: Backup fehlgeschlagen"
    heartbeat "?status=down&msg=backup-failed"
    exit 3
fi

# Aufräumen alter Snapshots gemäß Retention-Policy.
if restic forget \
    --keep-daily "$RETENTION_KEEP_DAILY" \
    --keep-weekly "$RETENTION_KEEP_WEEKLY" \
    --keep-monthly "$RETENTION_KEEP_MONTHLY" \
    --prune \
    2>&1 | tee -a "$LOG_FILE"; then
    log "Retention angewendet"
else
    log "WARNUNG: forget/prune fehlgeschlagen (Backup an sich war erfolgreich)"
fi

# Erfolgs-Heartbeat.
heartbeat "?status=up&msg=ok"

log "=== Backup-Lauf beendet ==="
