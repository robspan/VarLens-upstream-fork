#!/usr/bin/env bash
# Restore script for restic snapshots from Hetzner Object Storage.
# Usage:
#   restore.sh latest /tmp/restore-target          - restore the latest snapshot
#   restore.sh <snapshot-id> /tmp/restore-target   - restore a specific snapshot
#   restore.sh list                                - list available snapshots

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/restic/env}"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE does not exist." >&2
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
        echo "Restoring latest snapshot to $TARGET"
        mkdir -p "$TARGET"
        restic restore latest --target "$TARGET"
        echo "Restore complete: $TARGET"
        ;;
    "")
        echo "Usage:"
        echo "  $0 list"
        echo "  $0 latest [target-path]"
        echo "  $0 <snapshot-id> [target-path]"
        exit 1
        ;;
    *)
        SNAPSHOT="$1"
        TARGET="${2:-/tmp/restore-$(date +%s)}"
        echo "Restoring snapshot $SNAPSHOT to $TARGET"
        mkdir -p "$TARGET"
        restic restore "$SNAPSHOT" --target "$TARGET"
        echo "Restore complete: $TARGET"
        ;;
esac
