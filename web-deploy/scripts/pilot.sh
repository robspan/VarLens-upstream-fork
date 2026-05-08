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

# ---- Resumability ----------------------------------------------------------
#
# Goal: a Ctrl+C, a flapping internet, a closed laptop lid mid-pull, or any
# other interrupt during pilot bring-up must NOT corrupt local state. The
# operator should be able to re-run `make pilot` and have it pick up from
# wherever the previous attempt stopped.
#
# What we do here:
#
#   1. Trap SIGINT / SIGTERM. Print a friendly message, do NOT do partial
#      cleanup of cloud resources (a half-provisioned server costs money;
#      letting tofu's state file remain authoritative is the safer call).
#      The operator's next `make pilot` re-runs each step, all of which are
#      idempotent (tofu apply, docker compose up, setup-backup --reuse,
#      setup-monitoring's check-then-create, smoke).
#
#   2. Detect and release stale tofu state locks at the top of `main`.
#      A killed `tofu apply` leaves a `.terraform.tfstate.lock.info` file
#      that blocks the next `tofu apply` indefinitely. Auto-release on
#      re-entry — safe because we know nobody else is operating on this
#      single-tenant pilot state. Skipped if the lock file looks recent
#      (<60s old) or belongs to a still-running process.
#
#   3. Print a "resuming" banner if existing tofu state is detected, so
#      the operator knows we are continuing rather than starting fresh.
#
# Each step's retry hint already names the make target to re-run on its
# own. Re-running `make pilot` from cold is the catch-all path.

on_interrupt() {
  local signal="$1"
  printf '\n\n%s━━━ Interrupted (%s) ━━━%s\n' "$YELLOW$BOLD" "$signal" "$RESET"
  printf '  Local state is safe. Cloud resources stay as-is — partial cleanup\n'
  printf '  would risk billing for a half-provisioned server you cannot reach.\n\n'
  printf '  Resume from where you left off:\n'
  printf '    %smake pilot%s    # idempotent — re-runs each step, skips what is already done\n' "$BOLD" "$RESET"
  printf '  Start over from scratch (destroys cloud resources):\n'
  printf '    %smake pilot-down && make pilot%s\n\n' "$BOLD" "$RESET"
  exit 130
}
trap 'on_interrupt SIGINT' INT
trap 'on_interrupt SIGTERM' TERM

# Detect a fully-live pilot. Used to refuse blind re-runs of `make pilot`
# against a healthy deploy — re-running would force-recreate Caddy
# (brief downtime + LE-rate-limit churn) and try to re-register Kuma
# monitors that already exist. Operators should use targeted commands
# (make pilot-smoke / make stack-up / make pilot-down) for live deploys.
detect_healthy_pilot() {
  local ip="$1"
  [[ -z "$ip" ]] && return 1
  # Refuse-to-re-run requires *every* stateful step done, not just the
  # stack. Otherwise a partial bring-up that died after step 2 (e.g. LE
  # rate-limit at first, backup not yet configured) would be wrongly
  # detected as "fully healthy" and operators would lose the ability to
  # resume via `make pilot`.
  #
  # Liveness layer: prefer HTTPS, but accept plain HTTP /healthz as the
  # liveness fallback. TLS may be unhealthy (Caddy mid-ACME, LE prod
  # rate-limit, LE-staging fallback in flight, or self-healed to
  # tls-internal) while the stack itself is fine — the Caddyfile :80
  # block serves `/healthz` plainly regardless of TLS state.
  if ! ( curl -kfsS --max-time 5 -o /dev/null "https://$ip/varlens/healthz" 2>/dev/null \
         && curl -kfsS --max-time 5 -o /dev/null "https://$ip/welcome" 2>/dev/null ); then
    curl -fsS --max-time 5 -o /dev/null "http://$ip/healthz" 2>/dev/null || return 1
  fi
  # Step 3: restic configured + ≥1 snapshot.
  _ssh "$ip" 'sudo grep -q "^RESTIC_PASSWORD=." /etc/restic/env 2>/dev/null && \
              sudo bash -c "set -a; . /etc/restic/env; restic snapshots --no-lock --json 2>/dev/null | head -c 1" \
              | grep -qF "["' \
    >/dev/null 2>&1 || return 1
  # Step 4: Kuma admin user + varlens-backup monitor present.
  _ssh "$ip" '
    sudo docker exec uptime-kuma sqlite3 /app/data/kuma.db \
      "SELECT (SELECT COUNT(*) FROM user) || \" \" || (SELECT COUNT(*) FROM monitor WHERE name=\"varlens-backup\");" 2>/dev/null
  ' 2>/dev/null | grep -qE '^[1-9][0-9]* [1-9]' || return 1
  return 0
}

# Detect and clear a stale tofu lock left by a killed apply. Single-tenant
# pilot state, so there is no other operator we could be racing.
release_stale_tofu_lock() {
  local lock="$WEB_DEPLOY/tofu/environments/pilot/.terraform.tfstate.lock.info"
  [[ -f "$lock" ]] || return 0
  # Locks younger than 60s might belong to a tofu still in-flight in a
  # parallel shell — leave those alone. Older locks are almost certainly
  # stale from a prior interrupt.
  local age_s
  age_s=$(( $(date +%s) - $(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo 0) ))
  if (( age_s < 60 )); then
    printf '%s  ⚠ tofu state lock present (%ds old) — leaving alone in case a parallel run is active%s\n' "$YELLOW" "$age_s" "$RESET"
    return 0
  fi
  printf '%s  ⚠ stale tofu state lock (%ds old) from a prior interrupted run — releasing%s\n' "$YELLOW" "$age_s" "$RESET"
  local lock_id
  lock_id=$(grep -oE '"ID":"[^"]+"' "$lock" 2>/dev/null | head -1 | sed 's/.*"ID":"\([^"]*\)".*/\1/')
  if [[ -n "$lock_id" ]]; then
    ( cd "$WEB_DEPLOY/tofu/environments/pilot" && tofu force-unlock -force "$lock_id" ) >/dev/null 2>&1 || true
  else
    rm -f "$lock"
  fi
}

# Layer-2 operator-secret file: gitignored, 0600, single source for
# GHCR_TOKEN / RESTIC_S3_* / VARLENS_ADMIN_*. Sourced BEFORE preflight so
# its values feed every downstream check. Shell exports still override —
# `set -a` exports each assignment but only if the variable wasn't already
# in the environment, because `set -a` only marks subsequent assignments
# for export; a shell `export FOO=bar` before invocation already lives in
# the environment and takes precedence over the file's `FOO=...` line via
# our explicit guard below.
if [[ -f "$WEB_DEPLOY/.env" ]]; then
  # Read the file line-by-line, skip comments/blanks, and only set vars
  # that are not already set in the shell. This preserves CI/one-off
  # behavior where operators export ad-hoc creds without touching the file.
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    key="${key// /}"
    [[ -z "$key" || -n "${!key:-}" ]] && continue
    value="${value%$'\r'}"
    export "$key=$value"
  done < "$WEB_DEPLOY/.env"
