# PostgreSQL Parity Phase 6: Case Metadata and Cases Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed

**Completion note — 2026-04-24:** Implemented and merged via PR #176 (`refactor/postgres-parity-phase-6-case-metadata`). Fresh reconciliation check ran `make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/handlers/case-metadata-routing.test.ts` with 7 files and 38 tests passing.

**Goal:** Complete PostgreSQL parity for cases-query metadata filters and the `case-metadata:*` domain, validate it early against a running Docker PostgreSQL backend, and keep renderer PostgreSQL settings hidden.

**Architecture:** Use a Docker-first loop, then add a small backend-aware write executor beside the existing read executor and migrate one domain vertically. SQLite executors delegate to existing `DatabaseService` repositories; PostgreSQL executors delegate to a focused `PostgresCaseMetadataRepository`. `database:overview`, broad variants, import, export, delete, and summary rebuild remain deferred, but Phase 6 also produces the WGS-readiness notes needed to start Phase 7 immediately.

**Tech Stack:** Electron 40 main process IPC, TypeScript 6, `pg`, `better-sqlite3-multiple-ciphers`, Vitest, gated Docker PostgreSQL dev workflow, Playwright Electron E2E, `make rebuild-node`, `make typecheck`, `make ci`

---

## Reference Checks

Implementation details in this plan are pinned to primary documentation:

- Docker PostgreSQL init scripts in `/docker-entrypoint-initdb.d/` run on first database initialization in alphabetical order, so Phase 6 FK DDL must sort after `10-phase3-cases.sql`: https://docs.docker.com/guides/postgresql/advanced-configuration-and-initialization/
- node-postgres transactions must use one checked-out client; do not implement multi-statement transactions with separate `pool.query(...)` calls: https://node-postgres.com/features/transactions
- PostgreSQL sequences are independent objects; deterministic explicit-ID seed data must reset affected `BIGSERIAL` sequences with `setval(...)`: https://www.postgresql.org/docs/current/functions-sequence.html

## Parallelization Note

This plan is designed for maximum safe parallelism. When implementation starts, use `superpowers:subagent-driven-development` and dispatch workers by lane after Task 1 lands. Do not dispatch implementation agents during planning.

| Lane | Can start after | Write set | Commit prefix |
|---|---|---|---|
| A Docker/schema/E2E | Task 0 and Task 0A baseline smoke | `scripts/postgres/init-db/`, `tests/e2e/postgres-*.e2e.ts` | `test(e2e): ...` |
| B PostgreSQL repository | Task 1 | `src/main/storage/postgres/PostgresCaseMetadataRepository.ts`, repository tests | `feat(storage): ...` |
| C SQLite executors | Task 1; merge only with matching Task 4 session interface work | `src/main/storage/sqlite/`, SQLite storage tests | `refactor(storage): ...` |
| D PostgreSQL executor/session | Tasks 1 and 2 | `src/main/storage/postgres/PostgresReadExecutor.ts`, `PostgresWriteExecutor.ts`, `PostgresStorageSession.ts` | `refactor(storage): ...` |
| E IPC routing | Tasks 1, 3, and 4 | `src/main/ipc/handlers/case-metadata*`, handler tests | `refactor(ipc): ...` |
| F Cases filters | Task 2 Step 3 schema file exists | `PostgresCasesQueryRepository.ts`, cases query tests | `feat(storage): ...` |
| G WGS readiness notes | Task 2 schema/repository decisions are known | `.planning/artifacts/` or `.planning/docs/` only | `docs(planning): ...` |

The fastest implementation order is:

1. Land Task 0 and run Task 0A baseline Docker smoke.
2. Land Task 1 contract work.
3. Split Task 2 schema and repository work where useful; schema must use `11-phase6-case-metadata.sql`.
4. Run Task 3 and Task 4 in parallel, but merge them together or only after both backends implement `getWriteExecutor()`.
5. Run Task 5 IPC routing and Task 6 cases-filter parity in parallel after Task 2; Task 6 does not depend on IPC routing.
6. Run Task 0B/Lane G after Task 2 so WGS notes are grounded in the Phase 6 PostgreSQL schema/repository choices.
7. Run focused tests after every lane merge, then Docker E2E, then `make ci`.

## File Structure

### New Files

- `src/main/storage/case-metadata-types.ts` - backend-neutral case metadata parameter/result types shared by storage and IPC logic.
- `src/main/storage/write-executor.ts` - typed backend-neutral write task contract.
- `src/main/storage/sqlite/SqliteWriteExecutor.ts` - SQLite write executor delegating to `DatabaseService`.
- `src/main/storage/postgres/PostgresWriteExecutor.ts` - PostgreSQL write executor delegating to PostgreSQL repositories.
- `src/main/storage/postgres/PostgresCaseMetadataRepository.ts` - PostgreSQL implementation of case metadata reads and writes.
- `tests/main/storage/write-executor-contract.test.ts` - type contract tests for write tasks.
- `tests/main/storage/sqlite-write-executor.test.ts` - SQLite write executor tests.
- `tests/main/storage/postgres-case-metadata-repository.test.ts` - PostgreSQL repository tests using mocked `pg.Pool`.
- `tests/main/storage/postgres-write-executor.test.ts` - PostgreSQL write dispatch tests.
- `tests/main/handlers/case-metadata-routing.test.ts` - IPC registration tests that prove PostgreSQL routing uses the active storage session.
- `tests/e2e/postgres-case-metadata-dev-mode.e2e.ts` - gated Docker-backed E2E for case metadata.
- `scripts/postgres/init-db/11-phase6-case-metadata.sql` - Phase 6 PostgreSQL dev DDL that runs after `10-phase3-cases.sql` creates `cases`.

### Modified Files

- `src/main/storage/read-executor.ts` - add case metadata read tasks.
- `src/main/storage/session.ts` - expose `getWriteExecutor()`.
- `src/main/storage/sqlite/SqliteReadExecutor.ts` - dispatch case metadata read tasks.
- `src/main/storage/sqlite/SqliteStorageSession.ts` - construct the SQLite write executor.
- `src/main/storage/postgres/PostgresReadExecutor.ts` - dispatch case metadata read tasks.
- `src/main/storage/postgres/PostgresStorageSession.ts` - construct case metadata repository and write executor.
- `src/main/storage/postgres/PostgresCasesQueryRepository.ts` - support `cohort_ids` and `hpo_ids`.
- `src/main/ipc/handlers/case-metadata-logic.ts` - use storage session executors.
- `src/main/ipc/handlers/case-metadata.ts` - pass active session into logic functions.
- `scripts/postgres/init-db/20-phase3-seed-cases.sql` - seed metadata rows used by gated Docker E2E.
- `scripts/postgres/init-db/README.md` - document the Phase 6 init file and fresh-volume ordering.
- `tests/main/storage/read-executor-contract.test.ts` - add case metadata read task coverage.
- `tests/main/storage/sqlite-read-executor.test.ts` - add SQLite read dispatch coverage.
- `tests/main/storage/postgres-read-executor.test.ts` - add PostgreSQL read dispatch coverage.
- `tests/main/storage/postgres-storage-session.test.ts` - assert read/write executor routing.
- `tests/main/storage/storage-manager-compat.test.ts` - update mock sessions with `getWriteExecutor`.
- `tests/main/handlers/case-metadata-logic.test.ts` - update logic tests for executor dependencies.
- `tests/main/storage/postgres-cases-query-repository.test.ts` - replace unsupported-filter tests with parity tests.

### Explicitly Unchanged

