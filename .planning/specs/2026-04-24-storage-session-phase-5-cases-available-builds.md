# Storage Session Boundary Phase 5: Cases Available Builds

**Date:** 2026-04-24  
**Status:** Proposed Phase 5 spec  
**Depends on:** [`2026-04-23-storage-adapter-boundary-design.md`](./2026-04-23-storage-adapter-boundary-design.md)  
**Previous phase:** [`2026-04-24-storage-adapter-phase-4-backend-executor-strategy-design.md`](../archive/completed-specs/2026-04-24-storage-adapter-phase-4-backend-executor-strategy-design.md) implemented and archived  
**Recommendation:** Migrate `cases:availableBuilds` through the session-owned storage read executor, add backend-aware tests that run in normal CI, and defer `database:overview` plus renderer storage settings until the runtime boundary is more complete.

## Summary

Phase 4 moved `cases:query` through `StorageSession.getReadExecutor()` and left legacy SQLite read consumers behind the compatibility `getDbPool()` bridge.

Phase 5 should continue the migration **domain by domain** rather than jumping to a broad storage UI or a cross-domain summary endpoint. The recommended first Phase 5 slice is `cases:availableBuilds`:

- it stays inside the already-active cases domain,
- it already has a SQLite `DbTask` worker path,
- it has a small return shape,
- it is used by cohort analysis setup but does not require renderer IPC changes,
- it can get a straightforward PostgreSQL implementation against the session-owned pool,
- it exercises the new executor pattern without expanding into database overview aggregation.

`database:overview` should wait. It is a useful later target, but it crosses cases, cohorts, tags, phenotypes, summary counters, and BigInt conversion. Migrating it now would make Phase 5 a database-summary project instead of a focused executor-migration slice.

Renderer storage settings should also wait. The runtime still has SQLite-only lifecycle, file-backed workers, import/export/delete paths, and partial PostgreSQL read coverage. A settings UI now would expose a backend switcher before the underlying behavior is ready enough to explain honestly to users.

## Goals

1. Continue storage migration through the session-owned read executor.
2. Keep the Phase 5 implementation inside the cases domain.
3. Preserve SQLite behavior, including pooled worker execution when a `DbPool` exists.
4. Add a PostgreSQL implementation for available genome builds.
5. Make unsupported backend gaps explicit through tests rather than UI promises.
6. Add backend-aware unit coverage that runs in the normal Vitest/CI path.
7. Leave renderer storage settings out of scope for this phase.

## Non-goals

- No renderer storage settings or backend switcher UI.
- No `database:overview` migration in this phase.
- No broad migration of variants, cohort, annotations, metadata, tags, transcripts, gene lists, or region-file read paths.
- No write-worker, import, export, delete, or summary-rebuild migration.
- No production PostgreSQL provisioning or hosted-connection UX.
- No attempt to make existing SQLite repositories portable by swapping drivers.

## Current codebase anchors

Phase 5 should be grounded in these files:

- [`src/main/storage/read-executor.ts`](../../src/main/storage/read-executor.ts)
- [`src/main/storage/sqlite/SqliteReadExecutor.ts`](../../src/main/storage/sqlite/SqliteReadExecutor.ts)
- [`src/main/storage/postgres/PostgresReadExecutor.ts`](../../src/main/storage/postgres/PostgresReadExecutor.ts)
- [`src/main/storage/postgres/PostgresStorageSession.ts`](../../src/main/storage/postgres/PostgresStorageSession.ts)
- [`src/main/ipc/handlers/cases.ts`](../../src/main/ipc/handlers/cases.ts)
- [`src/main/ipc/handlers/cases-logic.ts`](../../src/main/ipc/handlers/cases-logic.ts)
- [`src/main/ipc/handlers/database-logic.ts`](../../src/main/ipc/handlers/database-logic.ts)
- [`src/main/workers/db-worker-dispatch.ts`](../../src/main/workers/db-worker-dispatch.ts)
- [`src/main/database/CaseRepository.ts`](../../src/main/database/CaseRepository.ts)
- [`tests/main/storage/sqlite-read-executor.test.ts`](../../tests/main/storage/sqlite-read-executor.test.ts)
- [`tests/main/storage/postgres-read-executor.test.ts`](../../tests/main/storage/postgres-read-executor.test.ts)
- [`tests/main/handlers/cases-handlers.test.ts`](../../tests/main/handlers/cases-handlers.test.ts)

Current state:

- `cases:list` is session-backed through an explicit `StorageSession.listCases()` method.
- `cases:query` is executor-backed through `StorageReadTask`.
- `cases:availableBuilds` still branches in `cases-logic.ts` between `getDbPool()` and `getDb()`.
- `database:overview` still branches in `database-logic.ts` between `getDbPool()` and `getDb()`.
- `db-worker-dispatch.ts` already supports both `cases:availableBuilds` and `database:overview` for SQLite pooled reads.

## Candidate slices

### Recommended: `cases:availableBuilds`

Pros:

- Same domain as Phase 3 and Phase 4.
- Small task shape: no external params, returns `Array<{ build: string; caseCount: number }>`.
- Preserves existing SQLite pool behavior by forwarding the current `cases:availableBuilds` `DbTask`.
- PostgreSQL implementation is a simple grouped query over `cases.genome_build`.
- Handler migration removes one more `getDbPool()` dependency from the cases domain.
- Backend-aware tests can be mocked and included in normal CI without requiring Docker.

