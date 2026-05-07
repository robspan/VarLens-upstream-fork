#!/usr/bin/env bash
# Automated restore drill for the Concept Pilot.
#
# What it does:
#   1. Creates a marker file on /mnt/data with random content.
#   2. Triggers the restic backup service on the server (synchronous wait).
#   3. Reads the latest snapshot ID.
#   4. Deletes the marker file.
#   5. Restores the snapshot to a temporary path.
#   6. Verifies that the marker reappears in the restore and is identical.
#   7. Cleans up the restore directory and the marker file.
#   8. Writes a protocol entry to .internalplanning/restore-log.md.
#
# Precondition: /etc/restic/env on the server is populated
# (bucket + credentials + password - see docs/backup.md).
#
# Usage from repo root:
#   IP=<server-ipv4> SSH_KEY=~/.ssh/varlens-tofu ./scripts/restore-drill.sh
#
# Or via Makefile:
#   make restore-drill

set -uo pipefail
# Intentionally no `-e`: a single SSH timeout must not swallow the protocol
# entry. Instead we check return codes explicitly and set RESULT=FAIL.

IP="${IP:?IP variable must be set, for example IP=178.104.176.148}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
PROTOCOL_FILE="${PROTOCOL_FILE:-.internalplanning/restore-log.md}"
# SSH_STRICT=no for e2e (recycled IPs, host-key collision possible).
SSH_STRICT="${SSH_STRICT:-accept-new}"
if [ "$SSH_STRICT" = "no" ]; then
    SSH_OPTS="-i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR"
else
    SSH_OPTS="-i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=$SSH_STRICT"
fi

# shellcheck disable=SC2086
ssh_exec() { ssh $SSH_OPTS "deploy@$IP" "$@"; }

TIMESTAMP="$(date -Iseconds)"
MARKER_NAME="restore-drill-marker-$(date -u +%Y%m%dT%H%M%SZ)"
MARKER_CONTENT="$(openssl rand -hex 32)"
RESTORE_TARGET="/tmp/restore-drill-$(date -u +%Y%m%dT%H%M%SZ)"

START_EPOCH=$(date +%s)
RESULT=PASS
SNAPSHOT_ID="(not reached)"
BACKUP_RESULT="(not reached)"

step() { echo "[$(date -Iseconds)] $1"; }
fail() { echo "[$(date -Iseconds)] FAIL: $1" >&2; RESULT=FAIL; }

