#!/usr/bin/env bash
# Restore-Skript für restic-Snapshots aus dem Hetzner Object Storage.
# Verwendung:
#   restore.sh latest /tmp/restore-target          - letzten Snapshot wiederherstellen
#   restore.sh <snapshot-id> /tmp/restore-target   - bestimmten Snapshot wiederherstellen
#   restore.sh list                                - verfügbare Snapshots auflisten

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/restic/env}"

if [ ! -f "$ENV_FILE" ]; then
    echo "FEHLER: $ENV_FILE existiert nicht." >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

case "${1:-}" in
    list)
        restic snapshots
        ;;
    latest)
        TARGET="${2:-/tmp/restore-$(date +%s)}"
        echo "Stelle letzten Snapshot wieder her nach $TARGET"
        mkdir -p "$TARGET"
        restic restore latest --target "$TARGET"
        echo "Wiederherstellung abgeschlossen: $TARGET"
        ;;
    "")
        echo "Verwendung:"
        echo "  $0 list"
        echo "  $0 latest [target-pfad]"
        echo "  $0 <snapshot-id> [target-pfad]"
        exit 1
        ;;
    *)
        SNAPSHOT="$1"
        TARGET="${2:-/tmp/restore-$(date +%s)}"
        echo "Stelle Snapshot $SNAPSHOT wieder her nach $TARGET"
        mkdir -p "$TARGET"
        restic restore "$SNAPSHOT" --target "$TARGET"
        echo "Wiederherstellung abgeschlossen: $TARGET"
        ;;
esac
