# PostgreSQL Migration Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL schema migration reliable, diagnosable, and safe for hosted/non-`public` schemas.

**Architecture:** Build on `PostgresMigrationRunner` and migration SQL files. Add stricter schema qualification checks, startup/open-profile migration diagnostics, and permission-aware error handling without changing SQLite behavior.

**Tech Stack:** TypeScript, `pg`, SQL migration files, Vitest, Playwright Electron, Dockerized PostgreSQL 18.

---

## Scope

This plan assumes the connection manager plan has introduced a UI/IPC path for opening PostgreSQL profiles. It focuses on migration correctness and hosted-schema behavior.

## Task 1: Migration Diagnostics Model

**Files:**

- Modify: `src/main/storage/postgres/migrations/types.ts`
- Modify: `src/shared/types/postgres-profile.ts`
- Test: `tests/main/storage/postgres-migration-runner.test.ts`

- [ ] **Step 1: Extend migration result shape**

Add fields to `PostgresMigrationResult`:

```ts
beforeVersion: string | null
currentVersion: string | null
applied: string[]
schema: string
```

Keep existing callers compiling by preserving `applied` and `currentVersion`.

- [ ] **Step 2: Return `beforeVersion` and `schema` from runner**

In `PostgresMigrationRunner.migrate()`, compute `beforeVersion` from already-applied migrations before applying pending migrations. Return the schema name used by the runner.

- [ ] **Step 3: Add tests**

Add assertions in `tests/main/storage/postgres-migration-runner.test.ts`:

- empty schema returns `beforeVersion: null`;
- partially migrated schema returns previous latest version;
- result contains `schema`.

Run:

```bash
npx vitest run tests/main/storage/postgres-migration-runner.test.ts
```

Expected: PASS.

## Task 2: Automatic Migration On PostgreSQL Session Open

**Files:**

- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Create or modify: `src/main/storage/postgres/createPostgresStorageSession.ts`
- Modify: `src/main/ipc/handlers/database-logic.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`
- Test: `tests/main/handlers/database-logic.test.ts`

- [ ] **Step 1: Add a focused session factory**

Create `src/main/storage/postgres/createPostgresStorageSession.ts` if no equivalent exists. It must:

- accept `PostgresStorageConfig`;
- create `pg.Pool`;
- run `PostgresMigrationRunner(pool, config.schema, POSTGRES_MIGRATIONS).migrate()`;
- construct `PostgresStorageSession`;
- close the pool if migration or construction fails.

- [ ] **Step 2: Expose migration result in session diagnostics**

Add a private `migrationResult` to `PostgresStorageSession` options. `collectDiagnostics()` must include the current migration version. If `collectDiagnostics()` does not currently exist, add it on the class because `database-logic.ts` already probes for it.

- [ ] **Step 3: Wire profile open to the session factory**

Update `openPostgresProfile` logic from the connection plan to use `createPostgresStorageSession(config)` instead of constructing `Pool` and `PostgresStorageSession` inline.

- [ ] **Step 4: Add tests**

Tests must verify:

- factory runs migrations before exposing the session;
- pool is closed on migration failure;
- profile open does not switch active session when migration fails;
- diagnostics include current migration version.

Run:

```bash
npx vitest run tests/main/storage/postgres-storage-session.test.ts tests/main/handlers/database-logic.test.ts
```

Expected: PASS.

## Task 3: Schema Qualification Guardrail

**Files:**

- Create: `tests/main/storage/postgres-migration-schema-qualification.test.ts`
- Modify: `src/main/storage/postgres/migrations/sql/*.sql` only if the test exposes an issue

- [ ] **Step 1: Add a static migration SQL test**

Create a test that reads every file under `src/main/storage/postgres/migrations/sql/` and fails if it finds unqualified DDL patterns for app tables. Allowed examples:

- `CREATE TABLE "__schema__"."table_name"`;
- `ALTER TABLE "__schema__"."table_name"`;
- `CREATE INDEX ... ON "__schema__"."table_name"`;
- generated function definitions that explicitly interpolate `"__schema__"`.

Disallowed examples:

- `CREATE TABLE cases`;
- `ALTER TABLE variants`;
- `CREATE INDEX ... ON variants`;
- `DROP TABLE cases`.

- [ ] **Step 2: Run the static test**

Run:

```bash
npx vitest run tests/main/storage/postgres-migration-schema-qualification.test.ts
```

Expected: PASS after fixing any unqualified SQL discovered.

## Task 4: Non-Public And Quoted Schema Tests

**Files:**

- Modify: `tests/main/storage/postgres-migration-runner.test.ts`
- Create: `tests/e2e/postgres-quoted-schema-dev-mode.e2e.ts`
- Modify: `docker-compose.postgres.yml` only if a new test role/db init is required

- [ ] **Step 1: Add unit coverage for quoted schemas**

Add migration runner unit tests using schemas:

- `workspace_a`;
- `Case Lab`;
- `clinical-1`.

Assert generated SQL uses `quoteIdentifier` output and does not inject raw schema text.

- [ ] **Step 2: Add Docker E2E**

Create an E2E that sets:

```bash
VARLENS_PG_SCHEMA='Case Lab'
```

It must connect, migrate, import or read seed data, and query variants without relying on `public`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npx vitest run tests/main/storage/postgres-migration-runner.test.ts
make build
VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_SCHEMA='Case Lab' npx playwright test tests/e2e/postgres-quoted-schema-dev-mode.e2e.ts --workers=1
```

Expected: PASS.

## Task 5: Permission-Aware Failure Messages

**Files:**

- Modify: `src/main/storage/postgres/PostgresHealthDiagnostics.ts`
- Modify: `src/main/storage/postgres/createPostgresStorageSession.ts`
- Test: `tests/main/storage/postgres-health-diagnostics.test.ts`

- [ ] **Step 1: Classify common PostgreSQL failures**

Map common `pg` error codes to user-safe messages:

- `28P01`: authentication failed;
- `3D000`: database does not exist;
- `42501`: insufficient privilege;
- `3F000`: schema does not exist;
- connection timeout and DNS errors: connection unavailable.

Never include password, full connection URL, or CA body.

- [ ] **Step 2: Add tests**

Add tests that pass fake errors through the classifier and assert the returned message is actionable and redacted.

Run:

```bash
npx vitest run tests/main/storage/postgres-health-diagnostics.test.ts
```

Expected: PASS.

## Plan Verification

After all tasks:

```bash
npx vitest run tests/main/storage/postgres-migration-runner.test.ts tests/main/storage/postgres-migration-definitions.test.ts tests/main/storage/postgres-migration-schema-qualification.test.ts tests/main/storage/postgres-health-diagnostics.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/handlers/database-logic.test.ts
make typecheck
make build
VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_SCHEMA='Case Lab' npx playwright test tests/e2e/postgres-quoted-schema-dev-mode.e2e.ts --workers=1
```

Commit:

```bash
git add src tests docker-compose.postgres.yml
git commit -m "feat(postgres): harden migration lifecycle"
```