fi

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
  local env_file="$WEB_DEPLOY/.env"
  local errors=0

  printf '%sPre-flight checks:%s\n' "$BOLD" "$RESET"

  # 0. Operator env file (Layer 2 secrets — see web-deploy/.env.example).
  # Informational only: shell exports work too, the file is just convenience.
  if [[ -f "$env_file" ]]; then
    printf '  %s✓%s sourcing %s\n' "$GREEN" "$RESET" "$env_file"
  else
    printf '  %sℹ%s  no web-deploy/.env (using shell env only — see .env.example for the convenience template)\n' "$DIM" "$RESET"
  fi

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

  # 6. GHCR_TOKEN — required to pull a private varlens-web image. Two-step
  # probe so we catch tokens that PASS the OAuth2 token-exchange but FAIL
  # the actual manifest-level ACL check (cold-start 2026-05-07 found this
  # false-positive: `gh auth token` returns a `gho_` lacking read:packages,
  # yet /token still returned 200; the real failure was at docker pull
  # 2 minutes later, after a Hetzner server had already been provisioned).
  #   step 1: /token?...:pull → 200 means "the credential is recognised"
  #   step 2: HEAD /v2/.../manifests/edge → 200 means "and can actually pull"
  # A 401/403 on step 2 with 200 on step 1 is exactly the false-positive
  # case; surface it as the preflight failure instead of letting it fire
  # mid-bring-up.
  if [[ -n "${GHCR_TOKEN:-}" ]]; then
    local ghcr_user="${GHCR_USER:-robspan}"
    local bearer
    bearer="$(curl -fsS -u "$ghcr_user:$GHCR_TOKEN" \
      "https://ghcr.io/token?service=ghcr.io&scope=repository:$ghcr_user/varlens-web:pull" 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)"
    if [[ -z "$bearer" ]]; then
      printf '  %s✗%s GHCR_TOKEN rejected at /token — invalid or expired credential for %s\n' "$RED" "$RESET" "$ghcr_user"
      errors=$((errors + 1))
    else
      local manifest_code
      manifest_code="$(curl -s -o /dev/null -w '%{http_code}' -I \
        -H "Authorization: Bearer $bearer" \
        -H "Accept: application/vnd.oci.image.manifest.v1+json,application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.docker.distribution.manifest.list.v2+json" \
        "https://ghcr.io/v2/$ghcr_user/varlens-web/manifests/edge" 2>/dev/null)"
      if [[ "$manifest_code" == "200" ]]; then
        printf '  %s✓%s GHCR_TOKEN can pull ghcr.io/%s/varlens-web:edge (manifest HEAD 200)\n' "$GREEN" "$RESET" "$ghcr_user"
      else
        printf '  %s✗%s GHCR_TOKEN passed token-exchange but cannot fetch manifest (HTTP %s) — token likely lacks read:packages scope\n' "$RED" "$RESET" "$manifest_code"
        printf '    %sFix:%s create a PAT with read:packages, or `gh auth refresh -h github.com -s read:packages`\n' "$DIM" "$RESET"
        errors=$((errors + 1))
      fi
    fi
  else
    printf '  %s⚠%s  GHCR_TOKEN not set — stack-up will fail if VARLENS_IMAGE points at a private GHCR package\n' "$YELLOW" "$RESET"
    printf '    %sExport before running:%s export GHCR_TOKEN=ghp_...\n' "$DIM" "$RESET"
  fi

  # 7. Hetzner S3 creds — REQUIRED. Hetzner does not expose an API for
  # S3 credential creation (probed live 2026-05-07: /v1/object_storage/
  # credentials returns 404 for both POST and GET). The keypair has to
  # be generated once per account in the console; everything downstream
  # (bucket creation, restic repo) is then automated. Failing here at
  # preflight saves a 3-minute Hetzner provisioning + admin-bootstrap
  # cycle that would otherwise abort at step 3.
  if [[ -n "${RESTIC_S3_ACCESS_KEY:-}" && -n "${RESTIC_S3_SECRET_KEY:-}" ]]; then
    printf '  %s✓%s RESTIC_S3_ACCESS_KEY + RESTIC_S3_SECRET_KEY present\n' "$GREEN" "$RESET"
  else
    printf '  %s✗%s RESTIC_S3_ACCESS_KEY / RESTIC_S3_SECRET_KEY required (setup-backup needs them)\n' "$RED" "$RESET"
    printf '    %sGenerate ONCE at:%s Hetzner Console > Security > S3 Credentials > Generate\n' "$DIM" "$RESET"
    printf '    %sPaste both into:%s web-deploy/.env\n' "$DIM" "$RESET"
    errors=$((errors + 1))
  fi

  # 8a. Phase 1 → Phase 2 upgrade hint. The recovery-key file moved from
  # dirname(VARLENS_DB_PATH) to VARLENS_RECOVERY_KEY_DIR. Defaults
  # coincide on the standard pilot (/data), but operators upgrading an
  # existing deployment may have legacy lines in their .env. Surface them.
  local _legacy_db_path="${VARLENS_DB_PATH:-}"
  if [[ -n "$_legacy_db_path" ]]; then
    printf '  %s⚠%s  VARLENS_DB_PATH is set in your env (%s) — Phase 2 ignores it.\n' \
      "$YELLOW" "$RESET" "$_legacy_db_path"
    printf '    %sThe web variant is now Postgres-only (see\n' "$DIM"
    printf '    .planning/web/phase2-execution-plan.md). The recovery-key\n'
    printf '    file path comes from VARLENS_RECOVERY_KEY_DIR (default /data).\n'
    printf '    Drop VARLENS_DB_PATH from web-deploy/.env to silence this warning.%s\n' "$RESET"
  fi

  # 8b. Backend mode + Postgres credentials. Phase 2: web mode is
  # Postgres-only; the varlens service auto-derives VARLENS_PG_URL
  # from POSTGRES_PASSWORD on the server. The compose `:?` guard on
  # POSTGRES_PASSWORD will fail loud at `docker compose up`, but
  # surfacing it at preflight is faster diagnostic feedback.
  if [[ -n "${VARLENS_PG_URL:-}" ]]; then
    printf '  %sℹ%s  VARLENS_PG_URL set in operator env — overrides the in-stack postgres default\n' "$DIM" "$RESET"
  else
    # When using the in-stack default, POSTGRES_PASSWORD must be set
    # somewhere visible to compose. The Makefile generates one if
    # /etc/varlens/postgres-password exists or it can be set by
    # the operator in compose/.env. The persistent file path is the
    # most reliable signal — but it lives on the server, not on the
    # operator's laptop, so we can only check what's locally visible.
    if [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
      printf '  %s✓%s Postgres backend (POSTGRES_PASSWORD present in operator env)\n' "$GREEN" "$RESET"
    else
      printf '  %sℹ%s  Postgres backend (POSTGRES_PASSWORD will be auto-generated server-side on first stack-up)\n' "$DIM" "$RESET"
    fi
  fi

  # 9. VarLens admin bootstrap creds — non-fatal but loud. Without them
  # the app boots fine, but no admin exists, so /api/auth/login has no
  # user to log in as. Operators frequently miss this on first run; the
  # warn here makes it visible at preflight rather than at first-login.
  if [[ -n "${VARLENS_ADMIN_USERNAME:-}" && -n "${VARLENS_ADMIN_PASSWORD:-}" ]]; then
    printf '  %s✓%s VARLENS_ADMIN_USERNAME + VARLENS_ADMIN_PASSWORD present (one-shot bootstrap)\n' "$GREEN" "$RESET"
  else
    printf '  %s⚠%s  VARLENS_ADMIN_* not set — the app will boot without an admin user\n' "$YELLOW" "$RESET"
    printf '    %sFix:%s set VARLENS_ADMIN_USERNAME and VARLENS_ADMIN_PASSWORD in web-deploy/.env (or shell env) before continuing\n' "$DIM" "$RESET"
    printf '    %sIf you continue, you will need to set them on the server post-boot and recreate the varlens container.%s\n' "$DIM" "$RESET"
  fi

  if (( errors > 0 )); then
    printf '\n%sPre-flight failed (%d issue(s)). Fix above and retry.%s\n\n' "$RED$BOLD" "$errors" "$RESET"
    exit 1
  fi
  echo ""
}

