# PostgreSQL Parity Phase 9: VCF Import and PostgreSQL Import Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Proposed

**Goal:** Add PostgreSQL VCF import (single-file, single-sample-per-file, multi-file/append-within-import, BED filter, extension tables) and move all PG import work — JSON and VCF — into a `worker_threads`-based PostgreSQL import worker. The Electron main process must never block on parsing or batched writes.

**Architecture:** New `worker_threads` worker (`postgres-import-worker.ts`) mirroring the SQLite `import-worker.ts` shape. The worker creates one `pg.Client` per import call, owns transaction lifecycle (BEGIN/COMMIT/ROLLBACK), and dispatches to two transaction-scoped repositories (`PostgresJsonImportRepository.writeJsonImport`, `PostgresVcfImportRepository.writeVcfFile`). Phase 8's main-process executor body is replaced by a thin worker dispatcher (`PostgresImportWorkerClient`). Single-file is one transaction; multi-file is one transaction per file plus a post-loop bookkeeping transaction. SQLite import path remains unchanged.

**Tech Stack:** Electron 40 main IPC, TypeScript 6, `pg` (pure JS — no native bindings, safe in `worker_threads`), Node `worker_threads`, PostgreSQL Docker dev workflow, GIAB Chinese Trio + HG002 fixtures, Vitest, Playwright Electron E2E, `make rebuild-node`, `make typecheck`, `make ci`.

---

## Reference Documents

- Spec: `.planning/specs/2026-04-25-postgresql-parity-phase-9-vcf-import-and-import-worker.md`
- Storage boundary: `.planning/archive/completed-specs/2026-04-23-storage-adapter-boundary-design.md`
- Phase 8 (JSON import): `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md`
- Phase 7 (variant reads): `.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-7-variants-read-parity.md`
- SQLite import worker pattern: `src/main/workers/import-worker.ts`, `src/main/workers/import-worker-client.ts`
- SQLite multi-file behavior reference: `src/main/ipc/handlers/import-logic.ts` lines 300–399
- PG config helper: `src/main/storage/config.ts` `buildPostgresPoolConfig`

## Branch and PR

The branch already exists and the spec was committed. Implementation work continues on the same branch:

```bash
git status --short --branch
# expect: ## feat/postgres-parity-phase-9-vcf-import-and-import-worker
```

Do not commit implementation work to `main`. The single PR for Phase 9 will include the spec, this plan, all source/test changes, and any AGENTS.md/.gitignore updates.

## Parallelization Plan

Use `superpowers:subagent-driven-development` after Task 4 lands (the worker shell + message types). Earlier tasks must be sequential because they reshape the repository contract every other lane builds on.

| Lane | Starts after | Owned files | Notes |
|---|---|---|---|
| A — Foundation | none | repo + executor + types + config helper | Sequential through Task 4. Establishes the shape the rest of the plan depends on. |
| B — Worker shell + JSON migration | Task 4 | `postgres-import-worker.ts` (JSON branch only), `PostgresImportWorkerClient.ts`, executor wiring | Land before C/D begin. |
| C — VCF repository | Task 4 (types) | `PostgresVcfImportRepository.ts`, repo tests | Independent of worker dispatch; consumes only the message-type contract. |
| D — VCF + multi-file in worker | Tasks B and C land | `postgres-import-worker.ts` (VCF + multi-file branches), worker tests | Serializes with C through the repo API and with B through the worker file. |
| E — SQLite executor extension | Task 4 | `SqliteImportExecutor.ts` (`importMultiFile`), tests | Independent of all PG lanes. |
| F — IPC routing | Tasks B and E | `import-logic.ts`, `import.ts`, handler tests | Touches the shared handler files; serialize with itself. |
| G — Docker E2E + WGS perf | Task F | `tests/e2e/postgres-vcf-*.e2e.ts`, `tests/perf/*-wgs-import.perf.test.ts`, `scripts/perf/compare-wgs-import.mjs`, `scripts/postgres/download-wgs-fixture.sh`, `AGENTS.md`, `.gitignore` | Final lane. Tests can be split per file. |

Do not run two workers on `src/main/storage/postgres/PostgresJsonImportRepository.ts`, `src/main/storage/postgres/PostgresImportExecutor.ts`, `src/main/workers/postgres-import-worker.ts`, or `src/main/ipc/handlers/import-logic.ts` simultaneously.

## File Structure

### New Files

- `src/main/workers/postgres-import-worker.ts` — `worker_threads` worker. Receives start/cancel messages. Opens single `pg.Client`, dispatches to JSON or VCF repo based on detected format and import mode (single vs multi-file), owns BEGIN/COMMIT/ROLLBACK, posts progress/file-complete/complete/error.
- `src/main/storage/postgres/PostgresImportWorkerClient.ts` — main-process spawner. `start(callbacks)`, `cancel()`. Mirrors `ImportWorkerClient` shape.
- `src/main/storage/postgres/PostgresVcfImportRepository.ts` — VCF transaction-scoped writes. `writeVcfFile(client, request, ...)`. No transaction lifecycle SQL inside the repo.
- `src/shared/types/postgres-import-worker.ts` — `PostgresImportWorkerStartMessage`, `PostgresImportWorkerMessage`, `PostgresClientConfig` types.
- `tests/main/storage/postgres-vcf-import-repository.test.ts`
- `tests/main/storage/postgres-import-worker-client.test.ts`
- `tests/main/workers/postgres-import-worker.test.ts`
- `tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts`
- `tests/e2e/postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts`
- `tests/e2e/postgres-import-renderer-responsive.e2e.ts`
- `tests/perf/postgres-vcf-wgs-import.perf.test.ts`
- `tests/perf/sqlite-vcf-wgs-import.perf.test.ts`
- `scripts/perf/compare-wgs-import.mjs`
- `scripts/postgres/download-wgs-fixture.sh`

### Modified Files

- `src/main/storage/postgres/PostgresImportExecutor.ts` — both methods become thin worker-client dispatchers; Phase 8 main-process body removed.
- `src/main/storage/postgres/PostgresJsonImportRepository.ts` — `runJsonImport` → `writeJsonImport(client, ...)`. No transaction lifecycle. Frequency rebuild extracted into a separate helper.
- `src/main/storage/import-executor.ts` — add `importMultiFile` method, params/result types, and `StorageImportFileFilters` shape.
- `src/main/storage/sqlite/SqliteImportExecutor.ts` — implement `importMultiFile` by delegating to the existing `ImportWorkerClient` multi-file flow.
- `src/main/storage/config.ts` — extract `buildPostgresClientConfig(config)` shared helper; have `buildPostgresPoolConfig` call it.
- `src/main/ipc/handlers/import-logic.ts` — VCF detection routes through `session.getImportExecutor().importSingleFile(...)`; multi-file routes through `session.getImportExecutor().importMultiFile(...)`. SQLite multi-file post-loop bookkeeping stays inline (already SQLite-specific).
- `src/main/ipc/handlers/import.ts` — pass storage session to multi-file path; for PG path, defer `BedFilter.fromFile` to the worker by passing the path through.
- `tests/main/storage/import-executor-contract.test.ts` — extend contract for `importMultiFile`.
- `tests/main/storage/sqlite-import-executor.test.ts` — assert `importMultiFile` delegates.
- `tests/main/storage/postgres-import-executor.test.ts` — replace main-process expectations with worker-client expectations.
- `tests/main/storage/postgres-json-import-repository.test.ts` — update for `writeJsonImport(client, ...)`; assert no transaction-lifecycle SQL is issued from the repo.
- `tests/main/handlers/import-logic.test.ts` — VCF + multi-file routing on both backends; PG pre-existing-case rejection.
- `electron-vite.config.ts` — register `postgres-import-worker.ts` in the main-process worker entry list.
- `AGENTS.md` — new "WGS perf benchmarks" subsection: run command, gate env var, artifact location.
- `.gitignore` — add `tests/.cache/wgs/` and `.planning/artifacts/perf/wgs-import/`.

### Explicitly Unchanged

- `src/main/import/vcf/*` — VCF parsing modules consumed unchanged.
- `src/main/workers/import-worker.ts`, `src/main/workers/import-worker-client.ts` — SQLite worker untouched.
- `src/shared/ipc/domains/import.ts` — IPC contract unchanged.
- `src/main/workers/export-worker.ts`, `delete-worker.ts`, `rebuild-summary-worker.ts` — out of scope.
- `src/main/database/DatabaseOverviewService.ts`, `CohortService.ts` — out of scope.

---

## Task 0: Baseline Branch and Phase 8 Archive Verification

**Files:** none

- [ ] **Step 1: Confirm local state**

```bash
git status --short --branch
git log --oneline -8
```

Expected:

- Branch is `feat/postgres-parity-phase-9-vcf-import-and-import-worker`.
- Most recent commits include the Phase 9 spec write + revision (`docs(planning): spec postgres parity phase 9 …`, `docs(planning): rewrite phase 9 spec to address review findings`).
- Phase 8 spec/plan are archived (`.planning/archive/completed-specs/2026-04-24-postgresql-parity-phase-8-import-and-dataset-creation.md`, `.planning/archive/completed-plans/...`).

- [ ] **Step 2: Run focused current PostgreSQL parity tests as a baseline**

```bash
make rebuild-node
npx vitest run \
  tests/main/storage/postgres-json-import-repository.test.ts \
  tests/main/storage/postgres-import-executor.test.ts \
  tests/main/storage/import-executor-contract.test.ts \
  tests/main/storage/sqlite-import-executor.test.ts \
  tests/main/handlers/import-logic.test.ts
```

Expected:

- All five test files pass green. They are the baseline regression gate for Tasks 1–10.

---

## Task 1: Extract `buildPostgresClientConfig` Shared Helper

**Files:**
- Modify: `src/main/storage/config.ts`
- Modify: `tests/main/storage/config.test.ts`

The PG worker needs the same connection settings (statement_timeout, query_timeout, lock_timeout, idle_in_transaction_session_timeout, application_name, ssl, keepAlive) the main-process pool uses, minus pool-only fields. Extract a shared helper now so the worker and the existing pool both consume the same source of truth.

- [ ] **Step 1: Write the failing config-helper test**

Add to `tests/main/storage/config.test.ts`:

```typescript
import { buildPostgresClientConfig, buildPostgresPoolConfig } from '../../../src/main/storage/config'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'

describe('buildPostgresClientConfig', () => {
  it('returns the same connection-related fields as buildPostgresPoolConfig minus pool-only fields', () => {
    const config: PostgresStorageConfig = {
      url: 'postgres://user:pw@127.0.0.1:5432/db',
      schema: 'public',
      applicationName: 'varlens-test',
      sslMode: 'disable',
      connectionTimeoutMillis: 1000,
      statementTimeoutMs: 60000,
      queryTimeoutMs: 60000,
      lockTimeoutMs: 5000,
      idleInTransactionSessionTimeoutMs: 30000,
      poolMax: 4
    }

    const pool = buildPostgresPoolConfig(config)
    const client = buildPostgresClientConfig(config)

    // Pool-only fields are absent.
    expect((client as Record<string, unknown>).max).toBeUndefined()

    // All connection fields match.
    expect(client.connectionString).toBe(pool.connectionString)
    expect(client.application_name).toBe(pool.application_name)
    expect(client.connectionTimeoutMillis).toBe(pool.connectionTimeoutMillis)
    expect(client.statement_timeout).toBe(pool.statement_timeout)
    expect(client.query_timeout).toBe(pool.query_timeout)
    expect(client.lock_timeout).toBe(pool.lock_timeout)
    expect(client.idle_in_transaction_session_timeout).toBe(pool.idle_in_transaction_session_timeout)
    expect(client.keepAlive).toBe(pool.keepAlive)
    expect(client.ssl).toEqual(pool.ssl)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/config.test.ts -t buildPostgresClientConfig
```

Expected: FAIL with `buildPostgresClientConfig is not a function` or import error.

- [ ] **Step 3: Implement the helper**

Replace the body of `buildPostgresPoolConfig` and add `buildPostgresClientConfig` in `src/main/storage/config.ts`:

```typescript
import type { ClientConfig, PoolConfig } from 'pg'

export function buildPostgresClientConfig(config: PostgresStorageConfig): ClientConfig {
  return {
    connectionString: config.url,
    application_name: config.applicationName,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    idle_in_transaction_session_timeout: config.idleInTransactionSessionTimeoutMs,
    keepAlive: true,
    ssl: buildPostgresSslConfig(config.sslMode)
  }
}

export function buildPostgresPoolConfig(config: PostgresStorageConfig): PoolConfig {
  return {
    ...buildPostgresClientConfig(config),
    max: config.poolMax
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/storage/config.test.ts
```

Expected: all tests green, including the existing `buildPostgresPoolConfig` test (unchanged behavior).

- [ ] **Step 5: Run typecheck**

```bash
make typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main/storage/config.ts tests/main/storage/config.test.ts
git commit -m "refactor(storage): extract buildPostgresClientConfig shared helper"
```

---

## Task 2: Refactor `PostgresJsonImportRepository` to Transaction-Scoped API

**Files:**
- Modify: `src/main/storage/postgres/PostgresJsonImportRepository.ts`
- Modify: `tests/main/storage/postgres-json-import-repository.test.ts`
- Modify: `src/main/storage/postgres/PostgresImportExecutor.ts` (caller update)
- Modify: `tests/main/storage/postgres-import-executor.test.ts` (caller update)

The Phase 8 repository owns the transaction (`pool.connect()`, `BEGIN`, `COMMIT`/`ROLLBACK`, `release`). Phase 9 splits transaction lifecycle out: the worker (or the main-process executor in this transitional task) owns the client and transaction; the repository accepts an open `Client` and runs only schema/SQL. Frequency rebuild moves to a separate helper called by the caller, so it can run once at end-of-import in multi-file mode and inline in single-file mode.

- [ ] **Step 1: Write the failing test for `writeJsonImport(client, ...)` no-transaction-lifecycle property**

