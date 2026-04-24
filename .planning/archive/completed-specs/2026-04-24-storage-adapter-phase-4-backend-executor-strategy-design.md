# Storage Session Boundary Phase 4: Backend-Specific Executor Strategy

**Date:** 2026-04-24  
**Status:** Proposed Phase 4 spec  
**Depends on:** [`2026-04-23-storage-adapter-boundary-design.md`](./2026-04-23-storage-adapter-boundary-design.md)  
**Previous phase:** [`2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-design.md`](./2026-04-23-storage-adapter-phase-3-cases-list-vertical-slice-design.md) implemented and verified  
**Recommendation:** Introduce a backend-specific read executor under `StorageSession`, keep file-backed workers explicitly SQLite-only for now, and use `cases:query` as the next vertical slice

## Summary

Phase 3 proved that `StorageSession` can carry one real dual-backend slice through `cases:list`.

Phase 4 should address the next architectural pressure point: **execution strategy still lives mostly outside the session boundary**. SQLite read offload is still driven by `DbPool` and `db-worker`, many handlers still branch on `getDbPool()` vs `getDb()`, and all current background worker paths still assume a local SQLite file plus optional encryption key.

The Phase 4 design is:

- keep `StorageSession` as the lifecycle owner
- add a backend-specific **read executor** owned by the session
- migrate one parameterized read slice through that executor
- preserve compatibility for legacy SQLite pooled-read paths that still depend on `getDbPool()`
- leave write workers and file-backed worker contracts explicitly SQLite-only
- avoid any claim that repositories or workers are broadly portable yet

The recommended next vertical slice is **`cases:query`**, not `database:overview` and not a write path.

## Why Phase 4 exists

The active boundary spec deliberately placed the seam above `DatabaseService`, not below it. That decision was correct, but Phase 3 only exercised the seam through one explicit session method.

The current codebase still has two execution models:

1. explicit session methods such as `listCases()`
2. ad hoc handler-level branching between raw `DatabaseService`, `DbPool`, and file-backed workers

That split is now the main architectural inconsistency.

If Phase 4 does not address it, later slices will keep reintroducing SQLite-specific execution details at the IPC layer. That would weaken the value of the storage-session boundary even if PostgreSQL repositories continue to grow.

## Design goals

1. Keep SQLite stable as the default and best-supported backend.
2. Move read execution ownership closer to `StorageSession`.
3. Preserve the current `DbPool` value for SQLite instead of replacing it prematurely.
4. Give PostgreSQL a first honest path for parameterized read execution without `DbPool`.
5. Preserve existing SQLite worker-thread settings and pooled-read behavior during the migration.
6. Keep write workers explicit about their SQLite/file-backed assumptions.
7. Pick a next slice that is locally testable with the current dev PostgreSQL setup.
8. Avoid broad repository portability claims and avoid generic "one abstraction solves everything" design.

## Non-goals

- No broad portability for the existing SQLite repositories.
- No attempt to make `db-worker.ts` or `worker-db.ts` backend-neutral in Phase 4.
- No migration of import, delete, export, or summary-rebuild workers to PostgreSQL.
- No renderer-facing backend switcher UI.
- No replacement of the current PostgreSQL session metadata/config shape.
- No broad conversion of every pooled read path in one phase.

## Current codebase anchors

Phase 4 is grounded in these current files:

- [`src/main/storage/session.ts`](../../src/main/storage/session.ts)
- [`src/main/storage/sqlite/SqliteStorageSession.ts`](../../src/main/storage/sqlite/SqliteStorageSession.ts)
- [`src/main/storage/postgres/PostgresStorageSession.ts`](../../src/main/storage/postgres/PostgresStorageSession.ts)
- [`src/main/services/DatabaseManager.ts`](../../src/main/services/DatabaseManager.ts)
- [`src/main/ipc/handlers/cases.ts`](../../src/main/ipc/handlers/cases.ts)
- [`src/main/ipc/handlers/cases-logic.ts`](../../src/main/ipc/handlers/cases-logic.ts)
- [`src/main/ipc/handlers/database-logic.ts`](../../src/main/ipc/handlers/database-logic.ts)
- [`src/main/ipc/dbPoolManager.ts`](../../src/main/ipc/dbPoolManager.ts)
- [`src/main/database/DbPool.ts`](../../src/main/database/DbPool.ts)
- [`src/main/workers/db-worker.ts`](../../src/main/workers/db-worker.ts)
- [`src/main/workers/db-worker-dispatch.ts`](../../src/main/workers/db-worker-dispatch.ts)
- [`src/main/workers/worker-db.ts`](../../src/main/workers/worker-db.ts)
- [`src/main/workers/import-worker.ts`](../../src/main/workers/import-worker.ts)
- [`src/main/workers/delete-worker.ts`](../../src/main/workers/delete-worker.ts)
- [`src/main/workers/export-worker.ts`](../../src/main/workers/export-worker.ts)
- [`src/main/workers/rebuild-summary-worker.ts`](../../src/main/workers/rebuild-summary-worker.ts)

These are the files where backend-specific execution is currently real, not hypothetical.

## Current execution inventory

### Session-backed today

- `cases:list` already routes through `StorageSession.listCases()`
- `SqliteStorageSession.listCases()` preserves current SQLite behavior by using `DbPool` when present and direct repository access otherwise
- `PostgresStorageSession.listCases()` uses a backend-specific PostgreSQL repository

This is the proven Phase 3 pattern.

### Still SQLite-pool-bound

The following read paths still branch on `getDbPool()` and depend on SQLite `DbTask` dispatch:

- `cases:query`
- `cases:availableBuilds`
- `database:overview`
- pooled read paths in variants, cohort, annotations, tags, case metadata, transcripts, gene lists, region files
- association data building via `AssociationEngine`

The important architectural point is not the count of those handlers. It is that **the execution decision is still made outside the session boundary**.

There is also an immediate migration constraint:

- many of these handlers still receive `HandlerDependencies.getDbPool`
- today that path is wired through the `dbPoolManager` singleton
- Phase 4 must not break those call sites while only one slice (`cases:query`) is being migrated

That means pool ownership can move toward the session boundary, but legacy pooled-read consumers need a compatibility bridge until they migrate.

### Still SQLite-file-bound

These worker paths still require `dbPath` and optional `encryptionKey`:

- import worker client + `import-worker.ts`
- delete worker launch from `cases-logic.ts` + `delete-worker.ts`
- export worker client + `export-worker.ts`
- deferred summary rebuild worker + `rebuild-summary-worker.ts`
- shared worker helpers in `worker-db.ts`

All of them open SQLite directly through `better-sqlite3-multiple-ciphers`. None of them have a credible PostgreSQL equivalent yet.

## Candidate approaches

### Option 1: keep adding per-slice session methods

Example direction:

- `session.queryCases(...)`
- `session.getDatabaseOverview()`
- `session.listTags()`

Pros:

- minimal new abstraction
- follows the successful `listCases()` precedent
- very low migration risk for one or two slices

Cons:

- scales poorly across the many existing pooled read paths
- turns `StorageSession` into a growing bag of unrelated slice methods
- does not address the architectural reality that read execution itself needs a home

Conclusion:

- acceptable for isolated slices
- not the best Phase 4 move

### Option 2: add a backend-specific read executor under `StorageSession`

Example direction:

- `StorageSession` owns a `StorageReadExecutor`
- handlers resolve the active session, then execute migrated read tasks through that executor
- SQLite executor wraps `DbPool` plus direct `DatabaseService` fallback
- PostgreSQL executor dispatches to backend-specific repositories/query services

Pros:

- matches the current code shape better than generic repository portability
- centralizes execution ownership without tearing out SQLite internals
- lets future slices migrate through one repeatable pattern
- keeps PostgreSQL honest by implementing only the tasks it actually supports