# ---- Step runner -----------------------------------------------------------
#
# Atomic step contract: each numbered step is a (check, run, verify) triplet.
#
#   check  — precondition test. Returns 0 if the step is already done and
#            correct on the live system; 1 if work is needed. The
#            orchestrator skips run + verify when check returns 0, so
#            re-runs of `make pilot` against a partial deploy converge
#            without redoing finished work.
#
#   run    — the action. Called only when check returned 1. Must fail loudly
#            (non-zero exit) on any error; the orchestrator translates that
#            into a step_fail with the named retry command.
#
#   verify — postcondition test. Run after `run` returns 0; asserts the
#            action actually took effect on the live system. Catches the
#            case where a tool exits 0 but didn't do what we asked (silent
#            partial success — Caddy started but cert ACME failed, etc.).
#
# Why this shape: re-runs are first-class. The status the orchestrator
# prints next to each step is one of: "skipped (already done)", "did the
# work, verified", or "failed at <phase>" — operators can read the run
# log and know exactly what changed.

declare -i OVERALL_START
OVERALL_START=$(date +%s)

# Run a step against the (check, run, verify) contract above.
#   $1: step number, $2: total, $3: label, $4: retry-hint command
#   $5: check_fn, $6: run_fn, $7: verify_fn
run_atomic_step() {
  local n="$1" total="$2" label="$3" retry="$4"
  local check_fn="$5" run_fn="$6" verify_fn="$7"
  step_begin "$n" "$total" "$label"
  local step_start
  step_start=$(date +%s)

  # Precondition: skip if check passes.
  if "$check_fn" 2>/dev/null; then
    local elapsed=$(($(date +%s) - step_start))
    printf '%s  ✓ already done — skipped (%s)%s\n' "$GREEN" "$(human_time "$elapsed")" "$RESET"
    return 0
  fi

  # Action.
  if ! "$run_fn"; then
    local elapsed=$(($(date +%s) - step_start))
    step_fail "$label" "$elapsed" "$retry"
    printf '%s     Failure phase: run%s\n' "$DIM" "$RESET"
    exit 1
  fi

  # Postcondition: did the action actually take effect?
  if ! "$verify_fn"; then
    local elapsed=$(($(date +%s) - step_start))
    step_fail "$label" "$elapsed" "$retry"
    printf '%s     Failure phase: verify (action ran but the postcondition is not%s\n' "$DIM" "$RESET"
    printf '%s     satisfied — the tool exited 0 but did not actually do what we asked).%s\n' "$DIM" "$RESET"
    exit 1
  fi

  local elapsed=$(($(date +%s) - step_start))
  step_ok "$elapsed"
}

# ---- Per-step (check, run, verify) implementations -------------------------

# Helper: SSH as deploy and run a command, returning its exit code.
_ssh() {
  local ip="$1"; shift
  local key="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
  ssh -i "$key" -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new \
    deploy@"$ip" "$@"
}

# Helper: extract the IPv4 from tfstate (avoids the slow `tofu output` path).
_pilot_ipv4() {
  local tfstate="$WEB_DEPLOY/tofu/environments/pilot/terraform.tfstate"
  [[ -f "$tfstate" ]] || return 1
  grep -oE '"ipv4":\{"value":"[0-9.]+"' "$tfstate" 2>/dev/null \
    | head -1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}'
}

# Step 1: Provision Hetzner server.
step1_check() {
  # Done iff: tofu state has resources AND we can SSH AND cloud-init bootstrap marker exists.
  local tfstate="$WEB_DEPLOY/tofu/environments/pilot/terraform.tfstate"
  [[ -f "$tfstate" ]] || return 1
  grep -q '"resources":\[\]' "$tfstate" 2>/dev/null && return 1
  local ip; ip="$(_pilot_ipv4)" || return 1
  [[ -n "$ip" ]] || return 1
  _ssh "$ip" 'test -f /var/lib/cloud/instance/varlens-bootstrap.ok' >/dev/null 2>&1
}
step1_run() {
  ( cd "$WEB_DEPLOY" && make up ) || return 1
  local ip; ip="$(_pilot_ipv4)"
  [[ -z "$ip" ]] && { printf '%s    ✗ no IPv4 in tofu output%s\n' "$RED" "$RESET" >&2; return 1; }
  wait_for_server_ready "$ip"
}
step1_verify() {
  local ip; ip="$(_pilot_ipv4)" || return 1
  _ssh "$ip" 'test -f /var/lib/cloud/instance/varlens-bootstrap.ok' >/dev/null 2>&1
}