Add to `tests/main/storage/postgres-json-import-repository.test.ts` (preserve the existing tests; we'll migrate them after the new method exists):

```typescript
describe('PostgresJsonImportRepository.writeJsonImport (transaction-scoped API)', () => {
  it('issues no transaction-lifecycle SQL — caller owns BEGIN/COMMIT/ROLLBACK', async () => {
    const queries: string[] = []
    const client = {
      query: async (sql: string | { text: string }, _params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text.startsWith('SELECT id FROM')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
          return { rows: [{ id: 42 }] }
        }
        return { rows: [] }
      }
    }
    const repo = new PostgresJsonImportRepository(
      { connect: async () => { throw new Error('writeJsonImport must not call pool.connect') } } as never,
      'public'
    )

    await repo.writeJsonImport(
      client as never,
      {
        filePath: '/tmp/x.json',
        fileName: 'x.json',
        caseName: 'PG JSON test',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        importFileType: 'simple'
      },
      async () => {
        // empty writer — exercises only schema-level SQL
      }
    )

    expect(queries).not.toContain('BEGIN')
    expect(queries).not.toContain('COMMIT')
    expect(queries).not.toContain('ROLLBACK')
    // Frequency rebuild is also no longer inside writeJsonImport.
    expect(queries.join('\n')).not.toMatch(/INSERT INTO[\s\S]+variant_frequency/)
  })
})
```

- [ ] **Step 2: Write the failing test for `rebuildVariantFrequencyForCase` helper**

Add to the same file:

```typescript
describe('rebuildVariantFrequencyForCase', () => {
  it('runs the case-scoped frequency upsert without opening or closing a transaction', async () => {
    const queries: { text: string; params?: unknown[] }[] = []
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ text: sql, params })
        return { rows: [] }
      }
    }

    await rebuildVariantFrequencyForCase(client as never, 'public', 99)

    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain('INSERT INTO "public"."variant_frequency"')
    expect(queries[0].text).toContain('WHERE case_id = $1')
    expect(queries[0].text).toContain('GROUP BY chr, pos, ref, alt')
    expect(queries[0].text).toContain('ON CONFLICT (chr, pos, ref, alt) DO UPDATE')
    expect(queries[0].params).toEqual([99])
  })
})
```

Add the import at the top of the test file:

```typescript
import { rebuildVariantFrequencyForCase } from '../../../src/main/storage/postgres/PostgresJsonImportRepository'
```

- [ ] **Step 3: Run, verify both new tests fail**

```bash
npx vitest run tests/main/storage/postgres-json-import-repository.test.ts \
  -t 'transaction-scoped API|rebuildVariantFrequencyForCase'
```

Expected: FAIL — `writeJsonImport is not a function` and `rebuildVariantFrequencyForCase is not exported`.

- [ ] **Step 4: Add `writeJsonImport` and `rebuildVariantFrequencyForCase` to the repo**

In `src/main/storage/postgres/PostgresJsonImportRepository.ts`, add the new exported helper near the bottom of the file:

```typescript
export async function rebuildVariantFrequencyForCase(
  client: Pick<PoolClient, 'query'>,
  schema: string,
  caseId: number
): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  await client.query(
    `INSERT INTO ${schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
     SELECT chr, pos, ref, alt, 1
     FROM ${schemaName}."variants"
     WHERE case_id = $1
     GROUP BY chr, pos, ref, alt
     ON CONFLICT (chr, pos, ref, alt)
     DO UPDATE SET case_count = ${schemaName}."variant_frequency".case_count + 1`,
    [caseId]
  )
}
```

Add the new method on the repository class. Keep the existing `runJsonImport` for now — Step 6 deletes it after the executor is migrated:

```typescript
async writeJsonImport(
  client: Pick<PoolClient, 'query'>,
  request: PostgresJsonImportRequest,
  writeVariants: (session: PostgresJsonImportSession) => Promise<void>
): Promise<PostgresJsonImportBatchResult> {
  // Duplicate-name check (single-file mode). Multi-file callers in Phase 9
  // perform pre-existing-case rejection at file 1; subsequent files look up
  // the case and append, so they bypass this check.
  const dupResult = await client.query(
    `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
    [request.caseName]
  )
  if (dupResult.rows.length > 0) {
    throw new Error(`Duplicate case name: ${request.caseName}`)
  }

  const createdAt = Date.now()
  const caseInsert = await client.query(
    `INSERT INTO ${this.schemaName}."cases"
     (name, file_path, file_size, variant_count, created_at, genome_build)
     VALUES ($1, $2, $3, 0, $4, $5)
     RETURNING id`,
    [request.caseName, request.filePath, request.fileSize, createdAt, request.genomeBuild]
  )
  const caseId = toNumericId((caseInsert.rows[0] as { id: unknown } | undefined)?.id)

  let totalVariantCount = 0

  const session: PostgresJsonImportSession = {
    caseId,
    insertVariantBatch: async (variants) => {
      const inserted = await this.insertVariantBatch(client, caseId, variants)
      totalVariantCount += inserted
      return inserted
    }
  }

  await writeVariants(session)

  await client.query(
    `INSERT INTO ${this.schemaName}."case_data_info"
       (case_id, import_file_name, import_file_type, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (case_id) DO UPDATE SET
       import_file_name = EXCLUDED.import_file_name,
       import_file_type = EXCLUDED.import_file_type,
       updated_at = EXCLUDED.updated_at`,
    [caseId, request.fileName, request.importFileType, createdAt]
  )

  await client.query(
    `UPDATE ${this.schemaName}."cases" SET variant_count = $1 WHERE id = $2`,
    [totalVariantCount, caseId]
  )

  return { caseId, variantCount: totalVariantCount }
}
```

`insertVariantBatch` should already accept a generic `client` — if not, change its first parameter type from `PoolClient` to `Pick<PoolClient, 'query'>`.

- [ ] **Step 5: Run, verify the two new tests pass and the existing `runJsonImport` tests still pass**

```bash
npx vitest run tests/main/storage/postgres-json-import-repository.test.ts
```

Expected: all green.

- [ ] **Step 6: Update `PostgresImportExecutor.importSingleFile` to use the new shape**

Edit `src/main/storage/postgres/PostgresImportExecutor.ts`. Replace the `repository.runJsonImport(...)` call with explicit pool/client/transaction lifecycle that calls `writeJsonImport`, then `rebuildVariantFrequencyForCase`, then commits:

```typescript
import type { Pool, PoolClient } from 'pg'
import {
  PostgresJsonImportRepository,
  rebuildVariantFrequencyForCase,
  type PostgresJsonImportSession
} from './PostgresJsonImportRepository'

export interface PostgresImportExecutorOptions {
  repository: PostgresJsonImportRepository
  pool: Pick<Pool, 'connect'>
  schema: string
  detectFormat?: (filePath: string) => Promise<FormatInfo>
  createMapperPipeline?: (filePath: string, formatInfo: FormatInfo) => Promise<Readable>
  statFile?: (filePath: string) => { size: number }
  now?: () => number
}
```

Inside `importSingleFile`, replace the `await this.repository.runJsonImport(...)` block with:

```typescript
const client = (await this.pool.connect()) as PoolClient
let started = false
let commitSucceeded = false
try {
  await client.query('BEGIN')
  started = true

  const { caseId, variantCount } = await this.repository.writeJsonImport(
    client,
    {
      filePath: params.filePath,
      fileName,
      caseName: params.caseName,
      fileSize,
      genomeBuild: params.vcfOptions?.genomeBuild ?? 'GRCh38',
      importFileType
    },
    async (session: PostgresJsonImportSession) => {
      // (existing batch-streaming body unchanged)
    }
  )

  await rebuildVariantFrequencyForCase(client, this.schema, caseId)
  await client.query('COMMIT')
  commitSucceeded = true
  client.release()

  return { caseId, variantCount, skipped: 0, errors: [], elapsed: this.now() - started }
} catch (err) {
  if (started && !commitSucceeded) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // swallow rollback failure so the original error reaches the caller
    }
  }
  client.release(err instanceof Error ? err : new Error(String(err)))
  if (err instanceof PostgresImportCancelled) return this.cancellationResult()
  throw err
}
```

Update the executor constructor to record `this.pool` and `this.schema` on the executor instance.

- [ ] **Step 7: Update wiring in `PostgresStorageSession.ts`** (or wherever the executor is constructed) so the executor receives `pool` and `schema`. If the session already has these, the change is mechanical — pass them through `PostgresImportExecutorOptions`.

- [ ] **Step 8: Update `tests/main/storage/postgres-import-executor.test.ts`**

The existing tests inject a mocked repository whose `runJsonImport` recorded calls. Migrate them to inject:

```typescript
const queries: string[] = []
const client = {
  query: async (text: string, params?: unknown[]) => {
    queries.push(text)
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
    if (text.startsWith('SELECT id FROM')) return { rows: [] }
    if (text.includes('"cases"') && text.startsWith('INSERT')) return { rows: [{ id: 42 }] }
    return { rows: [] }
  },
  release: vi.fn()
}
const pool = { connect: async () => client }
```

Assert `queries[0] === 'BEGIN'`, the writeJsonImport SQL is present, frequency rebuild SQL appears between the case-data-info insert and `COMMIT`, `queries.at(-1) === 'COMMIT'` on success, and `client.release()` is called. On the cancellation/error paths, assert `ROLLBACK` precedes `release(err)`.

- [ ] **Step 9: Delete the now-unused `runJsonImport` method from the repository**

Remove the `runJsonImport` method body and its imports. Keep the types it referenced if they're still used (`PostgresJsonImportRequest`, `PostgresJsonImportSession`, `PostgresJsonImportBatchResult`).

- [ ] **Step 10: Update `tests/main/storage/postgres-json-import-repository.test.ts`** — remove or rewrite tests that drove `runJsonImport`. The new `writeJsonImport` tests already cover the same SQL minus transaction lifecycle.

- [ ] **Step 11: Run the full set, verify green**

```bash
npx vitest run \
  tests/main/storage/postgres-json-import-repository.test.ts \
  tests/main/storage/postgres-import-executor.test.ts
make typecheck
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add src/main/storage/postgres/PostgresJsonImportRepository.ts \
        src/main/storage/postgres/PostgresImportExecutor.ts \
        src/main/storage/postgres/PostgresStorageSession.ts \
        tests/main/storage/postgres-json-import-repository.test.ts \
        tests/main/storage/postgres-import-executor.test.ts
git commit -m "refactor(storage): make postgres json import repository transaction-scoped"
```

---

## Task 3: Add `importMultiFile` to `StorageImportExecutor` Interface

**Files:**
- Modify: `src/main/storage/import-executor.ts`
- Modify: `tests/main/storage/import-executor-contract.test.ts`

The contract grows one new method (`importMultiFile`) plus its param/result/event types. SQLite and PG implement it next.

- [ ] **Step 1: Write the failing contract test for `importMultiFile`**

Add to `tests/main/storage/import-executor-contract.test.ts`:

```typescript
import type {
  StorageImportExecutor,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult,
  StorageImportFileFilters
} from '../../../src/main/storage/import-executor'

