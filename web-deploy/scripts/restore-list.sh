#!/usr/bin/env bash
# Read-only listing of restic snapshots in the configured bucket.
#
# Uses RESTIC_S3_* from the env (sourced from web-deploy/.env upstream)
# and decrypts the restic password from secrets/restic.yaml via SOPS.
# No SSH, no live server, no mutations — strictly informational.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DEPLOY="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${RESTIC_S3_ACCESS_KEY:?RESTIC_S3_ACCESS_KEY must be set}"
: "${RESTIC_S3_SECRET_KEY:?RESTIC_S3_SECRET_KEY must be set}"

BUCKET="${BUCKET_NAME:-varlens-pilot-backup}"
ENDPOINT="${BUCKET_ENDPOINT:-fsn1.your-objectstorage.com}"

# Decrypt restic password from SOPS. Operator must have age key + sops
# configured locally (same prerequisite as setup-backup's resume path).
SOPS_FILE="$WEB_DEPLOY/secrets/restic.yaml"
if [[ ! -f "$SOPS_FILE" ]]; then
  echo "ERROR: $SOPS_FILE missing — cannot decrypt restic password locally." >&2
  echo "If the bucket has snapshots, the password also lives on the server" >&2
  echo "in /etc/restic/env. SSH in and run: sudo bash -c '. /etc/restic/env; restic snapshots'" >&2
  exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "ERROR: sops not installed (brew install sops)." >&2
  exit 1
fi
if ! command -v restic >/dev/null 2>&1; then
  echo "ERROR: restic not installed (brew install restic)." >&2
  exit 1
fi

# sops 3.x doesn't auto-discover ~/.config/sops/age/keys.txt the way the
# Go SDK does — it requires SOPS_AGE_KEY_FILE explicitly. Set it if the
# operator hasn't.
if [[ -z "${SOPS_AGE_KEY_FILE:-}" ]] && [[ -f "$HOME/.config/sops/age/keys.txt" ]]; then
  export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
fi

RESTIC_PASSWORD="$(sops -d --extract '["restic_password"]' "$SOPS_FILE")"
export RESTIC_PASSWORD
export RESTIC_REPOSITORY="s3:$ENDPOINT/$BUCKET"
export AWS_ACCESS_KEY_ID="$RESTIC_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$RESTIC_S3_SECRET_KEY"

echo "Listing snapshots in $RESTIC_REPOSITORY"
echo
restic snapshots --no-lock
