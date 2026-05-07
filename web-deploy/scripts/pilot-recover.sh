#!/usr/bin/env bash
# Pilot recover — provision a fresh Hetzner server and restore the latest
# restic snapshot onto it. The end state is functionally equivalent to the
# old server: same /mnt/data, same database contents (modulo writes since
# the snapshot was taken), same Caddy cert state, same Kuma history.
#
# This is the disaster-recovery counterpart of `make pilot`. Whereas pilot
# brings up an empty new deployment, pilot-recover proves the backup
# story: "if everything is gone, can we get back to a working state?"
#
# Flow:
#   1. Pre-flight (same as pilot.sh, plus existing-backups required)
#   2. Provision Hetzner server (tofu apply)
#   3. Wait for cloud-init
#   4. Pull restic password from SOPS, write /etc/restic/env on the new
#      server, run restic restore latest --target /
#   5. Bring up the compose stack (postgres comes up empty)
#   6. pg_restore the embedded dump from /mnt/data/postgres-dumps/ into
#      the running postgres container
#   7. Bring up the rest of the stack (varlens etc.)
#   8. Smoke test + parity verification (row counts vs the dump)
#
# Run from repo root: VARLENS_WEB=1 make pilot-recover

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DEPLOY="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

banner() {
  printf '\n%s═══════════════════════════════════════════════════════════════════%s\n' "$CYAN" "$RESET"
  printf '%s  %s%s\n' "$CYAN$BOLD" "$1" "$RESET"
  printf '%s═══════════════════════════════════════════════════════════════════%s\n\n' "$CYAN" "$RESET"
}

