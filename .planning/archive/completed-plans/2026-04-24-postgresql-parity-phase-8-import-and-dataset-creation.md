# PostgreSQL Parity Phase 8: Import and Dataset Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Completed

**Goal:** Add PostgreSQL single-file JSON import so PostgreSQL mode can create a real case/dataset from user data and read it back through existing cases, case metadata, and variants APIs.

**Architecture:** Keep SQLite on the existing file-backed `ImportWorkerClient` path and add a narrow `StorageImportExecutor` to the storage-session boundary. PostgreSQL gets a focused JSON import executor/repository that streams mapped JSON variants, writes them transactionally with `pg`, uses `jsonb_to_recordset($1::jsonb)` for batch inserts, refreshes `variant_frequency` once after all batches, and reports the same `import:start` result/progress shape. VCF, multi-file import, export, delete, rebuild, cohort parity, database overview, and renderer PostgreSQL settings stay out of scope.

**Tech Stack:** Electron 40 main process IPC, TypeScript 6, `pg`, PostgreSQL Docker dev workflow, existing JSON import mapper pipeline, Vitest, Playwright Electron E2E, `make rebuild-node`, `make typecheck`, `make ci`

---

## Reference Documents

- Spec: `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md`
- Storage boundary: `.planning/archive/completed-specs/2026-04-23-storage-adapter-boundary-design.md`
- Previous completed phase: `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`
- Phase 7 metadata deferral: `.planning/artifacts/postgres-parity-phase-7-filter-metadata-deferral.md`
- Current SQLite worker import: `src/main/workers/import-worker.ts`
- Testable JSON pipeline: `src/main/workers/import-pipeline.ts`
- Current import IPC logic: `src/main/ipc/handlers/import-logic.ts`
- PostgreSQL session: `src/main/storage/postgres/PostgresStorageSession.ts`

## Branch and PR

Implementation must use one branch and one PR:

```bash
git switch -c feat/postgres-parity-phase-8-json-import
```

Do not commit implementation work to `main`. Planning/archive changes may already exist before the implementation branch is created; preserve them or rebase them intentionally.

## Parallelization Plan

Use `superpowers:subagent-driven-development` after Task 1 lands. The controller dispatches fresh subagents by lane and performs spec-compliance review, then code-quality review, before merging each lane.

| Lane | Starts after | Owned files | Notes |
|---|---|---|---|
| A Schema | Task 0 | `scripts/postgres/init-db/10-phase3-cases.sql`, `20-phase3-seed-cases.sql`, schema smoke tests | Does not touch TypeScript |
| B Contract/SQLite adapter | Task 1 | `src/main/storage/import-executor.ts`, `src/main/storage/session.ts`, `src/main/storage/sqlite/*`, contract/session tests | Shared interface lane; land before D/E |
| C PostgreSQL repository | Task 1 | `src/main/storage/postgres/PostgresJsonImportRepository.ts`, repository tests | Does not touch IPC |
| D PostgreSQL executor/session | Tasks 1 and C API | `src/main/storage/postgres/PostgresImportExecutor.ts`, `PostgresStorageSession.ts`, `src/main/storage/config.ts`, executor/session/config tests | Serializes with C only through API shape |
| E IPC routing | Tasks 1 and B | `src/main/ipc/handlers/import-logic.ts`, `src/main/ipc/handlers/import.ts`, handler tests | Does not edit repository code |
| F Docker E2E red test | Task 0 | `tests/e2e/postgres-json-import-dev-mode.e2e.ts` | Write and verify the end-to-end failing test before implementation lanes A-E |

Do not run two workers on `src/main/storage/session.ts`, `src/main/storage/postgres/PostgresStorageSession.ts`, or `src/main/ipc/handlers/import-logic.ts` at the same time.

## File Structure

### New Files

