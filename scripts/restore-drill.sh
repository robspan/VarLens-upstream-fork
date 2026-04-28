#!/usr/bin/env bash
# Automatischer Restore-Drill für den Konzept-Pilot.
#
# Was es tut:
#   1. Legt eine Marker-Datei auf /mnt/data mit zufälligem Inhalt an.
#   2. Triggert den restic-Backup-Service auf dem Server (synchroner Wait).
#   3. Liest die neueste Snapshot-ID aus.
#   4. Löscht die Marker-Datei.
#   5. Restored den Snapshot in einen temporären Pfad.
#   6. Verifiziert, dass der Marker im Restore wieder erscheint und identisch ist.
#   7. Räumt das Restore-Verzeichnis und die Marker-Datei auf.
#   8. Schreibt einen Protokoll-Eintrag nach docs/restore-protokoll.md.
#
# Vorbedingung: /etc/restic/env auf dem Server ist befüllt
# (Bucket + Credentials + Passwort - siehe docs/backup.md).
#
# Aufruf vom Repo-Root:
#   IP=<server-ipv4> SSH_KEY=~/.ssh/varlens-tofu ./scripts/restore-drill.sh
#
# Oder über Makefile:
#   make restore-drill

set -uo pipefail
# Bewusst kein `-e`: ein einzelner SSH-Timeout darf nicht den Protokoll-Eintrag
# verschlucken. Stattdessen prüfen wir Returncodes explizit und setzen RESULT=FAIL.

IP="${IP:?IP-Variable muss gesetzt sein, zum Beispiel IP=178.104.176.148}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
PROTOCOL_FILE="${PROTOCOL_FILE:-docs/restore-protokoll.md}"
# SSH_STRICT=no für e2e (recyclete IPs, Host-Key-Kollision möglich).
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
SNAPSHOT_ID="(nicht erreicht)"
BACKUP_RESULT="(nicht erreicht)"

step() { echo "[$(date -Iseconds)] $1"; }
fail() { echo "[$(date -Iseconds)] FAIL: $1" >&2; RESULT=FAIL; }

write_protocol() {
    # Wird über trap EXIT immer ausgeführt, auch bei vorzeitigem Abbruch.
    local duration=$(( $(date +%s) - START_EPOCH ))
    local marker_state
    marker_state=$([ "$RESULT" = PASS ] && echo "ja" || echo "nein")
    if [ ! -f "$PROTOCOL_FILE" ]; then
        cat > "$PROTOCOL_FILE" <<HEADER
# Restore-Protokoll

Aufzeichnung der Restore-Übungen für den Konzept-Pilot. Plan-Bezug:
\`konzept/infrastruktur.html\` §infrastruktur2 Phase 1 Gate fordert mindestens
eine protokollierte Restore-Übung. Das Skript \`scripts/restore-drill.sh\`
schreibt jeden automatisierten Drill als eigenen Eintrag hier herein.

HEADER
    fi
    cat >> "$PROTOCOL_FILE" <<ENTRY

## $TIMESTAMP - automatisierter Restore-Drill

| Feld | Wert |
|---|---|
| Server-IP | $IP |
| Snapshot-ID | $SNAPSHOT_ID |
| Marker-Datei | $MARKER_NAME |
| Restore-Pfad | $RESTORE_TARGET |
| Backup-Service-Result | $BACKUP_RESULT |
| Marker-Inhalt-identisch | $marker_state |
| Dauer in Sekunden | $duration |
| Ergebnis | **$RESULT** |

ENTRY
    step "Drill abgeschlossen mit Ergebnis $RESULT (Dauer ${duration}s)"
}
trap write_protocol EXIT

# 0. Vorbedingungen prüfen.
step "Prüfe /etc/restic/env auf dem Server"
if ! ssh_exec 'sudo test -f /etc/restic/env' 2>/dev/null; then
    fail "/etc/restic/env existiert nicht auf $IP. Erst Setup gemäß docs/backup.md durchführen."
    exit 2
fi
if ! ssh_exec 'sudo grep -q "^RESTIC_PASSWORD=." /etc/restic/env && sudo grep -q "^AWS_ACCESS_KEY_ID=." /etc/restic/env' 2>/dev/null; then
    fail "/etc/restic/env unvollständig (RESTIC_PASSWORD oder AWS_ACCESS_KEY_ID leer)."
    exit 2
fi

# 1. Marker anlegen.
step "Lege Marker-Datei an: /mnt/data/$MARKER_NAME"
ssh_exec "echo '$MARKER_CONTENT' | sudo tee /mnt/data/$MARKER_NAME >/dev/null && sudo chmod 0644 /mnt/data/$MARKER_NAME"

# 2. Backup triggern und auf Abschluss warten.
step "Triggere restic-Backup-Service"
ssh_exec 'sudo systemctl start restic-backup.service'

step "Warte auf Backup-Abschluss"
for _ in $(seq 1 60); do
    STATE=$(ssh_exec 'systemctl show restic-backup.service --property=ActiveState --value' 2>/dev/null)
    if [ "$STATE" = "inactive" ] || [ "$STATE" = "failed" ]; then
        break
    fi
    sleep 5
done

BACKUP_RESULT=$(ssh_exec 'systemctl show restic-backup.service --property=Result --value' 2>/dev/null)
if [ "$BACKUP_RESULT" != "success" ]; then
    fail "Backup-Service-Result war $BACKUP_RESULT"
    ssh_exec 'sudo journalctl -u restic-backup.service --no-pager -n 30' || true
fi

# 3. Snapshot-ID holen.
step "Lese neueste Snapshot-ID"
SNAPSHOT_ID=$(ssh_exec 'sudo bash -c "set -a; source /etc/restic/env; restic snapshots --json --latest 1 2>/dev/null"' \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["short_id"] if data else "NONE")' \
    2>/dev/null || echo "NONE")
if [ "$SNAPSHOT_ID" = "NONE" ]; then
    fail "Keine Snapshots im Repository gefunden"
fi
step "  → Snapshot $SNAPSHOT_ID"

# 4. Marker löschen.
step "Lösche Marker auf /mnt/data"
ssh_exec "sudo rm -f /mnt/data/$MARKER_NAME"

# 5. Restore.
if [ "$RESULT" = PASS ]; then
    step "Restore Snapshot $SNAPSHOT_ID nach $RESTORE_TARGET"
    if ! ssh_exec "sudo bash -c 'set -a; source /etc/restic/env; restic restore $SNAPSHOT_ID --target $RESTORE_TARGET'" >/dev/null 2>&1; then
        fail "restic restore fehlgeschlagen"
    fi
fi

# 6. Verifikation.
if [ "$RESULT" = PASS ]; then
    step "Verifiziere Marker-Inhalt"
    RESTORED_CONTENT=$(ssh_exec "sudo cat $RESTORE_TARGET/mnt/data/$MARKER_NAME 2>/dev/null" || echo "MISSING")
    if [ "$RESTORED_CONTENT" = "$MARKER_CONTENT" ]; then
        step "  → Marker-Inhalt identisch"
    else
        fail "Marker-Inhalt nicht identisch (erwartet $MARKER_CONTENT, bekommen $RESTORED_CONTENT)"
    fi
fi

# 7. Aufräumen (Protokoll-Write erfolgt automatisch via trap EXIT).
step "Aufräumen $RESTORE_TARGET"
ssh_exec "sudo rm -rf $RESTORE_TARGET" || true

[ "$RESULT" = PASS ] && exit 0 || exit 1