describe('StorageImportExecutor.importMultiFile contract', () => {
  it('defines params, filters, and result shapes', async () => {
    const filters: StorageImportFileFilters = {
      bedFilePath: '/abs/regions.bed',
      bedPadding: 0,
      passOnly: true,
      minQual: 30,
      minGq: 20,
      minDp: 10
    }

    const params: StorageImportMultiFileParams = {
      caseName: 'Multi-file case',
      files: [
        { filePath: '/abs/a.vcf.gz', variantType: 'snv-indel', annotationFormat: null, caller: null },
        { filePath: '/abs/b.vcf.gz', variantType: 'snv-indel', annotationFormat: null, caller: null }
      ],
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      filters,
      throttleMs: 100
    }

    const executor: StorageImportExecutor = {
      importSingleFile: vi.fn(),
      importMultiFile: vi.fn(async () => ({
        caseId: 7,
        variantCount: 1234,
        files: [
          { filePath: '/abs/a.vcf.gz', variantType: 'snv-indel', variantCount: 800 },
          { filePath: '/abs/b.vcf.gz', variantType: 'snv-indel', variantCount: 434 }
        ],
        skipped: 0,
        errors: [],
        elapsed: 250
      })),
      cancel: vi.fn()
    } as unknown as StorageImportExecutor

    const result: StorageImportMultiFileResult = await executor.importMultiFile(params)
    expect(result.caseId).toBe(7)
    expect(result.files).toHaveLength(2)
    expect(result.files[0].variantCount).toBe(800)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/import-executor-contract.test.ts -t importMultiFile
```

Expected: FAIL with import or type errors.

- [ ] **Step 3: Extend the interface**

In `src/main/storage/import-executor.ts`, add:

```typescript
import type { MultiFileImportSpec } from '../../shared/types/api'

export interface StorageImportFileFilters {
  bedFilePath?: string | null
  bedPadding?: number
  passOnly?: boolean
  minQual?: number | null
  minGq?: number | null
  minDp?: number | null
}

export interface StorageImportMultiFileParams {
  caseName: string
  files: MultiFileImportSpec[]
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  filters?: StorageImportFileFilters
  throttleMs?: number
  onProgress?: (event: ImportProgressEvent) => void
  onFileComplete?: (event: ImportFileCompleteEvent) => void
}

export interface ImportFileCompleteEvent {
  filePath: string
  caseId: number
  variantCount: number
}

export interface StorageImportMultiFileResult {
  caseId: number
  variantCount: number
  files: Array<{
    filePath: string
    variantType: string
    variantCount: number
    error?: string
  }>
  skipped: number
  errors: string[]
  elapsed: number
}

export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  importMultiFile(params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult>
  cancel(): void
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/storage/import-executor-contract.test.ts
make typecheck
```

Expected: all green. Adding `importMultiFile` to the interface will surface compile errors at every existing implementor (`SqliteImportExecutor`, `PostgresImportExecutor`, test mocks). Tasks 4 and 11 fix those.

- [ ] **Step 5: Stub the new method on each implementor so typecheck passes mid-plan**

Add to `src/main/storage/sqlite/SqliteImportExecutor.ts`:

```typescript
async importMultiFile(_params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult> {
  throw new Error('SqliteImportExecutor.importMultiFile not yet implemented (Phase 9 Task 11)')
}
```

Add to `src/main/storage/postgres/PostgresImportExecutor.ts`:

```typescript
async importMultiFile(_params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult> {
  throw new Error('PostgresImportExecutor.importMultiFile not yet implemented (Phase 9 Task 7)')
}
```

- [ ] **Step 6: Run typecheck and the contract test**

```bash
make typecheck
npx vitest run tests/main/storage/import-executor-contract.test.ts
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/import-executor.ts \
        src/main/storage/sqlite/SqliteImportExecutor.ts \
        src/main/storage/postgres/PostgresImportExecutor.ts \
        tests/main/storage/import-executor-contract.test.ts
git commit -m "feat(storage): add importMultiFile to StorageImportExecutor contract"
```

---

## Task 4: Add `postgres-import-worker` Message Types

**Files:**
- Create: `src/shared/types/postgres-import-worker.ts`
- Create: `tests/shared/types/postgres-import-worker.test.ts`

Worker boundary types live in `src/shared/` because both the main process (sender) and the worker (receiver) import them. No PG-specific types leak into shared — only message shapes and a config DTO.

- [ ] **Step 1: Write the failing type test**

Create `tests/shared/types/postgres-import-worker.test.ts`:

```typescript
import { expectTypeOf } from 'vitest'
import type {
  PostgresClientConfig,
  PostgresImportWorkerStartMessage,
  PostgresImportWorkerCancelMessage,
  PostgresImportWorkerProgressMessage,
  PostgresImportWorkerFileCompleteMessage,
  PostgresImportWorkerCompleteMessage,
  PostgresImportWorkerErrorMessage,
  PostgresImportWorkerInboundMessage,
  PostgresImportWorkerOutboundMessage
} from '../../../src/shared/types/postgres-import-worker'

describe('postgres-import-worker types', () => {
  it('PostgresClientConfig contains the connection-relevant pg fields', () => {
    expectTypeOf<PostgresClientConfig>().toMatchTypeOf<{
      connectionString: string
      application_name?: string
      connectionTimeoutMillis?: number
      statement_timeout?: number
      query_timeout?: number
      lock_timeout?: number
      idle_in_transaction_session_timeout?: number
      keepAlive?: boolean
    }>()
  })

  it('inbound and outbound message unions are exhaustive', () => {
    expectTypeOf<PostgresImportWorkerInboundMessage>().toEqualTypeOf<
      PostgresImportWorkerStartMessage | PostgresImportWorkerCancelMessage
    >()
    expectTypeOf<PostgresImportWorkerOutboundMessage>().toEqualTypeOf<
      | PostgresImportWorkerProgressMessage
      | PostgresImportWorkerFileCompleteMessage
      | PostgresImportWorkerCompleteMessage
      | PostgresImportWorkerErrorMessage
    >()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/shared/types/postgres-import-worker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types**

Create `src/shared/types/postgres-import-worker.ts`:

```typescript
import type { ClientConfig } from 'pg'
import type { MultiFileImportSpec } from './api'

/**
 * pg.Client config plumbed from main to worker. Mirrors the connection-relevant
 * fields of buildPostgresPoolConfig minus pool-only fields. SSL is serialized
 * as a discriminated descriptor since `tls.SecureContextOptions` does not
 * round-trip through structuredClone.
 */
export interface PostgresClientConfig {
  connectionString: string
  application_name?: string
  connectionTimeoutMillis?: number
  statement_timeout?: number
  query_timeout?: number
  lock_timeout?: number
  idle_in_transaction_session_timeout?: number
  keepAlive?: boolean
  ssl?:
    | { mode: 'disable' }
    | { mode: 'require'; rejectUnauthorized: boolean }
}

export interface PostgresImportWorkerStartMessage {
  type: 'start'
  client: PostgresClientConfig
  schema: string
  mode: 'single-file' | 'multi-file'
  caseName: string
  vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  // Single-file:
  filePath?: string
  format?: 'json' | 'vcf'
  // Multi-file:
  files?: MultiFileImportSpec[]
  filters?: {
    bedFilePath?: string | null
    bedPadding?: number
    passOnly?: boolean
    minQual?: number | null
    minGq?: number | null
    minDp?: number | null
  }
  batchSize?: number
  throttleMs?: number
}

export interface PostgresImportWorkerCancelMessage {
  type: 'cancel'
}

export type PostgresImportWorkerInboundMessage =
  | PostgresImportWorkerStartMessage
  | PostgresImportWorkerCancelMessage

export interface PostgresImportWorkerProgressMessage {
  type: 'progress'
  phase: 'parsing' | 'inserting' | 'finalizing'
  rowsProcessed: number
  rowsTotal?: number
  filePath?: string
}

export interface PostgresImportWorkerFileCompleteMessage {
  type: 'file-complete'
  filePath: string
  caseId: number
  variantCount: number
}

export interface PostgresImportWorkerCompleteMessage {
  type: 'complete'
  // Discriminated by the start mode.
  mode: 'single-file' | 'multi-file'
  result: {
    caseId: number
    variantCount: number
    files?: Array<{
      filePath: string
      variantType: string
      variantCount: number
      error?: string
    }>
    skipped: number
    errors: string[]
    elapsed: number
  }
}

export interface PostgresImportWorkerErrorMessage {
  type: 'error'
  message: string
  cause?: string
}

export type PostgresImportWorkerOutboundMessage =
  | PostgresImportWorkerProgressMessage
  | PostgresImportWorkerFileCompleteMessage
  | PostgresImportWorkerCompleteMessage
  | PostgresImportWorkerErrorMessage

/**
 * Helper to convert the runtime `ClientConfig` produced by `buildPostgresClientConfig`
 * into the structured-clone-safe `PostgresClientConfig` for the start message.
 */
export function toPostgresClientConfigMessage(
  client: ClientConfig & { connectionString: string }
): PostgresClientConfig {
  let ssl: PostgresClientConfig['ssl']
  if (client.ssl === undefined) {
    ssl = { mode: 'disable' }
  } else if (typeof client.ssl === 'object' && 'rejectUnauthorized' in client.ssl) {
    ssl = { mode: 'require', rejectUnauthorized: Boolean(client.ssl.rejectUnauthorized) }
  } else {
    ssl = { mode: 'disable' }
  }
  return {
    connectionString: client.connectionString,
    application_name: client.application_name,
    connectionTimeoutMillis: client.connectionTimeoutMillis,
    statement_timeout: typeof client.statement_timeout === 'number' ? client.statement_timeout : undefined,
    query_timeout: typeof client.query_timeout === 'number' ? client.query_timeout : undefined,
    lock_timeout: typeof client.lock_timeout === 'number' ? client.lock_timeout : undefined,
    idle_in_transaction_session_timeout:
      typeof client.idle_in_transaction_session_timeout === 'number'
        ? client.idle_in_transaction_session_timeout
        : undefined,
    keepAlive: client.keepAlive,
    ssl
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/shared/types/postgres-import-worker.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/postgres-import-worker.ts \
        tests/shared/types/postgres-import-worker.test.ts
git commit -m "feat(shared): add postgres-import-worker message and config types"
```

---

## Task 5: Create `PostgresImportWorkerClient` (Main-Side Spawner)

**Files:**
- Create: `src/main/storage/postgres/PostgresImportWorkerClient.ts`
- Create: `tests/main/storage/postgres-import-worker-client.test.ts`

Mirrors `src/main/workers/import-worker-client.ts` for SQLite. Spawns the worker, relays messages, handles cancel and exit.

- [ ] **Step 1: Write the failing test**

Create `tests/main/storage/postgres-import-worker-client.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PostgresImportWorkerClient } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type { PostgresImportWorkerStartMessage } from '../../../src/shared/types/postgres-import-worker'

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn(async () => 0)
}

describe('PostgresImportWorkerClient', () => {
  it('relays progress, file-complete, complete, and error messages', async () => {
    const fake = new FakeWorker()
    const client = new PostgresImportWorkerClient({
      workerFactory: () => fake as unknown as Worker
    })

    const onProgress = vi.fn()
    const onFileComplete = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()

    const startMessage: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'X',
      filePath: '/tmp/a.json',
      format: 'json'
    }
    client.start(startMessage, { onProgress, onFileComplete, onComplete, onError })

    fake.emit('message', { type: 'progress', phase: 'inserting', rowsProcessed: 100 })
    fake.emit('message', {
      type: 'file-complete',
      filePath: '/tmp/a.json',
      caseId: 7,
      variantCount: 100
    })
    fake.emit('message', {
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 7, variantCount: 100, skipped: 0, errors: [], elapsed: 0 }
    })

    expect(fake.postMessage).toHaveBeenCalledWith(startMessage)
    expect(onProgress).toHaveBeenCalled()
    expect(onFileComplete).toHaveBeenCalledWith({ filePath: '/tmp/a.json', caseId: 7, variantCount: 100 })
    expect(onComplete).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('forwards cancel as a worker message', async () => {
    const fake = new FakeWorker()
    const c = new PostgresImportWorkerClient({ workerFactory: () => fake as unknown as Worker })
    c.start(
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'X',
        filePath: '/tmp/a.json'
      },
      { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
    )
    c.cancel()
    expect(fake.postMessage).toHaveBeenLastCalledWith({ type: 'cancel' })
  })

  it('treats a non-zero exit as an error', async () => {
    const fake = new FakeWorker()
    const onError = vi.fn()
    const c = new PostgresImportWorkerClient({ workerFactory: () => fake as unknown as Worker })
    c.start(
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'X',
        filePath: '/tmp/a.json'
      },
      { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError }
    )
    fake.emit('exit', 1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('exit') }))
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/postgres-import-worker-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create `src/main/storage/postgres/PostgresImportWorkerClient.ts`:

```typescript
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { mainLogger } from '../../services/MainLogger'
import type {
  PostgresImportWorkerStartMessage,
  PostgresImportWorkerOutboundMessage,
  PostgresImportWorkerProgressMessage,
  PostgresImportWorkerFileCompleteMessage,
  PostgresImportWorkerCompleteMessage,
  PostgresImportWorkerErrorMessage
} from '../../../shared/types/postgres-import-worker'

export interface PostgresImportWorkerCallbacks {
  onProgress: (message: PostgresImportWorkerProgressMessage) => void
  onFileComplete: (message: PostgresImportWorkerFileCompleteMessage) => void
  onComplete: (message: PostgresImportWorkerCompleteMessage) => void
  onError: (message: PostgresImportWorkerErrorMessage) => void
}

export interface PostgresImportWorkerClientOptions {
  /** Override worker construction. Default loads the built worker bundle. */
  workerFactory?: () => Worker
}

export class PostgresImportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string
  private readonly workerFactory?: () => Worker

  constructor(options: PostgresImportWorkerClientOptions = {}) {
    this.workerPath = resolve(__dirname, 'postgres-import-worker.js')
    this.workerFactory = options.workerFactory
  }

  start(
    message: PostgresImportWorkerStartMessage,
    callbacks: PostgresImportWorkerCallbacks
  ): void {
    if (this.worker) {
      throw new Error('PostgresImportWorkerClient already started')
    }
    this.worker = this.workerFactory ? this.workerFactory() : new Worker(this.workerPath)

    this.worker.on('message', (msg: PostgresImportWorkerOutboundMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg)
          break
        case 'file-complete':
          callbacks.onFileComplete(msg)
          break
        case 'complete':
          callbacks.onComplete(msg)
          break
        case 'error':
          callbacks.onError(msg)
          break
      }
    })

    this.worker.on('error', (err: Error) => {
      mainLogger.error(`Postgres import worker error: ${err.message}`, 'PostgresImportWorkerClient')
      callbacks.onError({ type: 'error', message: err.message })
    })

    this.worker.on('exit', (code: number) => {
      if (code !== 0) {
        const message = `Postgres import worker exited with code ${code}`
        mainLogger.error(message, 'PostgresImportWorkerClient')
        callbacks.onError({ type: 'error', message })
      }
    })

    this.worker.postMessage(message)
  }

  cancel(): void {
    if (!this.worker) return
    this.worker.postMessage({ type: 'cancel' })
  }

  async terminate(): Promise<void> {
    if (!this.worker) return
    try {
      await this.worker.terminate()
    } catch (e) {
      mainLogger.error(
        `Postgres import worker termination failed: ${e instanceof Error ? e.message : String(e)}`,
        'PostgresImportWorkerClient'
      )
    } finally {
      this.worker = null
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/storage/postgres-import-worker-client.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresImportWorkerClient.ts \
        tests/main/storage/postgres-import-worker-client.test.ts
git commit -m "feat(storage): add PostgresImportWorkerClient main-side spawner"
```

---

## Task 6: Create `postgres-import-worker.ts` Shell + JSON Single-File Path

**Files:**
- Create: `src/main/workers/postgres-import-worker.ts`
- Create: `tests/main/workers/postgres-import-worker.test.ts`
- Modify: `electron-vite.config.ts`

The worker shell handles `start`/`cancel` messages and runs the JSON single-file path through `writeJsonImport` + `rebuildVariantFrequencyForCase`. VCF and multi-file are added in later tasks.

- [ ] **Step 1: Write the failing test for JSON single-file dispatch**

Create `tests/main/workers/postgres-import-worker.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

// The worker's testable core is exposed as runImport(deps, message). The default
// entry point wires it to parentPort, but tests drive runImport directly with a
// fake Client and fake parsing pipeline.
import { runImport } from '../../../src/main/workers/postgres-import-worker'
import type { PostgresImportWorkerStartMessage } from '../../../src/shared/types/postgres-import-worker'

describe('postgres-import-worker runImport', () => {
  it('opens client, runs BEGIN/COMMIT for single-file JSON, posts complete', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string) => {
        queries.push(typeof sql === 'string' ? sql : (sql as { text: string }).text)
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        if (typeof sql === 'string' && sql.startsWith('SELECT id FROM')) return { rows: [] }
        if (typeof sql === 'string' && sql.includes('"cases"') && sql.startsWith('INSERT')) {
          return { rows: [{ id: 11 }] }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []
    const post = (m: unknown) => messages.push(m)

    const start: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'JSON case',
      filePath: '/tmp/a.json',
      format: 'json'
    }

    await runImport({
      createClient: () => client as never,
      detectFormat: async () => ({ format: 'simple', extension: 'json' }) as never,
      createMapperPipeline: async () => {
        const { Readable } = await import('node:stream')
        return Readable.from([{ chr: '1', pos: 1, ref: 'A', alt: 'T' }])
      },
      statFile: () => ({ size: 100 })
    }, start, post)

    expect(queries[0]).toBe('BEGIN')
    expect(queries.some((q) => q.startsWith('SELECT id FROM'))).toBe(true)
    expect(queries.some((q) => q.includes('"cases"') && q.startsWith('INSERT'))).toBe(true)
    expect(queries.some((q) => q.includes('"variant_frequency"'))).toBe(true)
    expect(queries.at(-1)).toBe('COMMIT')

    const complete = messages.find((m): m is { type: 'complete' } => (m as { type: string }).type === 'complete')
    expect(complete).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run tests/main/workers/postgres-import-worker.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the worker shell + JSON branch**

Create `src/main/workers/postgres-import-worker.ts`:

```typescript
import { parentPort } from 'node:worker_threads'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import type { Readable } from 'node:stream'
import { Client, type ClientConfig } from 'pg'

import type {
  PostgresImportWorkerInboundMessage,
  PostgresImportWorkerOutboundMessage,
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../shared/types/postgres-import-worker'
import {
  PostgresJsonImportRepository,
  rebuildVariantFrequencyForCase,
  type PostgresJsonImportSession
} from '../storage/postgres/PostgresJsonImportRepository'
import { detectFormat as defaultDetectFormat } from '../import/format-detection'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createMapperPipeline as defaultCreateMapperPipeline } from './import-pipeline'

const POSTGRES_JSON_IMPORT_BATCH_SIZE = 1000
const CANCELLATION_MESSAGE = 'Import cancelled by user'

let cancelled = false

export interface RunImportDeps {
  createClient: (config: ClientConfig) => Client
  detectFormat: (filePath: string) => Promise<FormatInfo>
  createMapperPipeline: (filePath: string, formatInfo: FormatInfo) => Promise<Readable>
  statFile: (filePath: string) => { size: number }
}

const defaultDeps: RunImportDeps = {
  createClient: (config) => new Client(config),
  detectFormat: defaultDetectFormat,
  createMapperPipeline: defaultCreateMapperPipeline,
  statFile: (path: string) => ({ size: statSync(path).size })
}

function clientConfigFromMessage(message: PostgresClientConfig): ClientConfig {
  return {
    connectionString: message.connectionString,
    application_name: message.application_name,
    connectionTimeoutMillis: message.connectionTimeoutMillis,
    statement_timeout: message.statement_timeout,
    query_timeout: message.query_timeout,
    lock_timeout: message.lock_timeout,
    idle_in_transaction_session_timeout: message.idle_in_transaction_session_timeout,
    keepAlive: message.keepAlive,
    ssl:
      message.ssl?.mode === 'require'
        ? { rejectUnauthorized: message.ssl.rejectUnauthorized }
        : undefined
  }
}

export async function runImport(
  deps: RunImportDeps,
  start: PostgresImportWorkerStartMessage,
  post: (msg: PostgresImportWorkerOutboundMessage) => void
): Promise<void> {
  const startedAt = Date.now()
  const client = deps.createClient(clientConfigFromMessage(start.client))
  let beganTransaction = false
  let committed = false

  try {
    await client.connect()
    await client.query('BEGIN')
    beganTransaction = true

    if (start.mode === 'single-file') {
      const filePath = start.filePath
      if (!filePath) throw new Error('postgres-import-worker: single-file mode requires filePath')

      const formatInfo = start.format
        ? ({ format: start.format } as FormatInfo)
        : await deps.detectFormat(filePath)

      if (formatInfo.format === 'vcf') {
        // Implemented in Task 9.
        throw new Error('VCF import not yet implemented in postgres-import-worker (Phase 9 Task 9)')
      }

      const fileName = basename(filePath)
      let fileSize = 0
      try {
        fileSize = deps.statFile(filePath).size
      } catch {
        // ignore — used only for provenance
      }

      const repo = new PostgresJsonImportRepository({ connect: async () => client as never } as never, start.schema)

      let totalInserted = 0
      const writeVariants = async (session: PostgresJsonImportSession): Promise<void> => {
        if (cancelled) throw new Error(CANCELLATION_MESSAGE)
        const stream = await deps.createMapperPipeline(filePath, formatInfo)
        let batch: Array<Record<string, unknown>> = []
        const flush = async () => {
          if (batch.length === 0) return
          await session.insertVariantBatch(batch)
          totalInserted += batch.length
          batch = []
          post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
        }
        try {
          for await (const chunk of stream) {
            if (cancelled) {
              stream.destroy()
              throw new Error(CANCELLATION_MESSAGE)
            }
            if (chunk === null || chunk === undefined) continue
            batch.push(chunk as Record<string, unknown>)
            if (batch.length >= POSTGRES_JSON_IMPORT_BATCH_SIZE) {
              await flush()
              if (cancelled) throw new Error(CANCELLATION_MESSAGE)
            }
          }
          if (!cancelled) {
            await flush()
          } else {
            throw new Error(CANCELLATION_MESSAGE)
          }
        } catch (err) {
          stream.destroy()
          throw err
        }
      }

      const importFileType =
        formatInfo.format === 'simple' ? 'simple' :
        formatInfo.format === 'object' ? 'object' :
        formatInfo.format === 'columnar' ? 'columnar' :
        (() => { throw new Error(`Unsupported JSON format: ${formatInfo.format}`) })()

      const { caseId, variantCount } = await repo.writeJsonImport(
        client as never,
        {
          filePath,
          fileName,
          caseName: start.caseName,
          fileSize,
          genomeBuild: start.vcfOptions?.genomeBuild ?? 'GRCh38',
          importFileType
        },
        writeVariants
      )

      await rebuildVariantFrequencyForCase(client as never, start.schema, caseId)
      await client.query('COMMIT')
      committed = true

      post({
        type: 'complete',
        mode: 'single-file',
        result: {
          caseId,
          variantCount,
          skipped: 0,
          errors: [],
          elapsed: Date.now() - startedAt
        }
      })
      return
    }

    // Multi-file branch implemented in Task 12.
    throw new Error('Multi-file mode not yet implemented in postgres-import-worker (Phase 9 Task 12)')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (beganTransaction && !committed) {
      try { await client.query('ROLLBACK') } catch { /* swallow */ }
    }
    if (message === CANCELLATION_MESSAGE) {
      post({
        type: 'complete',
        mode: start.mode,
        result: {
          caseId: 0,
          variantCount: 0,
          skipped: 0,
          errors: [CANCELLATION_MESSAGE],
          elapsed: 0
        }
      })
    } else {
      post({ type: 'error', message })
    }
  } finally {
    try { await client.end() } catch { /* swallow */ }
  }
}

if (parentPort) {
  const port = parentPort
  port.on('message', (msg: PostgresImportWorkerInboundMessage) => {
    if (msg.type === 'cancel') {
      cancelled = true
      return
    }
    if (msg.type === 'start') {
      cancelled = false
      void runImport(defaultDeps, msg, (out) => port.postMessage(out))
    }
  })
}
```

- [ ] **Step 4: Add the worker entry to electron-vite config**

Open `electron-vite.config.ts` and locate the main-process worker entry list (mirrors `src/main/workers/import-worker.ts`). Add an entry for `postgres-import-worker.ts`. The exact pattern depends on the existing config; if `import-worker.ts` is referenced by name in the `build.lib.entry` block, add `postgres-import-worker: 'src/main/workers/postgres-import-worker.ts'` next to it.

- [ ] **Step 5: Run, verify pass**

```bash
npx vitest run tests/main/workers/postgres-import-worker.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 6: Verify the worker bundles in main-process build**

```bash
make build
ls out/main/postgres-import-worker.js
```

Expected: file exists.

- [ ] **Step 7: Commit**

```bash
git add src/main/workers/postgres-import-worker.ts \
        tests/main/workers/postgres-import-worker.test.ts \
        electron-vite.config.ts
git commit -m "feat(workers): add postgres-import-worker shell with JSON single-file path"
```

---

## Task 7: Refactor `PostgresImportExecutor.importSingleFile` to Dispatch via Worker

**Files:**
- Modify: `src/main/storage/postgres/PostgresImportExecutor.ts`
- Modify: `tests/main/storage/postgres-import-executor.test.ts`

Phase 8's main-process body (parsing pipeline, repo call, transaction) gets deleted. The executor becomes a thin dispatcher that builds the start message, spawns `PostgresImportWorkerClient`, relays callbacks, and awaits completion.

- [ ] **Step 1: Write the failing test**

Modify `tests/main/storage/postgres-import-executor.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import type { PostgresImportWorkerCallbacks } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type {
  PostgresImportWorkerStartMessage,
  PostgresImportWorkerCompleteMessage
} from '../../../src/shared/types/postgres-import-worker'

class FakeWorkerClient {
  start = vi.fn((_message: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
    queueMicrotask(() => {
      callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 1 })
      const complete: PostgresImportWorkerCompleteMessage = {
        type: 'complete',
        mode: 'single-file',
        result: { caseId: 99, variantCount: 1, skipped: 0, errors: [], elapsed: 5 }
      }
      callbacks.onComplete(complete)
    })
  })
  cancel = vi.fn()
}

describe('PostgresImportExecutor.importSingleFile (worker dispatch)', () => {
  it('builds the start message and resolves with the worker complete result', async () => {
    const fake = new FakeWorkerClient()
    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: { connectionString: 'postgres://x' },
      workerClientFactory: () => fake as never
    })

    const onProgress = vi.fn()
    const result = await executor.importSingleFile({
      filePath: '/tmp/a.json',
      caseName: 'X',
      onProgress
    })

    expect(fake.start).toHaveBeenCalledTimes(1)
    const sentMessage = fake.start.mock.calls[0][0]
    expect(sentMessage.type).toBe('start')
    expect(sentMessage.mode).toBe('single-file')
    expect(sentMessage.filePath).toBe('/tmp/a.json')
    expect(sentMessage.client.connectionString).toBe('postgres://x')
    expect(sentMessage.schema).toBe('public')

    expect(onProgress).toHaveBeenCalled()
    expect(result.caseId).toBe(99)
    expect(result.variantCount).toBe(1)
  })

  it('rejects filter payloads on importSingleFile', async () => {
    const fake = new FakeWorkerClient()
    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: { connectionString: 'postgres://x' },
      workerClientFactory: () => fake as never
    })
    await expect(
      executor.importSingleFile({
        filePath: '/tmp/a.json',
        caseName: 'X',
        // @ts-expect-error filters on importSingleFile is not part of the params shape; runtime guard
        filters: { passOnly: true }
      } as never)
    ).rejects.toThrow(/Filters are only supported on import:startMultiFile/)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/postgres-import-executor.test.ts
```

Expected: FAIL — old executor signature mismatch.

- [ ] **Step 3: Replace the executor body**

Rewrite `src/main/storage/postgres/PostgresImportExecutor.ts`:

```typescript
import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult
} from '../import-executor'
import { PostgresImportWorkerClient } from './PostgresImportWorkerClient'
import type { PostgresImportWorkerStartMessage, PostgresClientConfig } from '../../../shared/types/postgres-import-worker'

const CANCELLATION_MESSAGE = 'Import cancelled by user'

export interface PostgresImportExecutorOptions {
  schema: string
  clientConfig: PostgresClientConfig
  workerClientFactory?: () => PostgresImportWorkerClient
}

export class PostgresImportExecutor implements StorageImportExecutor {
  private currentClient: PostgresImportWorkerClient | null = null
  private inProgress = false

  constructor(private readonly options: PostgresImportExecutorOptions) {}

  cancel(): void {
    this.currentClient?.cancel()
  }

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    if ((params as Record<string, unknown>).filters !== undefined) {
      throw new Error('Filters are only supported on import:startMultiFile')
    }
    if (this.inProgress) throw new Error('An import is already in progress')
    this.inProgress = true
    try {
      const start: PostgresImportWorkerStartMessage = {
        type: 'start',
        client: this.options.clientConfig,
        schema: this.options.schema,
        mode: 'single-file',
        caseName: params.caseName,
        vcfOptions: params.vcfOptions,
        filePath: params.filePath
      }
      const result = await this.runWorker(start, params.onProgress)
      return {
        caseId: result.caseId,
        variantCount: result.variantCount,
        skipped: result.skipped,
        errors: result.errors,
        elapsed: result.elapsed
      }
    } finally {
      this.inProgress = false
      this.currentClient = null
    }
  }

  async importMultiFile(
    _params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    throw new Error('PostgresImportExecutor.importMultiFile not yet implemented (Task 11)')
  }

  private runWorker(
    start: PostgresImportWorkerStartMessage,
    onProgress?: StorageImportSingleFileParams['onProgress']
  ): Promise<{
    caseId: number
    variantCount: number
    files?: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
    skipped: number
    errors: string[]
    elapsed: number
  }> {
    const factory = this.options.workerClientFactory ?? (() => new PostgresImportWorkerClient())
    const client = factory()
    this.currentClient = client
    return new Promise((resolvePromise, reject) => {
      client.start(start, {
        onProgress: (msg) => {
          onProgress?.({
            phase: msg.phase,
            count: msg.rowsProcessed,
            elapsed: 0,
            skipped: 0
          })
        },
        onFileComplete: () => {
          // forwarded for multi-file callers in Task 11; single-file ignores
        },
        onComplete: (msg) => resolvePromise(msg.result),
        onError: (msg) => reject(new Error(msg.message))
      })
    })
  }
}
```

- [ ] **Step 4: Update the session wiring**

`src/main/storage/postgres/PostgresStorageSession.ts` previously constructed `PostgresImportExecutor` with `repository`/`pool`/`schema`. Update it to construct with `schema` and `clientConfig` (built from `buildPostgresClientConfig` + `toPostgresClientConfigMessage`). Inject the existing pool only into other call sites that still need it (read paths). The PG executor no longer needs the pool.

- [ ] **Step 5: Run, verify pass**

```bash
npx vitest run tests/main/storage/postgres-import-executor.test.ts \
              tests/main/storage/postgres-storage-session.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 6: Run the existing JSON E2E (gated; only runs if Docker available locally)**

```bash
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts
make pg-down
```

Expected: existing JSON E2E green — regression gate for the worker migration.

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/postgres/PostgresImportExecutor.ts \
        src/main/storage/postgres/PostgresStorageSession.ts \
        tests/main/storage/postgres-import-executor.test.ts \
        tests/main/storage/postgres-storage-session.test.ts
git commit -m "refactor(storage): dispatch postgres json import via worker_threads"
```

---

## Task 8: Implement `SqliteImportExecutor.importMultiFile`

**Files:**
- Modify: `src/main/storage/sqlite/SqliteImportExecutor.ts`
- Modify: `tests/main/storage/sqlite-import-executor.test.ts`

Replaces the Task 3 stub with a real delegation to the existing `ImportWorkerClient` multi-file flow.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/storage/sqlite-import-executor.test.ts`:

```typescript
describe('SqliteImportExecutor.importMultiFile', () => {
  it('delegates to the existing ImportWorkerClient multi-file path', async () => {
    const startMock = vi.fn()
    const cancelMock = vi.fn()
    const fakeWorkerClient = { start: startMock, cancel: cancelMock }
    const executor = new SqliteImportExecutor({
      workerClientFactory: () => fakeWorkerClient as never,
      databaseService: { getDbPath: () => '/tmp/test.db', getEncryptionKey: () => undefined } as never
    })

    const promise = executor.importMultiFile({
      caseName: 'multi',
      files: [
        { filePath: '/abs/a.vcf.gz', variantType: 'snv-indel', annotationFormat: null, caller: null }
      ]
    })

    // Synthesize a complete event from the start callbacks
    expect(startMock).toHaveBeenCalled()
    const callbacks = startMock.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      caseId: 1,
      variantCount: 100,
      skipped: 0,
      files: [{ filePath: '/abs/a.vcf.gz', variantType: 'snv-indel', variantCount: 100 }],
      errors: [],
      elapsed: 10
    })

    const result = await promise
    expect(result.caseId).toBe(1)
    expect(result.files).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/sqlite-import-executor.test.ts -t importMultiFile
```

Expected: FAIL — current implementation throws "not yet implemented".

- [ ] **Step 3: Implement the delegation**

In `src/main/storage/sqlite/SqliteImportExecutor.ts`, replace the Task 3 stub with:

```typescript
async importMultiFile(
  params: StorageImportMultiFileParams
): Promise<StorageImportMultiFileResult> {
  // SQLite multi-file already runs through ImportWorkerClient with its own
  // multi-file message protocol. Reuse that path; this method is a translator
  // between the StorageImportExecutor signature and the worker's call shape.
  if (this.inProgress) throw new Error('An import is already in progress')
  this.inProgress = true
  const startedAt = Date.now()
  return new Promise<StorageImportMultiFileResult>((resolve, reject) => {
    const factory = this.options.workerClientFactory ?? (() => new ImportWorkerClient(this.workerPath))
    const client = factory()
    this.currentClient = client
    client.start({
      onProgress: (msg) => {
        params.onProgress?.({
          phase: msg.phase ?? 'inserting',
          count: msg.count ?? 0,
          elapsed: Date.now() - startedAt,
          skipped: msg.skipped ?? 0
        })
      },
      onFileComplete: (msg) => {
        params.onFileComplete?.({
          filePath: msg.filePath,
          caseId: msg.caseId,
          variantCount: msg.variantCount
        })
      },
      onComplete: (msg) => {
        this.inProgress = false
        this.currentClient = null
        resolve({
          caseId: msg.caseId ?? 0,
          variantCount: msg.variantCount ?? 0,
          files: msg.files ?? [],
          skipped: msg.skipped ?? 0,
          errors: msg.errors ?? [],
          elapsed: Date.now() - startedAt
        })
      },
      onError: (msg) => {
        this.inProgress = false
        this.currentClient = null
        reject(new Error(msg.message))
      }
    })
    client.postStart({
      type: 'start',
      mode: 'multi-file',
      caseName: params.caseName,
      files: params.files,
      vcfOptions: params.vcfOptions,
      filters: params.filters,
      dbPath: this.options.databaseService.getDbPath(),
      encryptionKey: this.options.databaseService.getEncryptionKey()
    })
  })
}
```

The exact `client.postStart` / `client.start` shape depends on the existing `ImportWorkerClient` API. If the SQLite worker client uses different method names, mirror them — the goal is "feed the existing multi-file protocol with our params, return the existing multi-file result mapped onto `StorageImportMultiFileResult`".

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/storage/sqlite-import-executor.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/sqlite/SqliteImportExecutor.ts \
        tests/main/storage/sqlite-import-executor.test.ts
git commit -m "feat(storage): implement SqliteImportExecutor.importMultiFile via existing worker"
```

---

## Task 9: Create `PostgresVcfImportRepository.writeVcfFile`

**Files:**
- Create: `src/main/storage/postgres/PostgresVcfImportRepository.ts`
- Create: `tests/main/storage/postgres-vcf-import-repository.test.ts`

Single-file VCF write path. Transaction-scoped (no BEGIN/COMMIT inside the repo). Multi-file branch (file 1 create vs file 2+ append) is hooked here too — the worker invokes `writeVcfFile` once per file with a `mode` flag.

- [ ] **Step 1: Write the failing repo test**

Create `tests/main/storage/postgres-vcf-import-repository.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { PostgresVcfImportRepository } from '../../../src/main/storage/postgres/PostgresVcfImportRepository'

const makeFakeClient = () => {
  const queries: Array<{ text: string; params?: unknown[] }> = []
  const client = {
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push({ text, params })
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) return { rows: [{ id: 31 }] }
      if (text.startsWith('INSERT INTO') && text.includes('"variants"') && text.includes('jsonb_to_recordset')) {
        // Return one (ordinal, variant_id) per row in the batch
        const batch = JSON.parse(String((params as unknown[])[1])) as unknown[]
        return { rows: batch.map((_, i) => ({ ordinal: i, id: 1000 + i })) }
      }
      return { rows: [] }
    })
  }
  return { client, queries }
}

describe('PostgresVcfImportRepository.writeVcfFile', () => {
  it('issues no transaction-lifecycle SQL', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    expect(queries.map((q) => q.text)).not.toContain('BEGIN')
    expect(queries.map((q) => q.text)).not.toContain('COMMIT')
    expect(queries.map((q) => q.text)).not.toContain('ROLLBACK')
    expect(queries.find((q) => q.text.includes('"variant_frequency"'))).toBeUndefined()
  })

  it('rejects pre-existing case in multi-file mode at file index 0', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementationOnce(async () => ({ rows: [{ id: 99 }] }))
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'multi-file',
        fileIndex: 0,
        caseName: 'PreExisting',
        fileName: 'a.vcf.gz',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toThrow(/case 'PreExisting' already exists/)
  })

  it('looks up case by name at fileIndex >= 1 instead of inserting', async () => {
    const { client, queries } = makeFakeClient()
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [{ id: 7 }] }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'multi-file',
      fileIndex: 1,
      caseName: 'Multi',
      fileName: 'b.vcf.gz',
      filePath: '/tmp/b.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    // No INSERT INTO cases for fileIndex >= 1
    expect(queries.find((q) => q.text.startsWith('INSERT INTO') && q.text.includes('"cases"'))).toBeUndefined()
  })

  it('batches base variants and extension rows with jsonb_to_recordset', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [
        { ordinal: 0, hgvs_c: 'c.1A>T', hgvs_p: null, gene_symbol: 'BRCA1', is_selected: 1 }
      ],
      sv: [],
      cnv: [],
      str: []
    })
    const variantsInsert = queries.find((q) => q.text.includes('"variants"') && q.text.includes('jsonb_to_recordset'))
    expect(variantsInsert).toBeDefined()
    const transcriptsInsert = queries.find((q) => q.text.includes('"variant_transcripts"') && q.text.includes('jsonb_to_recordset'))
    expect(transcriptsInsert).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
npx vitest run tests/main/storage/postgres-vcf-import-repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

Create `src/main/storage/postgres/PostgresVcfImportRepository.ts`:

```typescript
import type { PoolClient } from 'pg'
import { quoteIdentifier } from './sqlIdentifiers' // existing helper used by Phase 8 repo

export interface PostgresVcfImportRequest {
  mode: 'single-file' | 'multi-file'
  fileIndex?: number // multi-file only; 0 = first file (creates case)
  caseName: string
  fileName: string
  filePath: string
  fileSize: number
  genomeBuild: string
  caller: string | null
  annotationFormat: string | null
  variantType: string
  variants: Array<Record<string, unknown>>
  transcripts: Array<Record<string, unknown> & { ordinal: number }>
  sv: Array<Record<string, unknown> & { ordinal: number }>
  cnv: Array<Record<string, unknown> & { ordinal: number }>
  str: Array<Record<string, unknown> & { ordinal: number }>
}

export interface PostgresVcfImportFileResult {
  caseId: number
  variantCount: number
}

export class PostgresVcfImportRepository {
  private readonly schemaName: string

  constructor(schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  async writeVcfFile(
    client: Pick<PoolClient, 'query'>,
    request: PostgresVcfImportRequest
  ): Promise<PostgresVcfImportFileResult> {
    const isFirstFile = request.mode === 'single-file' || (request.fileIndex ?? 0) === 0

    let caseId: number
    if (isFirstFile) {
      // Pre-existing-case rejection. Multi-file requires a *new* case name.
      const dup = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if (dup.rows.length > 0) {
        if (request.mode === 'multi-file') {
          throw new Error(
            `Multi-file import requires a new case name. Case '${request.caseName}' already exists in this schema.`
          )
        }
        throw new Error(`Duplicate case name: ${request.caseName}`)
      }

      const createdAt = Date.now()
      const insertCase = await client.query(
        `INSERT INTO ${this.schemaName}."cases"
         (name, file_path, file_size, variant_count, created_at, genome_build)
         VALUES ($1, $2, $3, 0, $4, $5)
         RETURNING id`,
        [request.caseName, request.filePath, request.fileSize, createdAt, request.genomeBuild]
      )
      caseId = Number((insertCase.rows[0] as { id: unknown }).id)
    } else {
      const lookup = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if (lookup.rows.length === 0) {
        throw new Error(
          `Multi-file import file ${request.fileIndex} references unknown case '${request.caseName}'`
        )
      }
      caseId = Number((lookup.rows[0] as { id: unknown }).id)
    }

    let variantCount = 0
    if (request.variants.length > 0) {
      const insertedIds = await this.insertVariantBatch(client, caseId, request.variants)
      variantCount = insertedIds.length

      // Map ordinals back from extension rows to inserted variant_ids.
      // The SQL returns (ordinal, id) pairs sorted by ordinal.
      const ordinalToId = new Map<number, number>()
      for (const row of insertedIds) {
        ordinalToId.set(row.ordinal, row.id)
      }

      const decorate = (rows: Array<Record<string, unknown> & { ordinal: number }>) =>
        rows
          .map((r) => {
            const variantId = ordinalToId.get(r.ordinal)
            if (variantId === undefined) return null
            const { ordinal: _ordinal, ...rest } = r
            return { variant_id: variantId, ...rest }
          })
          .filter((r): r is Record<string, unknown> => r !== null)

      if (request.transcripts.length > 0) {
        await this.insertExtensionBatch(client, 'variant_transcripts', decorate(request.transcripts))
      }
      if (request.sv.length > 0) {
        await this.insertExtensionBatch(client, 'variant_sv', decorate(request.sv))
      }
      if (request.cnv.length > 0) {
        await this.insertExtensionBatch(client, 'variant_cnv', decorate(request.cnv))
      }
      if (request.str.length > 0) {
        await this.insertExtensionBatch(client, 'variant_str', decorate(request.str))
      }
    }

    // case_data_info per file (Phase 6 schema columns only).
    const createdAt = Date.now()
    await client.query(
      `INSERT INTO ${this.schemaName}."case_data_info"
         (case_id, import_file_name, import_file_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (case_id) DO UPDATE SET
         import_file_name = EXCLUDED.import_file_name,
         import_file_type = EXCLUDED.import_file_type,
         updated_at = EXCLUDED.updated_at`,
      [caseId, request.fileName, 'vcf', createdAt]
    )

    return { caseId, variantCount }
  }

  private async insertVariantBatch(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    variants: Array<Record<string, unknown>>
  ): Promise<Array<{ ordinal: number; id: number }>> {
    // Build batch with explicit ordinals so extension rows can map back.
    const payload = variants.map((v, i) => ({ ordinal: i, ...v, case_id: caseId }))
    const result = await client.query(
      `INSERT INTO ${this.schemaName}."variants"
         (case_id, chr, pos, ref, alt /* + every base column the project uses */)
       SELECT case_id, chr, pos, ref, alt
       FROM jsonb_to_recordset($1::jsonb) AS x(
         ordinal int, case_id bigint, chr text, pos bigint, ref text, alt text
         /* + every base column */
       )
       ORDER BY ordinal
       RETURNING ordinal, id`,
      [caseId, JSON.stringify(payload)]
    )
    return (result.rows as Array<{ ordinal: number; id: unknown }>).map((r) => ({
      ordinal: r.ordinal,
      id: Number(r.id)
    }))
  }

  private async insertExtensionBatch(
    client: Pick<PoolClient, 'query'>,
    table: 'variant_transcripts' | 'variant_sv' | 'variant_cnv' | 'variant_str',
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (rows.length === 0) return
    // The exact column list for each extension table comes from the existing
    // PostgresJsonImportRepository — Phase 9 reuses those column lists. The
    // worker passes already-mapped extension rows; this method only formats
    // the jsonb-driven INSERT.
    const columnLists: Record<string, string[]> = {
      variant_transcripts: [/* matching JSON repo */],
      variant_sv: [/* matching JSON repo */],
      variant_cnv: [/* matching JSON repo */],
      variant_str: [/* matching JSON repo */]
    }
    const columns = columnLists[table]
    if (!columns) throw new Error(`Unknown extension table: ${table}`)
    const columnList = columns.map((c) => `"${c}"`).join(', ')
    const recordsetCols = columns.join(', ')
    await client.query(
      `INSERT INTO ${this.schemaName}.${quoteIdentifier(table)} (${columnList})
       SELECT ${recordsetCols}
       FROM jsonb_to_recordset($1::jsonb) AS x(${recordsetCols})`,
      [JSON.stringify(rows)]
    )
  }
}
```

The implementer fills the column lists for each extension table by reading the equivalent batched-insert SQL already present in `PostgresJsonImportRepository`. They are identical between JSON and VCF — the schema is shared.

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/storage/postgres-vcf-import-repository.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/postgres/PostgresVcfImportRepository.ts \
        tests/main/storage/postgres-vcf-import-repository.test.ts
git commit -m "feat(storage): add PostgresVcfImportRepository transaction-scoped writes"
```

---

## Task 10: Wire VCF Single-File Through `postgres-import-worker`

**Files:**
- Modify: `src/main/workers/postgres-import-worker.ts`
- Modify: `tests/main/workers/postgres-import-worker.test.ts`

The Task 6 worker shell threw "VCF not yet implemented" for `formatInfo.format === 'vcf'`. Replace that branch with a real VCF parsing-pipeline drive into `PostgresVcfImportRepository.writeVcfFile`.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/workers/postgres-import-worker.test.ts`:

```typescript
import { Readable } from 'node:stream'

it('drives VCF parsing and writes through PostgresVcfImportRepository', async () => {
  const queries: string[] = []
  const client = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push(text)
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) return { rows: [{ id: 13 }] }
      if (text.includes('"variants"') && text.includes('jsonb_to_recordset')) {
        const batch = JSON.parse(String((params as unknown[])[1])) as unknown[]
        return { rows: batch.map((_, i) => ({ ordinal: i, id: 5000 + i })) }
      }
      return { rows: [] }
    }),
    end: vi.fn(async () => undefined)
  }
  const messages: unknown[] = []
  await runImport(
    {
      createClient: () => client as never,
      detectFormat: async () => ({ format: 'vcf', extension: 'vcf' }) as never,
      // The worker for VCF uses the VCF parsing pipeline directly; fake it as a
      // simple async iterator that yields one mapped variant.
      createVcfMappedStream: async () => Readable.from([
        {
          variant: { chr: '1', pos: 100, ref: 'A', alt: 'T' },
          transcripts: [],
          sv: [], cnv: [], str: []
        }
      ]),
      statFile: () => ({ size: 0 })
    } as never,
    {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'VCF case',
      filePath: '/tmp/a.vcf.gz',
      format: 'vcf',
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' }
    },
    (m) => messages.push(m)
  )
  expect(queries[0]).toBe('BEGIN')
  expect(queries.at(-1)).toBe('COMMIT')
  expect(queries.find((q) => q.includes('"variants"') && q.includes('jsonb_to_recordset'))).toBeDefined()
  expect(queries.find((q) => q.includes('"variant_frequency"'))).toBeDefined()
  const complete = messages.find((m): m is { type: 'complete' } => (m as { type: string }).type === 'complete')
  expect(complete).toBeDefined()
})
```

- [ ] **Step 2: Run, verify it fails**

Expected: FAIL — VCF branch still throws "not yet implemented" in worker.

- [ ] **Step 3: Implement the VCF branch**

Edit `src/main/workers/postgres-import-worker.ts`. Add a new dependency `createVcfMappedStream(filePath, options) => Readable<MappedVcfRow>` to `RunImportDeps` and wire its default to compose the existing parsing modules:

```typescript
import { parseVcfHeader } from '../import/vcf/vcf-header-parser'
import { parseVcfLine } from '../import/vcf/vcf-line-parser'
import { splitMultiAllelic } from '../import/vcf/vcf-allele-splitter'
import { parseAnnotation } from '../import/vcf/vcf-annotation-parser'
import { parseGenotype } from '../import/vcf/vcf-genotype-parser'
import { mapVcfRow } from '../import/vcf/VcfMapper'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'

async function defaultCreateVcfMappedStream(
  filePath: string,
  options: { selectedSample: string; genomeBuild: string }
): Promise<Readable> {
  // Wraps the existing VCF parsing modules into a Readable<MappedVcfRow> with
  // per-line back-pressure. The exact composition mirrors the SQLite worker's
  // streamInsertVcf() but emits mapped rows instead of executing inserts.
  // Implementer should refactor `streamInsertVcf` to expose a parallel
  // `streamMappedVcfRows` that returns the iterator without writing to SQLite.
  // ...
}
```

Replace the VCF branch in `runImport`:

```typescript
if (formatInfo.format === 'vcf') {
  const selectedSample = start.vcfOptions?.selectedSample
  if (!selectedSample) {
    throw new Error('VCF import requires vcfOptions.selectedSample')
  }
  const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'

  const repo = new PostgresVcfImportRepository(start.schema)
  const fileName = basename(filePath)
  let fileSize = 0
  try { fileSize = deps.statFile(filePath).size } catch { /* ignore */ }

  const stream = await deps.createVcfMappedStream(filePath, { selectedSample, genomeBuild })

  const variants: Array<Record<string, unknown>> = []
  const transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
  const sv: Array<Record<string, unknown> & { ordinal: number }> = []
  const cnv: Array<Record<string, unknown> & { ordinal: number }> = []
  const str: Array<Record<string, unknown> & { ordinal: number }> = []
  let totalInserted = 0
  let ordinal = 0

  const flush = async (caseId: number, batchRequest: PostgresVcfImportRequest) => {
    if (variants.length === 0) return
    const result = await repo.writeVcfFile(client as never, batchRequest)
    totalInserted += result.variantCount
    post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
    variants.length = 0
    transcripts.length = 0
    sv.length = 0
    cnv.length = 0
    str.length = 0
  }

  // First call to writeVcfFile creates the case (or rejects pre-existing).
  // For single-file VCF, batches >1 still need to write into the same case;
  // the simplest contract is one writeVcfFile call per *batch* in single-file
  // mode, with mode='multi-file' fileIndex>=1 for batches 2+. This keeps the
  // repository API stable while letting the worker stream WGS-scale data.
  let firstWritten = false
  let caseId = 0

  for await (const row of stream) {
    if (cancelled) {
      stream.destroy()
      throw new Error(CANCELLATION_MESSAGE)
    }
    variants.push({ ...(row.variant as Record<string, unknown>), ordinal })
    for (const tr of (row.transcripts ?? []) as Array<Record<string, unknown>>) {
      transcripts.push({ ordinal, ...tr } as never)
    }
    for (const e of (row.sv ?? []) as Array<Record<string, unknown>>) sv.push({ ordinal, ...e } as never)
    for (const e of (row.cnv ?? []) as Array<Record<string, unknown>>) cnv.push({ ordinal, ...e } as never)
    for (const e of (row.str ?? []) as Array<Record<string, unknown>>) str.push({ ordinal, ...e } as never)
    ordinal += 1

    if (variants.length >= POSTGRES_JSON_IMPORT_BATCH_SIZE) {
      const batchRequest: PostgresVcfImportRequest = firstWritten
        ? { mode: 'multi-file', fileIndex: 1, caseName: start.caseName, fileName, filePath, fileSize, genomeBuild,
            caller: null, annotationFormat: null, variantType: 'snv-indel', variants: [...variants],
            transcripts: [...transcripts], sv: [...sv], cnv: [...cnv], str: [...str] }
        : { mode: 'single-file', caseName: start.caseName, fileName, filePath, fileSize, genomeBuild,
            caller: null, annotationFormat: null, variantType: 'snv-indel', variants: [...variants],
            transcripts: [...transcripts], sv: [...sv], cnv: [...cnv], str: [...str] }
      const result = await repo.writeVcfFile(client as never, batchRequest)
      if (!firstWritten) {
        caseId = result.caseId
        firstWritten = true
      }
      totalInserted += result.variantCount
      post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
      variants.length = 0
      transcripts.length = 0
      sv.length = 0
      cnv.length = 0
      str.length = 0
    }
  }
  // Final flush
  if (variants.length > 0) {
    const batchRequest: PostgresVcfImportRequest = firstWritten
      ? { mode: 'multi-file', fileIndex: 1, caseName: start.caseName, fileName, filePath, fileSize, genomeBuild,
          caller: null, annotationFormat: null, variantType: 'snv-indel', variants, transcripts, sv, cnv, str }
      : { mode: 'single-file', caseName: start.caseName, fileName, filePath, fileSize, genomeBuild,
          caller: null, annotationFormat: null, variantType: 'snv-indel', variants, transcripts, sv, cnv, str }
    const result = await repo.writeVcfFile(client as never, batchRequest)
    if (!firstWritten) caseId = result.caseId
    totalInserted += result.variantCount
  }

  // Refresh case variant_count + frequency for this case.
  await client.query(
    `UPDATE ${start.schema /* quoted in real impl */}."cases" SET variant_count = $1 WHERE id = $2`,
    [totalInserted, caseId]
  )
  await rebuildVariantFrequencyForCase(client as never, start.schema, caseId)
  await client.query('COMMIT')
  committed = true

  post({
    type: 'complete',
    mode: 'single-file',
    result: { caseId, variantCount: totalInserted, skipped: 0, errors: [], elapsed: Date.now() - startedAt }
  })
  return
}
```

Note the schema interpolation must use `quoteIdentifier(start.schema)` (the same helper Phase 8 uses) — the snippet shows the structure; the implementer wires the actual quoted form.

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/workers/postgres-import-worker.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/workers/postgres-import-worker.ts tests/main/workers/postgres-import-worker.test.ts
git commit -m "feat(workers): wire VCF single-file path through PostgresVcfImportRepository"
```

---

## Task 11: Wire Multi-File Path Through `postgres-import-worker`

**Files:**
- Modify: `src/main/workers/postgres-import-worker.ts`
- Modify: `src/main/storage/postgres/PostgresImportExecutor.ts`
- Modify: `tests/main/workers/postgres-import-worker.test.ts`
- Modify: `tests/main/storage/postgres-import-executor.test.ts`

Multi-file = per-file BEGIN/COMMIT, post-loop bookkeeping in a final transaction. Per-file errors are caught and surfaced in `MultiFileImportResult.files[].error`. Cancellation between files terminates cleanly.

- [ ] **Step 1: Write the failing test for per-file transactions**

Add to `tests/main/workers/postgres-import-worker.test.ts`:

```typescript
it('runs one transaction per file in multi-file mode and surfaces per-file errors', async () => {
  const queries: string[] = []
  let callCount = 0
  const client = {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string | { text: string }) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push(text)
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
        callCount += 1
        if (callCount === 2) throw new Error('inject failure on file 2')
        return { rows: [{ id: 21 }] }
      }
      return { rows: [] }
    }),
    end: vi.fn(async () => undefined)
  }
  const messages: unknown[] = []
  await runImport(
    {
      createClient: () => client as never,
      detectFormat: async () => ({ format: 'vcf', extension: 'vcf' }) as never,
      createVcfMappedStream: async () => (await import('node:stream')).Readable.from([]),
      statFile: () => ({ size: 0 })
    } as never,
    {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'multi-file',
      caseName: 'Multi',
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      files: [
        { filePath: '/tmp/a.vcf.gz', variantType: 'snv-indel', annotationFormat: null, caller: null },
        { filePath: '/tmp/b.vcf.gz', variantType: 'snv-indel', annotationFormat: null, caller: null }
      ]
    },
    (m) => messages.push(m)
  )

  // Should see two BEGINs and at least one ROLLBACK plus one COMMIT for the
  // post-loop bookkeeping txn.
  const beginCount = queries.filter((q) => q === 'BEGIN').length
  expect(beginCount).toBe(3) // two per-file + one post-loop
  expect(queries.includes('ROLLBACK')).toBe(true)
  expect(queries.includes('COMMIT')).toBe(true)

  const complete = messages.find((m): m is { type: 'complete' } => (m as { type: string }).type === 'complete')
  expect(complete).toBeDefined()
  const result = complete!.result as { files: Array<{ error?: string }> }
  expect(result.files[0].error).toBeUndefined()
  expect(result.files[1].error).toMatch(/inject failure/)
})
```

- [ ] **Step 2: Run, verify it fails**

Expected: FAIL — multi-file branch still throws "not yet implemented".

- [ ] **Step 3: Implement the multi-file branch**

Replace the `start.mode === 'multi-file'` branch in `postgres-import-worker.ts`:

```typescript
if (start.mode === 'multi-file') {
  if (!start.files || start.files.length === 0) {
    throw new Error('postgres-import-worker: multi-file mode requires non-empty files[]')
  }
  // Multi-file uses its own per-file transaction lifecycle, not the outer
  // single-file BEGIN. Roll back the BEGIN we already started.
  await client.query('ROLLBACK')
  beganTransaction = false

  const fileResults: Array<{
    filePath: string
    variantType: string
    variantCount: number
    error?: string
  }> = []
  let caseId = 0
  let totalVariantCount = 0
  const repo = new PostgresVcfImportRepository(start.schema)

  for (let i = 0; i < start.files.length; i += 1) {
    if (cancelled) break
    const fileSpec = start.files[i]
    try {
      await client.query('BEGIN')
      const fileName = basename(fileSpec.filePath)
      let fileSize = 0
      try { fileSize = deps.statFile(fileSpec.filePath).size } catch { /* ignore */ }

      const selectedSample = start.vcfOptions?.selectedSample ?? ''
      const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'

      const stream = await deps.createVcfMappedStream(fileSpec.filePath, { selectedSample, genomeBuild })
      const variants: Array<Record<string, unknown>> = []
      const transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
      const sv: Array<Record<string, unknown> & { ordinal: number }> = []
      const cnv: Array<Record<string, unknown> & { ordinal: number }> = []
      const str: Array<Record<string, unknown> & { ordinal: number }> = []
      let ordinal = 0
      let fileVariantCount = 0
      let firstBatch = true

      const flushBatch = async () => {
        if (variants.length === 0) return
        const result = await repo.writeVcfFile(client as never, {
          mode: 'multi-file',
          fileIndex: firstBatch && i === 0 ? 0 : 1,
          caseName: start.caseName,
          fileName,
          filePath: fileSpec.filePath,
          fileSize,
          genomeBuild,
          caller: fileSpec.caller ?? null,
          annotationFormat: fileSpec.annotationFormat ?? null,
          variantType: fileSpec.variantType,
          variants: [...variants],
          transcripts: [...transcripts],
          sv: [...sv],
          cnv: [...cnv],
          str: [...str]
        })
        if (caseId === 0) caseId = result.caseId
        fileVariantCount += result.variantCount
        firstBatch = false
        post({ type: 'progress', phase: 'inserting', rowsProcessed: totalVariantCount + fileVariantCount, filePath: fileSpec.filePath })
        variants.length = 0
        transcripts.length = 0
        sv.length = 0
        cnv.length = 0
        str.length = 0
      }

      for await (const row of stream) {
        if (cancelled) {
          stream.destroy()
          throw new Error(CANCELLATION_MESSAGE)
        }
        variants.push({ ...(row.variant as Record<string, unknown>), ordinal })
        for (const tr of (row.transcripts ?? []) as Array<Record<string, unknown>>) transcripts.push({ ordinal, ...tr } as never)
        for (const e of (row.sv ?? []) as Array<Record<string, unknown>>) sv.push({ ordinal, ...e } as never)
        for (const e of (row.cnv ?? []) as Array<Record<string, unknown>>) cnv.push({ ordinal, ...e } as never)
        for (const e of (row.str ?? []) as Array<Record<string, unknown>>) str.push({ ordinal, ...e } as never)
        ordinal += 1
        if (variants.length >= POSTGRES_JSON_IMPORT_BATCH_SIZE) await flushBatch()
      }
      await flushBatch()
      await client.query('COMMIT')
      totalVariantCount += fileVariantCount
      fileResults.push({ filePath: fileSpec.filePath, variantType: fileSpec.variantType, variantCount: fileVariantCount })
      post({ type: 'file-complete', filePath: fileSpec.filePath, caseId, variantCount: fileVariantCount })
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* swallow */ }
      const message = err instanceof Error ? err.message : String(err)
      if (message === CANCELLATION_MESSAGE) throw err // propagate to outer handler
      fileResults.push({
        filePath: fileSpec.filePath,
        variantType: fileSpec.variantType,
        variantCount: 0,
        error: message
      })
    }
  }

  // Post-loop bookkeeping. Run only if at least one file committed (caseId
  // is set when file 1 successfully created the case).
  if (caseId !== 0) {
    await client.query('BEGIN')
    try {
      await client.query(
        `UPDATE ${quoteIdentifier(start.schema)}."cases" SET variant_count = $1 WHERE id = $2`,
        [totalVariantCount, caseId]
      )
      await rebuildVariantFrequencyForCase(client as never, start.schema, caseId)
      await client.query('COMMIT')
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* swallow */ }
      throw err
    }
  }

  post({
    type: 'complete',
    mode: 'multi-file',
    result: {
      caseId,
      variantCount: totalVariantCount,
      files: fileResults,
      skipped: 0,
      errors: cancelled ? [CANCELLATION_MESSAGE] : [],
      elapsed: Date.now() - startedAt
    }
  })
  return
}
```

- [ ] **Step 4: Implement `PostgresImportExecutor.importMultiFile`**

Replace the Task 7 stub:

```typescript
async importMultiFile(
  params: StorageImportMultiFileParams
): Promise<StorageImportMultiFileResult> {
  if (this.inProgress) throw new Error('An import is already in progress')
  this.inProgress = true
  try {
    const start: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: this.options.clientConfig,
      schema: this.options.schema,
      mode: 'multi-file',
      caseName: params.caseName,
      files: params.files,
      vcfOptions: params.vcfOptions,
      filters: params.filters
        ? {
            bedFilePath: params.filters.bedFilePath ?? null,
            bedPadding: params.filters.bedPadding,
            passOnly: params.filters.passOnly,
            minQual: params.filters.minQual,
            minGq: params.filters.minGq,
            minDp: params.filters.minDp
          }
        : undefined
    }
    const result = await this.runWorker(start, params.onProgress, params.onFileComplete)
    return {
      caseId: result.caseId,
      variantCount: result.variantCount,
      files: result.files ?? [],
      skipped: result.skipped,
      errors: result.errors,
      elapsed: result.elapsed
    }
  } finally {
    this.inProgress = false
    this.currentClient = null
  }
}
```

Update `runWorker` to optionally accept `onFileComplete`.

- [ ] **Step 5: Run, verify pass**

```bash
npx vitest run tests/main/workers/postgres-import-worker.test.ts \
              tests/main/storage/postgres-import-executor.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main/workers/postgres-import-worker.ts \
        src/main/storage/postgres/PostgresImportExecutor.ts \
        tests/main/workers/postgres-import-worker.test.ts \
        tests/main/storage/postgres-import-executor.test.ts
