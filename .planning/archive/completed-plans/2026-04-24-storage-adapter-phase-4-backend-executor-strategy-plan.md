# Storage Session Boundary Phase 4: Backend-Specific Executor Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move backend-specific read execution under `StorageSession`, keep SQLite stable, and ship `cases:query` as the first executor-driven vertical slice while leaving file-backed workers explicitly SQLite-only.

**Architecture:** Add a narrow typed read executor owned by each storage session. SQLite wraps the existing `DbPool` plus direct `DatabaseService` fallback and keeps legacy `getDbPool()` consumers working through a transition bridge; PostgreSQL uses backend-specific query repositories against the session-owned `pg.Pool`. Migrate `cases:query` through that executor, keep `cases:list` as-is, and document worker/write paths as SQLite-only instead of pretending they are already portable.

**Tech Stack:** Electron 40, TypeScript 6, `better-sqlite3-multiple-ciphers`, `pg`, Piscina `DbPool`, Vitest, Docker PostgreSQL dev flow, `make rebuild-node`, `make ci`

---

## File structure

### New files

- `src/main/storage/read-executor.ts`
- `src/main/storage/sqlite/SqliteReadExecutor.ts`
- `src/main/storage/postgres/PostgresReadExecutor.ts`
- `src/main/storage/postgres/PostgresCasesQueryRepository.ts`
- `src/main/storage/sqlite/createSqliteStorageSession.ts`
- `tests/main/storage/read-executor-contract.test.ts`
- `tests/main/storage/sqlite-read-executor.test.ts`
- `tests/main/storage/postgres-read-executor.test.ts`
- `tests/main/storage/postgres-cases-query-repository.test.ts`

### Modified files

- `src/main/storage/session.ts`
- `src/main/storage/sqlite/SqliteStorageSession.ts`
- `src/main/storage/postgres/PostgresStorageSession.ts`
- `src/main/services/DatabaseManager.ts`
- `src/main/ipc/handlers/cases.ts`
- `src/main/ipc/handlers/cases-logic.ts`
- `src/main/ipc/handlers/database.ts`
- `src/main/ipc/handlers/database-logic.ts`
- `src/main/ipc/dbPoolManager.ts`
- `src/main/ipc/index.ts`
- `src/main/ipc/types.ts`
- `src/main/ipc/domains/cases.ts`
- `tests/main/handlers/cases-handlers.test.ts`
- `tests/main/handlers/database-logic.test.ts`
- `tests/main/storage/sqlite-storage-session.test.ts`
- `tests/main/storage/postgres-storage-session.test.ts`
- `tests/main/storage/storage-manager-compat.test.ts`

### Notes on scope

- This phase intentionally does **not** migrate import/delete/export/rebuild workers.
- This phase intentionally does **not** migrate `database:overview` yet.
- The only vertical-slice migration in this phase is `cases:query`.
- `db-worker-dispatch.ts` remains unchanged in this phase; SQLite pooled `cases:query` continues to use the existing `DbTask` path.

## Task 1: Define the read-executor contract at the storage boundary

**Files:**

- Create: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/session.ts`
- Test: `tests/main/storage/read-executor-contract.test.ts`
- Test: `tests/main/storage/sqlite-storage-session.test.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Add tests that assert:

- a storage session exposes `getReadExecutor()`
- the executor accepts a narrow typed task union for Phase 4
- PostgreSQL sessions fail explicitly when executor-backed behavior is unavailable instead of falling through to SQLite compatibility helpers

Use task shapes like:

```ts
const queryTask = {
  type: 'cases:query' as const,
  params: { limit: 25, offset: 0, sort_by: 'created_at', sort_order: 'desc' }
}
```

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- FAIL because `StorageSession` does not yet expose a read executor

- [ ] **Step 2: Add the read-executor types**

Create `src/main/storage/read-executor.ts` with the narrow Phase 4 contract:

```ts
import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export type StorageReadTask =
  | {
      type: 'cases:query'
      params: ValidatedCaseSearchParams
    }

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
```

- [ ] **Step 3: Extend the session interface**

Update `src/main/storage/session.ts`:

```ts
import type { StorageReadExecutor } from './read-executor'

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

- [ ] **Step 4: Add placeholder executor wiring in both sessions**

Update the session classes just enough for the contract tests to compile:

```ts
private readonly readExecutor: StorageReadExecutor