- `src/main/storage/import-executor.ts` - backend-neutral import request/result/callback types and executor interface.
- `src/main/storage/sqlite/SqliteImportExecutor.ts` - adapter around existing `ImportWorkerClient` behavior.
- `src/main/storage/postgres/PostgresJsonImportRepository.ts` - transaction-scoped PostgreSQL case, variant, extension, provenance, and frequency writes.
- `src/main/storage/postgres/PostgresImportExecutor.ts` - PostgreSQL import orchestration, JSON-only format gate, progress, and cancellation.
- `tests/main/storage/import-executor-contract.test.ts` - import executor contract tests.
- `tests/main/storage/sqlite-import-executor.test.ts` - SQLite adapter dispatch tests with a mocked worker client factory.
- `tests/main/storage/postgres-json-import-repository.test.ts` - mocked `pg` client tests for transaction and SQL behavior.
- `tests/main/storage/postgres-import-executor.test.ts` - JSON-only import orchestration tests covering simple, object, and columnar JSON.
- `tests/e2e/postgres-json-import-dev-mode.e2e.ts` - Docker-backed Electron E2E import test.

### Modified Files

- `scripts/postgres/init-db/10-phase3-cases.sql` - make `cases.id` generated for imported cases.
- `scripts/postgres/init-db/20-phase3-seed-cases.sql` - reset `cases` sequence after explicit seed IDs.
- `scripts/postgres/init-db/README.md` - document that Phase 8 enables generated case IDs for imports.
- `src/main/storage/session.ts` - add `getImportExecutor()`.
- `src/main/storage/sqlite/SqliteStorageSession.ts` - construct and return `SqliteImportExecutor`.
- `src/main/storage/postgres/PostgresStorageSession.ts` - construct and return `PostgresImportExecutor`.
- `src/main/storage/config.ts` - keep PostgreSQL pool connections alive for long imports.
- `src/main/ipc/handlers/import-logic.ts` - route `startImport(...)` through the active storage session.
- `src/main/ipc/handlers/import.ts` - pass `getDbManager` or `getStorageSession` dependency to import logic.
- `tests/main/storage/sqlite-storage-session.test.ts` - assert SQLite import executor is exposed.
- `tests/main/storage/postgres-storage-session.test.ts` - assert PostgreSQL import executor is exposed.
- `tests/main/handlers/import-logic.test.ts` - replace smoke-only coverage with routing and unsupported-format behavior.

### Explicitly Unchanged

- `src/main/workers/export-worker.ts`
- `src/main/workers/delete-worker.ts`
- `src/main/workers/rebuild-summary-worker.ts`
- `src/main/database/DatabaseOverviewService.ts`
- `src/main/database/CohortService.ts`
- renderer PostgreSQL settings and database-selection UI

## Task 0: Baseline Branch and Phase 6 Archive Check

**Files:** no source files

- [ ] **Step 1: Confirm local state**

Run:

```bash
git status --short --branch
git log --oneline -12
```

Expected:

- Phase 6 docs are archived under `.planning/archive/completed-*`.
- Phase 7 docs are archived.
- No implementation starts on `main`.

- [ ] **Step 2: Create the implementation branch**

Run:

```bash
git switch -c feat/postgres-parity-phase-8-json-import
```

Expected:

- Branch is `feat/postgres-parity-phase-8-json-import`.

- [ ] **Step 3: Run focused current PostgreSQL parity tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-case-metadata-repository.test.ts tests/main/storage/postgres-variant-read-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-write-executor.test.ts
```

Expected:

- PASS before Phase 8 changes.

## Task 1: Add Import Executor Contract

**Files:**

- Create: `src/main/storage/import-executor.ts`
- Modify: `src/main/storage/session.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Create: `tests/main/storage/import-executor-contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `tests/main/storage/import-executor-contract.test.ts`:

```ts
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult
} from '../../../src/main/storage/import-executor'

