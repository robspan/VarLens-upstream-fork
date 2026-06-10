-- provision-audit-owner.sql — Tier 2 audit-trail tamper protection.
--
-- Run ONCE per database, AFTER the application has applied migration 0013,
-- with a superuser (or CREATEROLE + ownership-capable) connection — NOT the
-- application role. Idempotent.
--
-- Transfers ownership of the shared varlens_audit schema to a dedicated
-- NOLOGIN role and reduces the application role to INSERT + SELECT. With
-- this in place the application credential physically cannot UPDATE,
-- DELETE, TRUNCATE, drop the append-only triggers, or alter the table —
-- the property German "Revisionssicherheit" expectations assume. Without
-- this script the deployment is at Tier 1 (trigger-only protection, which
-- the table owner could disable).
--
-- Required psql variable:
--   app_role — the role the VarLens web server connects as (e.g. varlens)
--
-- Usage (or use scripts/postgres/provision-audit-owner.sh):
--   psql "$ADMIN_PG_URL" -v app_role=varlens -f provision-audit-owner.sql

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'varlens_audit_owner') THEN
    CREATE ROLE varlens_audit_owner NOLOGIN;
  END IF;
END;
$$;

ALTER SCHEMA varlens_audit OWNER TO varlens_audit_owner;
ALTER TABLE varlens_audit.audit_log OWNER TO varlens_audit_owner;
ALTER FUNCTION varlens_audit.reject_audit_mutation() OWNER TO varlens_audit_owner;

REVOKE ALL ON SCHEMA varlens_audit FROM PUBLIC;
REVOKE ALL ON varlens_audit.audit_log FROM PUBLIC;
REVOKE ALL ON varlens_audit.audit_log FROM :"app_role";
REVOKE ALL ON SEQUENCE varlens_audit.audit_log_id_seq FROM :"app_role";

GRANT USAGE ON SCHEMA varlens_audit TO :"app_role";
GRANT INSERT, SELECT ON varlens_audit.audit_log TO :"app_role";
GRANT USAGE, SELECT ON SEQUENCE varlens_audit.audit_log_id_seq TO :"app_role";

COMMIT;