- `src/main/ipc/handlers/database-logic.ts` - `database:overview` remains legacy SQLite pool/direct logic.
- `src/main/workers/import-worker.ts` - import remains SQLite-file-backed.
- `src/main/workers/export-worker.ts` - export remains SQLite-file-backed.
- `src/main/workers/delete-worker.ts` - delete remains SQLite-file-backed.
- `src/main/workers/rebuild-summary-worker.ts` - summary rebuild remains SQLite-file-backed.
- Renderer and preload storage settings - no PostgreSQL settings UI in Phase 6.

## Task 0: Start the Implementation Branch

**Files:**

- No source files

- [ ] **Step 1: Confirm base state**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected:

- Work starts from an understood branch.
- Existing local changes, including planning docs, are not overwritten.
- Implementation does not commit directly to `main`.

- [ ] **Step 2: Create the implementation branch**

Run:

```bash
git switch -c refactor/postgres-parity-phase-6-case-metadata
```

Expected:

- New branch `refactor/postgres-parity-phase-6-case-metadata`.
- All Phase 6 implementation commits are made on this branch.

## Task 0A: Docker-first Baseline Smoke

**Files:**

- No source files unless the existing Docker smoke is broken

Run this immediately after Task 0 has created the implementation branch.

- [ ] **Step 1: Reset and start the local PostgreSQL backend**

Run:

```bash
make pg-reset
make pg-up
```

Expected:

- Docker starts `docker-compose.postgres.yml`.
- PostgreSQL listens on `127.0.0.1:${VARLENS_PG_PORT:-55432}`.
- If Docker is unavailable, record this and continue with unit tests; do not mark Docker verification complete.

- [ ] **Step 2: Run the current gated PostgreSQL E2E**

Run:

```bash
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts
```

Expected:

- PASS against the running Docker PostgreSQL backend.
- This proves the branch starts from a working PostgreSQL runtime before Phase 6 expands schema and IPC coverage.

- [ ] **Step 3: Stop the local backend**

Run:

```bash
make pg-down
```

Expected:

- Docker PostgreSQL is stopped.

- [ ] **Step 4: Commit only if a baseline fix was required**

Run this only if Step 2 required a test or Docker bootstrap fix, and only on the implementation branch from Task 0:

```bash
git add docker-compose.postgres.yml scripts/postgres tests/e2e/postgres-cases-list-dev-mode.e2e.ts
git commit -m "test(e2e): keep postgres docker smoke runnable"
```

Expected:

- No commit if the existing Docker smoke already passes.

## Task 0B: WGS-readiness Inventory Artifact

**Files:**

- Create: `.planning/artifacts/postgres-parity-phase-6-wgs-readiness.md`

Run this artifact task after Task 2 schema/repository decisions are known, even though it is numbered with the branch/bootstrap work. It is planning-only and must not touch runtime files.

- [ ] **Step 1: Write the WGS-readiness artifact**

Create `.planning/artifacts/postgres-parity-phase-6-wgs-readiness.md` with these sections:

```markdown
# PostgreSQL WGS-readiness Inventory

**Date:** 2026-04-24
**Scope:** Planning artifact only; no runtime code changes.

## Variant Tables Required

- `variants`
- `variant_transcripts`
- `variant_frequency`
- `variant_sv`
- `variant_cnv`
- `variant_str`
- PostgreSQL replacement for SQLite FTS tables

## First Variant-read Slice

Implement `variants:typeCounts`, `variants:typesPresent`, and `variants:geneSymbols` before full `variants:query`.

Reason: these are small, user-visible, case-scoped queries that validate variant table shape and indexes before porting the full filter builder.

## Indexes To Evaluate

- `variants(case_id, variant_type)`
- `variants(case_id, gene_symbol)`
- `variants(case_id, chr, pos)`
- `variants(case_id, consequence)`
- `variants(case_id, func)`
- `variant_frequency(chr, pos, ref, alt)`
- extension table indexes on `variant_id`

## PostgreSQL Full-text Options

- `to_tsvector` generated/search column plus GIN index for basic text search
- trigram index for gene/HGVS-ish prefix/fuzzy lookups
- explicit degraded mode only if search is excluded from early PG beta

## Import Scale Blockers

- current import worker accepts `dbPath` and SQLite key
- current import SQL is synchronous better-sqlite3 statements
- current FTS trigger teardown/rebuild is SQLite-specific
- PostgreSQL bulk path needs `COPY` or batched `INSERT ... ON CONFLICT`

## Measurement Commands For Phase 7

```bash
make pg-reset
make pg-up
VARLENS_EXPERIMENTAL_STORAGE_BACKEND=postgres VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-*.e2e.ts
```
```

- [ ] **Step 2: Commit the inventory artifact**

Run:

```bash
git add .planning/artifacts/postgres-parity-phase-6-wgs-readiness.md
git commit -m "docs(planning): inventory postgres wgs readiness"
```

Expected:

- The artifact exists for Phase 7 planning and does not change runtime code.

## Task 1: Add Read and Write Executor Contracts

**Files:**

- Create: `src/main/storage/case-metadata-types.ts`
- Create: `src/main/storage/write-executor.ts`
- Modify: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/session.ts`
- Test: `tests/main/storage/read-executor-contract.test.ts`
- Test: `tests/main/storage/write-executor-contract.test.ts`

- [ ] **Step 1: Write failing read contract tests**

Append these cases to `tests/main/storage/read-executor-contract.test.ts`:

```ts
it('supports case metadata read tasks', () => {
  const tasks = [
    { type: 'case-metadata:get', params: [1] },
    { type: 'case-metadata:listCohorts', params: [] },
    { type: 'case-metadata:getCohortByName', params: ['research'] },
    { type: 'case-metadata:getCaseCohorts', params: [1] },
    { type: 'case-metadata:getHpoTerms', params: [1] },
    { type: 'case-metadata:getDataInfo', params: [1] },
    { type: 'case-metadata:listExternalIds', params: [1] },
    { type: 'case-metadata:distinctHpoTerms', params: [] },
    { type: 'case-metadata:distinctPlatforms', params: [] },
    { type: 'case-metadata:distinctExternalIdTypes', params: [] },
    { type: 'case-metadata:getFullMetadata', params: [1] }
  ] satisfies StorageReadTask[]

  expect(tasks).toHaveLength(11)
})
```

- [ ] **Step 2: Write failing write contract tests**

Create `tests/main/storage/write-executor-contract.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { StorageWriteExecutor, StorageWriteTask } from '../../../src/main/storage/write-executor'

describe('StorageWriteExecutor contract', () => {
  it('supports case metadata write tasks', () => {
    const tasks = [
      { type: 'case-metadata:upsert', params: [1, { affected_status: 'affected', age: 42, date_of_birth: '1984-01-02' }] },
      { type: 'case-metadata:createCohort', params: [{ name: 'research', description: null }] },
      { type: 'case-metadata:updateCohort', params: [2, { name: 'updated' }] },
      { type: 'case-metadata:deleteCohort', params: [2] },
      { type: 'case-metadata:assignCohort', params: [1, 2] },
      { type: 'case-metadata:removeCohort', params: [1, 2] },
      { type: 'case-metadata:setCohorts', params: [1, [2, 3]] },
      { type: 'case-metadata:assignHpoTerm', params: [1, 'HP:0001250', 'Seizure'] },
      { type: 'case-metadata:removeHpoTerm', params: [1, 'HP:0001250'] },
      { type: 'case-metadata:upsertDataInfo', params: [1, { platform: 'WGS' }] },
      { type: 'case-metadata:upsertExternalId', params: [1, 'MRN', '12345'] },
      { type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] }
    ] satisfies StorageWriteTask[]

    expect(tasks).toHaveLength(12)
    expectTypeOf<StorageWriteExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
  })
})
```

- [ ] **Step 3: Run focused tests and typecheck to confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/write-executor-contract.test.ts
make typecheck
```

