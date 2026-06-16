# Plan: Real-engine regression test for transcript-switch denormalization (issue #207)

Spec: `.planning/specs/2026-06-15-issue-207-transcript-switch-denormalization-regression.md`
Branch: `test/issue-207-postgres-transcript-switch-regression`

## Task 1 — Write the parameterized test file

Create `tests/main/storage/transcript-switch-denormalization.test.ts`.

- Header comment explaining the gap (real-engine behavioral check through the
  write-executor seam) and the run command, mirroring `storage-session-contract.test.ts`.
- `DENORM_COLUMNS` constant + `DenormFields` type for the seven denormalized columns.
- Transcript A/B/C fixture constants (per spec table).
- `BackendFixture` interface: `{ name, setup }` where `setup()` returns
  `{ session, seedVariantWithTranscripts, readVariantDenorm, cleanup }`.
- `setupSqlite`: `DatabaseService` on a temp-dir file db; `SqliteStorageSession`; seed via
  `cases.createCase` + `variants.insertVariantsBatch` (variant carries A's values) + raw
  `database.prepare(...)` inserts for transcripts A (selected) and B; read via raw
  `SELECT`. Cleanup closes + removes temp dir.
- `setupPostgres`: unique schema, `createPostgresStorageSession`; a dedicated `pg.Client`
  for seeding/readback (schema-qualified, explicit columns, no `search_document`).
  Coerce `id`/`hpo_sim_score` to `Number`. Cleanup closes session + drops schema.
- `fixtures = [sqlite, ...(POSTGRES_E2E ? [postgres] : [])]`.
- `describe.each(fixtures)` with two `it`s:
  1. `transcripts:switch` A→B updates all denormalized columns on `variants`.
  2. `transcripts:insertAndSwitch` of VEP-only C updates all denormalized columns.
- Add a `describe.skipIf(POSTGRES_E2E)` marker noting the Postgres half is gated, matching
  the sibling file.

## Task 2 — Verify SQLite half

- `make rebuild-node` (already done this session, re-run if needed).
- `npx vitest run --project main tests/main/storage/transcript-switch-denormalization.test.ts`.
- Expect: SQLite describe block passes; Postgres half skipped.

## Task 3 — Verify Postgres half (real container)

- `make pg-up` (container already running on 55434).
- `VARLENS_RUN_POSTGRES_E2E=1 VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55434/varlens_dev npx vitest run --project main tests/main/storage/transcript-switch-denormalization.test.ts`.
- Expect: both backends pass.

## Task 4 — Gates

- `make typecheck` clean.
- `make lint-check` + `make format-check` clean (or `make lint` / `make format` to fix).
- `make agent-check` (new file is well under 600 lines).

## Task 5 — Commit + PR

- Commit: `test(storage): add real-engine transcript-switch denormalization regression (#207)`.
- Push branch; open PR referencing #207 and PR #214 (the fix), explaining this hardens the
  already-shipped fix with the real-container coverage the issue requested.
- Include `.planning/` spec + plan in the same branch.

## Risk / rollback

- Pure test addition; no production code touched. If the Postgres half is flaky in an
  environment without the container, it is gated off by default and CI is unaffected.