getReadExecutor(): StorageReadExecutor {
  return this.readExecutor
}
```

For now, constructor injection is acceptable. Real implementation arrives in later tasks.

- [ ] **Step 5: Run the contract tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/storage/read-executor.ts src/main/storage/session.ts src/main/storage/sqlite/SqliteStorageSession.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add session read executor contract"
```

## Task 2: Add a compatibility bridge for legacy `getDbPool()` consumers

**Files:**

- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/domains/cases.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/ipc/dbPoolManager.ts`
- Test: `tests/main/handlers/cases-handlers.test.ts`
- Test: `tests/main/storage/storage-manager-compat.test.ts`

- [ ] **Step 1: Write failing compatibility tests**

Add tests that assert:

- legacy `HandlerDependencies.getDbPool` can resolve from the active session instead of only from the singleton manager
- the compatibility getter returns the same pool instance the active SQLite session holds
- PostgreSQL sessions still expose `null` through the compatibility getter

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts tests/main/storage/storage-manager-compat.test.ts
```

Expected:

- FAIL because the IPC dependency wiring still assumes the old singleton-only pool source

- [ ] **Step 2: Add an active-session compatibility accessor**

Update `src/main/ipc/dbPoolManager.ts` to support a compatibility bridge:

```ts
import type { StorageSession } from '../storage/session'

let getActiveSession: (() => StorageSession | null) | null = null

export function setActiveSessionResolver(resolver: () => StorageSession | null): void {
  getActiveSession = resolver
}

export function getDbPool(): DbPool | null {
  const sessionPool = getActiveSession?.()?.getDbPool?.() ?? null
  if (sessionPool !== null) {
    return sessionPool
  }

  return dbPool
}
```

This keeps old callers working while the pool source moves toward the active session.

- [ ] **Step 3: Register the resolver from the active database manager**

Update `src/main/ipc/index.ts` so the IPC layer registers a resolver based on the current manager/session:

```ts
setActiveSessionResolver(() => {
  try {
    return getDatabaseManager().getCurrentSession()
  } catch {
    return null
  }
})
```

- [ ] **Step 4: Run the compatibility tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts tests/main/storage/storage-manager-compat.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/types.ts src/main/ipc/domains/cases.ts src/main/ipc/index.ts src/main/ipc/dbPoolManager.ts tests/main/handlers/cases-handlers.test.ts tests/main/storage/storage-manager-compat.test.ts
git commit -m "refactor(ipc): bridge legacy db pool access through storage session"
```

## Task 3: Make SQLite own read execution and pool lifecycle

**Files:**

- Create: `src/main/storage/sqlite/SqliteReadExecutor.ts`
- Create: `src/main/storage/sqlite/createSqliteStorageSession.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `src/main/services/DatabaseManager.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/main/ipc/handlers/database-logic.ts`
- Modify: `src/main/ipc/dbPoolManager.ts`
- Test: `tests/main/storage/sqlite-read-executor.test.ts`
- Test: `tests/main/storage/storage-manager-compat.test.ts`

- [ ] **Step 1: Write failing SQLite executor and manager tests**

Add tests that assert:

- `SqliteReadExecutor.execute({ type: 'cases:query', ... })` uses `DbPool.run(...)` when a pool exists
- `SqliteReadExecutor.execute({ type: 'cases:query', ... })` falls back to `databaseService.cases.queryCases(...)` when no pool exists
- `DatabaseManager` creates SQLite sessions with an initialized pool when session creation succeeds
- `DatabaseManager` validates passwords before initializing the pool
- database open/create no longer require a separate `initDbPool(...)` callback to be correct
- configured worker-thread counts still flow into the initialized pool

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/database-logic.test.ts
```

Expected:

- FAIL because SQLite execution and pool init still live outside the session boundary

- [ ] **Step 2: Implement the SQLite read executor**

Create `src/main/storage/sqlite/SqliteReadExecutor.ts`:

```ts
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'