Expected:

- Vitest or typecheck fails because the new task unions and write executor do not exist.

- [ ] **Step 4: Add backend-neutral case metadata storage types**

Create `src/main/storage/case-metadata-types.ts`:

```ts
export interface MetadataUpdates {
  affected_status?: string | null
  sex?: string | null
  notes?: string | null
  age?: number | null
  date_of_birth?: string | null
}

export interface CohortCreateParams {
  name: string
  description?: string | null
}

export interface CohortUpdateParams {
  name?: string
  description?: string | null
}

export interface DataInfoUpdates {
  platform?: string | null
  platform_details?: string | null
  af_filter?: string | null
  gene_list_filter?: string | null
  region_filter?: string | null
  quality_filter?: string | null
  data_notes?: string | null
  gene_list_id?: number | null
  region_file_id?: number | null
}

export interface FullCaseMetadataResult {
  metadata: unknown
  cohorts: unknown[]
  hpoTerms: unknown[]
  comments: unknown[]
  metrics: unknown[]
  dataInfo: unknown
  externalIds: unknown[]
}
```

These types intentionally live in storage, not `src/main/ipc/handlers/`, so storage code does not import IPC handler internals.

- [ ] **Step 5: Add the write executor contract**

Create `src/main/storage/write-executor.ts` with this shape:

```ts
import type {
  CohortCreateParams,
  CohortUpdateParams,
  DataInfoUpdates,
  MetadataUpdates
} from './case-metadata-types'

export type StorageWriteTask =
  | { type: 'case-metadata:upsert'; params: [caseId: number, updates: MetadataUpdates] }
  | { type: 'case-metadata:createCohort'; params: [params: CohortCreateParams] }
  | {
      type: 'case-metadata:updateCohort'
      params: [cohortId: number, updates: CohortUpdateParams]
    }
  | { type: 'case-metadata:deleteCohort'; params: [cohortId: number] }
  | { type: 'case-metadata:assignCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:removeCohort'; params: [caseId: number, cohortId: number] }
  | { type: 'case-metadata:setCohorts'; params: [caseId: number, cohortIds: number[]] }
  | { type: 'case-metadata:assignHpoTerm'; params: [caseId: number, hpoId: string, hpoLabel: string] }
  | { type: 'case-metadata:removeHpoTerm'; params: [caseId: number, hpoId: string] }
  | { type: 'case-metadata:upsertDataInfo'; params: [caseId: number, updates: DataInfoUpdates] }
  | { type: 'case-metadata:upsertExternalId'; params: [caseId: number, idType: string, idValue: string] }
  | { type: 'case-metadata:deleteExternalId'; params: [caseId: number, idType: string] }

export interface StorageWriteExecutor {
  execute(task: StorageWriteTask): Promise<unknown>
}
```

- [ ] **Step 6: Extend the read executor contract**

Update `src/main/storage/read-executor.ts` so `StorageReadTask` includes the eleven `case-metadata:*` read tasks from Step 1. Keep the existing cases tasks unchanged.

- [ ] **Step 7: Expose the write executor on sessions**

Update `src/main/storage/session.ts`:

```ts
import type { StorageWriteExecutor } from './write-executor'
```

Add to `StorageSession`:

```ts
getWriteExecutor(): StorageWriteExecutor
```

- [ ] **Step 8: Verify contracts**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/write-executor-contract.test.ts
make typecheck
```

Expected:

- Focused tests pass.
- Typecheck may fail because concrete session classes do not yet implement `getWriteExecutor()`; do not merge this checkpoint into another lane until Task 3 and Task 4 are green.

- [ ] **Step 9: Commit contract work**

Run:

```bash
git add src/main/storage/case-metadata-types.ts src/main/storage/read-executor.ts src/main/storage/write-executor.ts src/main/storage/session.ts tests/main/storage/read-executor-contract.test.ts tests/main/storage/write-executor-contract.test.ts
git commit -m "refactor(storage): add case metadata executor contracts"
```

## Task 2: Add PostgreSQL Schema and Case Metadata Repository

**Files:**

- Create: `scripts/postgres/init-db/11-phase6-case-metadata.sql`
- Modify: `scripts/postgres/init-db/20-phase3-seed-cases.sql`
- Modify: `scripts/postgres/init-db/README.md`
- Create: `src/main/storage/postgres/PostgresCaseMetadataRepository.ts`
- Test: `tests/main/storage/postgres-case-metadata-repository.test.ts`

- [ ] **Step 1: Write failing PostgreSQL repository tests**

Create `tests/main/storage/postgres-case-metadata-repository.test.ts`. The test file must cover the complete IPC result shape for this phase, including comments and metrics returned by current SQLite `MetadataRepository.getFullCaseMetadata()`.

Use this helper at the top of the test file:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'

const makePool = () => {
  const client = {
    query: vi.fn(),
    release: vi.fn()
  }

  return {
    pool: {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client)
    },
    client
  }
}

describe('PostgresCaseMetadataRepository', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})
```

Add these concrete tests inside the `describe` block:

```ts
it('reads case metadata and normalizes numeric ids', async () => {
  const { pool } = makePool()
  pool.query.mockResolvedValueOnce({
    rows: [{ id: '7', case_id: '1', affected_status: 'affected', sex: 'female', notes: 'index case' }]
  })
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await expect(repository.getCaseMetadata(1)).resolves.toStrictEqual({
    id: 7,
    case_id: 1,
    affected_status: 'affected',
    sex: 'female',
    notes: 'index case'
  })
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('"public"."case_metadata"'), [1])
})

it('upserts case metadata with conflict on case_id', async () => {
  const { pool } = makePool()
  pool.query.mockResolvedValueOnce({
    rows: [{ id: '8', case_id: '1', affected_status: 'affected', sex: 'female', notes: null, age: 42, date_of_birth: '1984-01-02' }]
  })
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await repository.upsertCaseMetadata(1, {
    affected_status: 'affected',
    sex: 'female',
    age: 42,
    date_of_birth: '1984-01-02'
  })

  expect(pool.query).toHaveBeenCalledWith(
    expect.stringContaining('ON CONFLICT (case_id) DO UPDATE'),
    expect.arrayContaining([1, 'affected', 'female', 42, '1984-01-02'])
  )
})

it('sets case cohorts transactionally on one checked-out client', async () => {
  const { pool, client } = makePool()
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await repository.setCaseCohorts(1, [2, 3])

  expect(pool.connect).toHaveBeenCalledTimes(1)
  expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "public"."case_cohort_links"'), [1])
  expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "public"."case_cohort_links"'), [1, [2, 3]])
  expect(client.query).toHaveBeenLastCalledWith('COMMIT')
  expect(client.release).toHaveBeenCalledTimes(1)
})

it('rolls back setCaseCohorts when an insert fails', async () => {
  const { pool, client } = makePool()
  client.query.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('insert failed'))
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await expect(repository.setCaseCohorts(1, [2])).rejects.toThrow('insert failed')

  expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  expect(client.release).toHaveBeenCalledTimes(1)
})

it('returns full case metadata with comments and metrics included', async () => {
  const { pool } = makePool()
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: '1', case_id: '1', affected_status: 'affected' }] })
    .mockResolvedValueOnce({ rows: [{ id: '2', name: 'rare disease' }] })
    .mockResolvedValueOnce({ rows: [{ id: '3', hpo_id: 'HP:0001250', hpo_label: 'Seizure' }] })
    .mockResolvedValueOnce({ rows: [{ id: '4', category: 'clinical', content: 'reviewed' }] })
    .mockResolvedValueOnce({ rows: [{ id: '5', metric_id: '6', name: 'Age', value_type: 'numeric', numeric_value: 42 }] })
    .mockResolvedValueOnce({ rows: [{ id: '7', platform: 'WGS' }] })
    .mockResolvedValueOnce({ rows: [{ id: '8', id_type: 'MRN', id_value: '12345' }] })
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await expect(repository.getFullCaseMetadata(1)).resolves.toStrictEqual({
    metadata: { id: 1, case_id: 1, affected_status: 'affected' },
    cohorts: [{ id: 2, name: 'rare disease' }],
    hpoTerms: [{ id: 3, hpo_id: 'HP:0001250', hpo_label: 'Seizure' }],
    comments: [{ id: 4, category: 'clinical', content: 'reviewed' }],
    metrics: [{ id: 5, metric_id: 6, name: 'Age', value_type: 'numeric', numeric_value: 42 }],
    dataInfo: { id: 7, platform: 'WGS' },
    externalIds: [{ id: 8, id_type: 'MRN', id_value: '12345' }]
  })
})

it('returns stable distinct HPO terms by hpo_id and hpo_label', async () => {
  const { pool } = makePool()
  pool.query.mockResolvedValueOnce({ rows: [{ hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: '2' }] })
  const repository = new PostgresCaseMetadataRepository(pool, 'public')

  await expect(repository.getDistinctHpoTerms()).resolves.toStrictEqual([
    { hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: 2 }
  ])
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('GROUP BY hpo_id, hpo_label'), [])
})
```

