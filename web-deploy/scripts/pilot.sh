#!/usr/bin/env bash
# Concept Pilot one-shot orchestrator.
#
# Designed for trust through visibility:
#   - Pre-flight checks fail loudly with a clear remedy.
#   - Each step prints a banner with the action, expected duration, and
#     retry command if it fails.
#   - Underlying tool output (Tofu, SSH, docker compose) is NOT swallowed
#     — it streams through so the operator can see resources being created
#     in real time. Tofu's own per-resource progress is already great
#     diagnostic information; framing it with banners is enough.
#   - Each step's elapsed time is reported.
#   - Final summary lists URLs + operator commands.
#
# Invoked from the repo-root Makefile via `make pilot`. May also be run
# directly from web-deploy/.

set -euo pipefail

# Resolve web-deploy/ no matter where invoked from.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DEPLOY="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- Output helpers --------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

banner() {
  local text="$1"
  printf '\n%s═══════════════════════════════════════════════════════════════════%s\n' "$CYAN" "$RESET"
  printf '%s  %s%s\n' "$CYAN$BOLD" "$text" "$RESET"
  printf '%s═══════════════════════════════════════════════════════════════════%s\n\n' "$CYAN" "$RESET"
}

step_begin() {
  local n="$1" total="$2" label="$3"
  printf '\n%s[%d/%d]%s %s%s%s\n' "$BOLD$CYAN" "$n" "$total" "$RESET" "$BOLD" "$label" "$RESET"
  printf '%s%s%s\n' "$DIM" "─────────────────────────────────────────────────────────────────" "$RESET"
}

step_ok() {
  local elapsed="$1"
  printf '%s  ✓ done in %s%s\n' "$GREEN" "$(human_time "$elapsed")" "$RESET"
}

step_fail() {
  local label="$1" elapsed="$2" retry="$3"
  printf '\n%s  ✗ FAILED after %s: %s%s\n' "$RED$BOLD" "$(human_time "$elapsed")" "$label" "$RESET"
  printf '%s     Retry just this step:%s %s\n' "$DIM" "$RESET" "$retry"
  printf '%s     Or full reset:%s        make pilot-down && make pilot\n' "$DIM" "$RESET"
}

human_time() {
  local s="$1"
  if (( s < 60 )); then
    printf '%ds' "$s"
  else
    printf '%dm %02ds' "$((s / 60))" "$((s % 60))"
  fi
}

# Wait for cloud-init to finish ALL phases (not just SSH). The first live
# cycle exposed two race-condition failures: (a) `tofu apply` returns the
# moment the server is provisioned but cloud-init's runcmd is still
# running (creates /mnt/data/app + chowns); (b) Hetzner sometimes reuses a
# just-released IPv4, making our cached known_hosts entry mismatch and
# breaking SSH with strict host-key checking. This step handles both.
wait_for_server_ready() {
  local ip="$1"
  local ssh_key="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"

  # Clear stale known_hosts in case Hetzner reused the IP.
  ssh-keygen -R "$ip" >/dev/null 2>&1 || true

  printf '  Waiting for SSH on %s ...' "$ip"
  local attempts=0
  until ssh -i "$ssh_key" \
    -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=accept-new \
    deploy@"$ip" 'true' 2>/dev/null; do
    if (( attempts > 36 )); then
      printf ' %s✗%s timed out after 3 min\n' "$RED" "$RESET"
      return 1
    fi
    printf '.'
    sleep 5
    attempts=$((attempts + 1))
  done
  printf ' %s✓%s SSH ready\n' "$GREEN" "$RESET"

  printf '  Waiting for cloud-init to finish (runcmd creates /mnt/data/app, chowns) ...'
  if ssh -i "$ssh_key" -o BatchMode=yes deploy@"$ip" \
    'cloud-init status --wait' >/dev/null 2>&1; then
    printf ' %s✓%s cloud-init done\n' "$GREEN" "$RESET"
  else
    printf ' %s✗%s cloud-init failed — investigate /var/log/cloud-init-output.log\n' "$RED" "$RESET"
    return 1
  fi

  # Assert the bootstrap success marker that cloud-init emits on the happy
  # path. cloud-init's own exit code does NOT distinguish "all runcmd steps
  # succeeded" from "runcmd ran but a step printed BOOTSTRAP_FAIL and we
  # tolerated it". The marker is the contract: present == bootstrap OK.
  printf '  Checking bootstrap success marker ...'
  if ssh -i "$ssh_key" -o BatchMode=yes deploy@"$ip" \
    'test -f /var/lib/cloud/instance/varlens-bootstrap.ok' 2>/dev/null; then
    printf ' %s✓%s bootstrap marker present\n' "$GREEN" "$RESET"
  else
    printf ' %s✗%s bootstrap marker missing — dumping cloud-init failure context:\n' "$RED" "$RESET"
    ssh -i "$ssh_key" -o BatchMode=yes deploy@"$ip" \
      'sudo grep -E "BOOTSTRAP_FAIL" /var/log/cloud-init-output.log || sudo tail -40 /var/log/cloud-init-output.log' \
      2>/dev/null || true
    return 1
  fi

  # Note: creating /mnt/data/app/data and chowning it to 1001:1001 is now
  # the responsibility of `make stack-up` (between rsync and docker compose
  # pull/up) — not this function. Doing it here would race with rsync
  # --delete, which strips paths not in the compose/ source tree.
}

