# Storage Session Boundary Phase 5: Cases Available Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `cases:availableBuilds` through the session-owned storage read executor for SQLite and PostgreSQL while keeping renderer IPC stable and leaving `database:overview` for a later phase.

**Architecture:** Extend the narrow `StorageReadTask` union with one cases-domain read task. SQLite keeps the existing `DbPool` worker path plus direct `DatabaseService` fallback; PostgreSQL gets a focused available-builds repository wired into `PostgresReadExecutor`. The IPC handler resolves the active `StorageSession` and no longer branches through `getDbPool()` for this endpoint.

**Tech Stack:** Electron 40 main process IPC, TypeScript 6, `better-sqlite3-multiple-ciphers`, `pg`, Piscina `DbPool`, Vitest, existing GitHub Actions `checks` job, `make rebuild-node`, `make ci`

---

## File structure

### New files

- `src/main/storage/postgres/identifiers.ts` - shared PostgreSQL identifier quoting helper for schema/table-safe SQL fragments.
- `src/main/storage/postgres/PostgresAvailableBuildsRepository.ts` - PostgreSQL cases-domain query for available genome builds.
- `tests/main/storage/postgres-identifiers.test.ts` - contract tests for PostgreSQL identifier escaping.
- `tests/main/storage/postgres-available-builds-repository.test.ts` - backend-aware repository tests with a mocked `pg.Pool`.

### Modified files

- `src/main/storage/read-executor.ts` - add the typed `cases:availableBuilds` read task and shared return type.
- `src/main/storage/sqlite/SqliteReadExecutor.ts` - route the new task to `DbPool` or `DatabaseService`.
- `src/main/storage/postgres/PostgresCasesQueryRepository.ts` - import shared identifier quoting instead of owning a private copy.
- `src/main/storage/postgres/PostgresReadExecutor.ts` - route the new task to the PostgreSQL repository.
- `src/main/storage/postgres/PostgresStorageSession.ts` - construct and pass the new PostgreSQL repository into the read executor.
- `src/main/ipc/handlers/cases-logic.ts` - make `getAvailableBuilds` session/executor-backed.
- `src/main/ipc/handlers/cases.ts` - wire `cases:availableBuilds` through `getDbManager().getCurrentSession()`.
- `tests/main/storage/read-executor-contract.test.ts` - lock the expanded task union.
- `tests/main/storage/sqlite-read-executor.test.ts` - add SQLite pool and fallback coverage.
- `tests/main/storage/postgres-read-executor.test.ts` - add PostgreSQL dispatch coverage.
- `tests/main/storage/postgres-storage-session.test.ts` - assert the session exposes an executor that can carry the new task.
- `tests/main/handlers/cases-handlers.test.ts` - prove IPC no longer touches `getDb()` / `getDbPool()` for `cases:availableBuilds`.

### Explicitly unchanged

- `src/main/ipc/handlers/database-logic.ts` - `database:overview` remains on the legacy SQLite pool/direct path.
- `src/main/workers/db-worker-dispatch.ts` - SQLite worker dispatch for `cases:availableBuilds` already exists.
- Renderer and preload files - the public IPC contract remains unchanged.
- GitHub Actions workflow - required tests are normal Vitest tests, so the existing `npm run test` CI step covers them.

## Task 0: Start the implementation branch

**Files:**

- No source files

- [ ] **Step 1: Confirm the base branch and working tree**

Run:

```bash
git status --short --branch
```

Expected:

- branch is `main` or a clean implementation base
- any existing local changes are understood before starting

- [ ] **Step 2: Create the implementation branch**

Run:

```bash
git switch -c refactor/storage-phase-5-available-builds
```

Expected:

- new branch `refactor/storage-phase-5-available-builds`
- all implementation commits for this phase happen on this branch and are intended for a PR

## Task 1: Extend the read-executor contract and SQLite executor

**Files:**

