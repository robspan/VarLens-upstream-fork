#!/usr/bin/env bash
# Concept Pilot teardown — destroys the Hetzner server, attached volume,
# IPv4 reservation, firewall, and Tofu-tracked SSH key. NEVER touches the
# restic backup bucket. That is a separate command on purpose:
#
#   make -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes
#
# Combining the two would let a single typo wipe both your live state AND
# every snapshot that could rebuild it. Strictly forbidden by design.
#
# CI / non-interactive bypass for the typed confirmations:
#   VARLENS_PILOT_DOWN_YES=1   skips both confirmation prompts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DEPLOY="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

banner() {
  printf '\n%s═══════════════════════════════════════════════════════════════════%s\n' "$RED" "$RESET"
  printf '%s  %s%s\n' "$RED$BOLD" "$1" "$RESET"
  printf '%s═══════════════════════════════════════════════════════════════════%s\n\n' "$RED" "$RESET"
}

human_time() {
  local s="$1"
  if (( s < 60 )); then printf '%ds' "$s"
  else printf '%dm %02ds' "$((s / 60))" "$((s % 60))"
  fi
}

# Prompt for a literal-string confirmation. Aborts the whole script on
# anything other than an exact match (no fuzzy "y" / "yes" — those are
# rejected on purpose so muscle-memory cannot trigger a destruction).
require_literal() {
  local prompt="$1" expected="$2"
  if [[ "${VARLENS_PILOT_DOWN_YES:-0}" = "1" ]]; then
    printf '  %sVARLENS_PILOT_DOWN_YES=1 — bypassing confirmation %s%s\n' "$DIM" "$expected" "$RESET"
    return 0
  fi
  printf '%s  %s%s\n' "$BOLD" "$prompt" "$RESET"
  printf '%s  > %s' "$BOLD" "$RESET"
  local reply=""
  read -r reply || true
  if [[ "$reply" != "$expected" ]]; then
    printf '\n%s  Aborted.%s Confirmation mismatch (expected %q, got %q).\n\n' "$RED$BOLD" "$RESET" "$expected" "$reply"
    exit 2
  fi
  printf '%s  ✓ confirmed%s\n\n' "$GREEN" "$RESET"
}

# Show what's about to be destroyed.
banner "VarLens Concept Pilot — TEAR DOWN"

# Empty-state detection reads tfstate JSON directly — `tofu output -raw`
# against an empty state can take seconds on some setups (state lock
# contention, plugin checks). Falls back to make-ip-grep if tfstate
# isn't where we expect.
TFSTATE="$WEB_DEPLOY/tofu/environments/pilot/terraform.tfstate"
current_ip=""
if [[ -f "$TFSTATE" ]]; then
  if grep -q '"resources":\[\]' "$TFSTATE" 2>/dev/null; then
    current_ip=""
  else
    current_ip="$(grep -oE '"value":[[:space:]]*"[0-9]{1,3}(\.[0-9]{1,3}){3}"' "$TFSTATE" | head -1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' || true)"
  fi
else
  current_ip="$(cd "$WEB_DEPLOY" && make -s ip 2>/dev/null | grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || true)"
fi
if [[ -z "$current_ip" ]]; then
  printf '  %sNo server in local Tofu state.%s Nothing to destroy locally.\n' "$YELLOW" "$RESET"
  printf '  %sNote:%s if a server exists on Hetzner outside this state (e.g. wiped local state),\n' "$DIM" "$RESET"
  printf '  destroy it via the Hetzner Console or `hcloud server delete`.\n\n'
  exit 0
fi

# ---- Loud warning block ---------------------------------------------------
printf '%s  ⚠  IRREVERSIBLE DESTRUCTION — read this before typing anything  ⚠%s\n\n' "$RED$BOLD" "$RESET"

printf '  %sWill be permanently destroyed:%s\n' "$RED$BOLD" "$RESET"
printf '    %s✗%s Hetzner cpx32 server  %s(IP %s)%s\n' "$RED" "$RESET" "$DIM" "$current_ip" "$RESET"
printf '    %s✗%s 50 GB attached data volume  %s(ALL DATA: PostgreSQL, app data, logs)%s\n' "$RED" "$RESET" "$DIM" "$RESET"
printf '    %s✗%s IPv4 address  %s(returned to Hetzner pool, may be re-assigned later)%s\n' "$RED" "$RESET" "$DIM" "$RESET"
printf '    %s✗%s Firewall rule set\n' "$RED" "$RESET"
printf '    %s✗%s Tofu-tracked SSH key entry on Hetzner\n\n' "$RED" "$RESET"