describe('StorageImportExecutor contract', () => {
  it('defines single-file import params and result shape', async () => {
    const params = {
      filePath: '/tmp/import.json',
      caseName: 'PG JSON import',
      vcfOptions: { genomeBuild: 'GRCh38' },
      throttleMs: 100,
      onProgress: vi.fn()
    } satisfies StorageImportSingleFileParams

    const executor: StorageImportExecutor = {
      importSingleFile: vi.fn(async () => ({
        caseId: 4,
        variantCount: 3,
        skipped: 0,
        errors: [],
        elapsed: 12
      })),
      cancel: vi.fn()
    }

    await expect(executor.importSingleFile(params)).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 12
    })
    expectTypeOf<StorageImportSingleFileResult>().toMatchTypeOf<{
      caseId: number
      variantCount: number
      skipped: number
      errors: string[]
      elapsed: number
    }>()
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
npx vitest run tests/main/storage/import-executor-contract.test.ts
```

Expected:

- FAIL because `src/main/storage/import-executor.ts` does not exist.

- [ ] **Step 3: Add the contract**

Create `src/main/storage/import-executor.ts`:

```ts
export interface StorageImportVcfOptions {
  selectedSample?: string
  genomeBuild?: string
}

export interface StorageImportProgress {
  phase: string
  count: number
  elapsed: number
  skipped: number
}

export interface StorageImportSingleFileParams {
  filePath: string
  caseName: string
  vcfOptions?: StorageImportVcfOptions
  throttleMs: number
  onProgress?: (data: StorageImportProgress) => void
}

export interface StorageImportSingleFileResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
}

export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  cancel(): void
}
```

Modify `src/main/storage/session.ts`:

```ts
import type { StorageImportExecutor } from './import-executor'
```

Add to `StorageSession`:

```ts
  getImportExecutor(): StorageImportExecutor
```

Add temporary unsupported executors to both `SqliteStorageSession` and `PostgresStorageSession` so the interface change is type-complete before backend implementations replace them:

```ts
const unsupportedImportExecutor: StorageImportExecutor = {
  async importSingleFile(): Promise<never> {
    throw new Error('Storage import executor is not implemented for this backend yet')
  },
  cancel(): void {}
}
```

Each session should return that object from `getImportExecutor()` until Task 2 and Task 6 replace it with real implementations.

- [ ] **Step 4: Verify green**

Run:

```bash
npx vitest run tests/main/storage/import-executor-contract.test.ts
make typecheck
```

Expected:

- Contract test passes.
- `make typecheck` passes because both session implementations expose a temporary import executor.

## Task 2: Add SQLite Import Executor Adapter

**Files:**

- Create: `src/main/storage/sqlite/SqliteImportExecutor.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `tests/main/storage/sqlite-storage-session.test.ts`
- Create: `tests/main/storage/sqlite-import-executor.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/main/storage/sqlite-import-executor.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'

describe('SqliteImportExecutor', () => {
  it('delegates single-file import to the existing worker client shape', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => 'secret',
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            filePath: '/tmp/input.json',
            caseName: 'Imported',
            duplicateStrategy: 'skip'
          })
        ],
        dbPath: '/tmp/test.varlens',
        encryptionKey: 'secret'
      })
    )

    const callbacks = start.mock.calls[0][0]
    callbacks.onFileComplete({ type: 'file-complete', fileIndex: 0, result: { caseId: 7, caseName: 'Imported', variantCount: 3, skipped: 0, elapsed: 5 } })
    callbacks.onComplete({ type: 'complete', results: { succeeded: 1, failed: 0, skipped: 0, cancelled: false, details: [{ filePath: '/tmp/input.json', fileName: 'input.json', caseName: 'Imported', status: 'success', variantCount: 3 }] } })

    await expect(promise).resolves.toStrictEqual({
      caseId: 7,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 5
    })
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
npx vitest run tests/main/storage/sqlite-import-executor.test.ts
```

Expected:

- FAIL because `SqliteImportExecutor` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `src/main/storage/sqlite/SqliteImportExecutor.ts` by moving the existing single-file worker orchestration from `startImport(...)` into a class. Preserve:

- worker singleton protection per executor instance,
- duplicate strategy `skip`,
- `db.variants.updateFrequencies(capturedCaseId)` on successful import,
- elapsed time from the worker `onFileComplete` result,
- cancellation result shape,
- worker fatal error rejection.

Constructor shape:

```ts
interface SqliteImportExecutorOptions {
  getDatabaseService: () => DatabaseService
  createWorkerClient?: () => ImportWorkerClient
}
```

Class shape:

```ts
export class SqliteImportExecutor implements StorageImportExecutor {
  async importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  cancel(): void
}
```

Modify `SqliteStorageSession` to construct one `SqliteImportExecutor` and return it from `getImportExecutor()`.

- [ ] **Step 4: Verify green**

Run:

```bash
npx vitest run tests/main/storage/sqlite-import-executor.test.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/import-executor-contract.test.ts
make typecheck
```