- [ ] **Step 2: Run the repository test and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts
```

Expected:

- FAIL because `PostgresCaseMetadataRepository` does not exist.

- [ ] **Step 3: Add PostgreSQL metadata schema**

Create `scripts/postgres/init-db/11-phase6-case-metadata.sql` to create these tables with `BIGSERIAL` primary keys and foreign keys to `cases(id)`.

Do not put this DDL in `001-create-varlens-schema.sql`: Docker runs `/docker-entrypoint-initdb.d` files in alphabetical order on fresh-volume initialization, and `10-phase3-cases.sql` must create `cases` before Phase 6 tables can reference `cases(id)`.

```sql
CREATE TABLE IF NOT EXISTS case_metadata (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  affected_status TEXT,
  notes TEXT,
  created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
  updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT,
  sex TEXT,
  age DOUBLE PRECISION,
  date_of_birth TEXT
);

CREATE TABLE IF NOT EXISTS cohort_groups (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_cohort_links (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  cohort_id BIGINT NOT NULL REFERENCES cohort_groups(id) ON DELETE CASCADE,
  UNIQUE(case_id, cohort_id)
);

CREATE TABLE IF NOT EXISTS case_hpo_terms (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  hpo_id TEXT NOT NULL,
  hpo_label TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(case_id, hpo_id)
);

CREATE TABLE IF NOT EXISTS case_data_info (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  import_file_name TEXT,
  import_file_type TEXT,
  platform TEXT,
  platform_details TEXT,
  af_filter TEXT,
  gene_list_filter TEXT,
  region_filter TEXT,
  quality_filter TEXT,
  data_notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  gene_list_id BIGINT,
  region_file_id BIGINT
);

CREATE TABLE IF NOT EXISTS case_external_ids (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  id_type TEXT NOT NULL,
  id_value TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(case_id, id_type)
);

CREATE TABLE IF NOT EXISTS case_comments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS metric_definitions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  value_type TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  is_predefined INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_metrics (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  metric_id BIGINT NOT NULL REFERENCES metric_definitions(id) ON DELETE CASCADE,
  numeric_value DOUBLE PRECISION,
  text_value TEXT,
  date_value TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(case_id, metric_id)
);
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_case_metadata_case_id ON case_metadata(case_id);
CREATE INDEX IF NOT EXISTS idx_case_cohort_links_case_id ON case_cohort_links(case_id);
CREATE INDEX IF NOT EXISTS idx_case_cohort_links_cohort_id ON case_cohort_links(cohort_id);
CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_case_id ON case_hpo_terms(case_id);
CREATE INDEX IF NOT EXISTS idx_case_hpo_terms_hpo_id ON case_hpo_terms(hpo_id);
CREATE INDEX IF NOT EXISTS idx_case_data_info_case_id ON case_data_info(case_id);
CREATE INDEX IF NOT EXISTS idx_case_external_ids_case_id ON case_external_ids(case_id);
CREATE INDEX IF NOT EXISTS idx_case_comments_case_created ON case_comments(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_comments_case_category ON case_comments(case_id, category);
CREATE INDEX IF NOT EXISTS idx_case_metrics_case ON case_metrics(case_id);
CREATE INDEX IF NOT EXISTS idx_case_metrics_metric ON case_metrics(metric_id);
```

- [ ] **Step 4: Seed PostgreSQL metadata fixtures**

Append deterministic seed rows to `scripts/postgres/init-db/20-phase3-seed-cases.sql`:

```sql
INSERT INTO case_metadata (case_id, affected_status, sex, notes)
VALUES
  (1, 'affected', 'female', 'index case'),
  (2, 'unaffected', 'male', 'control case')
ON CONFLICT (case_id) DO UPDATE SET
  affected_status = EXCLUDED.affected_status,
  sex = EXCLUDED.sex,
  notes = EXCLUDED.notes;

INSERT INTO cohort_groups (id, name, description, created_at)
VALUES
  (1, 'rare disease', 'Rare disease cohort', 1714060803000),
  (2, 'controls', 'Control cohort', 1714060804000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO case_cohort_links (case_id, cohort_id)
VALUES (1, 1), (2, 2), (3, 1)
ON CONFLICT (case_id, cohort_id) DO NOTHING;

INSERT INTO case_hpo_terms (case_id, hpo_id, hpo_label, created_at)
VALUES
  (1, 'HP:0001250', 'Seizure', 1714060805000),
  (3, 'HP:0004322', 'Short stature', 1714060806000)
ON CONFLICT (case_id, hpo_id) DO UPDATE SET hpo_label = EXCLUDED.hpo_label;

INSERT INTO case_comments (id, case_id, category, content, created_at)
VALUES
  (1, 1, 'clinical', 'Reviewed for PostgreSQL parity smoke', 1714060807000)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  content = EXCLUDED.content;

INSERT INTO metric_definitions (id, name, value_type, unit, category, is_predefined, created_at)
VALUES
  (1, 'Age at analysis', 'numeric', 'years', 'clinical', 1, 1714060808000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  value_type = EXCLUDED.value_type,
  unit = EXCLUDED.unit,
  category = EXCLUDED.category,
  is_predefined = EXCLUDED.is_predefined;

INSERT INTO case_metrics (id, case_id, metric_id, numeric_value, created_at, updated_at)
VALUES
  (1, 1, 1, 42, 1714060809000, 1714060809000)
ON CONFLICT (id) DO UPDATE SET
  numeric_value = EXCLUDED.numeric_value,
  updated_at = EXCLUDED.updated_at;

SELECT setval(pg_get_serial_sequence('public.case_metadata', 'id'), COALESCE((SELECT MAX(id) FROM case_metadata), 1), true);
SELECT setval(pg_get_serial_sequence('public.cohort_groups', 'id'), COALESCE((SELECT MAX(id) FROM cohort_groups), 1), true);
SELECT setval(pg_get_serial_sequence('public.case_comments', 'id'), COALESCE((SELECT MAX(id) FROM case_comments), 1), true);
SELECT setval(pg_get_serial_sequence('public.metric_definitions', 'id'), COALESCE((SELECT MAX(id) FROM metric_definitions), 1), true);
SELECT setval(pg_get_serial_sequence('public.case_metrics', 'id'), COALESCE((SELECT MAX(id) FROM case_metrics), 1), true);
```

The explicit `setval` calls are required because the seed data supplies IDs for deterministic E2E fixtures and `BIGSERIAL` sequences are not advanced by explicit ID inserts.

- [ ] **Step 5: Update init-db README**

Modify `scripts/postgres/init-db/README.md` so it no longer says the bootstrap is only Phase 1/minimal. It must document:

```markdown
- `001-create-varlens-schema.sql` creates the schema only.
- `10-phase3-cases.sql` creates the base `cases` table.
- `11-phase6-case-metadata.sql` creates Phase 6 metadata/cohort/HPO/comment/metric tables that depend on `cases`.
- `20-phase3-seed-cases.sql` seeds deterministic development rows and resets sequences after explicit-ID seed inserts.
```

- [ ] **Step 6: Implement the PostgreSQL repository**

Create `src/main/storage/postgres/PostgresCaseMetadataRepository.ts`. Use `quoteIdentifier` from `src/main/storage/postgres/identifiers.ts`; do not define a second quoting helper. The constructor must accept `Pick<Pool, 'query' | 'connect'>` so `setCaseCohorts()` can run a real transaction on one checked-out client.

Import `MetadataUpdates`, `CohortUpdateParams`, `DataInfoUpdates`, and `FullCaseMetadataResult` from `src/main/storage/case-metadata-types.ts`.

Required implementation details:

- Normalize PostgreSQL integer strings to JavaScript numbers for `id`, `case_id`, `cohort_id`, `metric_id`, and `case_count`.
- Return `null` when singular read queries have no row, matching current SQLite behavior.
- Preserve SQLite ordering semantics: `listCohortGroups()` by `name`; `getCaseCohorts()` by cohort group `name`; `getCaseHpoTerms()` by `hpo_id`; `listCaseExternalIds()` by `id_type`; `listCaseComments()` by `created_at DESC, id DESC`; `listCaseMetrics()` by metric `category`, then metric `name`; `getDistinctHpoTerms()` by `hpo_label`.
- `getFullCaseMetadata()` must return exactly:

```ts
{
  metadata,
  cohorts,
  hpoTerms,
  comments,
  metrics,
  dataInfo,
  externalIds
}
```

- `getDistinctHpoTerms()` must use `GROUP BY hpo_id, hpo_label` so PostgreSQL is deterministic and legal.
- `setCaseCohorts()` must use `const client = await this.pool.connect()`, then `BEGIN`, delete existing links, insert the new links with `UNNEST($2::bigint[])`, `COMMIT`, `ROLLBACK` on error, and `client.release()` in `finally`.

The repository class must include these public methods with the same names as `MetadataRepository`:

```ts
getCaseMetadata(caseId: number): Promise<unknown | null>
upsertCaseMetadata(caseId: number, updates: MetadataUpdates): Promise<unknown>
listCohortGroups(): Promise<unknown[]>
createCohortGroup(name: string, description?: string | null): Promise<unknown>
updateCohortGroup(cohortId: number, updates: CohortUpdateParams): Promise<unknown>
deleteCohortGroup(cohortId: number): Promise<void>
getCohortGroupByName(name: string): Promise<unknown | null>
getCaseCohorts(caseId: number): Promise<unknown[]>
assignCaseCohort(caseId: number, cohortId: number): Promise<void>
removeCaseCohort(caseId: number, cohortId: number): Promise<void>
setCaseCohorts(caseId: number, cohortIds: number[]): Promise<void>
getCaseHpoTerms(caseId: number): Promise<unknown[]>
assignCaseHpoTerm(caseId: number, hpoId: string, hpoLabel: string): Promise<unknown>
removeCaseHpoTerm(caseId: number, hpoId: string): Promise<void>
getCaseDataInfo(caseId: number): Promise<unknown | null>
upsertCaseDataInfo(caseId: number, updates: DataInfoUpdates): Promise<unknown>
listCaseExternalIds(caseId: number): Promise<unknown[]>
upsertCaseExternalId(caseId: number, idType: string, idValue: string): Promise<unknown>
deleteCaseExternalId(caseId: number, idType: string): Promise<void>
listCaseComments(caseId: number): Promise<unknown[]>
listCaseMetrics(caseId: number): Promise<unknown[]>
getDistinctHpoTerms(): Promise<unknown[]>
getDistinctPlatforms(): Promise<string[]>
getDistinctExternalIdTypes(): Promise<string[]>
getFullCaseMetadata(caseId: number): Promise<FullCaseMetadataResult>
```

- [ ] **Step 7: Verify PostgreSQL repository tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts
make typecheck
```

Expected:

- Repository tests pass.
- Typecheck may still fail until session classes implement write executor methods in later tasks; treat this as a local red checkpoint and do not merge or hand it to another lane as green.

- [ ] **Step 8: Commit PostgreSQL repository and schema**

Run:

```bash
git add scripts/postgres/init-db/11-phase6-case-metadata.sql scripts/postgres/init-db/20-phase3-seed-cases.sql scripts/postgres/init-db/README.md src/main/storage/postgres/PostgresCaseMetadataRepository.ts tests/main/storage/postgres-case-metadata-repository.test.ts
git commit -m "feat(storage): add postgres case metadata repository"
```

## Task 3: Add SQLite Read and Write Executors for Case Metadata

**Files:**

- Modify: `src/main/storage/sqlite/SqliteReadExecutor.ts`
- Create: `src/main/storage/sqlite/SqliteWriteExecutor.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Test: `tests/main/storage/sqlite-read-executor.test.ts`
- Test: `tests/main/storage/sqlite-write-executor.test.ts`
- Test: `tests/main/storage/sqlite-storage-session.test.ts`

- [ ] **Step 1: Write failing SQLite read executor tests**

Append tests to `tests/main/storage/sqlite-read-executor.test.ts` proving:

```ts
await executor.execute({ type: 'case-metadata:get', params: [1] })
await executor.execute({ type: 'case-metadata:listCohorts', params: [] })
await executor.execute({ type: 'case-metadata:getFullMetadata', params: [1] })
```

Expected:

- With `dbPool`, each call forwards to `dbPool.run({ type, params })`.
- Without `dbPool`, each call delegates to `databaseService.metadata`.

- [ ] **Step 2: Write failing SQLite write executor tests**

Create `tests/main/storage/sqlite-write-executor.test.ts` with tests proving:

```ts
await executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
await executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
await executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })
```

Expected:

- Each call delegates to the matching `databaseService.metadata` method.
- The executor returns repository results for upsert/create methods.
- Delete/remove methods resolve to `undefined`.

- [ ] **Step 3: Run focused SQLite executor tests and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/storage/sqlite-storage-session.test.ts
```

Expected:

- FAIL because the SQLite write executor does not exist and read dispatch is missing.

- [ ] **Step 4: Implement SQLite read dispatch**

Update `src/main/storage/sqlite/SqliteReadExecutor.ts` with one switch case per case metadata read task. These eleven read task types already exist in `DbTask` and `src/main/workers/db-worker-dispatch.ts`, so forwarding to `dbPool.run(...)` is a dispatch change only; do not extend `DbTask` in this task.

Use the existing pattern:

```ts
case 'case-metadata:get':
  if (this.dbPool !== null) {
    return await this.dbPool.run({ type: 'case-metadata:get', params: task.params })
  }
  return this.databaseService.metadata.getCaseMetadata(task.params[0])
```

Repeat the mapping for all eleven read tasks listed in Task 1.

- [ ] **Step 5: Implement SQLite write executor**

Create `src/main/storage/sqlite/SqliteWriteExecutor.ts`:

```ts
import type { DatabaseService } from '../../database/DatabaseService'
import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'

export class SqliteWriteExecutor implements StorageWriteExecutor {
  constructor(private readonly databaseService: DatabaseService) {}

  async execute(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'case-metadata:upsert':
        return this.databaseService.metadata.upsertCaseMetadata(task.params[0], task.params[1])
      case 'case-metadata:createCohort':
        return this.databaseService.metadata.createCohortGroup(task.params[0].name, task.params[0].description)
      case 'case-metadata:updateCohort':
        return this.databaseService.metadata.updateCohortGroup(task.params[0], task.params[1])
      case 'case-metadata:deleteCohort':
        this.databaseService.metadata.deleteCohortGroup(task.params[0])
        return undefined
      case 'case-metadata:assignCohort':
        this.databaseService.metadata.assignCaseCohort(task.params[0], task.params[1])
        return undefined
      case 'case-metadata:removeCohort':
        this.databaseService.metadata.removeCaseCohort(task.params[0], task.params[1])
        return undefined
      case 'case-metadata:setCohorts':
        this.databaseService.metadata.setCaseCohorts(task.params[0], task.params[1])
        return undefined
      case 'case-metadata:assignHpoTerm':
        return this.databaseService.metadata.assignCaseHpoTerm(task.params[0], task.params[1], task.params[2])
      case 'case-metadata:removeHpoTerm':
        this.databaseService.metadata.removeCaseHpoTerm(task.params[0], task.params[1])
        return undefined
      case 'case-metadata:upsertDataInfo':
        return this.databaseService.metadata.upsertCaseDataInfo(task.params[0], task.params[1])
      case 'case-metadata:upsertExternalId':
        return this.databaseService.metadata.upsertCaseExternalId(task.params[0], task.params[1], task.params[2])
      case 'case-metadata:deleteExternalId':
        this.databaseService.metadata.deleteCaseExternalId(task.params[0], task.params[1])
        return undefined
      default: {
        const exhaustive: never = task
        throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}
```

- [ ] **Step 6: Wire SQLite session**

Modify `src/main/storage/sqlite/SqliteStorageSession.ts`:

```ts
import { SqliteWriteExecutor } from './SqliteWriteExecutor'
import type { StorageWriteExecutor } from '../write-executor'
```

Add:

```ts
private readonly writeExecutor: StorageWriteExecutor
```

Initialize:

```ts
this.writeExecutor = new SqliteWriteExecutor(this.databaseService)
```

Expose:

```ts
getWriteExecutor(): StorageWriteExecutor {
  return this.writeExecutor
}
```

- [ ] **Step 7: Verify SQLite executor behavior**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/storage/sqlite-storage-session.test.ts
make typecheck
```

Expected:

- Focused SQLite tests pass.
- Typecheck may still fail because PostgreSQL session lacks `getWriteExecutor()`; treat this as a local red checkpoint and do not merge or hand it to another lane as green.

- [ ] **Step 8: Commit SQLite executor work**

Run:

```bash
git add src/main/storage/sqlite/SqliteReadExecutor.ts src/main/storage/sqlite/SqliteWriteExecutor.ts src/main/storage/sqlite/SqliteStorageSession.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/sqlite-write-executor.test.ts tests/main/storage/sqlite-storage-session.test.ts
git commit -m "refactor(storage): route sqlite case metadata through executors"
```

## Task 4: Wire PostgreSQL Executors and Session

**Files:**

- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Create: `src/main/storage/postgres/PostgresWriteExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Test: `tests/main/storage/postgres-read-executor.test.ts`
- Test: `tests/main/storage/postgres-write-executor.test.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`
- Test: `tests/main/storage/storage-manager-compat.test.ts`

- [ ] **Step 1: Write failing PostgreSQL executor tests**

Add read executor tests to `tests/main/storage/postgres-read-executor.test.ts`:

```ts
it('routes case metadata read tasks to the postgres repository', async () => {
  const caseMetadata = {
    getCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
    listCohortGroups: vi.fn().mockResolvedValue([]),
    getFullCaseMetadata: vi.fn().mockResolvedValue({
      metadata: null,
      cohorts: [],
      hpoTerms: [],
      comments: [],
      metrics: [],
      dataInfo: null,
      externalIds: []
    })
  }
  const executor = new PostgresReadExecutor({
    casesQuery: {} as never,
    availableBuilds: {} as never,
    caseMetadata: caseMetadata as never
  })

  await executor.execute({ type: 'case-metadata:get', params: [1] })
  await executor.execute({ type: 'case-metadata:listCohorts', params: [] })
  await executor.execute({ type: 'case-metadata:getFullMetadata', params: [1] })

  expect(caseMetadata.getCaseMetadata).toHaveBeenCalledWith(1)
  expect(caseMetadata.listCohortGroups).toHaveBeenCalledWith()
  expect(caseMetadata.getFullCaseMetadata).toHaveBeenCalledWith(1)
})
```

Create write executor tests in `tests/main/storage/postgres-write-executor.test.ts`:

```ts
it('routes case metadata write tasks to the postgres repository', async () => {
  const repository = {
    upsertCaseMetadata: vi.fn().mockResolvedValue({ case_id: 1 }),
    setCaseCohorts: vi.fn().mockResolvedValue(undefined),
    deleteCaseExternalId: vi.fn().mockResolvedValue(undefined)
  }
  const executor = new PostgresWriteExecutor(repository as never)

  await executor.execute({ type: 'case-metadata:upsert', params: [1, { sex: 'female' }] })
  await executor.execute({ type: 'case-metadata:setCohorts', params: [1, [2, 3]] })
  await executor.execute({ type: 'case-metadata:deleteExternalId', params: [1, 'MRN'] })

  expect(repository.upsertCaseMetadata).toHaveBeenCalledWith(1, { sex: 'female' })
  expect(repository.setCaseCohorts).toHaveBeenCalledWith(1, [2, 3])
  expect(repository.deleteCaseExternalId).toHaveBeenCalledWith(1, 'MRN')
})
```

- [ ] **Step 2: Run focused PostgreSQL executor tests and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts
```

Expected:

- FAIL because PostgreSQL write executor and read dispatch are missing.

- [ ] **Step 3: Extend PostgreSQL read executor**

Modify `src/main/storage/postgres/PostgresReadExecutor.ts` so repository dependencies include:

```ts
caseMetadata: Pick<PostgresCaseMetadataRepository,
  | 'getCaseMetadata'
  | 'listCohortGroups'
  | 'getCohortGroupByName'
  | 'getCaseCohorts'
  | 'getCaseHpoTerms'
  | 'getCaseDataInfo'
  | 'listCaseExternalIds'
  | 'getDistinctHpoTerms'
  | 'getDistinctPlatforms'
  | 'getDistinctExternalIdTypes'
  | 'getFullCaseMetadata'
>
```

Add switch cases for all eleven case metadata read tasks.

- [ ] **Step 4: Implement PostgreSQL write executor**

Create `src/main/storage/postgres/PostgresWriteExecutor.ts`:

```ts
import type { PostgresCaseMetadataRepository } from './PostgresCaseMetadataRepository'
import type { StorageWriteExecutor, StorageWriteTask } from '../write-executor'

export class PostgresWriteExecutor implements StorageWriteExecutor {
  constructor(private readonly caseMetadata: PostgresCaseMetadataRepository) {}

  async execute(task: StorageWriteTask): Promise<unknown> {
    switch (task.type) {
      case 'case-metadata:upsert':
        return await this.caseMetadata.upsertCaseMetadata(task.params[0], task.params[1])
      case 'case-metadata:createCohort':
        return await this.caseMetadata.createCohortGroup(task.params[0].name, task.params[0].description)
      case 'case-metadata:updateCohort':
        return await this.caseMetadata.updateCohortGroup(task.params[0], task.params[1])
      case 'case-metadata:deleteCohort':
        return await this.caseMetadata.deleteCohortGroup(task.params[0])
      case 'case-metadata:assignCohort':
        return await this.caseMetadata.assignCaseCohort(task.params[0], task.params[1])
      case 'case-metadata:removeCohort':
        return await this.caseMetadata.removeCaseCohort(task.params[0], task.params[1])
      case 'case-metadata:setCohorts':
        return await this.caseMetadata.setCaseCohorts(task.params[0], task.params[1])
      case 'case-metadata:assignHpoTerm':
        return await this.caseMetadata.assignCaseHpoTerm(task.params[0], task.params[1], task.params[2])
      case 'case-metadata:removeHpoTerm':
        return await this.caseMetadata.removeCaseHpoTerm(task.params[0], task.params[1])
      case 'case-metadata:upsertDataInfo':
        return await this.caseMetadata.upsertCaseDataInfo(task.params[0], task.params[1])
      case 'case-metadata:upsertExternalId':
        return await this.caseMetadata.upsertCaseExternalId(task.params[0], task.params[1], task.params[2])
      case 'case-metadata:deleteExternalId':
        return await this.caseMetadata.deleteCaseExternalId(task.params[0], task.params[1])
      default: {
        const exhaustive: never = task
        throw new Error(`Unsupported storage write task: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}
```

- [ ] **Step 5: Wire PostgreSQL session**

Modify `src/main/storage/postgres/PostgresStorageSession.ts`:

- construct one `PostgresCaseMetadataRepository`
- pass it into `PostgresReadExecutor`
- pass it into `PostgresWriteExecutor`
- implement `getWriteExecutor()`

- [ ] **Step 6: Update mock sessions**

Update tests that build mock `StorageSession` objects, especially `tests/main/storage/storage-manager-compat.test.ts`, to include:

```ts
getWriteExecutor: () => ({
  execute: vi.fn()
})
```

- [ ] **Step 7: Verify PostgreSQL executor wiring**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts
make typecheck
```

Expected:

- Focused tests pass.
- Typecheck passes for session interface implementations.

- [ ] **Step 8: Commit PostgreSQL executor wiring**

Run:

```bash
git add src/main/storage/postgres/PostgresReadExecutor.ts src/main/storage/postgres/PostgresWriteExecutor.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts
git commit -m "refactor(storage): wire postgres case metadata executors"
```

## Task 5: Route Case Metadata IPC Through Storage Sessions

**Files:**

- Modify: `src/main/ipc/handlers/case-metadata.ts`
- Modify: `src/main/ipc/handlers/case-metadata-logic.ts`
- Create: `tests/main/handlers/case-metadata-routing.test.ts`
- Test: `tests/main/handlers/case-metadata-logic.test.ts`

- [ ] **Step 1: Write failing handler tests**

Create `tests/main/handlers/case-metadata-routing.test.ts` with PostgreSQL routing tests for:

```ts
case-metadata:get
case-metadata:upsert
case-metadata:listCohorts
case-metadata:assignHpoTerm
case-metadata:getFullMetadata
```

Mock `getDb` and `getDbPool` to throw:

```ts
const getDb = () => {
  throw new Error('getDb should not be called for postgres case metadata')
}
const getDbPool = () => {
  throw new Error('getDbPool should not be called for postgres case metadata')
}
```

Expected:

- Each handler resolves through `getDbManager().getCurrentSession().getReadExecutor()` or `getWriteExecutor()`.
- The test captures handlers through a fake `ipcMain.handle` registry and invokes the registered function directly, so it proves IPC registration routing rather than only repository helpers.
- Keep the existing `tests/main/handlers/case-metadata-handlers.test.ts` focused on its current SQLite-backed integration coverage; do not force the new mocked routing tests into that file.

Use this fake IPC shape:

```ts
const registered = new Map<string, (...args: unknown[]) => unknown>()
const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registered.set(channel, handler)
  })
} as never
```

- [ ] **Step 2: Run handler tests and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/case-metadata-routing.test.ts tests/main/handlers/case-metadata-logic.test.ts
```

Expected:

- FAIL because handlers still call `getDb()` directly.

- [ ] **Step 3: Verify domain registration already exposes `getDbManager`**

Read `src/main/ipc/domains/case-metadata.ts` and `src/main/ipc/types.ts`. The current domain registration already passes `getDbManager`, and `HandlerDependencies` already includes it. Do not create a needless diff in `src/main/ipc/domains/case-metadata.ts` unless the live code has changed.

Expected current shape:

```ts
registerCaseMetadataHandlers({
  ipcMain,
  getDb,
  getDbManager,
  getDbPool
})
```

- [ ] **Step 4: Update case metadata logic functions**

Change `src/main/ipc/handlers/case-metadata-logic.ts` so `MetadataUpdates`, `CohortCreateParams`, `CohortUpdateParams`, and `DataInfoUpdates` are imported from `src/main/storage/case-metadata-types.ts` instead of being declared in the IPC logic file. Then change read functions to take `getSession: () => StorageSession` and execute `StorageReadTask`.

`MetadataUpdates` must include `age?: number | null` and `date_of_birth?: string | null` through the storage type, matching `CaseMetadataUpdates` in `src/shared/types/api.ts` and the existing SQLite `MetadataRepository.upsertCaseMetadata()` behavior.

Example:

```ts
export async function getMetadata(
  caseId: number,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession().getReadExecutor().execute({
    type: 'case-metadata:get',
    params: [caseId]
  })
}
```

Change write functions to execute `StorageWriteTask`.

Example:

```ts
export async function upsertMetadata(
  caseId: number,
  updates: MetadataUpdates,
  getSession: () => StorageSession
): Promise<unknown> {
  return await getSession().getWriteExecutor().execute({
    type: 'case-metadata:upsert',
    params: [caseId, updates]
  })
}
```

Apply the same pattern to every function exported from `case-metadata-logic.ts`.

- [ ] **Step 5: Update case metadata handlers**

Modify `src/main/ipc/handlers/case-metadata.ts`:

```ts
export function registerCaseMetadataHandlers({
  ipcMain,
  getDbManager
}: HandlerDependencies): void {
  const getSession = () => getDbManager().getCurrentSession()
}
```

Pass `getSession` into all logic functions.

Also widen `MetadataUpsertSchema` in `src/main/ipc/handlers/case-metadata.ts` so age/date-of-birth are not stripped before either backend sees them:

```ts
const MetadataUpsertSchema = z.object({
  affected_status: z.string().nullish(),
  sex: z.string().nullish(),
  notes: z.string().nullish(),
  age: z.number().nullish(),
  date_of_birth: z.string().nullish()
})
```

- [ ] **Step 6: Verify handler routing**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/case-metadata-routing.test.ts tests/main/handlers/case-metadata-logic.test.ts
make typecheck
```

Expected:

- Focused handler tests pass.
- Typecheck passes.

- [ ] **Step 7: Commit IPC routing**

Run:

```bash
git add src/main/ipc/handlers/case-metadata.ts src/main/ipc/handlers/case-metadata-logic.ts tests/main/handlers/case-metadata-routing.test.ts tests/main/handlers/case-metadata-logic.test.ts
git commit -m "refactor(ipc): route case metadata through storage sessions"
```

## Task 6: Complete PostgreSQL Cases Query Metadata Filters

**Files:**

- Modify: `src/main/storage/postgres/PostgresCasesQueryRepository.ts`
- Test: `tests/main/storage/postgres-cases-query-repository.test.ts`

- [ ] **Step 1: Replace unsupported-filter tests with failing parity tests**

Update `tests/main/storage/postgres-cases-query-repository.test.ts`:

```ts
it('filters postgres cases by cohort ids', async () => {
  const pool = {
    query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
  }
  const repository = new PostgresCasesQueryRepository(pool as never, 'public')

  await repository.queryCases({ limit: 25, offset: 0, cohort_ids: [1, 2] })

  expect(pool.query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('ccl_filter.cohort_id = ANY'),
    [[1, 2], 25, 0]
  )
})

it('filters postgres cases by hpo ids', async () => {
  const pool = {
    query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total_count: 0 }] })
  }
  const repository = new PostgresCasesQueryRepository(pool as never, 'public')

  await repository.queryCases({ limit: 25, offset: 0, hpo_ids: ['HP:0001250'] })

  expect(pool.query).toHaveBeenNthCalledWith(
    1,
    expect.stringContaining('cht_filter.hpo_id = ANY'),
    [['HP:0001250'], 25, 0]
  )
})
```

- [ ] **Step 2: Run cases query repository tests and confirm failure**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-cases-query-repository.test.ts
```