Cons:

- Less complex than `cases:query`, so it does not prove much new about parameter validation.
- Cohort view depends on it, so incorrect ordering or null-build behavior would be visible.

Decision:

- Use this as the first Phase 5 slice.
- Match SQLite semantics: group by stored `genome_build`, sort by descending count, and map `NULL` result rows to `GRCh38` after grouping.

### Defer: `database:overview`

Pros:

- Already has a SQLite pooled worker path.
- User-facing overview modal can benefit from backend-aware execution later.
- No input params, so the executor task shape is easy.

Cons:

- Crosses multiple repositories/services: cases, cohorts, tags, phenotypes, summary stats.
- Carries BigInt serialization behavior that must stay stable.
- PostgreSQL support would require a wider overview service or several backend-specific summary queries.
- Less aligned with the domain-by-domain migration rule.

Decision:

- Do not migrate `database:overview` in this first Phase 5 slice.
- Record it as a likely follow-up after the cases-domain executor migration is complete.

### Reject for Phase 5: broad read-task batch

Migrating all remaining `DbTask` read cases at once would reduce compatibility debt quickly on paper, but it would hide backend-specific query work behind a large mechanical change. That repeats the low-level-adapter mistake the storage boundary design already rejected.

Decision:

- Keep Phase 5 narrow.
- Prefer one proven backend-aware slice with tests over a broad task-union expansion.

## Proposed architecture

Extend the read executor one task at a time:

```ts
export type AvailableBuild = {
  build: string
  caseCount: number
}

export type StorageReadTask =
  | {
      type: 'cases:query'
      params: ValidatedCaseSearchParams
    }
  | {
      type: 'cases:availableBuilds'
      params: []
    }
```

SQLite behavior:

- `SqliteReadExecutor` forwards `cases:availableBuilds` to `DbPool.run({ type: 'cases:availableBuilds', params: [] })` when a pool exists.
- Without a pool, it falls back to `databaseService.cases.getAvailableGenomeBuilds()`.

PostgreSQL behavior:

- Add a focused PostgreSQL cases-domain repository for available builds.
- `PostgresReadExecutor` dispatches `cases:availableBuilds` to that repository.
- The SQL should quote the configured schema, group by raw `genome_build`, count rows, sort by descending count, and map `NULL` rows to `GRCh38` in TypeScript.

IPC behavior:

- `cases:availableBuilds` keeps the same IPC channel and renderer contract.
- `cases.ts` should resolve the active storage session and call `getAvailableBuilds(() => session)`.
- The handler should no longer use `getDb()` or `getDbPool()` for this read path.

## Backend-aware testing strategy

Required tests:

- Storage read-task contract test includes `cases:availableBuilds`.
- SQLite executor test proves pool dispatch.
- SQLite executor test proves direct `DatabaseService` fallback.
- PostgreSQL repository test proves SQL shape, schema quoting, null-build fallback, numeric conversion, and count ordering assumptions.
- PostgreSQL executor test proves dispatch to the PostgreSQL available-builds repository.
- Cases handler test proves `cases:availableBuilds` routes through the active session executor and does not touch `getDb()` or `getDbPool()`.

CI approach:

- Keep all required Phase 5 tests in Vitest unit tests so `npm run test`, `make test`, and the existing GitHub Actions `checks` job run them automatically.
- Do not require Docker PostgreSQL in the default CI path for this phase.
- A Docker-backed PostgreSQL integration test can be added later when the runtime has enough schema and fixture coverage to justify a stable CI service dependency.

## Renderer storage settings deferral

Renderer storage settings are explicitly deferred because the runtime is not ready to support a user-facing backend switcher:

- database open/create/rekey/delete lifecycle is still SQLite-file-based,
- import/export/delete/rebuild workers are still file-backed SQLite workers,
- only selected cases-domain reads support PostgreSQL,
- failure messaging for partial PostgreSQL mode is not yet user-facing,
- switching backends from the renderer would imply a support level the app does not have yet.

Phase 5 should improve the backend boundary without surfacing it as user preference UI.

## Acceptance criteria

Phase 5 is complete when:

- `cases:availableBuilds` is represented in `StorageReadTask`.
- `SqliteReadExecutor` handles `cases:availableBuilds` through the pool and fallback paths.
- `PostgresReadExecutor` handles `cases:availableBuilds` through a backend-specific PostgreSQL repository.
- `cases:availableBuilds` IPC routes through `StorageSession.getReadExecutor()`.
- Existing renderer/preload contracts remain unchanged.
- `database:overview` remains intentionally unmigrated and documented as a follow-up.
- Backend-aware tests run under normal `make test` / `make ci`.
- No renderer storage settings are added.

## Follow-up backlog

After Phase 5:

- evaluate `database:overview` as the next executor-backed read if overview-service scope is acceptable,
- continue migrating remaining cases-adjacent reads before moving into variant/cohort-heavy domains,
- design a PostgreSQL-compatible overview service only when enough component queries exist,
- revisit renderer storage settings after lifecycle, worker, and error-handling readiness are substantially higher.
