#!/usr/bin/env bash
# Configure the GitHub repository so `release-web.yml` can deploy a
# release to the running pilot. Idempotent — safe to re-run after the
# server IP rotates (e.g. after `make pilot-down && make pilot`).
#
# What it does:
#   1. Verifies `gh` is authenticated against the right repo (default:
#      origin's owner/name; override via `--repo owner/name`).
#   2. Reads the deploy SSH private key from ~/.ssh/varlens-tofu (or
#      $SSH_KEY) and validates it parses as a PEM key.
#   3. Reads the server IPv4 from `tofu output -raw ipv4` (or env
#      `DEPLOY_HOST`).
#   4. Uploads both as repo secrets via `gh secret set`. Existing
#      values are overwritten — that's the point of "auto-configured".
#
# What it does NOT do:
#   - Does not store the Hetzner API token, GHCR token, or restic
#     credentials in CI. Those have a much larger blast radius and
#     stay operator-only. Provisioning + backup setup remain `make
#     pilot` / `make setup-backup`.
#   - Does not create a GitHub Environment automatically. The workflow
#     references `environment: pilot`, which GH creates implicitly on
#     first run; if you want manual approval gates, wire those in the
#     repo Settings → Environments after the first deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOFU_DIR="$WEB_DEPLOY_DIR/tofu/environments/pilot"

# ---- Defaults ---------------------------------------------------------------
SSH_KEY_PATH="${SSH_KEY:-$HOME/.ssh/varlens-tofu}"
REPO_OVERRIDE=""
DEPLOY_HOST_OVERRIDE="${DEPLOY_HOST:-}"
DRY_RUN=0

usage() {
  cat <<USAGE
Usage: enable-github-release.sh [options]

Sets repo secrets DEPLOY_SSH_KEY + DEPLOY_HOST so the release-web.yml
workflow can deploy on a published release.

Options:
  --repo owner/name      Target repository (default: origin remote)
  --ssh-key PATH         Path to the deploy SSH private key
                         (default: \$SSH_KEY or ~/.ssh/varlens-tofu)
  --host IP              Override the server IPv4 (default: tofu output)
  --dry-run              Print what would be uploaded without calling gh
  -h, --help             Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_OVERRIDE="$2"; shift 2 ;;
    --ssh-key) SSH_KEY_PATH="$2"; shift 2 ;;
    --host) DEPLOY_HOST_OVERRIDE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---- Colors -----------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; RED=""; YELLOW=""; RESET=""
fi
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '  %s✗%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

printf '%s━ Enabling GitHub Actions release-deploy for VarLens-Web ━%s\n\n' "$BOLD" "$RESET"

# ---- 1. Tooling -------------------------------------------------------------
command -v gh >/dev/null 2>&1 || fail "gh CLI not found. Install: https://cli.github.com"
if ! gh auth status >/dev/null 2>&1; then
  fail "gh is not authenticated. Run: gh auth login (and grant 'repo' scope)"
fi
ok "gh CLI authenticated"

# ---- 2. Repo resolution -----------------------------------------------------
if [[ -n "$REPO_OVERRIDE" ]]; then
  REPO="$REPO_OVERRIDE"
else
  # Resolve from the `origin` remote URL specifically — `gh repo view`
  # without a default picks an arbitrary remote (often the upstream of
  # a fork), which would upload secrets to the wrong repo. Origin is
  # by convention what we push to, so it's the right target.
  ORIGIN_URL=$(git remote get-url origin 2>/dev/null || true)
  [[ -n "$ORIGIN_URL" ]] || fail "no 'origin' remote in this checkout. Pass --repo owner/name."
  # Handle both SSH (git@host:owner/repo[.git]) and HTTPS
  # (https://host/owner/repo[.git]) forms with a small bit of string
  # surgery — bash's ERE has no lazy quantifiers.
  STRIPPED="${ORIGIN_URL%.git}"
  STRIPPED="${STRIPPED%/}"
  REPO_NAME="${STRIPPED##*/}"
  REMAINDER="${STRIPPED%/*}"
  OWNER="${REMAINDER##*[/:]}"
  if [[ -z "$OWNER" || -z "$REPO_NAME" || "$OWNER" == "$STRIPPED" ]]; then
    fail "could not parse owner/name from origin URL: $ORIGIN_URL"
  fi
  REPO="$OWNER/$REPO_NAME"