Expected:

- FAIL because the repository still throws unsupported-filter errors.

- [ ] **Step 3: Implement cohort and HPO filters**

Modify `src/main/storage/postgres/PostgresCasesQueryRepository.ts`:

- remove the explicit unsupported-filter throws
- add `EXISTS` clauses for filter-only joins
- keep display joins for `cohort_names` and `cohort_ids`
- keep filter and display cohort IDs consistently typed as `bigint[]`; if current display SQL casts `cohort_ids` to `int[]`, update it to `bigint[]`
- include the same filter conditions in the count query

Use this condition shape:

```sql
EXISTS (
  SELECT 1
  FROM "schema"."case_cohort_links" ccl_filter
  WHERE ccl_filter.case_id = c.id
    AND ccl_filter.cohort_id = ANY($n::bigint[])
)
```

and:

```sql
EXISTS (
  SELECT 1
  FROM "schema"."case_hpo_terms" cht_filter
  WHERE cht_filter.case_id = c.id
    AND cht_filter.hpo_id = ANY($n::text[])
)
```

- [ ] **Step 4: Verify cases query repository parity**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-case-metadata-repository.test.ts
make typecheck
```

Expected:

- Focused repository tests pass.
- Typecheck passes.

- [ ] **Step 5: Commit cases query filters**

Run:

```bash
git add src/main/storage/postgres/PostgresCasesQueryRepository.ts tests/main/storage/postgres-cases-query-repository.test.ts
git commit -m "feat(storage): support postgres cases metadata filters"
```

## Task 7: Add Gated Docker-backed PostgreSQL Integration Coverage

**Files:**

- Create: `tests/e2e/postgres-case-metadata-dev-mode.e2e.ts`
- Modify: `tests/e2e/postgres-cases-list-dev-mode.e2e.ts` if shared helper extraction is needed

- [ ] **Step 1: Write gated E2E tests**

Create `tests/e2e/postgres-case-metadata-dev-mode.e2e.ts` with the same skip gate as the existing PostgreSQL E2E:

```ts
test.skip(
  process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
  'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
)
```

Add tests that call renderer APIs:

```ts
await window.api.cases.query({ limit: 25, offset: 0, cohort_ids: [1] })
await window.api.cases.query({ limit: 25, offset: 0, hpo_ids: ['HP:0001250'] })
await window.api.caseMetadata.getFullMetadata(1)
await window.api.caseMetadata.assignHpoTerm(2, 'HP:0000707', 'Abnormality of the nervous system')
```

Expected:

- Tests are skipped unless `VARLENS_RUN_POSTGRES_E2E=1`.
- They are not part of default CI unless explicitly enabled.

- [ ] **Step 2: Run skipped E2E without Docker**

Run:

```bash
npx playwright test tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
```

Expected:

- Tests are skipped with the PostgreSQL E2E gate message.

- [ ] **Step 3: Run Docker-backed E2E locally when Docker is available**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
make pg-down
```