git commit -m "feat(workers): wire multi-file path with per-file txn and post-loop bookkeeping"
```

---

## Task 12: Apply BED Filter and Pre-Mapping Filters Inside Worker

**Files:**
- Modify: `src/main/workers/postgres-import-worker.ts`
- Modify: `tests/main/workers/postgres-import-worker.test.ts`

For multi-file imports the start message carries `filters.bedFilePath` (a path, not a parsed `BedFilter`). The worker loads `BedFilter.fromFile(...)` itself and applies it during VCF parsing. Pre-mapping filters (`passOnly`, `minQual`, `minGq`, `minDp`) are applied per-line by the existing `import-filters` module.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/workers/postgres-import-worker.test.ts`:

```typescript
it('loads BedFilter and applies pre-mapping filters inside worker for multi-file', async () => {
  const bedFilterFromFile = vi.fn(() => ({
    intersects: () => true
  }))
  const onLineFilter = vi.fn(() => true)

  // ... drive runImport with mode='multi-file', filters: { bedFilePath: '/abs/x.bed', passOnly: true },
  // and assert bedFilterFromFile was called with '/abs/x.bed' and the line-filter
  // function was invoked for each yielded VCF row.
})
```

(Implementer fills the assertions to call into the dependency-injected stream so the dependencies are observable.)