export class SqliteReadExecutor implements StorageReadExecutor {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly dbPool: DbPool | null
  ) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:query',
            params: [task.params]
          })
        }
        return this.databaseService.cases.queryCases(task.params)
    }
  }
}
```

- [ ] **Step 3: Add a SQLite session factory that validates before pool initialization**

Create `src/main/storage/sqlite/createSqliteStorageSession.ts`:

```ts
import { DatabaseService } from '../../database/DatabaseService'
import { DbPool } from '../../database/DbPool'
import { resolveGeneRefDbPath } from '../../database/geneReferenceLoader'
import { WrongPasswordError } from '../../database/errors'
import { getWorkerThreads } from '../../ipc/dbPoolManager'
import { SqliteStorageSession } from './SqliteStorageSession'

export function createSqliteStorageSession(dbPath: string, key?: string): SqliteStorageSession {
  const databaseService = new DatabaseService(dbPath, key)

  if (key !== undefined && key.length > 0) {
    try {
      databaseService.database.prepare('SELECT count(*) FROM sqlite_master').get()
    } catch (error) {
      databaseService.close()

      if (
        error instanceof Error &&
        error.message.includes('file is encrypted or is not a database')
      ) {
        throw new WrongPasswordError()
      }

      throw error
    }
  }

  let geneRefDbPath: string | undefined
  try {
    geneRefDbPath = resolveGeneRefDbPath()
  } catch {
    geneRefDbPath = undefined
  }

  const configuredWorkerThreads = getWorkerThreads()
  const maxThreads = configuredWorkerThreads > 0 ? configuredWorkerThreads : undefined

  const dbPool = new DbPool()
  dbPool.init(dbPath, key, {
    ...(maxThreads !== undefined ? { maxThreads } : {}),
    ...(geneRefDbPath !== undefined ? { geneRefDbPath } : {})
  })

  return new SqliteStorageSession({
    databaseService,
    dbPool
  })
}
```

- [ ] **Step 4: Make `DatabaseManager` create SQLite sessions through the factory**

Update `src/main/services/DatabaseManager.ts` so `createSqliteSession(...)` becomes async and uses the factory instead of constructing `DatabaseService` and `SqliteStorageSession` inline:

```ts
import { createSqliteStorageSession } from '../storage/sqlite/createSqliteStorageSession'

private async createSqliteSession(dbPath: string, key?: string): Promise<StorageSession> {
  return createSqliteStorageSession(dbPath, key)
}
```

Update `open(...)`, `createDatabase(...)`, and `switchDatabase(...)` to `await this.createSqliteSession(...)` and keep the existing `WrongPasswordError` handling semantics intact.

- [ ] **Step 5: Remove now-redundant handler-level pool init**

Update `src/main/ipc/handlers/database-logic.ts` and `src/main/ipc/handlers/database.ts` so open/create lifecycle no longer depend on:

```ts
initDbPool: (path: string, password?: string) => Promise<void>
```

The open/create flow should become:

```ts
await manager.switchDatabase(vPath, vPassword)
callbacks.triggerStartupRebuild(getDb())
```

and:

```ts
await manager.createDatabase(params.path, params.password)
```

No follow-up `initDbPool(...)` call should be necessary.

Leave `dbPoolManager.getDbPool()` in place for unmigrated handlers; it should now resolve through the active session bridge from Task 2.

- [ ] **Step 6: Run the SQLite-focused tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/database-logic.test.ts
```

Expected:

- PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/sqlite/SqliteReadExecutor.ts src/main/storage/sqlite/createSqliteStorageSession.ts src/main/storage/sqlite/SqliteStorageSession.ts src/main/services/DatabaseManager.ts src/main/ipc/handlers/database.ts src/main/ipc/handlers/database-logic.ts src/main/ipc/dbPoolManager.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/database-logic.test.ts
git commit -m "refactor(storage): move sqlite read execution under session"
```

## Task 4: Implement PostgreSQL read execution for `cases:query`

**Files:**

- Create: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Create: `src/main/storage/postgres/PostgresCasesQueryRepository.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Test: `tests/main/storage/postgres-cases-query-repository.test.ts`
- Test: `tests/main/storage/postgres-read-executor.test.ts`
- Test: `tests/main/storage/postgres-storage-session.test.ts`

- [ ] **Step 1: Write failing PostgreSQL query tests**

Add tests that assert:

- PostgreSQL `cases:query` returns `PaginatedResult<CaseWithCohorts>`
- search, sort, offset, and limit are respected
- `cohort_ids` and `hpo_ids` are either implemented correctly or rejected explicitly

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- FAIL because PostgreSQL only supports `listCases()`