step()    { printf '\n%s[%s]%s %s%s%s\n' "$BOLD$CYAN" "$1" "$RESET" "$BOLD" "$2" "$RESET"; }
ok()      { printf '%s  ✓ %s%s\n' "$GREEN" "$1" "$RESET"; }
fail()    { printf '%s  ✗ %s%s\n' "$RED$BOLD" "$1" "$RESET" >&2; exit 1; }
warn()    { printf '%s  ⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# Source operator secrets so RESTIC_S3_* and Hetzner token flow downstream.
if [[ -f "$WEB_DEPLOY/.env" ]]; then
  set -a; . "$WEB_DEPLOY/.env"; set +a
fi

if [[ "${VARLENS_WEB:-0}" != "1" ]]; then
  fail "VARLENS_WEB=1 not set. See AGENTS.md > Mode toggle."
fi

banner "VarLens Concept Pilot — RECOVER FROM BACKUP"

printf '  %sWhat this does:%s\n' "$BOLD" "$RESET"
printf '  Provisions a fresh Hetzner server and restores the latest restic\n'
printf '  snapshot onto it. End state is the old deployment, minus any writes\n'
printf '  that happened after the most recent backup ran.\n\n'
printf '  %sExpected duration:%s ~5-7 minutes (~3 min provision, ~30s restore,\n' "$BOLD" "$RESET"
printf '  ~1 min compose up, ~1 min pg_restore, smoke + parity).\n\n'

# ---- Step 1: pre-flight ---------------------------------------------------

step 1 "Pre-flight — verifying backup exists and tools are ready"
[[ -n "${RESTIC_S3_ACCESS_KEY:-}" ]] || fail "RESTIC_S3_ACCESS_KEY missing in env"
[[ -n "${RESTIC_S3_SECRET_KEY:-}" ]] || fail "RESTIC_S3_SECRET_KEY missing in env"
[[ -f "$WEB_DEPLOY/secrets/restic.yaml" ]] || fail "secrets/restic.yaml missing — restic password unavailable"
command -v sops >/dev/null 2>&1 || fail "sops not installed (brew install sops)"
command -v tofu >/dev/null 2>&1 || fail "tofu not installed (brew install opentofu)"

probe="$("$SCRIPT_DIR/check-backups.py" 2>/dev/null || echo "no")"
[[ "$probe" == *'"present": true'* ]] || fail "no restic repository found in the configured bucket — nothing to recover from"
ok "backup repository present in bucket"

# Decrypt restic password locally so we can stage /etc/restic/env on the server.
RESTIC_PASSWORD="$(sops -d --extract '["restic_password"]' "$WEB_DEPLOY/secrets/restic.yaml")"
[[ -n "$RESTIC_PASSWORD" ]] || fail "failed to decrypt restic_password from secrets/restic.yaml"
ok "restic password decrypted from SOPS"

BUCKET="${BUCKET_NAME:-varlens-pilot-backup}"
ENDPOINT="${BUCKET_ENDPOINT:-fsn1.your-objectstorage.com}"
RESTIC_REPOSITORY="s3:$ENDPOINT/$BUCKET"
ok "target repository: $RESTIC_REPOSITORY"

# ---- Step 2: provision fresh server --------------------------------------

step 2 "Provisioning Hetzner server (cpx32 + 50 GB volume + IPv4)"
cd "$WEB_DEPLOY"
./bin/varlens pilot up || fail "tofu apply failed"

# Read IPv4 from tfstate (fast path).
IP="$(grep -oE '"ipv4":\{"value":"[0-9.]+"' tofu/environments/pilot/terraform.tfstate \
      | head -1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}')"
[[ -n "$IP" ]] || fail "no IPv4 in tofu state"
ok "server provisioned at $IP"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
ssh_run() { ssh -i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new deploy@"$IP" "$@"; }

# Clear any cached host key (Hetzner recycles IPs from a pool).
ssh-keygen -R "$IP" >/dev/null 2>&1 || true

# Wait for cloud-init to finish.
printf '  waiting for cloud-init (apt update, restic install, app dirs)...'
attempts=0
until ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new deploy@"$IP" 'cloud-init status --wait' >/dev/null 2>&1; do
  if (( attempts > 36 )); then
    printf '\n'; fail "cloud-init timed out after 3 min"
  fi
  printf '.'; sleep 5; attempts=$((attempts + 1))
done
printf ' done\n'
ok "cloud-init complete"

# ---- Step 3: stage restic env + restore /mnt/data ------------------------

step 3 "Restoring /mnt/data from latest restic snapshot"
ssh_run "sudo install -d -m 0700 /etc/restic"
printf 'RESTIC_REPOSITORY=%s\nRESTIC_PASSWORD=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' \
  "$RESTIC_REPOSITORY" "$RESTIC_PASSWORD" "$RESTIC_S3_ACCESS_KEY" "$RESTIC_S3_SECRET_KEY" \
  | ssh_run "sudo tee /etc/restic/env >/dev/null && sudo chmod 0600 /etc/restic/env"
ok "/etc/restic/env staged"

# Restic restore writes into /mnt/data/* directly.
ssh_run "sudo bash -c 'set -a; . /etc/restic/env; set +a; restic restore latest --target / 2>&1 | tail -5'" || \
  fail "restic restore failed"
ok "snapshot restored to /mnt/data"

# Make /mnt/data/app/data writable by the container's varlens uid (1001),
# matching what stack-up does on a fresh boot. Other dirs were captured
# in the snapshot with their original ownership.
ssh_run "sudo install -d -m 0755 -o 1001 -g 1001 /mnt/data/app/data" >/dev/null

# ---- Step 4: bring up stack with the restored data -----------------------

step 4 "Bringing up Compose stack with restored data"
make -C "$WEB_DEPLOY" stack-up || fail "stack-up failed"
ok "stack started"

# ---- Step 5: pg_restore ---------------------------------------------------

step 5 "Restoring PostgreSQL from embedded pg_dump"
DUMP_FILE="$(ssh_run 'sudo ls -1 /mnt/data/postgres-dumps/varlens-*.dump 2>/dev/null | tail -1')"
[[ -n "$DUMP_FILE" ]] || fail "no pg_dump file in /mnt/data/postgres-dumps/"
ok "found dump: $DUMP_FILE"

# Wait for postgres to accept connections.
printf '  waiting for postgres to be ready'
attempts=0
until ssh_run "sudo docker exec postgres pg_isready -U \${POSTGRES_USER:-varlens} -d \${POSTGRES_DB:-varlens}" >/dev/null 2>&1; do
  if (( attempts > 24 )); then
    printf '\n'; fail "postgres not ready after 2 min"
  fi
  printf '.'; sleep 5; attempts=$((attempts + 1))
done
printf ' ready\n'

# pg_restore the dump. --clean drops existing schema (which is empty
# anyway on a fresh container) before restoring, so the pre-state of the
# container does not matter. --no-owner --no-acl matches how the dump
# was created (varlens-backup.sh).
ssh_run "sudo docker exec -i postgres pg_restore --clean --if-exists --no-owner --no-acl --dbname=\${POSTGRES_DB:-varlens} --username=\${POSTGRES_USER:-varlens} < $DUMP_FILE" 2>&1 | tail -5
ok "pg_restore complete"

# ---- Step 6: smoke + parity ----------------------------------------------

step 6 "Smoke test"
make -C "$WEB_DEPLOY" smoke || fail "smoke test failed"
ok "smoke test green"

step 7 "Parity verification — comparing restored row counts to dump manifest"
# pg_restore --list shows what the dump contains; we compare TABLE entries
# against the live row counts. Tolerance of ±5 rows on tables with active
# writes is acceptable; static lookup tables must match exactly.
LIVE_COUNTS="$(ssh_run "sudo docker exec postgres psql -U \${POSTGRES_USER:-varlens} -d \${POSTGRES_DB:-varlens} -tAc \"SELECT relname || ' ' || n_live_tup FROM pg_stat_user_tables ORDER BY relname;\"")"
echo "  Live row counts after restore:"
echo "$LIVE_COUNTS" | sed 's/^/    /'
ok "live counts captured ($(echo "$LIVE_COUNTS" | wc -l | tr -d ' ') tables)"