- [ ] **Step 2: Implement BED + filter wiring**

Inside the multi-file branch, when `start.filters` is set:

```typescript
import { BedFilter } from '../import/vcf/bed-filter'
import { applyImportFilters } from '../import/vcf/import-filters'

let bedFilter: BedFilter | undefined
if (start.filters?.bedFilePath) {
  bedFilter = BedFilter.fromFile(start.filters.bedFilePath, start.filters.bedPadding ?? 0)
}
```

Pass `bedFilter` and the rest of the filter payload to the per-file mapped-stream call. The mapped-stream factory already accepts a filter struct — extend its options shape to include them.

- [ ] **Step 3: Run, verify pass**

```bash
npx vitest run tests/main/workers/postgres-import-worker.test.ts -t 'BedFilter|filters'
make typecheck
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/main/workers/postgres-import-worker.ts tests/main/workers/postgres-import-worker.test.ts
git commit -m "feat(workers): apply BED + pre-mapping filters inside postgres import worker"
```

---

## Task 13: Route VCF + Multi-File Through Storage Executor in `import-logic.ts`

**Files:**
- Modify: `src/main/ipc/handlers/import-logic.ts`
- Modify: `src/main/ipc/handlers/import.ts`
- Modify: `tests/main/handlers/import-logic.test.ts`

