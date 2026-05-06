#!/usr/bin/env bash
# Concept Pilot teardown — calls `varlens pilot down` with banner + timing.
# Destructive: removes the Hetzner cpx32, the 50 GB volume (with all data),
# and the IPv4 reservation. The CLI requires typing 'pilot' as confirmation.
#
# To skip the confirmation in CI: set VARLENS_PILOT_DOWN_YES=1 in the env.

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

# Show what's about to be destroyed.
banner "VarLens Concept Pilot — TEAR DOWN"

current_ip="$(cd "$WEB_DEPLOY" && make -s ip 2>/dev/null | grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || true)"
if [[ -z "$current_ip" ]]; then
  printf '  %sNo server in local Tofu state.%s Nothing to destroy locally.\n' "$YELLOW" "$RESET"
  printf '  %sNote:%s if a server exists on Hetzner outside this state (e.g. wiped local state),\n' "$DIM" "$RESET"
  printf '  destroy it via the Hetzner Console or `hcloud server delete`.\n\n'
  exit 0
fi

printf '  %sAbout to destroy:%s\n' "$BOLD" "$RESET"
printf '    Server IP:  %s\n' "$current_ip"
printf '    Resources:  cpx32 (Hetzner) + 50 GB volume + IPv4\n'
printf '    %sAll data on the volume will be gone. Backups in restic are out of\n' "$YELLOW"
printf '    scope and survive — restore via make restore-drill or restore.sh.%s\n\n' "$RESET"

start=$(date +%s)
if [[ "${VARLENS_PILOT_DOWN_YES:-0}" = "1" ]]; then
  ( cd "$WEB_DEPLOY" && ./bin/varlens pilot down --yes )
else
  ( cd "$WEB_DEPLOY" && ./bin/varlens pilot down )
fi
elapsed=$(($(date +%s) - start))

banner "✓ Tear-down complete in $(human_time "$elapsed")"
printf '  Tofu state is now empty. Run %smake pilot%s to provision a fresh server.\n\n' "$BOLD" "$RESET"
