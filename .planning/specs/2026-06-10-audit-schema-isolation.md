# Audit Schema Isolation — Spec

**Status:** Draft 2026-06-10
**Predecessor:** branch `web/10-audit-contract` (PG audit contract + read-by-default API auditing)
**Motivating review:** in-session compliance review of `web/10-audit-contract` (2026-06-10) — gaps: audit trail not tamper-evident, audit rows die with their project schema, no retention concept, audit log readable by every authenticated user.

## Goal

Move the PostgreSQL audit trail out of the per-project schema into a single privilege-isolated `varlens_audit` schema per database, so that:

1. the trail is **tamper-evident** (the application role physically cannot `UPDATE`/`DELETE`/`TRUNCATE` audit rows),
2. the trail **survives project deletion** (dropping a project schema no longer drops its access history),
3. **retention** becomes enforceable by a privileged maintenance path the app does not have,
4. audit reads in web mode are **admin-gated**.

The decisive design constraint: audit writes must stay **in the same transaction** as the change they document. That is why this is a same-instance schema split, not a separate database — `INSERT INTO varlens_audit.audit_log` participates in the annotation transaction in `PostgresAnnotationsRepository` exactly as the per-schema insert does today. A remote/central audit DB is explicitly rejected (dual-write atomicity loss, availability coupling, desktop offline model); cross-instance aggregation, if ever needed, is async log *shipping out of* this schema (Non-goals).

### Threat-model honesty (two tiers)

- **Tier 1 — app-applied (migration 0013):** `BEFORE UPDATE OR DELETE` row trigger + `BEFORE TRUNCATE` statement trigger that `RAISE EXCEPTION`. Protects against application bugs, injected SQL through the app role, and casual mutation. Does **not** protect against a hostile actor holding the table-owner credential (the owner can disable triggers).
- **Tier 2 — deployment-applied (provisioning script, DBA-run):** a separate `varlens_audit_owner` role owns the schema/table/trigger function; the application role is reduced to `INSERT` + `SELECT`. Only with Tier 2 in place is the trail tamper-evident against the app credential itself. Tier 2 cannot be guaranteed from app-run migrations (requires `CREATEROLE`/superuser), so it ships as a documented provisioning step, and the compliance documentation must state that Revisionssicherheit claims depend on it.

## Audience

A coding agent executing this spec one task at a time on branch `web/11-audit-schema-isolation`, against the conventions in `AGENTS.md`.

## In scope