Cons:

- introduces one more layer
- requires compatibility work around current `DbPool` access

Conclusion:

- best fit for Phase 4
- recommended

### Option 3: jump directly to generalized worker/read-write orchestration

Example direction:

- define one broad backend-neutral executor for reads and writes
- migrate worker launches, import, delete, export, and summary rebuild in the same phase

Pros:

- looks architecturally complete on paper

Cons:

- far too much hidden scope for the current codebase
- write workers are still fundamentally SQLite-file-shaped
- would destabilize the working SQLite app for little immediate validation value

Conclusion:

- not appropriate for Phase 4

## Proposed Phase 4 architecture

### 1. Introduce a session-owned read executor

Phase 4 should add a narrow, typed read executor concept under `StorageSession`.

Recommended shape:

```ts
export type StorageReadTask =
  | {
      type: 'cases:query'
      params: ValidatedCaseSearchParams
    }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
```

Important constraint:

- this is **not** a generic SQL executor
- this is **not** a promise that every existing `DbTask` is portable
- this is only the backend-neutral home for migrated read slices

### 2. Keep `StorageSession` as the owning boundary

`StorageSession` should own read execution rather than forcing IPC handlers to reason about pool vs direct access.

Recommended near-term session addition:

```ts
export interface StorageSession {
  readonly workspace: WorkspaceRef
  readonly capabilities: StorageCapabilities

  listCases(): Promise<Case[]>
  getReadExecutor(): StorageReadExecutor
  getDatabaseService(): DatabaseService
  getDbPool(): DbPool | null
  getEncryptionKey(): string | undefined
  needsStartupRebuild(): boolean
  rekey(newPassword: string): void
  close(): Promise<void>
  health(): Promise<StorageHealth>
}
```

`listCases()` stays in place because it is already shipped. The new executor is for the next class of migrated read slices.

Compatibility rule for Phase 4:

- direct compatibility methods such as `getDatabaseService()` and `getDbPool()` remain available
- new migrated slices should use `getReadExecutor()`
- legacy pooled-read handlers may continue to use `getDbPool()` until they migrate
- `HandlerDependencies.getDbPool` should resolve from the active session during the transition so SQLite pooled reads keep working

### 3. SQLite executor wraps the existing runtime, not a new runtime

The SQLite implementation should be explicit about what it preserves:

- `DbPool` remains the preferred off-thread read path
- direct `DatabaseService` calls remain the fallback
- `db-worker-dispatch.ts` remains authoritative for pooled task execution
- SQLite worker/pool initialization should be associated with the SQLite session lifecycle, not scattered across IPC handlers
- existing worker-thread count settings must continue to flow into the active SQLite pool
- wrong-password or failed-open flows must validate before a pool is initialized

This keeps SQLite stable while moving execution ownership closer to the session boundary.

### 4. PostgreSQL executor is direct and backend-specific

The PostgreSQL implementation should not emulate `DbPool`.

It should:

- live under `src/main/storage/postgres/`
- use the session-owned `pg.Pool`
- dispatch migrated tasks to explicit PostgreSQL repositories/query services
- throw or reject unsupported tasks clearly

That keeps the migration honest. Unsupported PostgreSQL tasks remain unsupported until their slice lands.

### 5. Worker/write execution remains explicitly SQLite-only

Phase 4 should not attempt to "port" these worker paths:

- import
- delete
- export
- summary rebuild

Instead, it should make their status more explicit:

- they are SQLite/file-backed execution paths
- they remain valid for SQLite sessions
- PostgreSQL sessions do not advertise them as supported

The important design move is architectural honesty, not premature cross-backend implementation.

Phase 4 should also add explicit capability-based guards for worker-backed operations so PostgreSQL sessions fail clearly with "SQLite-only in this phase" behavior instead of incidental unsupported-method exceptions.

### 6. Move the next migrated read slice through the executor