fi
ok "Target repo: $REPO"

# ---- 3. SSH key -------------------------------------------------------------
[[ -f "$SSH_KEY_PATH" ]] || fail "SSH key not found at $SSH_KEY_PATH (override with --ssh-key)"
# Verify the key parses; ssh-keygen exits non-zero on a malformed file.
if ! ssh-keygen -y -f "$SSH_KEY_PATH" >/dev/null 2>&1; then
  fail "SSH key at $SSH_KEY_PATH does not parse. Wrong file? Encrypted? Pass a plaintext private key."
fi
KEY_BYTES=$(wc -c < "$SSH_KEY_PATH" | tr -d ' ')
ok "SSH key OK at $SSH_KEY_PATH (${KEY_BYTES} bytes, parses cleanly)"

# ---- 4. Server host ---------------------------------------------------------
if [[ -n "$DEPLOY_HOST_OVERRIDE" ]]; then
  HOST="$DEPLOY_HOST_OVERRIDE"
else
  if ! HOST=$(tofu -chdir="$TOFU_DIR" output -raw ipv4 2>/dev/null); then
    fail "could not read IPv4 from tofu state at $TOFU_DIR. Pass --host or run 'make pilot' first."
  fi
fi
[[ -n "$HOST" ]] || fail "resolved host is empty. Pass --host."
# Sanity-check it's an IP-shaped string (don't enforce v4 strictly — a
# DNS name is also reasonable here even if today the pilot uses a raw IP).
if [[ ! "$HOST" =~ ^[0-9a-zA-Z][0-9a-zA-Z.-]+$ ]]; then
  fail "host '$HOST' looks malformed"
fi
ok "Deploy host: $HOST"

# ---- 5. Dry-run gate --------------------------------------------------------
if (( DRY_RUN == 1 )); then
  printf '\n%sDry-run only — no secrets uploaded.%s\n' "$DIM" "$RESET"
  printf '  Would set DEPLOY_SSH_KEY (from %s) and DEPLOY_HOST=%s on %s\n' "$SSH_KEY_PATH" "$HOST" "$REPO"
  exit 0
fi

# ---- 6. Upload secrets ------------------------------------------------------
printf '\nUploading secrets to %s%s%s ...\n' "$BOLD" "$REPO" "$RESET"
gh secret set DEPLOY_SSH_KEY --repo "$REPO" --body "$(cat "$SSH_KEY_PATH")" >/dev/null
ok "DEPLOY_SSH_KEY  set"
gh secret set DEPLOY_HOST    --repo "$REPO" --body "$HOST" >/dev/null
ok "DEPLOY_HOST     set ($HOST)"

# ---- 7. Verify the workflow file is present ---------------------------------
WORKFLOW=".github/workflows/release-web.yml"
if [[ -f "$(git -C "$WEB_DEPLOY_DIR/.." rev-parse --show-toplevel)/$WORKFLOW" ]]; then
  ok "Workflow present: $WORKFLOW"
else
  warn "Workflow $WORKFLOW not found in this checkout — release-web won't fire until it is committed and pushed."
fi

# ---- 8. Next steps ----------------------------------------------------------
cat <<NEXT

${BOLD}━ Done. To ship a release: ━${RESET}

  ${BOLD}gh release create v1.2.3 --generate-notes${RESET}
      ↳ builds the image, pushes to GHCR, deploys to ${HOST}, runs smoke

  Or via the GitHub UI:
      https://github.com/${REPO}/releases/new

${BOLD}Roll back to a previous version:${RESET}

  ${BOLD}gh workflow run release-web.yml -f version=v1.2.2 -f skip_build=true${RESET}

${BOLD}If the server IP changes (after pilot-down + pilot):${RESET}

  Re-run this script — it overwrites the existing secrets.
NEXT