- Modify: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/sqlite/SqliteReadExecutor.ts`
- Modify: `tests/main/storage/read-executor-contract.test.ts`
- Modify: `tests/main/storage/sqlite-read-executor.test.ts`

- [ ] **Step 1: Write failing contract coverage**

Update the existing import in `tests/main/storage/read-executor-contract.test.ts` to include `AvailableBuild`, then add the new task-shape test below the existing `cases:query` test. Keep the existing `cases:query` coverage in place.

```ts
import type {
  AvailableBuild,
  StorageReadExecutor,
  StorageReadTask
} from '../../../src/main/storage/read-executor'
```

```ts
it('supports cases:availableBuilds as a typed read task', () => {
  const task = {
    type: 'cases:availableBuilds',
    params: []
  } satisfies StorageReadTask

  expectTypeOf(task.params).toEqualTypeOf<[]>()
  expectTypeOf<AvailableBuild>().toEqualTypeOf<{ build: string; caseCount: number }>()
  expectTypeOf<StorageReadExecutor['execute']>().returns.toEqualTypeOf<Promise<unknown>>()
})
```

- [ ] **Step 2: Write failing SQLite executor tests**

Append these tests to `tests/main/storage/sqlite-read-executor.test.ts`:

```ts
it('uses the worker read pool for cases:availableBuilds when a pool exists', async () => {
  const expected = [{ build: 'GRCh38', caseCount: 2 }]
  const dbPool = {
    run: vi.fn().mockResolvedValue(expected)
  }
  const databaseService = {
    cases: {
      getAvailableGenomeBuilds: vi.fn()
    }
  }
  const executor = new SqliteReadExecutor(databaseService as never, dbPool as never)

  await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
    expected
  )
  expect(dbPool.run).toHaveBeenCalledWith({
    type: 'cases:availableBuilds',
    params: []
  })
  expect(databaseService.cases.getAvailableGenomeBuilds).not.toHaveBeenCalled()
})

it('falls back to DatabaseService for cases:availableBuilds when no pool exists', async () => {
  const expected = [{ build: 'GRCh37', caseCount: 1 }]
  const databaseService = {
    cases: {
      getAvailableGenomeBuilds: vi.fn().mockReturnValue(expected)
    }
  }
  const executor = new SqliteReadExecutor(databaseService as never, null)

  await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
    expected
  )
  expect(databaseService.cases.getAvailableGenomeBuilds).toHaveBeenCalledWith()
})
```

- [ ] **Step 3: Run the focused runtime tests and confirm they fail**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-read-executor.test.ts
```

Expected:

- FAIL because `SqliteReadExecutor` does not dispatch the new task
- The contract test may not fail under Vitest because `satisfies` is type-only; the next `make typecheck` run is the type-level guard.

- [ ] **Step 4: Run type checking and confirm the contract fails**

Run:

```bash
make typecheck
```

Expected:

- FAIL because `StorageReadTask` does not include `cases:availableBuilds`

- [ ] **Step 5: Extend the read-executor contract**

Update `src/main/storage/read-executor.ts`:

```ts
import type { ValidatedCaseSearchParams } from '../../shared/types/ipc-schemas'

export interface AvailableBuild {
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

export interface StorageReadExecutor {
  execute(task: StorageReadTask): Promise<unknown>
}
```

- [ ] **Step 6: Implement SQLite executor dispatch**

Update `src/main/storage/sqlite/SqliteReadExecutor.ts`:

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

      case 'cases:availableBuilds':
        if (this.dbPool !== null) {
          return await this.dbPool.run({
            type: 'cases:availableBuilds',
            params: []
          })
        }

        return this.databaseService.cases.getAvailableGenomeBuilds()
    }
  }
}
```

- [ ] **Step 7: Verify the contract and SQLite executor**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-read-executor.test.ts
make typecheck
```

Expected:

- PASS

- [ ] **Step 8: Commit**

Run:

```bash
git add src/main/storage/read-executor.ts src/main/storage/sqlite/SqliteReadExecutor.ts tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-read-executor.test.ts
git commit -m "refactor(storage): add available builds read task"
```

## Task 2: Add PostgreSQL available-builds execution

**Files:**

- Create: `src/main/storage/postgres/identifiers.ts`
- Create: `src/main/storage/postgres/PostgresAvailableBuildsRepository.ts`
- Modify: `src/main/storage/postgres/PostgresCasesQueryRepository.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Create: `tests/main/storage/postgres-identifiers.test.ts`
- Create: `tests/main/storage/postgres-available-builds-repository.test.ts`
- Modify: `tests/main/storage/postgres-read-executor.test.ts`
- Modify: `tests/main/storage/postgres-storage-session.test.ts`

- [ ] **Step 1: Write the failing PostgreSQL identifier-helper test**

Create `tests/main/storage/postgres-identifiers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { quoteIdentifier } from '../../../src/main/storage/postgres/identifiers'

describe('postgres identifier helpers', () => {
  it('wraps identifiers in double quotes', () => {
    expect(quoteIdentifier('public')).toBe('"public"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    expect(quoteIdentifier('tenant"schema')).toBe('"tenant""schema"')
  })
})
```

- [ ] **Step 2: Run the identifier-helper test and confirm it fails**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-identifiers.test.ts
```

Expected:

- FAIL because `src/main/storage/postgres/identifiers.ts` does not exist

- [ ] **Step 3: Extract the shared PostgreSQL identifier helper**

Create `src/main/storage/postgres/identifiers.ts`:

```ts
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.split('"').join('""')}"`
}
```

Update `src/main/storage/postgres/PostgresCasesQueryRepository.ts` to remove its private `quoteIdentifier` function and import the shared helper:

```ts
import { quoteIdentifier } from './identifiers'
```

- [ ] **Step 4: Verify the identifier helper and existing cases query repository tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-identifiers.test.ts tests/main/storage/postgres-cases-query-repository.test.ts
```

Expected:

- PASS

- [ ] **Step 5: Write failing PostgreSQL repository tests**

Create `tests/main/storage/postgres-available-builds-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresAvailableBuildsRepository } from '../../../src/main/storage/postgres/PostgresAvailableBuildsRepository'

describe('PostgresAvailableBuildsRepository', () => {
  it('returns available genome builds with numeric counts and null-build fallback', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { build: 'GRCh38', case_count: '3' },
        { build: null, case_count: 1 }
      ]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'public')

    await expect(repository.getAvailableGenomeBuilds()).resolves.toEqual([
      { build: 'GRCh38', caseCount: 3 },
      { build: 'GRCh38', caseCount: 1 }
    ])
  })

  it('quotes the configured schema and groups by the stored genome build', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ build: 'GRCh38', case_count: 1 }]
    })
    const repository = new PostgresAvailableBuildsRepository({ query } as never, 'tenant"schema')

    await repository.getAvailableGenomeBuilds()

    expect(query).toHaveBeenCalledTimes(1)
    const sql = query.mock.calls[0][0] as string
    expect(sql).toContain('"tenant""schema"."cases"')
    expect(sql).toContain('GROUP BY genome_build')
    expect(sql).toContain('ORDER BY case_count DESC')
  })
})
```

- [ ] **Step 6: Write failing PostgreSQL executor test**

Update `tests/main/storage/postgres-read-executor.test.ts` so the executor receives both repositories:

```ts
it('dispatches cases:availableBuilds to the postgres available-builds repository', async () => {
  const expected = [{ build: 'GRCh38', caseCount: 2 }]
  const casesQuery = {
    queryCases: vi.fn()
  }
  const availableBuilds = {
    getAvailableGenomeBuilds: vi.fn().mockResolvedValue(expected)
  }
  const executor = new PostgresReadExecutor({ casesQuery, availableBuilds })

  await expect(executor.execute({ type: 'cases:availableBuilds', params: [] })).resolves.toBe(
    expected
  )
  expect(availableBuilds.getAvailableGenomeBuilds).toHaveBeenCalledWith()
  expect(casesQuery.queryCases).not.toHaveBeenCalled()
})
```