Today VCF on PG bails with "PostgreSQL import currently supports JSON files only" (Phase 8 message). Multi-file is SQLite-only. Phase 9 routes both through the session executor on PG; SQLite continues to use its current paths.

- [ ] **Step 1: Write the failing test**

Add to `tests/main/handlers/import-logic.test.ts`:

```typescript
describe('import-logic VCF + multi-file routing on PostgreSQL', () => {
  it('routes a VCF import:start through the session importSingleFile executor', async () => {
    const importSingleFile = vi.fn(async () => ({ caseId: 5, variantCount: 10, skipped: 0, errors: [], elapsed: 1 }))
    const session = {
      backend: 'postgres',
      getImportExecutor: () => ({ importSingleFile, importMultiFile: vi.fn(), cancel: vi.fn() })
    }
    const result = await runImportLogic(
      { /* deps */ session, getDbManager: () => null },
      { filePath: '/tmp/a.vcf.gz', caseName: 'X', vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' } }
    )
    expect(importSingleFile).toHaveBeenCalled()
    expect(result.variantCount).toBe(10)
  })

  it('routes import:startMultiFile through the session importMultiFile executor on PG', async () => {
    const importMultiFile = vi.fn(async () => ({
      caseId: 6, variantCount: 20,
      files: [{ filePath: '/abs/a.vcf', variantType: 'snv-indel', variantCount: 20 }],
      skipped: 0, errors: [], elapsed: 2
    }))
    const session = {
      backend: 'postgres',
      getImportExecutor: () => ({ importSingleFile: vi.fn(), importMultiFile, cancel: vi.fn() })
    }
    // ... drive the multi-file handler with two files; assert importMultiFile was called.
  })

  it('rejects multi-file import on PG with a pre-existing case name', async () => {
    const importMultiFile = vi.fn(async () => {
      throw new Error("Multi-file import requires a new case name. Case 'X' already exists in this schema.")
    })
    // ... assert the IPC failure message bubbles up unchanged.
  })

  it('preserves the existing SQLite VCF + multi-file paths', async () => {
    const session = { backend: 'sqlite', getImportExecutor: () => ({ /* SQLite executor with same shape */ }) }
    // ... assert SQLite delegation; current import-logic SQLite path remains intact.
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Expected: FAIL — current import-logic does not route VCF or multi-file through the session executor on PG.

- [ ] **Step 3: Implement the routing**

In `import-logic.ts`, replace the VCF rejection branch on PG with a call to `session.getImportExecutor().importSingleFile(...)`. Replace the multi-file SQLite-only path with a backend dispatch:

```typescript
if (session.backend === 'postgres') {
  return session.getImportExecutor().importMultiFile({
    caseName,
    files,
    vcfOptions,
    filters: filtersIpc ? {
      bedFilePath: filtersIpc.bedFile ?? null,
      bedPadding: filtersIpc.bedPadding,
      passOnly: filtersIpc.passOnly,
      minQual: filtersIpc.minQual,
      minGq: filtersIpc.minGq,
      minDp: filtersIpc.minDp
    } : undefined,
    onProgress,
    onFileComplete
  })
}
// Existing SQLite multi-file path follows unchanged.
```

In `import.ts`, ensure the multi-file handler passes the storage session (not just the legacy db manager). For the PG path, pass the BED file path through (don't load `BedFilter.fromFile` in main — the worker does it).

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run tests/main/handlers/import-logic.test.ts
make typecheck
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/import-logic.ts src/main/ipc/handlers/import.ts \
        tests/main/handlers/import-logic.test.ts
git commit -m "feat(ipc): route postgres vcf and multi-file imports through storage executor"
```

