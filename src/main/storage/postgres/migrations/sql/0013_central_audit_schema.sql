-- 0013_central_audit_schema.sql
--
-- Moves the audit trail out of the per-project schema into one shared
-- `varlens_audit` schema per database:
--
--   * the trail survives DROP SCHEMA on a project (access history must
--     outlive the data it documents),
--   * UPDATE / DELETE / TRUNCATE are rejected by triggers (Tier 1
--     tamper-evidence; Tier 2 ownership separation is applied by
--     scripts/postgres/provision-audit-owner.sh, see the spec
--     .planning/specs/2026-06-10-audit-schema-isolation.md),
--   * retention is enforceable only by the owner role
--     (scripts/postgres/audit-retention.sh).
--
-- Concurrency: PostgresMigrationRunner holds pg_advisory_xact_lock(928714, 0)
-- for the whole migration transaction, so the shared-schema DDL below cannot
-- race a concurrent per-schema migration run. No extra lock is needed here.
--
-- Privilege tolerance: after Tier 2 provisioning the application role no
-- longer owns the varlens_audit objects, so this migration (running for a
-- NEW project schema on an already-provisioned database) must skip — not
-- replace — the shared function and triggers. That is why the function and
-- trigger DDL below is guarded by existence checks instead of
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS.

CREATE SCHEMA IF NOT EXISTS varlens_audit;

CREATE TABLE IF NOT EXISTS varlens_audit."audit_log" (
  id BIGSERIAL PRIMARY KEY,
  project_schema TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN (
    'acmg_classify',
    'acmg_evidence_update',
    'star',
    'unstar',
    'comment_add',
    'comment_edit',
    'comment_delete',
    'tag_assign',
    'tag_remove',
    'auth_login_success',
    'auth_login_failure',
    'auth_logout',
    'auth_password_change',
    'auth_password_reset',
    'auth_user_deactivate',
    'api_read',
    'api_write'
  )),
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'variant_annotation',
    'case_variant_annotation',
    'user_account',
    'api_call'
  )),
  entity_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  user_name TEXT,
  metadata_json TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT
);

CREATE INDEX IF NOT EXISTS idx_varlens_audit_entity
  ON varlens_audit."audit_log"(project_schema, entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_varlens_audit_action
  ON varlens_audit."audit_log"(project_schema, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_varlens_audit_entity_type
  ON varlens_audit."audit_log"(project_schema, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_varlens_audit_created_at
  ON varlens_audit."audit_log"(project_schema, created_at DESC);

DO $do$
BEGIN
  IF to_regprocedure('varlens_audit.reject_audit_mutation()') IS NULL THEN
    CREATE FUNCTION varlens_audit.reject_audit_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'varlens_audit.audit_log is append-only (% blocked)', TG_OP;
    END;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_trigger
    WHERE tgname = 'audit_log_block_mutation'
      AND tgrelid = 'varlens_audit.audit_log'::regclass
  ) THEN
    CREATE TRIGGER audit_log_block_mutation
      BEFORE UPDATE OR DELETE ON varlens_audit."audit_log"
      FOR EACH ROW EXECUTE FUNCTION varlens_audit.reject_audit_mutation();
  END IF;

  IF NOT EXISTS (
    SELECT FROM pg_trigger
    WHERE tgname = 'audit_log_block_truncate'
      AND tgrelid = 'varlens_audit.audit_log'::regclass
  ) THEN
    CREATE TRIGGER audit_log_block_truncate
      BEFORE TRUNCATE ON varlens_audit."audit_log"
      FOR EACH STATEMENT EXECUTE FUNCTION varlens_audit.reject_audit_mutation();
  END IF;
END;
$do$;

-- Copy this project schema's legacy audit rows into the central table,
-- stamped with the schema name, then drop the per-schema table. The schema
-- name is derived from the regclass because the runner only interpolates
-- the quoted-identifier form of the placeholder; relative row order is
-- preserved via ORDER BY id (new central ids are assigned by the sequence).
-- A second run finds no legacy table and skips — idempotent by construction.
DO $do$
DECLARE
  legacy_table regclass := to_regclass('"__schema__"."audit_log"');
  legacy_schema text;
BEGIN
  IF legacy_table IS NULL THEN
    RETURN;
  END IF;

  SELECT n.nspname INTO legacy_schema
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = legacy_table;

  INSERT INTO varlens_audit."audit_log"
    (project_schema, action_type, entity_type, entity_key,
     old_value, new_value, user_name, metadata_json, created_at)
  SELECT legacy_schema, action_type, entity_type, entity_key,
         old_value, new_value, user_name, metadata_json, created_at
  FROM "__schema__"."audit_log"
  ORDER BY id;

  DROP TABLE "__schema__"."audit_log";
END;
$do$;