Also update the existing `cases:query` test constructor:

```ts
const executor = new PostgresReadExecutor({
  casesQuery,
  availableBuilds: {
    getAvailableGenomeBuilds: vi.fn()
  }
})
```

- [ ] **Step 7: Write the failing PostgreSQL session test**

Add this test to `tests/main/storage/postgres-storage-session.test.ts`:

```ts
it('routes cases:availableBuilds through the session-owned postgres read executor', async () => {
  const pool = {
    query: vi.fn().mockResolvedValue({
      rows: [{ build: 'GRCh38', case_count: 2 }]
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn()
  }
  const session = new PostgresStorageSession({
    config: makeConfig({ schema: 'phase5_cases' }),
    pool: pool as never
  })

  await expect(
    session.getReadExecutor().execute({
      type: 'cases:availableBuilds',
      params: []
    })
  ).resolves.toEqual([{ build: 'GRCh38', caseCount: 2 }])

  expect(pool.query).toHaveBeenCalledTimes(1)
  expect(pool.query.mock.calls[0][0]).toContain('"phase5_cases"."cases"')
})
```

- [ ] **Step 8: Run the focused tests and confirm they fail**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-identifiers.test.ts tests/main/storage/postgres-available-builds-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- FAIL because `PostgresAvailableBuildsRepository` does not exist
- FAIL because `PostgresReadExecutor` does not accept or dispatch the new repository

- [ ] **Step 9: Implement the PostgreSQL repository**

Create `src/main/storage/postgres/PostgresAvailableBuildsRepository.ts`:

```ts
import type { Pool } from 'pg'

import type { AvailableBuild } from '../read-executor'
import { quoteIdentifier } from './identifiers'

export class PostgresAvailableBuildsRepository {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly schema: string
  ) {}

  async getAvailableGenomeBuilds(): Promise<AvailableBuild[]> {
    const schemaName = quoteIdentifier(this.schema)
    const query = `
      SELECT
        genome_build AS build,
        COUNT(*)::int AS case_count
      FROM ${schemaName}."cases"
      GROUP BY genome_build
      ORDER BY case_count DESC
    `

    const result = await this.pool.query(query)

    return result.rows.map((row) => ({
      build: row.build === null || row.build === undefined ? 'GRCh38' : String(row.build),
      caseCount: Number(row.case_count)
    }))
  }
}
```

- [ ] **Step 10: Update the PostgreSQL read executor**

Update `src/main/storage/postgres/PostgresReadExecutor.ts`:

```ts
import type { StorageReadExecutor, StorageReadTask } from '../read-executor'
import type { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
import type { PostgresCasesQueryRepository } from './PostgresCasesQueryRepository'

interface PostgresReadExecutorRepositories {
  casesQuery: Pick<PostgresCasesQueryRepository, 'queryCases'>
  availableBuilds: Pick<PostgresAvailableBuildsRepository, 'getAvailableGenomeBuilds'>
}

export class PostgresReadExecutor implements StorageReadExecutor {
  constructor(private readonly repositories: PostgresReadExecutorRepositories) {}

  async execute(task: StorageReadTask): Promise<unknown> {
    switch (task.type) {
      case 'cases:query':
        return await this.repositories.casesQuery.queryCases(task.params)

      case 'cases:availableBuilds':
        return await this.repositories.availableBuilds.getAvailableGenomeBuilds()
    }
  }
}
```

- [ ] **Step 11: Wire the repository into the PostgreSQL session**

Update `src/main/storage/postgres/PostgresStorageSession.ts` imports and constructor:

```ts
import { PostgresAvailableBuildsRepository } from './PostgresAvailableBuildsRepository'
```

Replace the read-executor construction with:

```ts
this.readExecutor = new PostgresReadExecutor({
  casesQuery: new PostgresCasesQueryRepository(options.pool, options.config.schema),
  availableBuilds: new PostgresAvailableBuildsRepository(options.pool, options.config.schema)
})
```

- [ ] **Step 12: Verify PostgreSQL executor tests**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/postgres-identifiers.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-available-builds-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
```

Expected:

- PASS

- [ ] **Step 13: Commit**

Run:

```bash
git add src/main/storage/postgres/identifiers.ts src/main/storage/postgres/PostgresAvailableBuildsRepository.ts src/main/storage/postgres/PostgresCasesQueryRepository.ts src/main/storage/postgres/PostgresReadExecutor.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-identifiers.test.ts tests/main/storage/postgres-available-builds-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts
git commit -m "feat(storage): add postgres available builds executor"
```

## Task 3: Route `cases:availableBuilds` IPC through the active session

**Files:**

- Modify: `src/main/ipc/handlers/cases-logic.ts`
- Modify: `src/main/ipc/handlers/cases.ts`
- Modify: `tests/main/handlers/cases-handlers.test.ts`

- [ ] **Step 1: Write the failing handler test**

Add this test to the `cases IPC handlers` coverage in `tests/main/handlers/cases-handlers.test.ts`:

```ts
it('routes cases:availableBuilds through the active storage read executor', async () => {
  const expected = [{ build: 'GRCh38', caseCount: 2 }]
  const execute = vi.fn().mockResolvedValue(expected)
  const currentSession = {
    getReadExecutor: () => ({ execute })
  }
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }

  const { registerCaseHandlers } = await import('../../../src/main/ipc/handlers/cases')

  registerCaseHandlers({
    ipcMain: ipcMain as never,
    getDb: (() => {
      throw new Error('getDb should not be called for cases:availableBuilds')
    }) as never,
    getDbManager: (() => ({
      getCurrentSession: () => currentSession
    })) as never,
    getDbPool: (() => {
      throw new Error('getDbPool should not be called for cases:availableBuilds')
    }) as never
  })

  const handler = handlers.get('cases:availableBuilds')
  expect(handler).toBeTypeOf('function')

  const result = await handler!()

  expect(result).toBe(expected)
  expect(execute).toHaveBeenCalledWith({
    type: 'cases:availableBuilds',
    params: []
  })
})
```

- [ ] **Step 2: Run the focused handler test and confirm it fails**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- FAIL because the handler still uses `getDbPool()` / `getDb()` for `cases:availableBuilds`

- [ ] **Step 3: Change `getAvailableBuilds` to use the session executor**

Update `src/main/ipc/handlers/cases-logic.ts` imports:

```ts
import type { AvailableBuild, StorageReadTask } from '../../storage/read-executor'
```

Replace `getAvailableBuilds` with:

```ts
/**
 * Get distinct genome builds used across cases with per-build counts.
 * Used by the cohort view to populate the genome build selector.
 */
export async function getAvailableBuilds(
  getSession: () => StorageSession
): Promise<AvailableBuild[]> {
  const task: StorageReadTask = {
    type: 'cases:availableBuilds',
    params: []
  }

  return (await getSession().getReadExecutor().execute(task)) as AvailableBuild[]
}
```

Remove now-unused `DbPool` imports from `cases-logic.ts` if TypeScript reports them as unused.

- [ ] **Step 4: Wire the cases handler to the session**

Update `src/main/ipc/handlers/cases.ts`:

```ts
ipcMain.handle('cases:availableBuilds', async () => {
  return wrapHandler(() => getAvailableBuilds(() => getDbManager().getCurrentSession()))
})
```

If `getDbPool` is no longer used in the destructuring list for `registerCaseHandlers`, remove it from that destructuring list. Keep `HandlerDependencies` itself unchanged because other domains still use `getDbPool`.

- [ ] **Step 5: Verify handler routing**

Run:

```bash
make rebuild-node && npx vitest run tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 6: Commit**