Expected:

- Tests pass.
- Typecheck passes with SQLite using the real adapter and PostgreSQL still using the temporary unsupported executor from Task 1.

## Task 3: Add Docker-backed PostgreSQL JSON Import E2E Red Test

**Files:**

- Create: `tests/e2e/postgres-json-import-dev-mode.e2e.ts`

- [ ] **Step 1: Write the failing E2E**

Create `tests/e2e/postgres-json-import-dev-mode.e2e.ts`:

```ts
import { expect, test } from '@playwright/test'
import { join } from 'node:path'

import {
  dismissDisclaimerIfPresent,
  launchElectronApp,
  waitForAppShell
} from './helpers/electron-app'

function expectSuccessfulIpcResult<T>(result: T): T {
  expect(result).not.toEqual(
    expect.objectContaining({
      code: expect.any(String),
      message: expect.any(String),
      userMessage: expect.any(String)
    })
  )
  return result
}

test('postgres dev mode imports a JSON file and reads the created dataset', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 after starting the local postgres container to run this test.'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL:
          process.env.VARLENS_PG_URL ??
          'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev',
        VARLENS_PG_SCHEMA: process.env.VARLENS_PG_SCHEMA ?? 'public'
      }
    })

    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    const fixturePath = join(process.cwd(), 'tests/fixtures/import/simple-format.json')
    const caseName = `PG JSON Import ${Date.now()}`

    const results = await launched.window.evaluate(
      async ({ fixturePath, caseName }) => {
        const importResult = await window.api.import.start(fixturePath, caseName)
        const unwrappedImport =
          typeof importResult === 'object' &&
          importResult !== null &&
          'code' in importResult
            ? { caseId: 0, variantCount: 0 }
            : importResult
        return {
          importResult,
          cases: await window.api.cases.query({ limit: 25, offset: 0, search_term: caseName }),
          dataInfo: await window.api.caseMetadata.getDataInfo(unwrappedImport.caseId),
          typeCounts: await window.api.variants.typeCounts(unwrappedImport.caseId),
          brca1: await window.api.variants.query(
            unwrappedImport.caseId,
            { gene_symbol: 'BRCA1' },
            0,
            25
          ),
          fullText: await window.api.variants.query(
            unwrappedImport.caseId,
            { search_query: 'BRCA1' },
            0,
            25
          ),
          internalAf: await window.api.variants.query(
            unwrappedImport.caseId,
            { max_internal_af: 1 },
            0,
            25
          )
        }
      },
      { fixturePath, caseName }
    )

    const importResult = expectSuccessfulIpcResult(results.importResult)
    expect(importResult.caseId).toBeGreaterThan(3)
    expect(importResult.variantCount).toBe(3)

    expect(expectSuccessfulIpcResult(results.cases)).toMatchObject({
      total_count: 1,
      data: [
        expect.objectContaining({
          id: importResult.caseId,
          name: caseName,
          variant_count: 3,
          genome_build: 'GRCh38'
        })
      ]
    })

    expect(expectSuccessfulIpcResult(results.dataInfo)).toMatchObject({
      case_id: importResult.caseId,
      import_file_name: 'simple-format.json',
      import_file_type: 'simple'
    })

    expect(expectSuccessfulIpcResult(results.typeCounts)).toMatchObject({ snv: 3 })
    expect(expectSuccessfulIpcResult(results.brca1)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1', consequence: 'HIGH' })]
    })
    expect(expectSuccessfulIpcResult(results.fullText)).toMatchObject({
      total_count: 1,
      data: [expect.objectContaining({ gene_symbol: 'BRCA1' })]
    })
    expect(expectSuccessfulIpcResult(results.internalAf)).toMatchObject({ total_count: 3 })
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
```

This E2E is the red acceptance test for both PostgreSQL import routing and generated imported case IDs:

```ts
expect(importResult.caseId).toBeGreaterThan(3)
```