# Step 2: Compose stack up.
#
# Health model: container health (docker compose ps --status=running with
# `healthy` healthchecks) is the SOURCE OF TRUTH. TLS reachability is
# observability — Caddy may be mid-ACME, falling back from LE prod to LE
# staging, or rate-limited (HTTP 429: 5 certs/IP/168h). During those
# windows Caddy aborts the handshake with `tlsv1 alert internal_error`
# even for `curl -k`, but the app behind it is fine.
#
# So verify in three layers, cheapest first:
#   1. all 5 containers running and healthy
#   2. /healthz reachable on plain HTTP :80 (Caddyfile serves it without TLS)
#   3. /varlens/healthz reachable on HTTPS (best-effort; warning, not fatal)
_step2_containers_healthy() {
  local ip="$1"
  # `docker compose ps --format json` prints one JSON line per service.
  # We need (Service ∈ {caddy,uptime-kuma,dozzle,app,postgres}, State=running,
  # Health ∈ {healthy,""}) — empty Health is OK for services without a
  # healthcheck (dozzle has none; the others do).
  local out
  out=$(_ssh "$ip" 'cd /mnt/data/app 2>/dev/null && sudo docker compose ps --format json 2>/dev/null' 2>/dev/null) || return 1
  [[ -n "$out" ]] || return 1
  local svc state health count=0
  while IFS= read -r line; do
    svc=$(printf '%s' "$line"   | sed -n 's/.*"Service":"\([^"]*\)".*/\1/p')
    state=$(printf '%s' "$line" | sed -n 's/.*"State":"\([^"]*\)".*/\1/p')
    health=$(printf '%s' "$line"| sed -n 's/.*"Health":"\([^"]*\)".*/\1/p')
    case "$svc" in
      caddy|uptime-kuma|dozzle|app|postgres)
        [[ "$state" = "running" ]] || return 1
        [[ -z "$health" || "$health" = "healthy" ]] || return 1
        count=$((count + 1))
        ;;
    esac
  done <<< "$out"
  [[ "$count" = "5" ]]
}
step2_check() {
  local ip; ip="$(_pilot_ipv4)" || return 1
  _step2_containers_healthy "$ip" || return 1
  # Plain-HTTP healthz served by Caddy on :80 — does not depend on ACME.
  curl -fsS --max-time 5 -o /dev/null "http://$ip/healthz" 2>/dev/null
}
step2_run() {
  ( cd "$WEB_DEPLOY" && make stack-up )
}
step2_verify() {
  local ip; ip="$(_pilot_ipv4)" || return 1
  # Wait up to 90s for all containers to converge to healthy after
  # `docker compose up -d`. Fresh-pull boots take longer than the old
  # 30s window allowed, especially on first migration runs.
  local attempts=0
  while (( attempts < 18 )); do
    if _step2_containers_healthy "$ip"; then break; fi
    sleep 5
    attempts=$((attempts + 1))
  done
  _step2_containers_healthy "$ip" || return 1
  # Plain-HTTP /healthz on :80 is the protocol-independent liveness probe.
  # Caddyfile serves `respond "ok" 200` for path=/healthz before any TLS.
  if ! curl -fsS --max-time 5 -o /dev/null "http://$ip/healthz" 2>/dev/null; then
    printf '%s    ✗ http://%s/healthz did not respond%s\n' "$RED" "$ip" "$RESET" >&2
    return 1
  fi
  # HTTPS reachability — give Caddy ~15s to settle, then check.
  local https_ok=0
  for _ in 1 2 3; do
    if curl -kfsS --max-time 5 -o /dev/null "https://$ip/varlens/healthz" 2>/dev/null; then
      https_ok=1
      break
    fi
    sleep 5
  done
  if (( https_ok == 1 )); then
    return 0
  fi
  # HTTPS not reachable. Inspect Caddy logs: if LE prod returned 429
  # (5 certs/IP/168h rate limit), self-heal by flipping to tls-internal
  # and recreating Caddy. Caddy will not auto-fall-back to its internal
  # CA on its own — it falls back to LE staging, which serves an
  # untrusted cert and still leaves browsers showing ERR_CERT_*. The
  # operator-visible behaviour the heads-up promised ("falls back to a
  # self-signed cert") only happens if we wire it ourselves.
  if _ssh "$ip" 'sudo docker logs caddy 2>&1 | grep -q "urn:ietf:params:acme:error:rateLimited"' 2>/dev/null; then
    printf '%s    ⚠ Let'\''s Encrypt prod is rate-limited for this IP (5 certs/168h).%s\n' "$YELLOW" "$RESET"
    printf '%s      Self-healing: flipping CADDY_TLS_PROFILE=tls-internal and recreating Caddy.%s\n' "$YELLOW" "$RESET"
    printf '%s      Browsers will show a one-time cert warning on first visit; acceptable for%s\n' "$YELLOW" "$RESET"
    printf '%s      the rate-limit window (LE prod will be retryable on the next cycle).%s\n' "$YELLOW" "$RESET"
    if ! _ssh "$ip" 'cd /mnt/data/app && \
        sudo sed -i "s|^CADDY_TLS_PROFILE=.*|CADDY_TLS_PROFILE=tls-internal|" .env && \
        grep -q "^CADDY_TLS_PROFILE=tls-internal" .env && \
        sudo docker compose up -d --force-recreate caddy' >/dev/null 2>&1; then
      printf '%s    ✗ self-heal failed — could not recreate Caddy with tls-internal%s\n' "$RED" "$RESET" >&2
      return 1
    fi
    # Re-probe HTTPS — internal CA cert is served immediately.
    local attempts=0
    while (( attempts < 6 )); do
      if curl -kfsS --max-time 5 -o /dev/null "https://$ip/varlens/healthz" 2>/dev/null; then
        printf '%s    ✓ self-heal succeeded — Caddy now serving its internal-CA certificate%s\n' "$GREEN" "$RESET"
        return 0
      fi
      sleep 5
      attempts=$((attempts + 1))
    done
    printf '%s    ✗ HTTPS still not reachable after tls-internal self-heal%s\n' "$RED" "$RESET" >&2
    return 1
  fi
  # Not rate-limited — Caddy may simply still be mid-ACME. Containers are
  # healthy, so this is observability, not a hard fail.
  printf '%s    ⚠ HTTPS not reachable yet — Caddy is likely still obtaining a%s\n' "$YELLOW" "$RESET"
  printf '%s      certificate. Containers are healthy; bring-up continues. Tail logs%s\n' "$YELLOW" "$RESET"
  printf '%s      with `make -C web-deploy stack-logs` if it persists past a few minutes.%s\n' "$YELLOW" "$RESET"
  return 0
}