printf '  %sNOT destroyed by this command:%s\n' "$GREEN$BOLD" "$RESET"
printf '    %s✓%s Restic snapshots in Hetzner Object Storage  %s(your backups)%s\n' "$GREEN" "$RESET" "$DIM" "$RESET"
printf '    %s✓%s web-deploy/.env  %s(operator secrets)%s\n' "$GREEN" "$RESET" "$DIM" "$RESET"
printf '    %s✓%s terraform.tfvars  %s(Hetzner API token, SSH pubkey)%s\n' "$GREEN" "$RESET" "$DIM" "$RESET"
printf '    %s✓%s secrets/restic.yaml  %s(SOPS-encrypted restic password)%s\n\n' "$GREEN" "$RESET" "$DIM" "$RESET"

printf '  %sBucket teardown is a separate command — STRICTLY NOT combined here:%s\n' "$YELLOW$BOLD" "$RESET"
printf '    %smake -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes%s\n' "$BOLD" "$RESET"
printf '    %sCombining would let one typo wipe both your live state AND every%s\n' "$DIM" "$RESET"
printf '    %ssnapshot that could rebuild it. Two commands, two decisions.%s\n\n' "$DIM" "$RESET"

printf '  %sRecovery path if you regret this:%s\n' "$BOLD" "$RESET"
printf '    1. %smake pilot%s — provisions a fresh server\n' "$BOLD" "$RESET"
printf '    2. %smake -C web-deploy restore-drill%s — verifies the restic snapshots\n' "$BOLD" "$RESET"
printf '       are still good and restoreable\n'
printf '    3. Use scripts/restore.sh to actually pull the latest snapshot back\n'
printf '       onto the new /mnt/data\n\n'

# ---- Two-stage typed confirmation -----------------------------------------
# Stage 1 names WHAT we're tearing down (the pilot environment).
# Stage 2 confirms the CONSEQUENCE (irreversible destruction).
# Both must match exactly — fuzzy y/yes is rejected on purpose.
printf '%s───────────────────────────────────────────────────────────────────%s\n' "$DIM" "$RESET"
printf '%s  Two-stage confirmation. Each prompt requires the literal string —%s\n' "$DIM" "$RESET"
printf '%s  yes/y/anything-else aborts.%s\n' "$DIM" "$RESET"
printf '%s───────────────────────────────────────────────────────────────────%s\n\n' "$DIM" "$RESET"

require_literal "Confirmation 1/2 — type \"pilot\" to acknowledge scope (the Concept Pilot environment):" "pilot"
require_literal "Confirmation 2/2 — type \"DESTROY\" (uppercase) to authorize irreversible destruction:" "DESTROY"

# Both confirmations passed; proceed with the actual tofu destroy.
# bin/varlens pilot down --yes is invoked because we already collected
# our own typed confirmations and don't want the CLI's separate prompt.
printf '\n  %sDestroying server, volume, IPv4, firewall, SSH key…%s\n' "$BOLD" "$RESET"
printf '  %sThis typically takes ~60s. Tofu progress lines stream below;%s\n' "$DIM" "$RESET"
printf '  %sif you see no output for >2 min, re-run with VARLENS_VERBOSE=1.%s\n\n' "$DIM" "$RESET"
start=$(date +%s)
( cd "$WEB_DEPLOY" && ./bin/varlens pilot down --yes )
elapsed=$(($(date +%s) - start))

banner "✓ Tear-down complete in $(human_time "$elapsed")"
printf '  Tofu state is now empty. Run %smake pilot%s to provision a fresh server.\n\n' "$BOLD" "$RESET"

printf '  %sBackup bucket preserved.%s Snapshots in Hetzner Object Storage are intact\n' "$GREEN$BOLD" "$RESET"
printf '  and can rebuild a new server. To verify them: %smake pilot && make -C web-deploy restore-drill%s.\n\n' "$BOLD" "$RESET"
printf '  %sIf you also want to destroy the bucket (separate, deliberate command):%s\n' "$YELLOW" "$RESET"
printf '    make -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes\n'
printf '    %s(auto-sources web-deploy/.env for RESTIC_S3_*)%s\n\n' "$DIM" "$RESET"