Expected:

- PostgreSQL E2E tests pass when Docker is available.
- This remains outside default CI, but it is required local verification for Phase 6 implementation branches when Docker is available.
- If Docker is unavailable locally, record that the gated Docker E2E was not run and keep default CI verification as the required non-Docker gate.

- [ ] **Step 4: Commit gated E2E**

Run:

```bash
git add tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-cases-list-dev-mode.e2e.ts
git commit -m "test(e2e): cover postgres case metadata dev mode"
```

## Task 8: Final Verification

**Files:**

- All files touched in prior tasks

- [ ] **Step 1: Run focused Phase 6 unit tests**

Run:

```bash
make rebuild-node && npx vitest run \
  tests/main/storage/read-executor-contract.test.ts \
  tests/main/storage/write-executor-contract.test.ts \
  tests/main/storage/sqlite-read-executor.test.ts \
  tests/main/storage/sqlite-write-executor.test.ts \
  tests/main/storage/postgres-read-executor.test.ts \
  tests/main/storage/postgres-write-executor.test.ts \
  tests/main/storage/postgres-case-metadata-repository.test.ts \
  tests/main/storage/postgres-cases-query-repository.test.ts \
  tests/main/storage/postgres-storage-session.test.ts \
  tests/main/handlers/case-metadata-routing.test.ts \
  tests/main/handlers/case-metadata-logic.test.ts
```