# Step 3: Restic backup configured + first snapshot taken.
step3_check() {
  # Done iff: /etc/restic/env exists with RESTIC_PASSWORD AND ≥1 snapshot.
  local ip; ip="$(_pilot_ipv4)" || return 1
  _ssh "$ip" 'sudo grep -q "^RESTIC_PASSWORD=." /etc/restic/env 2>/dev/null && \
              sudo bash -c "set -a; . /etc/restic/env; restic snapshots --no-lock --json 2>/dev/null | head -c 1" \
              | grep -qF "["' \
    >/dev/null 2>&1
}
step3_run() {
  ( cd "$WEB_DEPLOY" && make setup-backup SETUP_BACKUP_ARGS=--default-reuse-when-resumable )
}
step3_verify() {
  step3_check
}

# Step 4: Uptime Kuma admin + heartbeat monitor configured.
step4_check() {
  # Done iff: Kuma DB has an admin user AND the varlens-backup push monitor exists.
  # Kuma persists to /mnt/data/uptime-kuma/kuma.db; query it directly via sqlite3.
  local ip; ip="$(_pilot_ipv4)" || return 1
  _ssh "$ip" '
    sudo docker exec uptime-kuma sqlite3 /app/data/kuma.db \
      "SELECT (SELECT COUNT(*) FROM user) || \" \" || (SELECT COUNT(*) FROM monitor WHERE name=\"varlens-backup\");" 2>/dev/null
  ' 2>/dev/null | grep -qE '^[1-9][0-9]* [1-9]'
}
step4_run() {
  ( cd "$WEB_DEPLOY" && make setup-monitoring )
}
step4_verify() {
  step4_check
}

# Step 5: Smoke test — atomic by definition (it IS the verification).
step5_check() { return 1; }   # always run — it's the test, not a thing to skip
step5_run() {
  ( cd "$WEB_DEPLOY" && make smoke )
}
step5_verify() {
  # `make smoke` exits non-zero on any probe fail; reaching here means
  # all 12 probes passed. No additional postcondition beyond that.
  return 0
}