- [ ] **Step 2: Add a focused PostgreSQL cases-query repository**

Create `src/main/storage/postgres/PostgresCasesQueryRepository.ts` with only the SQL needed for the slice:

```ts
import type { Pool } from 'pg'
import type { CaseWithCohorts, PaginatedResult } from '../../../shared/types/database'
import type { ValidatedCaseSearchParams } from '../../../shared/types/ipc-schemas'

export class PostgresCasesQueryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: string
  ) {}

  async queryCases(params: ValidatedCaseSearchParams): Promise<PaginatedResult<CaseWithCohorts>> {
    const limit = params.limit
    const offset = params.offset ?? 0
    const searchTerm = params.search_term?.trim()
    const sortBy = params.sort_by ?? 'created_at'
    const sortOrder = params.sort_order ?? 'desc'

    if ((params.cohort_ids?.length ?? 0) > 0) {
      throw new Error('cases:query cohort_ids filtering is not implemented for postgres sessions in Phase 4')
    }

    if ((params.hpo_ids?.length ?? 0) > 0) {
      throw new Error('cases:query hpo_ids filtering is not implemented for postgres sessions in Phase 4')
    }

    const values: unknown[] = []
    const whereClauses: string[] = []

    if (searchTerm !== undefined && searchTerm !== '') {
      values.push(`%${searchTerm}%`)
      whereClauses.push(`c.name ILIKE $${values.length}`)
    }

    const orderColumn =
      sortBy === 'name'
        ? 'c.name'
        : sortBy === 'variant_count'
          ? 'c.variant_count'
          : 'c.created_at'
    const orderDirection = sortOrder === 'asc' ? 'ASC' : 'DESC'
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

    const rowsSql = `
      SELECT
        c.id,
        c.name,
        c.file_path,
        c.file_size,
        c.variant_count,
        c.created_at,
        c.genome_build,
        cm.affected_status,
        cm.sex,
        COALESCE(array_agg(DISTINCT cg.name) FILTER (WHERE cg.name IS NOT NULL), '{}'::text[]) AS cohort_names,
        COALESCE(array_agg(DISTINCT cg.id) FILTER (WHERE cg.id IS NOT NULL), '{}'::int[]) AS cohort_ids
      FROM "${this.schema}"."cases" c
      LEFT JOIN "${this.schema}"."case_metadata" cm ON cm.case_id = c.id
      LEFT JOIN "${this.schema}"."case_cohort_links" ccl ON ccl.case_id = c.id
      LEFT JOIN "${this.schema}"."cohort_groups" cg ON cg.id = ccl.cohort_id
      ${whereSql}
      GROUP BY c.id, cm.affected_status, cm.sex
      ORDER BY ${orderColumn} ${orderDirection}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `

    const countSql = `
      SELECT COUNT(*)::int AS total_count
      FROM "${this.schema}"."cases" c
      ${whereSql}
    `

    const rowsResult = await this.pool.query(rowsSql, [...values, limit, offset])
    const countResult = await this.pool.query(countSql, values)

    return {
      data: rowsResult.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        file_path: String(row.file_path),
        file_size: Number(row.file_size),
        variant_count: Number(row.variant_count),
        created_at: Number(row.created_at),
        genome_build: String(row.genome_build),
        affected_status: row.affected_status ?? null,
        sex: row.sex ?? null,
        cohort_names: Array.isArray(row.cohort_names) ? row.cohort_names.map(String) : [],
        cohort_ids: Array.isArray(row.cohort_ids) ? row.cohort_ids.map(Number) : []
      })),
      total_count: Number(countResult.rows[0]?.total_count ?? 0)
    }
  }
}
```

The implementation must preserve the existing payload contract:

- `cohort_names`
- `cohort_ids`
- `affected_status`
- `sex`
- `total_count`

- [ ] **Step 3: Add the PostgreSQL read executor**

Create `src/main/storage/postgres/PostgresReadExecutor.ts`:

```ts
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(
    private readonly casesQuery: PostgresCasesQueryRepository
  ) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.casesQuery.queryCases(task.params)
    }
  }
}
```

- [ ] **Step 4: Wire the executor into `PostgresStorageSession`**