# ---- Pre-flight ------------------------------------------------------------

preflight() {
  local tfvars="$WEB_DEPLOY/tofu/environments/pilot/terraform.tfvars"
  local errors=0

  printf '%sPre-flight checks:%s\n' "$BOLD" "$RESET"

  # 1. tfvars present
  if [[ -f "$tfvars" ]]; then
    printf '  %s✓%s terraform.tfvars present\n' "$GREEN" "$RESET"
  else
    printf '  %s✗%s terraform.tfvars missing at %s\n' "$RED" "$RESET" "$tfvars"
    printf '    %sCopy %s and fill in hcloud_token + ssh_pubkey.%s\n' "$DIM" "$tfvars.example" "$RESET"
    errors=$((errors + 1))
  fi

  # 2. hcloud_token has a real value (not the placeholder)
  if [[ -f "$tfvars" ]]; then
    if grep -qE '^[[:space:]]*hcloud_token[[:space:]]*=[[:space:]]*"[^"]+"' "$tfvars" \
       && ! grep -qE 'hcloud_token[[:space:]]*=[[:space:]]*"(REPLACE|YOUR|TODO)' "$tfvars"; then
      printf '  %s✓%s hcloud_token populated\n' "$GREEN" "$RESET"
    else
      printf '  %s✗%s hcloud_token in %s looks like a placeholder\n' "$RED" "$RESET" "$tfvars"
      errors=$((errors + 1))
    fi
  fi

  # 3. ssh key present (default location)
  local ssh_key="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
  if [[ -f "$ssh_key" ]]; then
    printf '  %s✓%s ssh key at %s\n' "$GREEN" "$RESET" "$ssh_key"
  else
    printf '  %s✗%s ssh key missing at %s\n' "$RED" "$RESET" "$ssh_key"
    printf '    %sGenerate with:%s ssh-keygen -t ed25519 -f %s -C varlens-tofu -N ""\n' "$DIM" "$RESET" "$ssh_key"
    errors=$((errors + 1))
  fi

  # 4. tofu installed
  if command -v tofu >/dev/null 2>&1; then
    local v
    v="$(tofu version -json 2>/dev/null | sed -nE 's/.*"terraform_version":[[:space:]]*"([^"]+)".*/\1/p' | head -1)"
    printf '  %s✓%s tofu %s\n' "$GREEN" "$RESET" "${v:-installed}"
  else
    printf '  %s✗%s tofu not on PATH (brew install opentofu)\n' "$RED" "$RESET"
    errors=$((errors + 1))
  fi

  # 5. ssh on PATH (used by remote stack-up / smoke)
  if command -v ssh >/dev/null 2>&1; then
    printf '  %s✓%s ssh\n' "$GREEN" "$RESET"
  else
    printf '  %s✗%s ssh not on PATH\n' "$RED" "$RESET"
    errors=$((errors + 1))
  fi

  # 6. GHCR_TOKEN — required to pull a private varlens-web image. Probe
  # the registry directly so we catch expired / scope-reduced tokens at
  # preflight rather than at the docker pull during stack-up (which is
  # ~5 min in).
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    local ghcr_user="${GHCR_USER:-robspan}"
    if curl -fsS -u "$ghcr_user:$GHCR_TOKEN" -o /dev/null \
         "https://ghcr.io/v2/$ghcr_user/varlens-web/manifests/edge" 2>/dev/null; then
      printf '  %s✓%s GHCR_TOKEN can read ghcr.io/%s/varlens-web (manifest reachable)\n' "$GREEN" "$RESET" "$ghcr_user"
    else
      printf '  %s✗%s GHCR_TOKEN cannot read ghcr.io/%s/varlens-web manifests — expired or scope reduced\n' "$RED" "$RESET" "$ghcr_user"
      errors=$((errors + 1))
    fi
  else
    printf '  %s⚠%s  GHCR_TOKEN not set — stack-up will fail if VARLENS_IMAGE points at a private GHCR package\n' "$YELLOW" "$RESET"
    printf '    %sExport before running:%s export GHCR_TOKEN=ghp_...\n' "$DIM" "$RESET"
  fi

  # 7. Hetzner S3 creds — required by setup-backup (Hetzner does not yet
  # automate S3-credential generation via API; they must come from env)
  if [[ -n "${RESTIC_S3_ACCESS_KEY:-}" && -n "${RESTIC_S3_SECRET_KEY:-}" ]]; then
    printf '  %s✓%s RESTIC_S3_ACCESS_KEY + RESTIC_S3_SECRET_KEY present\n' "$GREEN" "$RESET"
  else
    printf '  %s⚠%s  RESTIC_S3_* not set — setup-backup will print Console-click instructions and fail\n' "$YELLOW" "$RESET"
    printf '    %sGenerate at:%s Hetzner Console > Security > S3 Credentials\n' "$DIM" "$RESET"
  fi

  if (( errors > 0 )); then
    printf '\n%sPre-flight failed (%d issue(s)). Fix above and retry.%s\n\n' "$RED$BOLD" "$errors" "$RESET"
    exit 1
  fi
  echo ""
}

# ---- Step runner -----------------------------------------------------------

declare -i OVERALL_START
OVERALL_START=$(date +%s)

run_step() {
  local n="$1" total="$2" label="$3" retry="$4"
  shift 4
  step_begin "$n" "$total" "$label"
  local step_start
  step_start=$(date +%s)
  if ! ( cd "$WEB_DEPLOY" && "$@" ); then
    local elapsed=$(($(date +%s) - step_start))
    step_fail "$label" "$elapsed" "$retry"
    exit 1
  fi
  local elapsed=$(($(date +%s) - step_start))
  step_ok "$elapsed"
}

# ---- Main ------------------------------------------------------------------

main() {
  local repo
  repo="$(git -C "$WEB_DEPLOY" rev-parse --show-toplevel 2>/dev/null || echo "$WEB_DEPLOY")"
  local branch
  branch="$(git -C "$WEB_DEPLOY" branch --show-current 2>/dev/null || echo "(no git)")"

  banner "VarLens Concept Pilot — bringing up from cold"
  printf '  %sRepo:%s     %s\n' "$DIM" "$RESET" "$repo"
  printf '  %sBranch:%s   %s\n' "$DIM" "$RESET" "$branch"
  printf '  %sImage:%s    %s\n' "$DIM" "$RESET" "${VARLENS_IMAGE:-ghcr.io/robspan/varlens-web:edge (compose default)}"
  printf '  %sTarget:%s   Hetzner cpx32 + 50 GB volume + IPv4\n' "$DIM" "$RESET"
  printf '  %sStarted:%s  %s\n\n' "$DIM" "$RESET" "$(date '+%Y-%m-%d %H:%M:%S %Z')"

  preflight

  # Each step: number, total, label, retry-command, then the make target.
  # Underlying tool output streams through to stdout — no swallowing.
  run_step 1 5 \
    "Provisioning Hetzner server (cpx32 + 50 GB volume + IPv4) [~3 min, watch tofu output below]" \
    "make -C web-deploy up" \
    make up

  # Bridge step between provisioning and stack-up. NOT counted as a numbered
  # step — operators conceptually think "provision then bring up the stack"
  # and this is just plumbing between those two intentions.
  printf '\n%s    waiting for server to finish booting ...%s\n' "$DIM" "$RESET"
  local ip
  ip="$(cd "$WEB_DEPLOY" && make -s ip 2>/dev/null | grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || echo "")"
  if [[ -z "$ip" ]]; then
    printf '%s    ✗ no IPv4 in tofu output — is the server actually provisioned?%s\n' "$RED" "$RESET"
    exit 1
  fi
  if ! wait_for_server_ready "$ip"; then
    printf '\n%s  Step 2 prerequisites failed. The server is up but not ready.%s\n' "$RED$BOLD" "$RESET"
    exit 1
  fi

  run_step 2 5 \
    "Bringing up Compose stack (Caddy + Kuma + Dozzle + VarLens) [~1 min]" \
    "make -C web-deploy stack-up" \
    make stack-up

  run_step 3 5 \
    "Configuring restic backup (Hetzner Object Storage)" \
    "make -C web-deploy setup-backup" \
    make setup-backup

  run_step 4 5 \
    "Configuring monitoring (Uptime Kuma admin + heartbeat)" \
    "make -C web-deploy setup-monitoring" \
    make setup-monitoring

  run_step 5 5 \
    "Smoke test (12 probes — SSH, HTTPS routes, ports, services)" \
    "make -C web-deploy smoke" \
    make smoke

  # Post-smoke TLS trust probe. The smoke test uses `curl -k`; this probe
  # is strict so we surface Let's Encrypt rate-limit fallbacks (self-signed)
  # that would render the site browser-untrusted. Non-fatal — operators may
  # legitimately be on the staging issuer or hit a temporary LE limit.
  local probe_ip
  probe_ip="$(cd "$WEB_DEPLOY" && make -s ip 2>/dev/null | grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' || echo "")"
  if [[ -n "$probe_ip" ]]; then
    printf '\n%s    TLS trust probe: curl --fail https://%s/welcome ...%s\n' "$DIM" "$probe_ip" "$RESET"
    if curl --fail --silent --show-error --max-time 10 -o /dev/null \
         "https://$probe_ip/welcome" 2>/dev/null; then
      printf '%s    ✓ TLS cert is browser-trusted%s\n' "$GREEN" "$RESET"
    else
      printf '%s    ⚠ WARN: TLS cert at https://%s/welcome is not browser-trusted%s\n' "$YELLOW$BOLD" "$probe_ip" "$RESET"
      printf '%s      Likely cause: Let'\''s Encrypt rate limit → Caddy fell back to a self-signed cert.%s\n' "$YELLOW" "$RESET"
      printf '%s      Browsers will show a warning. Check Caddy logs and re-issue when the limit resets.%s\n' "$DIM" "$RESET"
    fi
  fi

  local total=$(($(date +%s) - OVERALL_START))
  local ip
  ip="$(cd "$WEB_DEPLOY" && make -s ip 2>/dev/null || echo "unknown")"

  banner "✓ Concept Pilot is live in $(human_time "$total")"
  printf '  %sURLs:%s\n' "$BOLD" "$RESET"
  printf '    Welcome:     https://%s/welcome\n' "$ip"
  printf '    VarLens app: https://%s/varlens/healthz\n' "$ip"
  printf '    Monitoring:  https://%s/  %s(admin / varlens-konzept)%s\n' "$ip" "$DIM" "$RESET"
  printf '    Logs:        https://%s/logs/\n\n' "$ip"
  printf '  %sOperator commands:%s\n' "$BOLD" "$RESET"
  printf '    make pilot-ssh      # SSH as deploy user\n'
  printf '    make pilot-smoke    # re-run smoke probes\n'
  printf '    make pilot-status   # show server status\n'
  printf '    make pilot-down     # tear everything down\n\n'
}

main "$@"