# Legacy wrapper — kept so anything that still calls run_step keeps working
# without atomic semantics. New steps should use run_atomic_step.
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

  # Resume detection: existing tofu state with resources = a prior run got
  # at least through Step 1. Adjust the banner accordingly so the operator
  # knows we are continuing, not starting over.
  local tfstate="$WEB_DEPLOY/tofu/environments/pilot/terraform.tfstate"
  local resuming=0
  if [[ -f "$tfstate" ]] && ! grep -q '"resources":\[\]' "$tfstate" 2>/dev/null; then
    resuming=1
  fi

  release_stale_tofu_lock

  # Refuse blind re-runs against a healthy deploy. Re-running would
  # force-recreate Caddy (brief downtime + churns LE state, possibly
  # tipping into rate limit) and re-register Kuma monitors that are
  # already there. The right response when everything is already up is
  # to use a targeted command, not `make pilot` again.
  if (( resuming == 1 )); then
    local existing_ip
    existing_ip="$(_pilot_ipv4 || echo "")"
    if [[ -n "$existing_ip" ]] && detect_healthy_pilot "$existing_ip"; then
      banner "✓ Concept Pilot is already live and healthy"
      printf '  Detected at %shttps://%s%s — refusing to re-run.\n\n' "$BOLD" "$existing_ip" "$RESET"
      printf '  Re-running %smake pilot%s against a working deploy would:\n' "$BOLD" "$RESET"
      printf '    %s•%s force-recreate Caddy (brief downtime + may churn LE certs into rate-limit)\n' "$DIM" "$RESET"
      printf '    %s•%s re-pull images even if they have not changed\n' "$DIM" "$RESET"
      printf '    %s•%s try to re-register Kuma monitors that already exist\n\n' "$DIM" "$RESET"
      printf '  %sUse a targeted command instead:%s\n' "$BOLD" "$RESET"
      printf '    make pilot-smoke                   %s# re-run the 12 smoke probes%s\n' "$DIM" "$RESET"
      printf '    make pilot-ssh                     %s# SSH into the server%s\n' "$DIM" "$RESET"
      printf '    make pilot-status                  %s# check server status%s\n' "$DIM" "$RESET"
      printf '    make -C web-deploy stack-up        %s# pull updated image, recreate containers%s\n' "$DIM" "$RESET"
      printf '    make -C web-deploy stack-logs      %s# tail container logs%s\n' "$DIM" "$RESET"
      printf '    make -C web-deploy restore-drill   %s# verify backup round-trip%s\n\n' "$DIM" "$RESET"
      printf '  To force a full bring-up cycle, tear down first:\n'
      printf '    %smake pilot-down && make pilot%s\n\n' "$BOLD" "$RESET"
      exit 0
    fi
  fi

  if (( resuming == 1 )); then
    banner "VarLens Concept Pilot — resuming partial bring-up"
    printf '  %sExisting Hetzner resources detected in local tofu state.%s This run will\n' "$YELLOW" "$RESET"
    printf '  re-execute every step; each one is idempotent and will skip work that is\n'
    printf '  already done (tofu reports "0 to add, 0 to change", docker pull is a no-op\n'
    printf '  if images are present, setup-backup with --default-reuse-when-resumable\n'
    printf '  reuses the existing bucket + password). If you want a fully fresh start\n'
    printf '  instead, abort with Ctrl+C and run %smake pilot-down && make pilot%s.\n\n' "$BOLD" "$RESET"
  else
    banner "VarLens Concept Pilot — bringing up from cold"
  fi
  # The "what this does" intro below applies to both fresh + resume paths.
  printf '  %sWhat this does:%s in roughly 5 minutes you will have a working,\n' "$BOLD" "$RESET"
  printf '  TLS-terminated VarLens deployment on a fresh Hetzner cpx32 server, with\n'
  printf '  PostgreSQL backed up nightly to Hetzner Object Storage and basic monitoring.\n'
  printf '  Five numbered steps run end-to-end; each prints what it is doing, how long\n'
  printf '  it normally takes, and the exact retry command if it fails.\n\n'
  printf '  %sRepo:%s     %s\n' "$DIM" "$RESET" "$repo"
  printf '  %sBranch:%s   %s\n' "$DIM" "$RESET" "$branch"
  printf '  %sImage:%s    %s\n' "$DIM" "$RESET" "${VARLENS_IMAGE:-ghcr.io/robspan/varlens-web:edge (compose default)}"
  printf '  %sTarget:%s   Hetzner cpx32 + 50 GB volume + IPv4 (~0.02 EUR/h while running)\n' "$DIM" "$RESET"
  printf '  %sStarted:%s  %s\n\n' "$DIM" "$RESET" "$(date '+%Y-%m-%d %H:%M:%S %Z')"

  # TLS forewarning. The default profile is tls-le-ip (LE 7-day cert
  # bound to the raw IP). LE rate-limits at 5 certs per IP per 168h, so
  # a tear-down/bring-up cycle that recycles the IP can hit the wall and
  # silently fall back to a self-signed cert. Operator gets a "browser
  # cert warning" surprise hours later. Tell them upfront.
  printf '  %s━ Heads-up about TLS certificates ━%s\n' "$YELLOW$BOLD" "$RESET"
  printf '  %sDefault: Caddy issues a Let'\''s Encrypt cert pinned to the IP (auto-renewed%s\n' "$YELLOW" "$RESET"
  printf '  %severy ~5 days). LE rate-limits at 5 certs per IP / 168h — recycling the IP%s\n' "$YELLOW" "$RESET"
  printf '  %svia repeated pilot-down/up cycles can hit the wall, in which case Caddy%s\n' "$YELLOW" "$RESET"
  printf '  %sfalls back to a self-signed cert and browsers will show ERR_CERT_* or%s\n' "$YELLOW" "$RESET"
  printf '  %sERR_QUIC_PROTOCOL_ERROR. The bring-up reports the cert state at the end.%s\n' "$YELLOW" "$RESET"
  printf '  %sIf you know you are rate-limited, force self-signed mode upfront:%s\n' "$YELLOW" "$RESET"
  printf '    %smake pilot && make -C web-deploy stack-up TLS=internal%s    %s# accept browser warning%s\n\n' "$BOLD" "$RESET" "$DIM" "$RESET"

  printf '  %sPre-flight checks%s — verifying credentials, tools, and config %sBEFORE%s\n' "$BOLD" "$RESET" "$BOLD" "$RESET"
  printf '  any cloud resource is touched. A failure here costs nothing; it is far\n'
  printf '  cheaper than failing mid-provision after a server has been billed for.\n'
  preflight

  # ---- Backup-protection guard --------------------------------------------
  # If a restic repository is already initialised in the configured bucket
  # AND we are NOT resuming an in-progress bring-up, refuse to provision a
  # fresh server. Reason: a fresh `make pilot` against pre-existing
  # backups means the operator either (a) wants to RESTORE those backups
  # onto a new server (use pilot-recover), or (b) genuinely wants a clean
  # slate and accepts that the snapshots stay in the bucket as orphans
  # (set VARLENS_IGNORE_EXISTING_BACKUPS=1).
  #
  # Without this guard, an operator who tore down their last server and
  # absent-mindedly re-ran `make pilot` would get a fresh empty server
  # with no automatic offer of recovery — they would only realise their
  # backups still exist when they go looking, and may have already done
  # writes against the empty server. The block forces a deliberate
  # decision before any cloud resource is touched.
  if (( resuming == 0 )) && [[ -n "${RESTIC_S3_ACCESS_KEY:-}" && -n "${RESTIC_S3_SECRET_KEY:-}" ]]; then
    local backup_probe
    backup_probe="$("$WEB_DEPLOY/scripts/check-backups.py" 2>/dev/null || echo "no")"
    if [[ "$backup_probe" != "no" ]] && [[ "$backup_probe" == *'"present": true'* ]]; then
      if [[ "${VARLENS_IGNORE_EXISTING_BACKUPS:-0}" != "1" ]]; then
        local bucket_name
        bucket_name="$(printf '%s' "$backup_probe" | sed -n 's/.*"bucket":[[:space:]]*"\([^"]*\)".*/\1/p')"
        printf '\n%s═══════════════════════════════════════════════════════════════════%s\n' "$YELLOW" "$RESET"
        printf '%s  ⚠  EXISTING BACKUPS DETECTED — fresh provision blocked  ⚠%s\n' "$YELLOW$BOLD" "$RESET"
        printf '%s═══════════════════════════════════════════════════════════════════%s\n\n' "$YELLOW" "$RESET"
        printf '  An initialised restic repository exists in the configured bucket:\n'
        printf '    %sBucket:%s   %s\n\n' "$BOLD" "$RESET" "$bucket_name"
        printf '  Provisioning a fresh server now would leave those snapshots orphaned\n'
        printf '  and let the operator do real writes against an empty database without\n'
        printf '  realising prior data is recoverable.\n\n'
        printf '  %sChoose explicitly:%s\n\n' "$BOLD" "$RESET"
        printf '  %s1. Restore the existing backups onto a new server%s  %s(safest)%s\n' "$GREEN$BOLD" "$RESET" "$DIM" "$RESET"
        printf '       %smake pilot-recover%s\n' "$BOLD" "$RESET"
        printf '       Provisions a fresh cpx32, restores /mnt/data from the latest\n'
        printf '       restic snapshot, restores PostgreSQL from the embedded pg_dump,\n'
        printf '       brings up the stack, runs smoke + parity check.\n\n'
        printf '  %s2. List the snapshots before deciding%s\n' "$BOLD" "$RESET"
        printf '       %smake -C web-deploy restore-list%s    %s(read-only; needs SOPS)%s\n\n' "$BOLD" "$RESET" "$DIM" "$RESET"
        printf '  %s3. Discard the backups deliberately%s — destroy them first, then provision:\n' "$RED$BOLD" "$RESET"
        printf '       %smake -C web-deploy destroy-bucket DESTROY_BUCKET_ARGS=--yes && make pilot%s\n\n' "$BOLD" "$RESET"
        printf '  %s4. Override (only if you understand the consequences):%s\n' "$RED" "$RESET"
        printf '       %sVARLENS_IGNORE_EXISTING_BACKUPS=1 make pilot%s\n' "$BOLD" "$RESET"
        printf '       This provisions a fresh server and leaves the existing\n'
        printf '       snapshots in the bucket as orphans (still restoreable later\n'
        printf '       via the SOPS-stored password). Use only when you are sure the\n'
        printf '       data on the snapshots is not needed by this new deployment.\n\n'
        exit 2
      fi
      printf '%s  ⚠ VARLENS_IGNORE_EXISTING_BACKUPS=1 — provisioning despite existing snapshots in bucket%s\n\n' "$YELLOW" "$RESET"
    fi
  fi

  # Each step: number, total, label, retry-command, then the make target.
  # Underlying tool output streams through to stdout — no swallowing.
  printf '\n%s  Step 1 talks to the Hetzner Cloud API to create the actual VM,%s\n' "$DIM" "$RESET"
  printf '%s  attach a 50 GB persistent data volume, pin a public IPv4, and apply%s\n' "$DIM" "$RESET"
  printf '%s  the firewall rules. Cloud-init then runs on first boot to install%s\n' "$DIM" "$RESET"
  printf '%s  Docker, restic, and the deploy user. You will see Tofu naming each%s\n' "$DIM" "$RESET"
  printf '%s  resource as it gets created — that is normal progress, not an error.%s\n' "$DIM" "$RESET"
  run_atomic_step 1 5 \
    "Provisioning Hetzner server (cpx32 + 50 GB volume + IPv4) [~3 min, watch tofu output below]" \
    "make -C web-deploy up" \
    step1_check step1_run step1_verify

  printf '\n%s  Step 2 rsyncs the compose/ tree to /mnt/data/app on the server,%s\n' "$DIM" "$RESET"
  printf '%s  logs in to ghcr.io with the operator GHCR_TOKEN, pulls the five%s\n' "$DIM" "$RESET"
  printf '%s  container images (Caddy reverse proxy, Postgres, the VarLens app,%s\n' "$DIM" "$RESET"
  printf '%s  Uptime Kuma for monitoring, Dozzle for log viewing) and starts them.%s\n' "$DIM" "$RESET"
  printf '%s  Caddy is what gives you the HTTPS URL the operator hits.%s\n' "$DIM" "$RESET"
  run_atomic_step 2 5 \
    "Bringing up Compose stack (Caddy + Kuma + Dozzle + VarLens) [~1 min]" \
    "make -C web-deploy stack-up" \
    step2_check step2_run step2_verify

  printf '\n%s  Step 3 creates the restic-encrypted backup target in Hetzner Object%s\n' "$DIM" "$RESET"
  printf '%s  Storage (or reuses an existing one), writes /etc/restic/env on the%s\n' "$DIM" "$RESET"
  printf '%s  server, and runs the FIRST snapshot. From now on a systemd timer fires%s\n' "$DIM" "$RESET"
  printf '%s  the backup nightly. Postgres is dumped with pg_dump first, then restic%s\n' "$DIM" "$RESET"
  printf '%s  snapshots /mnt/data — so the dump is the consistent recovery point.%s\n' "$DIM" "$RESET"
  run_atomic_step 3 5 \
    "Configuring restic backup (Hetzner Object Storage)" \
    "make -C web-deploy setup-backup SETUP_BACKUP_ARGS=--default-reuse-when-resumable" \
    step3_check step3_run step3_verify

  printf '\n%s  Step 4 sets up Uptime Kuma — the small monitoring dashboard you reach%s\n' "$DIM" "$RESET"
  printf '%s  at https://<ip>/ . Creates the admin user, then registers a heartbeat%s\n' "$DIM" "$RESET"
  printf '%s  push monitor that the nightly backup script pings on success. If the%s\n' "$DIM" "$RESET"
  printf '%s  backup ever fails, Kuma flips that monitor red and you see it.%s\n' "$DIM" "$RESET"
  run_atomic_step 4 5 \
    "Configuring monitoring (Uptime Kuma admin + heartbeat)" \
    "make -C web-deploy setup-monitoring" \
    step4_check step4_run step4_verify

  printf '\n%s  Step 5 is a 12-probe end-to-end check: SSH reachability, HTTP→HTTPS%s\n' "$DIM" "$RESET"
  printf '%s  redirect, the welcome page, all Kuma routes, the auth gate on the logs%s\n' "$DIM" "$RESET"
  printf '%s  endpoint, the VarLens /healthz, and that internal-only ports (Kuma,%s\n' "$DIM" "$RESET"
  printf '%s  Dozzle, Postgres) are bound to localhost only. If anything is wrong%s\n' "$DIM" "$RESET"
  printf '%s  with the deploy, this is where you find out — see smoke-remediation.md.%s\n' "$DIM" "$RESET"
  run_atomic_step 5 5 \
    "Smoke test (12 probes — SSH, HTTPS routes, ports, services)" \
    "make -C web-deploy smoke" \
    step5_check step5_run step5_verify

  # Post-smoke TLS trust probe. The smoke test uses `curl -k`; this probe
  # is strict so we surface Let's Encrypt rate-limit fallbacks (self-signed)
  # that would render the site browser-untrusted. Non-fatal — operators may
  # legitimately be on the staging issuer or hit a temporary LE limit.
  # Also extract the actual issuer string so the warning explicitly names
  # whether we are on Caddy's local CA, the LE staging CA, or a real cert.
  local probe_ip
  probe_ip="$(_pilot_ipv4 || echo "")"
  local cert_issuer=""
  if [[ -n "$probe_ip" ]]; then
    cert_issuer="$(echo | openssl s_client -servername "$probe_ip" -connect "$probe_ip:443" 2>/dev/null \
      | openssl x509 -noout -issuer 2>/dev/null | sed 's/^issuer=//' | head -c 200)"
  fi
  if [[ -n "$probe_ip" ]]; then
    printf '\n%s    TLS trust probe: curl --fail https://%s/welcome ...%s\n' "$DIM" "$probe_ip" "$RESET"
    if curl --fail --silent --show-error --max-time 10 -o /dev/null \
         "https://$probe_ip/welcome" 2>/dev/null; then
      printf '%s    ✓ TLS cert is browser-trusted%s\n' "$GREEN" "$RESET"
      [[ -n "$cert_issuer" ]] && printf '%s      issuer: %s%s\n' "$DIM" "$cert_issuer" "$RESET"
    else
      printf '\n%s═══════════════════════════════════════════════════════════════════%s\n' "$YELLOW" "$RESET"
      printf '%s  ⚠  TLS CERT WARNING — operator action required%s\n' "$YELLOW$BOLD" "$RESET"
      printf '%s═══════════════════════════════════════════════════════════════════%s\n\n' "$YELLOW" "$RESET"
      printf '  The cert at https://%s/welcome is %sNOT%s browser-trusted.\n' "$probe_ip" "$BOLD" "$RESET"
      [[ -n "$cert_issuer" ]] && printf '  Cert issuer: %s%s%s\n' "$BOLD" "$cert_issuer" "$RESET"
      printf '\n  %sWhat browsers will show:%s ERR_CERT_AUTHORITY_INVALID, ERR_CERT_DATE_INVALID,\n' "$BOLD" "$RESET"
      printf '  or — on Chromium with a recycled IP — %sERR_QUIC_PROTOCOL_ERROR%s (cached HTTP/3\n' "$BOLD" "$RESET"
      printf '  alt-svc record from a previous cert holder).\n\n'
      printf '  %sLikely cause:%s Let'\''s Encrypt rate limit (5 certs per IP per 168h). Caddy\n' "$BOLD" "$RESET"
      printf '  fell back to its internal self-signed CA when LE refused a fresh cert.\n\n'
      printf '  %sFix options, in order of preference:%s\n' "$BOLD" "$RESET"
      printf '    1. %sExplicit self-signed mode%s — own the warning, click through it once,\n' "$BOLD" "$RESET"
      printf '       no cert churn:\n'
      printf '         %smake -C web-deploy stack-up TLS=internal%s\n\n' "$BOLD" "$RESET"
      printf '    2. %sWait out the LE rate limit%s (the next 168h-window line is in Caddy'\''s\n' "$BOLD" "$RESET"
      printf '       log: %ssudo docker logs caddy 2>&1 | grep retry-after%s ), then:\n' "$DIM" "$RESET"
      printf '         %smake -C web-deploy stack-up%s\n\n' "$BOLD" "$RESET"
      printf '    3. %sBind a real domain%s and re-issue against it (LE rate-limits per\n' "$BOLD" "$RESET"
      printf '       identifier, so a domain has its own quota):\n'
      printf '         %smake -C web-deploy stack-up DOMAIN=varlens.example.org%s\n\n' "$BOLD" "$RESET"
      printf '  %sBrowser-side gotchas (separate from the cert itself):%s\n' "$BOLD" "$RESET"
      printf '    %s•%s Chromium caches HTTP/3 alt-svc records per-IP. After a cert change,\n' "$DIM" "$RESET"
      printf '      open chrome://net-internals/#hsts and clear the host, OR test in a fresh\n'
      printf '      incognito window.\n'
      printf '    %s•%s After accepting a self-signed cert: the warning is one-time per browser\n' "$DIM" "$RESET"
      printf '      profile. Shareable links to the URL will show the same warning to others.\n\n'
    fi
  fi

  local total=$(($(date +%s) - OVERALL_START))
  local ip
  ip="$(_pilot_ipv4 || echo "unknown")"

  # Best-effort: configure the GitHub Actions release-deploy secrets so
  # the operator can ship subsequent versions via `make web-release` (or
  # the GitHub UI Release dialog) without manually wiring repo secrets.
  # Re-running the pilot rotates the IP, so re-uploading on every fresh
  # bring-up keeps DEPLOY_HOST in sync with reality.
  #
  # Failure here is *never* fatal. If the operator hasn't installed gh,
  # hasn't authenticated, or doesn't want CI deploys, we print a
  # one-line tip and move on — the pilot itself is fully usable.
  if [[ -n "$ip" && "$ip" != "unknown" ]]; then
    printf '\n%s  Configuring GitHub Actions release-deploy secrets (best-effort)...%s\n' "$DIM" "$RESET"
    if "$WEB_DEPLOY/scripts/enable-github-release.sh" --host "$ip" >/dev/null 2>&1; then
      printf '%s    ✓ DEPLOY_SSH_KEY + DEPLOY_HOST uploaded — releases will auto-deploy.%s\n' "$GREEN" "$RESET"
      printf '%s      Ship the next version with: %smake web-release VERSION=v0.x.y NOTES_FROM=auto%s\n' "$DIM" "$BOLD" "$RESET"
    else
      printf '%s    ⚠ Skipped — gh not installed/authed, or no origin remote yet.%s\n' "$YELLOW" "$RESET"
      printf '%s      Re-run later with: %smake web-release-enable%s%s (pilot is fully usable without it).%s\n' "$DIM" "$BOLD" "$RESET" "$DIM" "$RESET"
    fi
  fi

  banner "✓ Concept Pilot is live in $(human_time "$total")"
  printf '  %sFour URLs you can hit right now (replace <ip> if copy-pasting):%s\n\n' "$BOLD" "$RESET"
  printf '    Welcome page:       https://%s/welcome\n' "$ip"
  printf '    %s↳ a static "the pilot is running" landing page%s\n\n' "$DIM" "$RESET"
  printf '    VarLens app:        https://%s/varlens/\n' "$ip"
  printf '    %s↳ login screen for the actual VarLens web app%s\n' "$DIM" "$RESET"
  printf '    %s  /varlens/healthz returns {"status":"ok"} for liveness probes%s\n\n' "$DIM" "$RESET"
  printf '    Monitoring:         https://%s/   %s(admin / varlens-konzept)%s\n' "$ip" "$DIM" "$RESET"
  printf '    %s↳ Uptime Kuma — see backup heartbeat + uptime history%s\n\n' "$DIM" "$RESET"
  printf '    Logs:               https://%s/logs/\n' "$ip"
  printf '    %s↳ Dozzle — live container logs in the browser, basic-auth gated%s\n\n' "$DIM" "$RESET"

  # Admin bootstrap follow-up. The recovery key file is the only copy of
  # an extremely sensitive secret; point operators at it loudly so the
  # capture-and-delete step doesn't get skipped.
  if [[ -n "${VARLENS_ADMIN_USERNAME:-}" && -n "${VARLENS_ADMIN_PASSWORD:-}" ]]; then
    printf '  %sAdmin bootstrap:%s\n' "$BOLD" "$RESET"
    printf '    User:        %s%s%s (Argon2 password from VARLENS_ADMIN_PASSWORD)\n' "$BOLD" "${VARLENS_ADMIN_USERNAME}" "$RESET"
    printf '    %sCapture the one-time recovery key NOW:%s\n' "$YELLOW" "$RESET"
    printf '      make pilot-ssh\n'
    printf '      sudo cat /mnt/data/app/data/admin-recovery-key.txt    # copy somewhere safe\n'
    printf '      sudo rm  /mnt/data/app/data/admin-recovery-key.txt    # then delete\n'
    printf '    %sAfter capture, blank VARLENS_ADMIN_PASSWORD in web-deploy/.env%s\n' "$DIM" "$RESET"
    printf '    %s(env-based rotation is not supported; future: varlens admin rotate)%s\n\n' "$DIM" "$RESET"
  fi

  printf '  %sOperator commands:%s\n' "$BOLD" "$RESET"
  printf '    make pilot-ssh      # SSH as deploy user\n'
  printf '    make pilot-smoke    # re-run smoke probes\n'
  printf '    make pilot-status   # show server status\n'
  printf '    make pilot-down     # tear everything down\n\n'
}

main "$@"
