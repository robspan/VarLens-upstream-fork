#!/usr/bin/env bash
# Audit-trail retention — see audit-retention.sql for the policy caveats
# (retention periods need DPO sign-off; defaults are starting points only).
#
# Must run with a connection that can act as varlens_audit_owner (i.e. the
# admin URL used for provision-audit-owner.sh) — the application role is
# blocked from deleting audit rows by design.
#
# Usage:
#   VARLENS_PG_ADMIN_URL=postgres://postgres:...@host:5432/varlens \
#   [VARLENS_AUDIT_CLINICAL_RETENTION_DAYS=3650] \
#   [VARLENS_AUDIT_ACCESS_RETENTION_DAYS=730] \
#     scripts/postgres/audit-retention.sh
#
# Scheduling (cron/systemd/k8s) is deployment-specific and intentionally
# not provided here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLINICAL_DAYS="${VARLENS_AUDIT_CLINICAL_RETENTION_DAYS:-3650}"
ACCESS_DAYS="${VARLENS_AUDIT_ACCESS_RETENTION_DAYS:-730}"

if [[ -z "${VARLENS_PG_ADMIN_URL:-}" ]]; then
  echo "VARLENS_PG_ADMIN_URL must be set (audit retention requires the owner/admin credential)." >&2
  exit 1
fi

if ! [[ "$CLINICAL_DAYS" =~ ^[0-9]+$ ]] || ! [[ "$ACCESS_DAYS" =~ ^[0-9]+$ ]]; then
  echo "Retention days must be non-negative integers." >&2
  exit 1
fi

psql "$VARLENS_PG_ADMIN_URL" \
  -v clinical_retention_days="$CLINICAL_DAYS" \
  -v access_retention_days="$ACCESS_DAYS" \
  -f "$SCRIPT_DIR/audit-retention.sql"

echo "Audit retention applied: clinical ${CLINICAL_DAYS}d, access/activity ${ACCESS_DAYS}d."