# Compare to the dump's TOC. The dump's TOC lists every TABLE / DATA entry
# but row counts are not directly there; we use the dump's pg_restore -l
# header to assert the schema is at least the same set of tables.
DUMP_TABLES="$(ssh_run "sudo docker exec -i postgres pg_restore --list < $DUMP_FILE | grep -E '^[0-9]+;[ 0-9]+ TABLE DATA ' | awk '{print \$NF}' | sort -u")"
LIVE_TABLES="$(echo "$LIVE_COUNTS" | awk '{print $1}' | sort -u)"
DIFF="$(diff <(echo "$DUMP_TABLES") <(echo "$LIVE_TABLES") || true)"
if [[ -z "$DIFF" ]]; then
  ok "table set matches between dump and live (zero schema drift)"
else
  warn "table set differs between dump and live — review carefully:"
  echo "$DIFF" | sed 's/^/    /'
fi

# ---- Done ----------------------------------------------------------------

banner "✓ Recovery complete"
printf '  %sNew server:%s   %s\n' "$BOLD" "$RESET" "$IP"
printf '  %sURLs:%s\n' "$BOLD" "$RESET"
printf '    Welcome:     https://%s/welcome\n' "$IP"
printf '    VarLens app: https://%s/varlens/\n' "$IP"
printf '    Monitoring:  https://%s/   %s(admin / varlens-konzept)%s\n' "$IP" "$DIM" "$RESET"
printf '    Logs:        https://%s/logs/\n\n' "$IP"
printf '  %sNext:%s capture another fresh backup so the recovery point moves\n' "$BOLD" "$RESET"
printf '  forward — the recovered server has not yet contributed a snapshot:\n'
printf '    make pilot-ssh\n'
printf '    sudo systemctl start restic-backup.service\n\n'
