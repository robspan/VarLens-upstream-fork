# PostgreSQL Product Parity Spec

**Date:** 2026-04-30  
**Branch:** `feat/postgres-final-parity`  
**Motivation:** Follow-up to `.planning/code-review/CODEBASE-REVIEW-2026-04-28-POSTGRESQL-ROADMAP.md` after `v0.58.3`.

## Goal

Make PostgreSQL a first-class VarLens workspace backend, not an environment-gated developer mode. A clinical user should be able to connect to a PostgreSQL workspace from the app UI, run the same supported workflows as SQLite, and have VarLens manage schema readiness and diagnostics safely enough for hosted PostgreSQL.

## Current State

The `v0.58.3` branch closed the planned read/workflow parity gaps:

- clinical variant filters;
- cohort query/summary/carriers/gene burden;
- variant and cohort export;
- audit log;
- Shortlist;
- active PostgreSQL workspace display in the database picker;
- Dockerized PostgreSQL 18 smoke and E2E coverage.

Remaining gaps are productization gaps:

- PostgreSQL connection is still driven by `VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres`, `VARLENS_PG_URL`, and `VARLENS_PG_SCHEMA`.
- The database picker has SQLite file actions only.
- `PostgresProfileStore` exists, but it is not connected to IPC or renderer UI.
- `PostgresMigrationRunner` exists, but the UI connection path must make migration, version reporting, and failure handling explicit.
- Hosted/cloud PostgreSQL behavior is not yet validated against non-`public` schemas, least-privilege roles, SSL verification, and clean diagnostic failures.
- WGS query readiness must be backed by query benchmark evidence before public claims.

## Non-Goals

- Do not replace local encrypted SQLite as the default offline backend.
- Do not build multi-tenant server functionality. VarLens remains a desktop client.
- Do not add cloud provider-specific SDKs.
- Do not store PostgreSQL passwords or CA certificates in plaintext settings files.
- Do not claim WGS query readiness until the benchmark plan is executed and reviewed.

## Product Requirements

### Connection Manager

Users can open a PostgreSQL workspace from the existing database picker.

Required fields:

- display name;
- host;
- port;
- database;
- username;
- password;
- schema;
- SSL mode: `disable` or `require-verify`;
- optional CA certificate PEM text or file import;
- connection timeout;
- statement timeout;
- lock timeout;
- idle-in-transaction timeout;
- pool size.

Required actions:

- test connection without switching the active workspace;
- save profile;
- connect to saved profile;
- remove saved profile;
- show clear redacted connection details in the database picker;
- keep SQLite open/create/delete/rekey actions unchanged.

The UI must not expose raw PostgreSQL passwords after save.

### Storage Lifecycle

The storage manager must support PostgreSQL sessions from saved profiles:

- construct `PostgresStorageConfig` from public profile plus secrets;
- open a PostgreSQL session with safe rollback if connection or migration fails;
- close the previous session only after the new PostgreSQL session is ready;
- add saved PostgreSQL profiles to the same recent workspace list or an equivalent picker section with a distinct `postgres:` identity;
- make `database.info()` return a PostgreSQL workspace display object that the renderer can show without treating it as a local file.

### Migration Lifecycle

The app must treat migrations as part of PostgreSQL workspace connection, not as a separate manual operation:

- create schema if the profile role has rights;
- create and read `"schema_migrations"`;
- apply forward-only migrations with checksums;
- fail clearly on unknown future migrations or checksum mismatch;
- expose current migration version in diagnostics;
- support non-`public` schemas, including schema names that require quoting;
- avoid relying on ambient `search_path`.

Destructive migrations are out of scope for this tranche. Any future destructive migration must be explicitly documented and gated.

### Hosted Schema Security

The app must be safe against common hosted PostgreSQL mistakes:

- all SQL created by migrations and runtime repositories must schema-qualify objects;
- diagnostics must distinguish connection failure, authentication failure, permission failure, missing schema, migration failure, and unsupported server version where possible;
- password and CA certificate are stored only through the configured secret store abstraction;
- logs must use redacted connection strings and must not log credentials or certificate bodies;
- Electron security defaults remain unchanged.

### Dev Tooling And Verification

Developers must be able to run a populated local PostgreSQL 18 workspace and monkey test it from the app:

- `make pg-reset`;
- `make pg-up`;
- seed data used by PostgreSQL E2Es;
- dev command with PostgreSQL profile or env fallback documented in `.planning`;
- E2E tests that prove connection UI, migration, data load, and key workflows against Dockerized PostgreSQL.

### WGS Query Readiness

WGS query readiness is an evidence project, not a default release blocker:

- download or reuse the WGS fixture with `scripts/postgres/download-wgs-fixture.sh`;
- reset and populate Dockerized PostgreSQL;
- run `make pg-query-perf`;
- record benchmark artifacts under `.planning/artifacts/perf/postgres-query/`;
- compare p50/p95 query timings against explicit budgets;
- decide follow-up indexes only from benchmark evidence.

## Architecture

### IPC

Extend the existing database domain:

- shared contract in `src/shared/ipc/domains/database.ts`;
- preload binding in `src/preload/domains/database.ts`;
- main handlers in `src/main/ipc/handlers/database.ts`;
- pure handler logic in `src/main/ipc/handlers/database-logic.ts`.

New PostgreSQL operations must return `IpcResult<T>` and validate parameters at the IPC boundary.

### Main Process

Use existing storage pieces:

- `PostgresProfileStore` for public profile metadata and secrets;
- `buildPostgresStorageConfigFromProfile` for connection config;
- `PostgresMigrationRunner` and `POSTGRES_MIGRATIONS` for schema readiness;
- `PostgresStorageSession` for active backend sessions;
- `DatabaseManager.openPostgresSession` or a new rollback-safe variant for switching.

Add small focused services only where needed:

- profile validation/schema;
- profile lifecycle wrapper;
- connection tester;
- migration diagnostics if current diagnostics cannot represent connection-time failures clearly.

### Renderer

Extend the existing database picker rather than adding a separate landing page:

- a PostgreSQL section below recent SQLite databases;
- icon-only actions where possible;
- a focused connection dialog for PostgreSQL create/edit/test/connect;
- clear status and validation errors;
- no feature-explainer text blocks inside the app.

### Testing Strategy

Each plan must include:

- focused Vitest tests for IPC contracts and pure logic;
- storage-level tests with mocked `pg` pool/client where possible;
- renderer component/store tests for UI behavior;
- Dockerized PostgreSQL 18 E2Es for connection, migration, and key workflows;
- `make typecheck` after each plan;
- final `make ci` and gated PostgreSQL E2E pass before any release claim.

## Execution Order

1. PostgreSQL connection manager UI and persisted profile lifecycle.
2. Migration lifecycle and hosted schema hardening.
3. Hosted verification and developer monkey-test tooling.
4. WGS query readiness evidence.

The first three are required before claiming broad PostgreSQL product parity. The fourth is required only before claiming WGS query readiness.

## Acceptance Criteria

Product parity may be claimed when:

- a user can connect to PostgreSQL from the UI without environment variables;
- saved PostgreSQL profiles survive app restart;
- passwords and CA certificates are not written to settings JSON;
- connection test and connect failures are actionable and redacted;
- migrations run automatically on connect and report current version;
- non-`public` schemas pass unit and Dockerized E2E coverage;
- core workflows still pass in PostgreSQL E2E: import/read/filter/shortlist/cohort/export/audit;
- `make ci` passes;
- release notes avoid WGS query claims unless the WGS benchmark plan has been executed.