write_protocol() {
    # Always executed via trap EXIT, even on early abort.
    local duration=$(( $(date +%s) - START_EPOCH ))
    local marker_state
    marker_state=$([ "$RESULT" = PASS ] && echo "yes" || echo "no")
    if [ ! -f "$PROTOCOL_FILE" ]; then
        cat > "$PROTOCOL_FILE" <<HEADER
# Restore protocol

Record of restore drills for the Concept Pilot. Plan reference:
Stage 1 infrastructure plan §infrastruktur2 Phase 1 Gate requires at least
one logged restore drill. The script \`scripts/restore-drill.sh\` writes
every automated drill as its own entry here.

HEADER
    fi
    cat >> "$PROTOCOL_FILE" <<ENTRY

## $TIMESTAMP - automated restore drill

| Field | Value |
|---|---|
| Server IP | $IP |
| Snapshot ID | $SNAPSHOT_ID |
| Marker file | $MARKER_NAME |
| Restore path | $RESTORE_TARGET |
| Backup service result | $BACKUP_RESULT |
| Marker content identical | $marker_state |
| Duration in seconds | $duration |
| Result | **$RESULT** |

ENTRY
    step "Drill complete with result $RESULT (duration ${duration}s)"
}
trap write_protocol EXIT

# 0. Check preconditions.
step "Checking /etc/restic/env on the server"
if ! ssh_exec 'sudo test -f /etc/restic/env' 2>/dev/null; then
    fail "/etc/restic/env does not exist on $IP. Run setup per docs/backup.md first."
    exit 2
fi
if ! ssh_exec 'sudo grep -q "^RESTIC_PASSWORD=." /etc/restic/env && sudo grep -q "^AWS_ACCESS_KEY_ID=." /etc/restic/env' 2>/dev/null; then
    fail "/etc/restic/env incomplete (RESTIC_PASSWORD or AWS_ACCESS_KEY_ID empty)."
    exit 2
fi

# 1. Create marker.
step "Creating marker file: /mnt/data/$MARKER_NAME"
ssh_exec "echo '$MARKER_CONTENT' | sudo tee /mnt/data/$MARKER_NAME >/dev/null && sudo chmod 0644 /mnt/data/$MARKER_NAME"

# 2. Trigger backup and wait for completion.
step "Triggering restic backup service"
ssh_exec 'sudo systemctl start restic-backup.service'

step "Waiting for backup to finish"
for _ in $(seq 1 60); do
    STATE=$(ssh_exec 'systemctl show restic-backup.service --property=ActiveState --value' 2>/dev/null)
    if [ "$STATE" = "inactive" ] || [ "$STATE" = "failed" ]; then
        break
    fi
    sleep 5
done

BACKUP_RESULT=$(ssh_exec 'systemctl show restic-backup.service --property=Result --value' 2>/dev/null)
if [ "$BACKUP_RESULT" != "success" ]; then
    fail "Backup service result was $BACKUP_RESULT"
    ssh_exec 'sudo journalctl -u restic-backup.service --no-pager -n 30' || true
fi

# 3. Get snapshot ID.
step "Reading latest snapshot ID"
SNAPSHOT_ID=$(ssh_exec 'sudo bash -c "set -a; source /etc/restic/env; restic snapshots --json --latest 1 2>/dev/null"' \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["short_id"] if data else "NONE")' \
    2>/dev/null || echo "NONE")
if [ "$SNAPSHOT_ID" = "NONE" ]; then
    fail "No snapshots found in repository"
fi
step "  -> Snapshot $SNAPSHOT_ID"

# 4. Delete marker.
step "Deleting marker on /mnt/data"
ssh_exec "sudo rm -f /mnt/data/$MARKER_NAME"

# 5. Restore.
if [ "$RESULT" = PASS ]; then
    step "Restoring snapshot $SNAPSHOT_ID to $RESTORE_TARGET"
    if ! ssh_exec "sudo bash -c 'set -a; source /etc/restic/env; restic restore $SNAPSHOT_ID --target $RESTORE_TARGET'" >/dev/null 2>&1; then
        fail "restic restore failed"
    fi
fi

# 6. Verification (a): marker file round-trips.
if [ "$RESULT" = PASS ]; then
    step "Verifying marker content"
    RESTORED_CONTENT=$(ssh_exec "sudo cat $RESTORE_TARGET/mnt/data/$MARKER_NAME 2>/dev/null" || echo "MISSING")
    if [ "$RESTORED_CONTENT" = "$MARKER_CONTENT" ]; then
        step "  -> Marker content identical"
    else
        fail "Marker content not identical (expected $MARKER_CONTENT, got $RESTORED_CONTENT)"
    fi
fi

# 6b. Phase 2 verification: a Postgres pg_dump file lands in the snapshot.
# The whole point of the Postgres-aware backup is that the dump exists
# AND is readable; without this check the drill could pass while the
# pg_dump step silently no-op'd. The dump must be non-empty AND its
# magic bytes must identify it as a Postgres custom-format archive.
if [ "$RESULT" = PASS ]; then
    step "Verifying pg_dump archive in restore"
    PG_DUMP_FILES=$(ssh_exec "sudo ls -1 $RESTORE_TARGET/mnt/data/postgres-dumps/varlens-*.dump 2>/dev/null | head -1" || echo "")
    if [ -z "$PG_DUMP_FILES" ]; then
        fail "No pg_dump file found in restored snapshot at $RESTORE_TARGET/mnt/data/postgres-dumps/"
    else
        # Postgres custom-format archives start with "PGDMP" (5 bytes).
        # Cheap byte-level sanity check; pg_restore --list would be
        # more thorough but requires pg_restore on the server.
        MAGIC=$(ssh_exec "sudo head -c5 $PG_DUMP_FILES" 2>/dev/null || echo "")
        if [ "$MAGIC" = "PGDMP" ]; then
            step "  -> pg_dump archive present and well-formed ($PG_DUMP_FILES)"
        else
            fail "pg_dump archive at $PG_DUMP_FILES has wrong magic bytes (expected PGDMP, got $(printf '%q' "$MAGIC"))"
        fi
    fi
fi

# 6c. Phase 2 verification: the raw PGDATA must NOT be in the snapshot.
# Backing up live PGDATA is the regression Phase 2 explicitly fixes.
# This assertion locks in the exclude rule.
if [ "$RESULT" = PASS ]; then
    step "Verifying PGDATA exclusion"
    PG_DATA_PRESENT=$(ssh_exec "sudo test -d $RESTORE_TARGET/mnt/data/postgres && echo yes || echo no" 2>/dev/null || echo unknown)
    if [ "$PG_DATA_PRESENT" = "no" ]; then
        step "  -> PGDATA correctly excluded from snapshot"
    else
        fail "Raw PGDATA present in snapshot ($PG_DATA_PRESENT) — backup excludes are not working"
    fi
fi

# 7. Cleanup (protocol write happens automatically via trap EXIT).
step "Cleaning up $RESTORE_TARGET"
ssh_exec "sudo rm -rf $RESTORE_TARGET" || true

[ "$RESULT" = PASS ] && exit 0 || exit 1