| ID | Title | Rationale |
|---|---|---|
| **AS-1** | **Migration `0013_central_audit_schema.sql`** (register in `src/main/storage/postgres/migrations/definitions.ts` as `{ version: '0013', name: 'central_audit_schema' }`). Contents, in order: (a) `pg_advisory_xact_lock` on a fixed key so concurrent per-schema migration runs don't race the shared-schema DDL; (b) `CREATE SCHEMA IF NOT EXISTS varlens_audit`; (c) `CREATE TABLE IF NOT EXISTS varlens_audit.audit_log` — same columns as `0006_create_audit_log.sql` + `0012` CHECK constraints, **plus `project_schema TEXT NOT NULL`**; same four indexes, each additionally leading with or including `project_schema` where the query path filters on it (`(project_schema, entity_key, created_at DESC)`, `(project_schema, action_type, created_at DESC)`, `(project_schema, entity_type, created_at DESC)`, `(project_schema, created_at DESC)`); (d) trigger function `varlens_audit.reject_audit_mutation()` raising `audit_log is append-only`, wired as `BEFORE UPDATE OR DELETE FOR EACH ROW` and `BEFORE TRUNCATE FOR EACH STATEMENT` on the table (`CREATE OR REPLACE` / drop-and-recreate trigger for idempotency); (e) a `DO` block guarded by `to_regclass('"__schema__"."audit_log"')`: copy all legacy rows into the central table stamped `project_schema = '__schema__'` (literal schema name after template replacement), then `DROP TABLE "__schema__"."audit_log"`. Second run finds no legacy table and skips — idempotent by construction. | One shared trail per database; data preserved; tamper-evidence Tier 1; migration must survive the double-run real-instance idempotency test. |
| **AS-2** | **`PostgresAuditLogRepository` retarget.** `append` inserts into `varlens_audit.audit_log` with `project_schema` stamped from the constructor's `schema` argument (kept — it is the per-project discriminator per the multi-project design doc, mapping 1:1 onto `projects.schema_name`). `getByEntityKey` / `query` add `WHERE project_schema = $n` to every read so per-project views are unchanged. The audit-contract sanitization from `web/10-audit-contract` applies unchanged. | Same construction sites (`PostgresStorageSession`, `PostgresAnnotationsRepository` transactional path) keep working; transactional write property preserved verbatim. |
| **AS-3** | **Provisioning script `scripts/postgres/provision-audit-owner.sql`** + runner shell wrapper, DBA/superuser-run, idempotent: create `varlens_audit_owner` (NOLOGIN), `ALTER SCHEMA/TABLE/FUNCTION ... OWNER TO varlens_audit_owner`, `REVOKE ALL` then `GRANT INSERT, SELECT ON varlens_audit.audit_log TO <app role>` (app role name as a psql variable), `GRANT USAGE ON SCHEMA varlens_audit TO <app role>`, sequence grant for the `id` BIGSERIAL (`GRANT USAGE ON SEQUENCE`). Document in the web deployment docs (`docs/`, user-facing) as the step that upgrades Tier 1 → Tier 2, with the explicit statement that compliance claims about log immutability require it. | Tier 2 tamper-evidence; cannot live in app migrations. |
| **AS-4** | **Retention script `scripts/postgres/audit-retention.sql`** + wrapper, run with the owner credential (not the app role): `ALTER TABLE ... DISABLE TRIGGER` → class-based `DELETE` → `ENABLE TRIGGER`, in one transaction. Two retention classes by `action_type`: **clinical-change** (`acmg_classify`, `acmg_evidence_update`, `comment_*`, `tag_*`, `star`/`unstar`) default **10 years** (§ 630f BGB documentation horizon); **access/activity** (`api_read`, `api_write`, `auth_*`) default **2 years**, parameterized via psql variables. The script header must state that retention periods are deployment policy requiring DPO sign-off, not values this repo can fix. No scheduler in this phase — the script is the enforcement *mechanism*; scheduling is deployment-specific (Non-goals). | Storage-limitation for employee-activity data; GenDG/§ 630f clocks differ from access-log clocks; only the privileged path can delete. |
| **AS-5** | **Admin-gate audit reads in web mode.** Remove `audit:getByEntity` and `audit:query` from `READ_TASK_TYPES` in `src/web/server/task-types.ts`; add a `buildAuditOverrides()` in `src/web/server/routes/audit-log.ts` that wraps the same read-executor tasks behind an admin check (hoist `requireAdmin` from `routes/auth.ts` into a shared helper next to `routes/types.ts` rather than duplicating it). Non-admin gets 403. The override keys remain subject to read-auditing (`shouldAuditApiRead`) — reading the audit log is itself an auditable access. Desktop IPC handlers unchanged (single-user). | Audit rows are employee-monitoring data (§ 26 BDSG territory); every clinical user could read colleagues' login failures today. |
| **AS-6** | **Renderer: hide `ActivityLogPanel` for non-admins in web mode.** Gate on the current user's role from the auth store/`auth:currentUser`; desktop behavior unchanged. Graceful empty-state if a 403 slips through anyway (no error toast loop). | UI must not advertise an endpoint that now 403s. |
| **AS-7** | **Tests.** (a) Extend `tests/main/storage/postgres-migrations-idempotent.test.ts` (real-PG, `VARLENS_RUN_POSTGRES_E2E=1`): after first run, `varlens_audit.audit_log` exists, project-schema `audit_log` is gone, a legacy row seeded before 0013 (insert it between 0012 and 0013 via the runner hook or a two-stage apply) appears centrally with the correct `project_schema`; double-run snapshot still identical. (b) New real-PG immutability test: `UPDATE`, `DELETE`, `TRUNCATE` against `varlens_audit.audit_log` as the test role each raise. (c) `tests/main/storage/postgres-audit-log-repository.test.ts`: mock-pool assertions that SQL targets `varlens_audit."audit_log"` and stamps/filters `project_schema`. (d) Web-gate dispatcher test: `audit:query` returns 403 for `role: 'user'`, succeeds for `role: 'admin'`, and still produces an `api_read` audit row for the admin. | Behavior-boundary coverage per AGENTS.md; immutability is the load-bearing claim and must be proven against a real engine, not a mock. |
| **AS-8** | **Docs note in `docs/` (web deployment page):** one section covering the audit schema, the two-tier model, the provisioning step, and the retention script with its DPO caveat. Planning-internal rationale stays in this spec; only operator-facing instructions go to `docs/`. | Deployments that skip AS-3 must be able to discover that they are at Tier 1. |

## Non-goals (defer — each needs its own spec)

- **Read-audit granularity** (record *which* case/sample a read touched, not just the method name) — the biggest remaining compliance gap from the motivating review; touches the dispatcher arg model and the sanitization contract. Own spec.
- **Clinical-content versioning** (§ 630f original-content recoverability for edited/deleted comments and ACMG evidence) — belongs in the annotation tables as history rows, **not** in the audit log (data minimization). Own spec.
- **Async export / WORM shipping** of `varlens_audit` to append-only storage, and any cross-instance aggregation. Bolts onto this design later; nothing in this phase may preclude it.
- **Retention scheduling** (cron/systemd/k8s Job) — deployment-specific; this phase ships the mechanism only.
- **Desktop (SQLite) tamper-proofing** — single-user offline app, user owns the disk; divergence is documented as an accepted residual risk, the shared audit contract types stay identical.
- **`user_name` → stable user-id attribution** — needs an auth-schema decision; tracked, not blocking.

## Acceptance gates

1. `VARLENS_WEB=1 make ci` green on the PR branch.
2. `VARLENS_RUN_POSTGRES_E2E=1` migration idempotency suite green against a real Postgres (`make pg-up`), including the new 0013 assertions (AS-7a).
3. Immutability test (AS-7b) proves `UPDATE`/`DELETE`/`TRUNCATE` raise on `varlens_audit.audit_log`.
4. Legacy audit rows from a pre-0013 schema are present in `varlens_audit.audit_log` with correct `project_schema` after migration; the per-schema table no longer exists.
5. Dispatcher test (AS-7d): non-admin `audit:query` → 403; admin succeeds and the access is itself read-audited.
6. Annotation upsert tests still pass unchanged — proving the transactional change+audit write survived the retarget (AS-2).
7. `make agent-check` passes; no touched file crosses the 600-line bar.

## PR shape

One PR, one branch.

| PR | Branch | Tasks | Title |
|---|---|---|---|
| **PR-1** | `web/11-audit-schema-isolation` | AS-1 … AS-8 | `feat(web): isolate audit trail in privileged varlens_audit schema` |

If review finds AS-5/AS-6 (access control) inflating the diff, they may split into a follow-up PR `web/12-audit-read-gating` — the schema move (AS-1…AS-4, AS-7a-c, AS-8) is the atomic core.