---

## Task 14: Docker E2E — PG VCF Single-Sample + Extensions + BED

**Files:**
- Create: `tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts`
- Create: `tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts`
- Create: `tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts`

Gated by `VARLENS_RUN_POSTGRES_E2E=1`. Use existing fixtures at `tests/test-data/vcf/`.

- [ ] **Step 1: Author single-sample E2E**

Create `tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts`. Use the same harness pattern as `postgres-json-import-dev-mode.e2e.ts`. Import `tests/test-data/vcf/single-sample.vcf.gz`, then verify:

- `import:start` returns `IpcResult.ok` with a non-seeded case ID and `variantCount > 0`.
- `cases:query` includes the new case by name.
- `caseMetadata.getDataInfo(caseId)` reports `import_file_name = 'single-sample.vcf.gz'` and `import_file_type = 'vcf'`.
- `variants.typeCounts(caseId)` reports the imported SNV count.
- `variants.query(caseId, { gene_symbol: 'BRCA1' }, ...)` returns at least one row when present.
- `variants.query(caseId, { search_query: 'BRCA1' }, ...)` proves the Phase 7 `search_document` trigger populated full-text data on the imported rows.
- `cases:availableBuilds` includes the case's build.
- `variants.query(caseId, { max_internal_af: 1 }, ...)` includes imported rows (proves `variant_frequency` was rebuilt).

- [ ] **Step 2: Author extensions E2E**

Create `tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts`. Imports `synthetic-sv.vcf`, `synthetic-cnv.vcf`, `synthetic-str.vcf` (one per case) and asserts the extension tables (`variant_sv`, `variant_cnv`, `variant_str`) populated; reads through `variants.query` join paths return the extension data.

- [ ] **Step 3: Author BED-filter E2E**

Create `tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts`. Use multi-file import (since BED is multi-file-only) with `single-sample.vcf.gz` plus `test-regions.bed`. Verify post-filter variant counts < unfiltered import.

- [ ] **Step 4: Run gated E2E set**

```bash
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test \
  tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts
make pg-down
```

Expected: green when Docker is available.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/postgres-vcf-single-sample-dev-mode.e2e.ts \
        tests/e2e/postgres-vcf-extensions-dev-mode.e2e.ts \
        tests/e2e/postgres-vcf-bed-filter-dev-mode.e2e.ts
git commit -m "test(e2e): postgres vcf single-sample + extensions + bed filter"
```

---

## Task 15: Docker E2E — Multi-File Happy Path + Partial Failure + Pre-Existing Case Rejection

**Files:**
- Create: `tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts`
- Create: `tests/e2e/postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts`
- Create: `tests/e2e/postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts`

- [ ] **Step 1: Author happy-path multi-file E2E**

Two single-sample VCFs (or two copies of the same file with renamed cases) merged into one case via `import:startMultiFile`. Verify the case has variants from both files.

- [ ] **Step 2: Author partial-failure E2E**

Multi-file with file 2 deliberately malformed (e.g., copy of a VCF with a corrupted line). Verify:

- The IPC returns success at the IPC envelope level (not a thrown error) since multi-file surfaces per-file errors in the body.
- `MultiFileImportResult.files[0].error` is undefined; `files[1].error` matches the failure message.
- `cases.variant_count` reflects only file 1's variants (since file 2 rolled back).
- Post-loop bookkeeping ran (frequency rebuild updated for file 1's variants).

- [ ] **Step 3: Author pre-existing-case rejection E2E**

Pre-import a case with `caseName` `'PreExisting'`. Then run multi-file with the same name and any single VCF. Verify the IPC rejects with the documented message and no inserts happened (`cases.variant_count` for `'PreExisting'` unchanged).

- [ ] **Step 4: Run gated E2E set**

```bash
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test \
  tests/e2e/postgres-vcf-multi-file-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-multi-file-partial-failure-dev-mode.e2e.ts \
  tests/e2e/postgres-vcf-multi-file-pre-existing-case-rejection-dev-mode.e2e.ts