- [ ] **Step 2: Verify red against Docker**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts
make pg-down
```

Expected:

- FAIL before implementation because PostgreSQL import is not routed or `cases.id` cannot be generated.

## Task 4: Enable Generated PostgreSQL Case IDs

**Files:**

- Modify: `scripts/postgres/init-db/10-phase3-cases.sql`
- Modify: `scripts/postgres/init-db/20-phase3-seed-cases.sql`
- Modify: `scripts/postgres/init-db/README.md`

- [ ] **Step 1: Update PostgreSQL schema**

Change `scripts/postgres/init-db/10-phase3-cases.sql`:

```sql
CREATE TABLE IF NOT EXISTS cases (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  variant_count BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  genome_build TEXT NOT NULL DEFAULT 'GRCh38'
);
```

Append to `scripts/postgres/init-db/20-phase3-seed-cases.sql`:

```sql
SELECT setval(pg_get_serial_sequence('public.cases', 'id'), COALESCE((SELECT MAX(id) FROM cases), 1), true);
```

Update `scripts/postgres/init-db/README.md` to say Phase 8 requires `cases.id` to be generated so imports can create new datasets after seeded IDs.

- [ ] **Step 2: Verify with Docker schema reset**

Run:

```bash
make pg-reset
make pg-up
docker compose -f docker-compose.postgres.yml --env-file .env.postgres.local exec -T postgres sh -lc "psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -c \"INSERT INTO cases (name, file_path, file_size, variant_count, created_at, genome_build) VALUES ('Generated ID Smoke', '/tmp/generated.json', 1, 0, 1714060810000, 'GRCh38') RETURNING id;\""
make pg-down
```

Expected:

- Returned `id` is greater than 3.

## Task 5: Add PostgreSQL JSON Import Repository

**Files:**

- Create: `src/main/storage/postgres/PostgresJsonImportRepository.ts`
- Create: `tests/main/storage/postgres-json-import-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create tests that use a mocked `pg.Pool` with `connect()`, a client with `query`, and `release`. Cover:

- `BEGIN`, `COMMIT`, and `release()` on success,
- `ROLLBACK` and `release(expect.any(Error))` on insert failure so a dirty PostgreSQL client is not returned to the pool,
- duplicate case name throws `Duplicate case name`,
- case insert uses generated ID with `RETURNING id`,
- base variant batch insert uses `jsonb_to_recordset($1::jsonb)` and one JSON parameter,
- batch payloads carry an explicit `import_ordinal` when the result must be joined back to input rows,
- extension-bearing variant IDs are mapped back to input rows deterministically,
- extension table inserts use `jsonb_to_recordset($1::jsonb)` after generated `variant_id` values are known,
- `case_data_info` receives import file name and import type using only columns from `11-phase6-case-metadata.sql`,
- `variant_frequency` is refreshed once after all variant batches are inserted, using a grouped query from `variants WHERE case_id = $1`,
- duplicate coordinates within one imported case increment `variant_frequency.case_count` exactly once for that coordinate,
- imported rows have non-null `search_document`, proving the Phase 7 trigger path is active,
- two variant batches are inserted inside the same transaction without accumulating the entire file in the repository.

Use this minimum test skeleton:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresJsonImportRepository } from '../../../src/main/storage/postgres/PostgresJsonImportRepository'

function makeClient(rowsByCall: Array<{ rows: unknown[] }>) {
  const query = vi.fn(async () => rowsByCall.shift() ?? { rows: [], rowCount: 0 })
  return {
    query,
    release: vi.fn()
  }
}