Update `src/main/storage/postgres/PostgresStorageSession.ts` so it owns:

```ts
private readonly readExecutor: StorageReadExecutor

constructor(options: PostgresStorageSessionOptions) {
  const casesQuery = new PostgresCasesQueryRepository(options.pool, options.config.schema)
  this.readExecutor = new PostgresReadExecutor(casesQuery)
}

getReadExecutor(): StorageReadExecutor {
  return this.readExecutor
}
```

Keep `listCases()` working exactly as it does today.

- [ ] **Step 5: Run PostgreSQL executor tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/storage/postgres/PostgresReadExecutor.ts src/main/storage/postgres/PostgresCasesQueryRepository.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add postgres cases query executor"
```

## Task 5: Migrate `cases:query` through the active storage session

**Files:**

- Modify: `src/main/ipc/handlers/cases.ts`
- Modify: `src/main/ipc/handlers/cases-logic.ts`
- Modify: `tests/main/handlers/cases-handlers.test.ts`

- [ ] **Step 1: Write the failing handler tests**

Add tests that assert:

- `cases:query` resolves the active session
- it uses `session.getReadExecutor().execute({ type: 'cases:query', ... })`
- it no longer reads `getDbPool()` directly for the migrated slice
- `cases:list` remains session-backed
- `cases:availableBuilds` remains unchanged in this phase

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- FAIL because `cases:query` still branches on `getDbPool()` / `getDb()`

- [ ] **Step 2: Refactor `cases-logic.ts`**

Change `queryCases(...)` to accept the active session instead of raw SQLite dependencies:

```ts
import type { StorageSession } from '../../storage/session'
import type { StorageReadTask } from '../../storage/read-executor'

export async function queryCases(
  params: ValidatedCaseSearchParams,
  getSession: () => StorageSession
): Promise<unknown> {
  const task: StorageReadTask = {
    type: 'cases:query',
    params
  }

  return await getSession().getReadExecutor().execute(task)
}
```

Leave `getAvailableBuilds(...)`, delete operations, and other handlers unchanged in this phase.

- [ ] **Step 3: Refactor the cases handler**

Update `src/main/ipc/handlers/cases.ts`:

```ts
ipcMain.handle('cases:query', async (_event, params: unknown) => {
  return wrapHandler(async () => {
    const validated = CaseSearchParamsSchema.safeParse(params)
    if (!validated.success) {
      throw new Error('Invalid parameters')
    }

    return await queryCases(validated.data, () => getDbManager().getCurrentSession())
  })
})
```

`cases:list` should remain:

```ts
return wrapHandler(() => listCases(() => getDbManager().getCurrentSession()))
```

- [ ] **Step 4: Run the cases handler tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/handlers/cases.ts src/main/ipc/handlers/cases-logic.ts tests/main/handlers/cases-handlers.test.ts
git commit -m "refactor(cases): route cases query through storage executor"
```

## Task 6: Add explicit guardrails for SQLite-only worker/write execution

**Files:**

- Modify: `src/main/storage/types.ts`
- Modify: `src/main/storage/session.ts`
- Modify: `src/main/storage/sqlite/SqliteStorageSession.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `src/main/ipc/handlers/cases.ts`
- Modify: `src/main/ipc/handlers/cases-logic.ts`
- Modify: `tests/main/storage/sqlite-storage-session.test.ts`
- Modify: `tests/main/storage/postgres-storage-session.test.ts`
- Modify: `tests/main/storage/storage-manager-compat.test.ts`
- Modify: `tests/main/handlers/cases-handlers.test.ts`

- [ ] **Step 1: Write failing capability tests**

Add tests that assert:

- SQLite sessions advertise support for file-backed worker execution
- PostgreSQL sessions advertise that file-backed worker execution is unavailable
- the phase does not accidentally imply write-worker portability
- worker-backed case deletes fail explicitly for PostgreSQL sessions with a SQLite-only error

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/cases-handlers.test.ts
```

Expected:

- FAIL because the capability set does not yet surface this distinction cleanly

- [ ] **Step 2: Extend storage capabilities**

Update `src/main/storage/types.ts`:

```ts
export interface StorageCapabilities {
  readonly backend: StorageBackendKind
  readonly supportsEncryptionAtRest: boolean
  readonly supportsLocalFileLifecycle: boolean
  readonly supportsHostedConnectionLifecycle: boolean
  readonly supportsWorkerReadPool: boolean
  readonly supportsFileBackedWorkerWrites: boolean
  readonly supportsFullTextSearch: boolean
}
```

- [ ] **Step 3: Set honest backend values**

Update SQLite capabilities:

```ts
const SQLITE_CAPABILITIES: StorageCapabilities = {
  backend: 'sqlite',
  supportsEncryptionAtRest: true,
  supportsLocalFileLifecycle: true,
  supportsHostedConnectionLifecycle: false,
  supportsWorkerReadPool: true,
  supportsFileBackedWorkerWrites: true,
  supportsFullTextSearch: true
}
```

Update PostgreSQL capabilities:

```ts
const POSTGRES_CAPABILITIES: StorageCapabilities = {
  backend: 'postgres',
  supportsEncryptionAtRest: false,
  supportsLocalFileLifecycle: false,
  supportsHostedConnectionLifecycle: true,
  supportsWorkerReadPool: false,
  supportsFileBackedWorkerWrites: false,
  supportsFullTextSearch: false
}
```

- [ ] **Step 4: Add explicit capability guards to worker-backed paths**

At the top of `cases:delete`, `cases:deleteAll`, and `cases:deleteBatch`, resolve the active session and fail early when worker-backed writes are unsupported:

```ts
const session = getDbManager().getCurrentSession()
if (!session.capabilities.supportsFileBackedWorkerWrites) {
  throw new Error('cases:delete is SQLite-only in Phase 4')
}
```

This should happen before any `getDb()` access or worker launch.

- [ ] **Step 5: Add advisory boundary guards for new slices**

Add JSDoc to `StorageSession.getDatabaseService()` and `StorageSession.getDbPool()` noting that:

```ts
/**
 * Compatibility escape hatch for legacy SQLite-only paths.
 * New migrated slices must use getReadExecutor().
 */
```

- [ ] **Step 6: Run the capability tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 7: Commit**

```bash
git add src/main/storage/types.ts src/main/storage/session.ts src/main/storage/sqlite/SqliteStorageSession.ts src/main/storage/postgres/PostgresStorageSession.ts src/main/ipc/handlers/cases.ts src/main/ipc/handlers/cases-logic.ts tests/main/storage/sqlite-storage-session.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/storage/storage-manager-compat.test.ts tests/main/handlers/cases-handlers.test.ts
git commit -m "refactor(storage): mark file-backed worker writes as sqlite-only"
```

## Task 7: Verify the phase locally on this workstation

**Files:**

- No new source files
- Verification touches the existing local PostgreSQL setup from Phase 2

- [ ] **Step 1: Run targeted local tests during development**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 2: Run the existing local PostgreSQL environment**

Run:

```bash
make pg-up
```

Expected:

- local PostgreSQL container starts successfully

If the schema needs bootstrapping for the `cases:query` tests, apply the existing Phase 2/3 init scripts before rerunning the test suite.

- [ ] **Step 3: Run the minimum project verification**

Run:

```bash
make ci
```

Expected:

- PASS

- [ ] **Step 4: Capture residual scope**

Record the remaining post-Phase-4 backlog in the implementation notes or PR description:

```md
- `database:overview` still routes through the legacy SQLite pooled path
- legacy pooled read consumers still exist behind the `getDbPool()` compatibility bridge
- import/delete/export/rebuild workers remain SQLite/file-backed
- executor migration is proven for `cases:query`, not for all reads
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test(storage): verify phase 4 executor strategy"
```

## Self-review checklist

- Spec coverage:
  Phase 4 architecture, executor ownership, pool compatibility, worker inventory, and next-slice recommendation are all implemented by Tasks 1-6.

- Placeholder scan:
  No `TBD`, `TODO`, or "similar to previous task" shortcuts remain.

- Type consistency:
  The plan uses `StorageReadTask`, `StorageReadExecutor`, `getReadExecutor()`, `supportsFileBackedWorkerWrites`, and the legacy `getDbPool()` compatibility bridge consistently across tasks.

## Execution handoff

Plan complete and saved to `.planning/plans/2026-04-24-storage-adapter-phase-4-backend-executor-strategy-plan.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