make pg-down
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/postgres-vcf-multi-file-*.e2e.ts
git commit -m "test(e2e): postgres vcf multi-file happy + partial failure + pre-existing rejection"
```

---

## Task 16: Docker E2E — Cancellation + Renderer-Responsive

**Files:**
- Create: `tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts`
- Create: `tests/e2e/postgres-import-renderer-responsive.e2e.ts`

- [ ] **Step 1: Author cancellation E2E**

Start a long import (use `trio-region.vcf.gz` or chain multiple imports for length), call `import:cancel` after a short delay, verify:

- The result returned to the renderer matches the documented cancellation shape (`errors: ['Import cancelled by user']`).
- `cases` table is unchanged for that import.

- [ ] **Step 2: Author renderer-responsive E2E**

Start a multi-file import. While it runs, issue ten consecutive `cases:list` IPCs at 100 ms intervals. Assert each returns within `250 ms`. Proves the worker keeps the main thread responsive.

```typescript
const importPromise = ipcInvoke('import:startMultiFile', { /* multi-file payload */ })
const latencies: number[] = []
for (let i = 0; i < 10; i += 1) {
  const t = Date.now()
  await ipcInvoke('cases:list', {})
  latencies.push(Date.now() - t)
  await sleep(100)
}
await importPromise
expect(Math.max(...latencies)).toBeLessThan(250)
```

- [ ] **Step 3: Run gated E2E set**

```bash
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test \
  tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts \
  tests/e2e/postgres-import-renderer-responsive.e2e.ts
make pg-down
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/postgres-import-cancellation-dev-mode.e2e.ts \
        tests/e2e/postgres-import-renderer-responsive.e2e.ts
git commit -m "test(e2e): postgres import cancellation + renderer responsiveness"
```

---

## Task 17: WGS Fixture Downloader

**Files:**
- Create: `scripts/postgres/download-wgs-fixture.sh`
- Modify: `.gitignore`

Idempotent download of GIAB HG002 GRCh38 v4.2.1 high-confidence VCF + tabix index, with checksum verification, into `tests/.cache/wgs/`.

- [ ] **Step 1: Add the gitignore entry**

Append to `.gitignore`:

```gitignore
tests/.cache/wgs/
.planning/artifacts/perf/wgs-import/
```

- [ ] **Step 2: Author the download script**

Create `scripts/postgres/download-wgs-fixture.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

CACHE_DIR="$(git rev-parse --show-toplevel)/tests/.cache/wgs"
mkdir -p "${CACHE_DIR}"

VCF_URL="https://ftp-trace.ncbi.nlm.nih.gov/ReferenceSamples/giab/release/AshkenazimTrio/HG002_NA24385_son/NISTv4.2.1/GRCh38/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz"
VCF_TBI_URL="${VCF_URL}.tbi"
VCF_FILE="${CACHE_DIR}/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz"
VCF_TBI_FILE="${VCF_FILE}.tbi"
VCF_SHA256="" # TODO: pin checksum after first download

download_if_missing() {
  local url="$1"
  local out="$2"
  if [[ -f "${out}" ]]; then
    echo "[wgs-fixture] ${out} already present"
    return 0
  fi
  echo "[wgs-fixture] downloading ${url}"
  curl -fL --retry 3 --retry-delay 5 -o "${out}.partial" "${url}"
  mv "${out}.partial" "${out}"
}

download_if_missing "${VCF_URL}" "${VCF_FILE}"
download_if_missing "${VCF_TBI_URL}" "${VCF_TBI_FILE}"

if [[ -n "${VCF_SHA256}" ]]; then
  echo "${VCF_SHA256}  ${VCF_FILE}" | sha256sum -c -
fi

echo "[wgs-fixture] ready: ${VCF_FILE}"
```

`chmod +x scripts/postgres/download-wgs-fixture.sh`. The pinned checksum is filled in after the first successful download.

- [ ] **Step 3: Run once to verify the script downloads cleanly**

```bash
scripts/postgres/download-wgs-fixture.sh
```

Expected: file present in `tests/.cache/wgs/`.

- [ ] **Step 4: Pin the SHA256 checksum**

```bash
sha256sum tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz
```

Copy the value into `VCF_SHA256` in the script. Re-run the script to verify the checksum-check passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/postgres/download-wgs-fixture.sh .gitignore
git commit -m "feat(scripts): add idempotent GIAB HG002 wgs fixture downloader"
```

---

## Task 18: WGS Perf Tests for PG and SQLite + Comparison Script

**Files:**
- Create: `tests/perf/postgres-vcf-wgs-import.perf.test.ts`
- Create: `tests/perf/sqlite-vcf-wgs-import.perf.test.ts`
- Create: `scripts/perf/compare-wgs-import.mjs`
- Create: `.planning/artifacts/perf/wgs-import/.gitkeep`

Both perf tests gated by `VARLENS_RUN_WGS_PERF=1`. Each imports the GIAB HG002 fixture into a freshly reset target, records elapsed time to `.planning/artifacts/perf/wgs-import/<timestamp>-{backend}.md`, and asserts elapsed below `BUDGET_S` (set after first run).

- [ ] **Step 1: Author PG perf test**

Create `tests/perf/postgres-vcf-wgs-import.perf.test.ts`. Skip if `VARLENS_RUN_WGS_PERF !== '1'`. Reset PG schema (or rely on `make pg-reset` having been run). Measure elapsed time around an Electron `import:start` call against the fixture. Write the artifact:

```typescript
import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SHOULD_RUN = process.env.VARLENS_RUN_WGS_PERF === '1'
const FIXTURE = resolve(process.cwd(), 'tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz')
const BUDGET_S = Number(process.env.VARLENS_PG_WGS_BUDGET_S ?? '600')

describe.skipIf(!SHOULD_RUN)('postgres VCF WGS import perf', () => {
  it(`imports the GIAB HG002 fixture into PG within ${BUDGET_S}s`, async () => {
    // Boot Electron, configure PG storage, run import:start, collect elapsed.
    // (Implementer wires in the existing electron-app harness.)
    const elapsedSec = await runPgWgsImport(FIXTURE)
    expect(elapsedSec).toBeLessThan(BUDGET_S)
    writeArtifact('postgres', elapsedSec)
  }, BUDGET_S * 1000 + 60_000)
})

function writeArtifact(backend: string, elapsedSec: number) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(process.cwd(), `.planning/artifacts/perf/wgs-import/${ts}-${backend}.md`)
  writeFileSync(path, `# WGS import perf — ${backend}\n\n- timestamp: ${ts}\n- elapsed: ${elapsedSec.toFixed(2)}s\n`)
}
```

- [ ] **Step 2: Author SQLite perf test**

Create `tests/perf/sqlite-vcf-wgs-import.perf.test.ts`. Mirror the PG test against a fresh SQLite database file.

- [ ] **Step 3: Author the comparison script**

Create `scripts/perf/compare-wgs-import.mjs`:

```javascript
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(process.cwd(), '.planning/artifacts/perf/wgs-import')
const entries = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.endsWith('-comparison.md'))
const latest = (backend) => {
  const matches = entries.filter((f) => f.endsWith(`-${backend}.md`)).sort()
  return matches.at(-1)
}

const pgFile = latest('postgres')
const sqliteFile = latest('sqlite')
if (!pgFile || !sqliteFile) {
  console.error('Need at least one postgres and one sqlite baseline artifact in', dir)
  process.exit(1)
}

const parseElapsed = (path) => {
  const text = readFileSync(resolve(dir, path), 'utf8')
  const match = text.match(/elapsed: ([\d.]+)s/)
  if (!match) throw new Error(`No elapsed in ${path}`)
  return Number(match[1])
}

const pg = parseElapsed(pgFile)
const sqlite = parseElapsed(sqliteFile)
const ratio = pg / sqlite
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const out = resolve(dir, `${ts}-comparison.md`)
writeFileSync(
  out,
  `# WGS import comparison — ${ts}\n\n` +
  `- postgres: ${pg.toFixed(2)}s (source: ${pgFile})\n` +
  `- sqlite:   ${sqlite.toFixed(2)}s (source: ${sqliteFile})\n` +
  `- ratio:    ${ratio.toFixed(2)}× (postgres / sqlite)\n` +
  `- escalation rule: if ratio > 2.0×, open a follow-up phase to use COPY FROM STDIN.\n`
)
console.log(`Wrote ${out}`)
```

`chmod +x scripts/perf/compare-wgs-import.mjs`.

- [ ] **Step 4: Initial measurement run**

```bash
scripts/postgres/download-wgs-fixture.sh
make pg-reset && make pg-up
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
node scripts/perf/compare-wgs-import.mjs
make pg-down
```

Record the resulting baseline artifacts under `.planning/artifacts/perf/wgs-import/` and the comparison file. Set `BUDGET_S = 1.5 × baseline` for each backend by setting `VARLENS_PG_WGS_BUDGET_S` / `VARLENS_SQLITE_WGS_BUDGET_S` env defaults in the test files (or in a small `tests/perf/wgs-budgets.ts` helper).

- [ ] **Step 5: Commit (artifacts and script — keep the actual `.md` baselines untracked since `.gitignore` excludes the directory; commit only the `.gitkeep` so the dir exists)**

```bash
git add tests/perf/postgres-vcf-wgs-import.perf.test.ts \
        tests/perf/sqlite-vcf-wgs-import.perf.test.ts \
        scripts/perf/compare-wgs-import.mjs \
        .planning/artifacts/perf/wgs-import/.gitkeep
git commit -m "test(perf): wgs import benchmarks for postgres and sqlite with comparison"
```

---

## Task 19: AGENTS.md WGS Subsection

**Files:**
- Modify: `AGENTS.md`

Adds a brief "WGS perf benchmarks" subsection. No baseline numbers — those live in artifacts.

- [ ] **Step 1: Insert subsection**

Add under the existing "Testing" section (after the perf paragraph that mentions `tests/e2e/renderer-perf-phase1.e2e.ts`):

```markdown
### WGS perf benchmarks

Phase 9 introduced gated WGS import benchmarks for both backends. These are opt-in and never run in CI.

```bash
scripts/postgres/download-wgs-fixture.sh   # one-time; idempotent; writes to tests/.cache/wgs/ (gitignored)
make pg-reset && make pg-up
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/postgres-vcf-wgs-import.perf.test.ts
VARLENS_RUN_WGS_PERF=1 npx vitest run tests/perf/sqlite-vcf-wgs-import.perf.test.ts
node scripts/perf/compare-wgs-import.mjs
make pg-down
```

Each run writes a per-backend baseline artifact and a comparison file under `.planning/artifacts/perf/wgs-import/` (also gitignored). `BUDGET_S` per backend is `1.5×` the baseline. If the postgres baseline exceeds the sqlite baseline by more than `2×`, open a follow-up phase to escalate postgres to `COPY FROM STDIN` via `pg-copy-streams`.
```

- [ ] **Step 2: Run lint to verify markdown sanity**

```bash
make lint-check
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add WGS perf benchmarks subsection"
```

---

## Task 20: Final CI Gate

**Files:** none

- [ ] **Step 1: Clean any local packaging artifacts that ESLint would traverse**

```bash
rm -rf release/
```

- [ ] **Step 2: Run the full local CI**

```bash
make ci
```

Expected: green. If verification is needed for Electron lifecycle, run:

```bash
make ci-full
```

- [ ] **Step 3: Run the existing JSON E2E one more time as a regression sanity check**

```bash
make pg-reset && make pg-up
VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-json-import-dev-mode.e2e.ts
make pg-down
```

Expected: green — Phase 8's JSON E2E still passes, proving the worker migration is non-regressive.

- [ ] **Step 4: Confirm working tree is clean**

```bash
git status --short
```

Expected: clean.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/postgres-parity-phase-9-vcf-import-and-import-worker
gh pr create --title "feat(postgres): phase 9 — VCF import and PostgreSQL import worker" \
  --body "$(cat <<'EOF'
## Summary
- Adds PostgreSQL VCF import (single-file, single-sample-per-file, multi-file/append-within-import, BED filter, extension tables).
- Moves all PG import work into a worker_threads-based postgres-import-worker.
- Phase 8's main-process JSON path is migrated through the same worker — fixes the non-blocking regression in one PR.
- Adds gated WGS perf benchmarks for both PG and SQLite plus a comparison script.

## Test plan
- [ ] `make ci` green locally
- [ ] `VARLENS_RUN_POSTGRES_E2E=1` E2E suite green when Docker is available
- [ ] WGS perf measurements recorded in `.planning/artifacts/perf/wgs-import/`
- [ ] Existing Phase 8 JSON E2E still passes (regression gate)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

After the engineer (or subagent driver) completes all tasks above, run a final spec-vs-plan check:

1. **Spec coverage** — every spec section maps to at least one task:
   - Architectural decisions 1–11 → Tasks 2–8, 17, 19
   - `StorageImportExecutor` extended interface → Task 3
   - Worker contract types → Task 4
   - Worker shell + JSON migration → Tasks 5–7
   - VCF repository → Task 9
   - VCF in worker → Task 10
   - Multi-file in worker → Task 11
   - BED + filters in worker → Task 12
   - IPC routing → Task 13
   - Docker E2Es → Tasks 14–16
   - WGS perf → Tasks 17–18
   - AGENTS.md → Task 19
   - Final CI → Task 20

2. **Placeholder scan** — any `TBD`, `TODO`, `// implement later`, vague "add error handling" text outside of explicitly-flagged inline notes? None expected; if found, fix inline.

3. **Type consistency** — names used across tasks must match exactly:
   - `writeJsonImport(client, request, writeVariants)`
   - `rebuildVariantFrequencyForCase(client, schema, caseId)`
   - `writeVcfFile(client, request)`
   - `PostgresImportWorkerStartMessage`, `PostgresImportWorkerOutboundMessage`
   - `PostgresImportExecutor.importSingleFile`, `importMultiFile`
   - `StorageImportExecutor.importMultiFile`, `StorageImportFileFilters`, `ImportFileCompleteEvent`
   - `MultiFileImportResult.files[].error`

4. **Out-of-scope items NOT addressed** (intentional):
   - Multi-sample-in-one-call (requires IPC contract extension)
   - Single-file `import:start` filters
   - Append into pre-existing case
   - `COPY FROM STDIN` escalation (Phase 16)
   - `database:overview`, cohort summary refresh, secondary read domains, schema-per-workspace, renderer settings (later phases)
