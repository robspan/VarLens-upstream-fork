#!/usr/bin/env bash
# Tier 2 audit-trail provisioning — see provision-audit-owner.sql for what
# this does and why. Run once per database after migration 0013, with an
# ADMIN (superuser) connection URL, not the application role's.
#
# Usage:
#   VARLENS_PG_ADMIN_URL=postgres://postgres:...@host:5432/varlens \
#     scripts/postgres/provision-audit-owner.sh [app_role]
#
# app_role defaults to "varlens" (the role the web server connects as).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROLE="${1:-varlens}"

if [[ -z "${VARLENS_PG_ADMIN_URL:-}" ]]; then
  echo "VARLENS_PG_ADMIN_URL must be set to a superuser connection URL." >&2
  echo "Refusing to guess: provisioning with the application role would be a no-op for tamper protection." >&2
  exit 1
fi

psql "$VARLENS_PG_ADMIN_URL" -v app_role="$APP_ROLE" -f "$SCRIPT_DIR/provision-audit-owner.sql"

echo "varlens_audit is now owned by varlens_audit_owner; role '$APP_ROLE' reduced to INSERT+SELECT (Tier 2)."