Run:

```bash
git add src/main/ipc/handlers/cases-logic.ts src/main/ipc/handlers/cases.ts tests/main/handlers/cases-handlers.test.ts
git commit -m "refactor(cases): route available builds through storage executor"
```

## Task 4: Verify backend-aware coverage and document deferred overview scope

**Files:**

- Modify: implementation PR description or implementation notes
- No source change is required for GitHub Actions because the new tests live under `tests/**/*.test.ts` and are covered by `npm run test`

- [ ] **Step 1: Run the complete Phase 5 targeted suite**

Run:

```bash
make rebuild-node && npx vitest run tests/main/storage/read-executor-contract.test.ts tests/main/storage/sqlite-read-executor.test.ts tests/main/storage/postgres-identifiers.test.ts tests/main/storage/postgres-cases-query-repository.test.ts tests/main/storage/postgres-available-builds-repository.test.ts tests/main/storage/postgres-read-executor.test.ts tests/main/storage/postgres-storage-session.test.ts tests/main/handlers/cases-handlers.test.ts
```

Expected:

- PASS

- [ ] **Step 2: Run type checking**

Run:

```bash
make typecheck
```

Expected:

- PASS

- [ ] **Step 3: Run minimum project verification**

Run:

```bash
make ci
```

Expected:

- PASS

- [ ] **Step 4: Capture the CI coverage note for the PR**

Include this note in the implementation PR body:

```md
Backend-aware Phase 5 coverage is included in normal CI through Vitest:

- `tests/main/storage/sqlite-read-executor.test.ts`
- `tests/main/storage/postgres-identifiers.test.ts`
- `tests/main/storage/postgres-cases-query-repository.test.ts`
- `tests/main/storage/postgres-available-builds-repository.test.ts`
- `tests/main/storage/postgres-read-executor.test.ts`
- `tests/main/storage/postgres-storage-session.test.ts`
- `tests/main/handlers/cases-handlers.test.ts`

No Docker-backed PostgreSQL CI service is added in this phase. The PostgreSQL
coverage uses mocked `pg.Pool` calls and runs under the existing `npm run test`
step. `database:overview` remains on the legacy SQLite pool/direct path by
design and should be evaluated as a later cross-domain read slice.
```

- [ ] **Step 5: Commit any final test or note adjustments**

If Task 4 required source or test adjustments, commit them:

```bash
git add src/main/storage src/main/ipc tests/main
git commit -m "test(storage): cover available builds executor migration"
```

Skip this commit if there are no file changes after the verification runs.

## Self-review checklist

- Spec coverage:
  This plan implements the selected `cases:availableBuilds` slice, preserves SQLite pool/fallback behavior, adds PostgreSQL support, adds backend-aware tests in normal CI, and leaves `database:overview` and renderer storage settings deferred.

- Placeholder scan:
  No placeholder tasks are left. Each implementation step names files, code shape, commands, and expected results.

- Type consistency:
  The plan uses `AvailableBuild`, `StorageReadTask`, `StorageReadExecutor`, `getReadExecutor()`, `PostgresAvailableBuildsRepository`, and `getAvailableGenomeBuilds()` consistently.

## Execution handoff

Plan complete and saved to `.planning/plans/2026-04-24-storage-session-phase-5-cases-available-builds.md`.

Recommended execution option when Phase 5 implementation begins:

1. Use `superpowers:subagent-driven-development` for Task 1 and Task 2 if multiple agents are available, because the SQLite contract work and PostgreSQL repository work have mostly disjoint write sets.
2. Use inline execution for Task 3 and Task 4 so handler routing and final verification stay under one reviewer.

Do not implement Phase 5 from this planning task.
