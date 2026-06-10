-- audit-retention.sql — audit-trail retention enforcement.
--
-- !! RETENTION PERIODS ARE DEPLOYMENT POLICY, NOT VALUES THIS REPOSITORY
-- !! CAN FIX. The defaults passed by audit-retention.sh (clinical 10 years,
-- !! access 2 years) are starting points oriented on § 630f BGB's
-- !! documentation horizon and common access-log practice; the operating
-- !! organisation's data-protection officer must confirm them before this
-- !! script is scheduled.
--
-- Must run as varlens_audit_owner (SET ROLE) or a superuser: the append-only
-- triggers block DELETE for everyone, so retention disables them inside one
-- transaction, deletes expired rows per retention class, and re-enables
-- them. The application role cannot do this by design — do not "fix" that
-- by granting it ownership.
--
-- Two retention classes by action_type:
--   clinical-change — ACMG classifications, comments, tags, stars: part of
--     the clinical documentation trail (long retention).
--   access/activity — api_read/api_write/auth_*: employee activity data
--     (GDPR storage limitation applies; shorter retention).
--
-- Required psql variables:
--   clinical_retention_days, access_retention_days
--
-- Usage (or use scripts/postgres/audit-retention.sh):
--   psql "$ADMIN_PG_URL" \
--     -v clinical_retention_days=3650 -v access_retention_days=730 \
--     -f audit-retention.sql

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE varlens_audit.audit_log DISABLE TRIGGER audit_log_block_mutation;

DELETE FROM varlens_audit.audit_log
WHERE action_type IN (
    'api_read',
    'api_write',
    'auth_login_success',
    'auth_login_failure',
    'auth_logout',
    'auth_password_change',
    'auth_password_reset',
    'auth_user_deactivate'
  )
  AND created_at < (EXTRACT(EPOCH FROM now()) * 1000)::bigint
    - (:access_retention_days::bigint * 86400000);

DELETE FROM varlens_audit.audit_log
WHERE action_type IN (
    'acmg_classify',
    'acmg_evidence_update',
    'star',
    'unstar',
    'comment_add',
    'comment_edit',
    'comment_delete',
    'tag_assign',
    'tag_remove'
  )
  AND created_at < (EXTRACT(EPOCH FROM now()) * 1000)::bigint
    - (:clinical_retention_days::bigint * 86400000);

ALTER TABLE varlens_audit.audit_log ENABLE TRIGGER audit_log_block_mutation;

COMMIT;