The next slice should be `cases:query`.

That means:

- `cases:query` handler stops making its own pool-vs-db decision
- it resolves the active session
- it calls `session.getReadExecutor().execute({ type: 'cases:query', params })`
- SQLite and PostgreSQL each implement the task their own way

This proves the executor pattern with a parameterized, user-visible read path.

PostgreSQL honesty rule for this slice:

- the PostgreSQL path must not silently ignore supported `CaseSearchParams` fields
- if Phase 4 does not implement a filter such as `cohort_ids` or `hpo_ids`, it must reject that request explicitly rather than returning wrong results
- if the Phase 4 PostgreSQL schema does not yet support full `CaseWithCohorts` parity, the plan must add that schema/bootstrap work explicitly or narrow the slice contract

## Why `cases:query` is the right next slice

### `cases:query`

Pros:

- directly adjacent to the already-migrated `cases:list` slice
- parameterized, paginated, and sorted, so it tests more of the executor shape than `cases:list`
- already has clear handler tests and an existing SQLite pool path
- easy to compare SQLite main-thread fallback, SQLite pooled execution, and PostgreSQL direct execution
- meaningful in normal app usage and locally testable

Cons:

- requires a PostgreSQL implementation for richer case payloads, not just raw `Case[]`
- may need one small PostgreSQL repository for cohort/metadata-enriched rows

Conclusion:

- recommended Phase 4 slice

### `database:overview`

Pros:

- narrower parameter surface
- exercises executor routing without pagination/search logic

Cons:

- less representative than `cases:query`
- mostly proves one summary query, not the broader executor pattern
- lower follow-on value for later cases-domain migration

Conclusion:

- good follow-up slice after `cases:query`
- not the best Phase 4 slice

### One narrow write path

The honest candidates are things like delete, import finalization, or summary rebuild, because those are where backend-specific worker pressure is strongest.

However, they are poor Phase 4 choices because:

- current implementations are tightly coupled to SQLite files, FTS rebuilds, and summary rebuild SQL
- they would force write-worker redesign before the read executor boundary is proven
- they would add a great deal of hidden scope to a phase that should stay narrow

Conclusion:

- document and isolate these paths
- do not make one the next slice

## SQLite-bound path inventory to carry forward

Phase 4 should explicitly record these as still SQLite-specific after completion:

- `DbPool` initialization and worker data currently require `dbPath` and `encryptionKey`
- `db-worker.ts` opens SQLite directly and applies SQLite PRAGMAs
- `worker-db.ts` provides only SQLite open/rebuild helpers
- import/delete/export/rebuild workers all assume direct file-backed SQLite access
- database lifecycle helpers still initialize pooled SQLite reads around open/create
- many read handlers still accept `getDbPool` as a compatibility dependency

That inventory is not a failure. It is the baseline for later worker/write phases.

## Testing strategy

Phase 4 must stay testable on this workstation.

Required test layers:

- unit tests for the new read executor contract
- SQLite executor tests for pooled and fallback read paths
- compatibility tests proving legacy `getDbPool()` consumers still reach the active SQLite session pool
- regression tests proving user-configured worker-thread settings still affect the SQLite pool
- PostgreSQL executor tests for `cases:query`
- PostgreSQL executor tests that verify unsupported `cases:query` filters fail explicitly if not implemented
- handler tests proving `cases:query` routes through the session-owned executor
- targeted local PostgreSQL integration test with the existing Docker-backed Phase 2 setup

Verification should be achievable with:

- `make rebuild-node`
- targeted `vitest` suites during development
- `make ci` before claiming the phase complete

## Phase 4 outcome

If Phase 4 succeeds:

- `StorageSession` remains the lifecycle boundary
- read execution gains a proper backend-specific home
- SQLite keeps its current strengths
- PostgreSQL gets one real parameterized read slice through the new pattern
- worker/write paths remain explicit technical debt rather than disguised portability

That is the right architectural position before any worker or write-path migration.