describe('PostgresJsonImportRepository', () => {
  it('creates a case, inserts variants, stores provenance, refreshes frequency, and commits', async () => {
    const client = makeClient([
      { rows: [] },
      { rows: [{ id: '4' }] },
      { rows: [{ id: '10' }, { id: '11' }] },
      { rows: [] },
      { rows: [] },
      { rows: [] }
    ])
    const pool = { connect: vi.fn(async () => client) }
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await expect(
      repository.runJsonImport(
        {
          filePath: '/tmp/simple-format.json',
          fileName: 'simple-format.json',
          caseName: 'Imported JSON',
          fileSize: 100,
          genomeBuild: 'GRCh38'
        },
        async (session) => {
          await session.insertVariantBatch([
            { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: 'BRCA1', consequence: 'HIGH' },
            { chr: '7', pos: 67890, ref: 'C', alt: 'T', gene_symbol: 'CFTR', consequence: 'MODERATE' }
          ])
        }
      )
    ).resolves.toStrictEqual({ caseId: 4, variantCount: 2 })

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_to_recordset($1::jsonb)'),
      expect.any(Array)
    )
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
npx vitest run tests/main/storage/postgres-json-import-repository.test.ts
```

Expected:

- FAIL because `PostgresJsonImportRepository` does not exist.

- [ ] **Step 3: Implement repository**

Create `PostgresJsonImportRepository` with:

```ts
export interface PostgresJsonImportRequest {
  filePath: string
  fileName: string
  caseName: string
  fileSize: number
  genomeBuild: string
}

export interface PostgresJsonImportBatchResult {
  caseId: number
  variantCount: number
}

export interface PostgresJsonImportSession {
  readonly caseId: number
  insertVariantBatch(variants: Array<Record<string, unknown>>): Promise<number>
}
```

Implement `runJsonImport(request, writeVariants)` with one checked-out client transaction:

- `SELECT id FROM "schema"."cases" WHERE name = $1`
- `INSERT INTO "schema"."cases" (name, file_path, file_size, variant_count, created_at, genome_build) ... RETURNING id`
- expose `PostgresJsonImportSession.insertVariantBatch(...)` to the callback
- `insertVariantBatch(...)` must use `jsonb_to_recordset($1::jsonb)` instead of multi-row `VALUES`, keeping each batch to one bind parameter and avoiding the PostgreSQL 65,535 parameter wire-protocol limit.
- include `import_ordinal` in JSON batch payloads whenever input-to-output mapping is needed.
- do not rely on PostgreSQL returning rows in input order from `INSERT ... RETURNING`.
- use one deterministic strategy for generated ID mapping:
  - for base-only rows, the repository may ignore returned row order because no extension rows need an input-to-ID map,
  - for extension-bearing rows, insert those base rows one row at a time and immediately use the returned `id`, or use a valid transaction-local staging table with explicit `import_ordinal` and a real join back to staged rows. Do not require or implement invalid SQL that returns source-only ordinal columns directly from `INSERT ... RETURNING`.
- extension inserts must be keyed by the deterministic ID mapping for `_transcripts`, `_sv`, `_cnv`, `_str`
- extension table inserts should also use `jsonb_to_recordset($1::jsonb)` with payloads that already include `variant_id`.
- `INSERT INTO "schema"."case_data_info" (...) ON CONFLICT (case_id) DO UPDATE ...` using the Phase 6 columns from `scripts/postgres/init-db/11-phase6-case-metadata.sql`; do not introduce `import_date` or other new columns in Phase 8.
- `UPDATE "schema"."cases" SET variant_count = $1 WHERE id = $2`
- verify `search_document IS NOT NULL` for at least one inserted variant in repository tests. PostgreSQL Phase 7 owns the trigger, but Phase 8 must not bypass it.
- refresh `variant_frequency` exactly once after `writeVariants` completes:

```sql
INSERT INTO "schema"."variant_frequency" (chr, pos, ref, alt, case_count)
SELECT chr, pos, ref, alt, 1
FROM "schema"."variants"
WHERE case_id = $1
GROUP BY chr, pos, ref, alt
ON CONFLICT (chr, pos, ref, alt)
DO UPDATE SET case_count = "schema"."variant_frequency".case_count + 1
```

- on any failure after `BEGIN`, run `ROLLBACK` and then call `client.release(error)` with a truthy error value. On success, call `client.release()` with no argument.

Use `quoteIdentifier` from `src/main/storage/postgres/identifiers.ts` for schema/table names. Convert PostgreSQL string IDs to numbers before returning.

- [ ] **Step 4: Verify green**

Run:

```bash
npx vitest run tests/main/storage/postgres-json-import-repository.test.ts
make typecheck
```

Expected:

- Repository tests pass.
- Typecheck passes with the repository compiled and the PostgreSQL session still using the temporary unsupported executor from Task 1.

## Task 6: Add PostgreSQL Import Executor and Session Wiring

**Files:**

- Create: `src/main/storage/postgres/PostgresImportExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `src/main/storage/config.ts`
- Modify/Create: `tests/main/storage/config.test.ts`
- Modify: `tests/main/storage/postgres-storage-session.test.ts`
- Create: `tests/main/storage/postgres-import-executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

Create tests for:

- simple JSON import streams `tests/fixtures/import/simple-format.json` through the mapper and calls repository with three variants,
- object JSON import streams `tests/fixtures/import/object-format.json` through the mapper and calls repository with its mapped variants,
- columnar JSON import streams `tests/fixtures/import/columnar-format.json` through the mapper and calls repository with its mapped variants,
- VCF input rejects with `PostgreSQL import currently supports JSON files only`,
- cancellation before the first batch resolves with cancellation result,
- cancellation between batches rolls back the transaction through the repository path and does not commit or leave a partial case row; cover with either an integration-style repository test or mocked-client assertions for `ROLLBACK`, no `COMMIT`, and `release(expect.any(Error))`,
- progress callback receives `parsing` and `inserting` phases.

Use dependency injection:

```ts
const executor = new PostgresImportExecutor({
  repository,
  detectFormat: async () => ({ format: 'simple' }),
  createMapperPipeline: async () => Readable.from([{ chr: '1', pos: 1, ref: 'A', alt: 'G' }]),
  statFile: () => ({ size: 100 }),
  now: () => 1714060810000
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
npx vitest run tests/main/storage/postgres-import-executor.test.ts
```

Expected:

- FAIL because `PostgresImportExecutor` does not exist.

- [ ] **Step 3: Implement executor**

Create `PostgresImportExecutor` that:

- calls injected or default `detectFormat(filePath)`,
- accepts `simple`, `object`, and `columnar`,
- rejects `vcf`,
- streams mapper output into bounded batches,
- calls `repository.runJsonImport(...)` once and writes every bounded batch through the transaction session,
- emits progress using the existing import result shape,
- checks `this.cancelled` between batches,
- resets cancellation state after completion.

Use a Phase 8 batch size constant such as:

```ts
const POSTGRES_JSON_IMPORT_BATCH_SIZE = 1000
```

- [ ] **Step 4: Wire session**

Modify `PostgresStorageSession`:

- construct `PostgresJsonImportRepository`,
- construct `PostgresImportExecutor`,
- return it from `getImportExecutor()`.
- keep the existing `pool.on('error', ...)` registration in `PostgresStorageSession`; do not remove the session-level pool error logging while adding import support.

Modify `src/main/storage/config.ts`:

- add `keepAlive: true` to the PostgreSQL pool configuration to reduce long-import connection stalls.
- add a focused config test asserting the pool config enables `keepAlive`.

- [ ] **Step 5: Verify green**

Run:

```bash
npx vitest run tests/main/storage/postgres-import-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/config.test.ts tests/main/storage/import-executor-contract.test.ts
make typecheck
```

Expected:

- Tests pass.
- Typecheck passes with all session implementations exposing `getImportExecutor()`.

## Task 7: Route import:start Through Storage Session

**Files:**

- Modify: `src/main/ipc/handlers/import-logic.ts`
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: `tests/main/handlers/import-logic.test.ts`

- [ ] **Step 1: Write failing routing tests**

Replace the smoke-only import logic test with behavior tests:

```ts
import { describe, expect, it, vi } from 'vitest'

import { startImport } from '../../../src/main/ipc/handlers/import-logic'

describe('startImport', () => {
  it('uses the active storage session import executor', async () => {
    const importSingleFile = vi.fn(async () => ({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    }))
    const session = {
      getImportExecutor: () => ({ importSingleFile, cancel: vi.fn() })
    }

    await expect(
      startImport('/tmp/input.json', 'Imported', undefined, () => session as never, {})
    ).resolves.toStrictEqual({
      caseId: 4,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 10
    })

    expect(importSingleFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/input.json',
        caseName: 'Imported'
      })
    )
  })
})
```

- [ ] **Step 2: Verify red**

Run:

```bash
npx vitest run tests/main/handlers/import-logic.test.ts
```

Expected:

- FAIL because `startImport` still accepts `getDb: () => DatabaseService`.

- [ ] **Step 3: Refactor import logic**

Change `startImport` signature to accept a session provider:

```ts
export function startImport(
  filePath: string,
  caseName: string,
  vcfOptions: VcfImportOptions | undefined,
  getSession: () => StorageSession,
  callbacks: ImportCallbacks
): Promise<ImportResult>
```

Implementation:

```ts
const executor = getSession().getImportExecutor()
return await executor.importSingleFile({
  filePath,
  caseName,
  vcfOptions,
  throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
  onProgress: callbacks.onProgress
})
```

Keep `cancelImport()` by tracking the active `StorageImportExecutor` instead of a worker client.

Modify `import.ts` to pass the active session from `DatabaseManager`. `HandlerDependencies` already exposes `getDbManager`, and `DatabaseManager` already exposes `getCurrentSession()`, so keep the wiring narrow:

```ts
const getSession = () => getDbManager().getCurrentSession()
```

Do not modify renderer or preload APIs.

- [ ] **Step 4: Preserve multi-file SQLite behavior**

`startMultiFileImport(...)` may continue accepting `getDb: () => DatabaseService` and remain SQLite-only in Phase 8. Add a guard so PostgreSQL sessions reject `import:startMultiFile` with:

```text
PostgreSQL multi-file import is not supported in Phase 8
```

The guard belongs in handler/logic routing, not renderer UI.

- [ ] **Step 5: Verify green**

Run:

```bash
npx vitest run tests/main/handlers/import-logic.test.ts tests/main/handlers/batch-import-logic.test.ts
make typecheck
```

Expected:

- Import routing tests pass.
- Existing batch import tests still pass for SQLite behavior.

## Task 8: Verify Docker-backed PostgreSQL JSON Import E2E

**Files:**

- Modify: `tests/e2e/postgres-json-import-dev-mode.e2e.ts` only if the existing red test from Task 3 needs a contract correction

- [ ] **Step 1: Confirm the red E2E still matches the final IPC contract**

Check that `tests/e2e/postgres-json-import-dev-mode.e2e.ts` still uses:

```ts
window.api.cases.query({ limit: 25, offset: 0, search_term: caseName })
```

Expected:

- No `search` property is used for case search.
- The E2E asserts the imported case has `genome_build: 'GRCh38'`, documenting the Phase 8 JSON default.
- The E2E asserts `variants.query(caseId, { search_query: 'BRCA1' }, ...)` returns the imported row, proving the PostgreSQL `search_document` trigger path works for imported data.

- [ ] **Step 2: Verify green after Tasks 4-7**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts
make pg-down
```

Expected:

- New import E2E passes.
- Existing PostgreSQL case metadata and variant read E2E still pass.

## Task 9: Final Verification and PR

**Files:** no new source files unless verification exposes a bug

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npx vitest run tests/main/storage/import-executor-contract.test.ts tests/main/storage/sqlite-import-executor.test.ts tests/main/storage/postgres-json-import-repository.test.ts tests/main/storage/postgres-import-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/config.test.ts tests/main/handlers/import-logic.test.ts
```

Expected:

- All focused Phase 8 tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
make typecheck
```

Expected:

- Typecheck passes.

- [ ] **Step 3: Run minimum CI**

Run:

```bash
make ci
```

Expected:

- `lint-check`, `format-check`, `typecheck`, `rebuild-node`, and Vitest pass.

- [ ] **Step 4: Run Docker-backed PostgreSQL validation**

Run:

```bash
make pg-reset
make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts tests/e2e/postgres-case-metadata-dev-mode.e2e.ts tests/e2e/postgres-variants-read-dev-mode.e2e.ts
make pg-down
```

Expected:

- All gated PostgreSQL E2E tests pass. If Docker is unavailable, do not mark this complete; record the exact Docker error in the PR.

- [ ] **Step 5: Review scope before PR**

Check:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected changed areas:

- PostgreSQL init schema/seed files,
- storage import executor files,
- import IPC logic tests/routing,
- PostgreSQL JSON import tests,
- Docker E2E test.

No changes should appear in renderer PostgreSQL settings, export, delete, rebuild, cohort parity, or database overview.

- [ ] **Step 6: Open one PR**

Use a conventional commit history and open one PR from:

```text
feat/postgres-parity-phase-8-json-import
```

PR summary must include:

- JSON import is supported for PostgreSQL.
- VCF and multi-file import are explicitly deferred.
- Docker PostgreSQL validation command and result.
- Any known Docker unavailability or residual risk.