Expected:

- All focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
make typecheck
```

Expected:

- PASS.

- [ ] **Step 3: Run default CI**

Run:

```bash
make ci
```

Expected:

- PASS.

- [ ] **Step 4: Gated PostgreSQL E2E**

Run only when Docker is available:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-cases-list-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts
make pg-down
```

Expected:

- PASS when Docker is available.
- If skipped because Docker is unavailable, state that explicitly in the final implementation report.

- [ ] **Step 5: Confirm no catch-all commit is needed**

Run:

```bash
git status --short
```

Expected:

- Working tree is clean except for unrelated pre-existing local changes.
- Prior tasks already committed their focused slices; do not make a broad catch-all commit that could capture opportunistic or unrelated edits.
- No renderer storage settings were added.
- `database:overview` remains unmigrated.

## Self-review Checklist

- [ ] Spec requirement 1 covered: remaining SQLite-only paths are inventoried in the Phase 6 spec matrix.
- [ ] Spec requirement 2 covered: parity matrix includes SQLite implementation, worker path, PostgreSQL status, required work, tests, and user-facing blocker status.
- [ ] Spec requirement 3 covered: next smallest high-leverage slice is case metadata plus cases-query filters.
- [ ] Spec requirement 4 covered: implementation is one backend/domain vertical slice, not broad task-union expansion.
- [ ] Spec requirement 5 covered: `database:overview` is explicitly deferred.
- [ ] Spec requirement 6 covered: Docker-backed PostgreSQL integration is gated outside default CI and required locally when Docker is available.
- [ ] Spec requirement 7 covered: import, export, delete, rebuild, summary rebuild, lifecycle/open/close/health/config appear in the matrix.
- [ ] Spec requirement 8 covered: renderer storage settings remain out of scope.
