# PostgreSQL Export Delete Overview Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PostgreSQL workspaces operational after import by adding case deletion, database overview, and streaming export parity.

**Architecture:** Add PostgreSQL lifecycle/export repositories behind storage executors or dedicated domain executors. Keep WGS-sized exports streaming and avoid `DatabaseService` in PostgreSQL paths.

**Tech Stack:** TypeScript, PostgreSQL, `pg-query-stream` if added, existing IPC/export handlers, Vitest, Playwright-gated PostgreSQL tests.

---

## Files

- Create: `src/main/storage/postgres/PostgresCaseLifecycleRepository.ts`
- Create: `src/main/storage/postgres/PostgresOverviewRepository.ts`
- Create: `src/main/storage/postgres/PostgresExportRepository.ts`
- Modify: `src/main/storage/write-executor.ts`
- Modify: `src/main/storage/read-executor.ts`
- Modify: `src/main/storage/postgres/PostgresReadExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresWriteExecutor.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Modify: `src/main/ipc/handlers/cases.ts`
- Modify: `src/main/ipc/handlers/database.ts`
- Modify: `src/main/ipc/handlers/export.ts`
- Create: `tests/main/storage/postgres-case-lifecycle-repository.test.ts`
- Create: `tests/main/storage/postgres-overview-repository.test.ts`
- Create: `tests/main/storage/postgres-export-repository.test.ts`
- Create: `tests/main/handlers/postgres-export-routing.test.ts`

## Task 1: Add PostgreSQL case delete

- [ ] **Step 1: Write repository test**

Create `tests/main/storage/postgres-case-lifecycle-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresCaseLifecycleRepository } from '../../../src/main/storage/postgres/PostgresCaseLifecycleRepository'

describe('PostgresCaseLifecycleRepository', () => {
  it('deletes a case and rebuilds variant frequency in one transaction', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() }
    const pool = { connect: vi.fn(async () => client) }
    const repo = new PostgresCaseLifecycleRepository(pool as never, 'public')

    await repo.deleteCase(7)

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM public."cases" WHERE id = $1'), [7])
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('variant_frequency'))
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/main/storage/postgres-case-lifecycle-repository.test.ts`

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement repository**

Create `src/main/storage/postgres/PostgresCaseLifecycleRepository.ts`:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

export class PostgresCaseLifecycleRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async deleteCase(caseId: number): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM ${this.schemaName}."cases" WHERE id = $1`, [caseId])
      await client.query(`TRUNCATE ${this.schemaName}."variant_frequency"`)
      await client.query(`
        INSERT INTO ${this.schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
        SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id)::bigint
        FROM ${this.schemaName}."variants"
        GROUP BY chr, pos, ref, alt
      `)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
```

- [ ] **Step 4: Route write task**

Modify `src/main/storage/write-executor.ts`:

```ts
| { type: 'cases:delete'; params: [caseId: number] }
```

Modify `PostgresWriteExecutor` to accept lifecycle repository and route:

```ts
case 'cases:delete':
  return await this.caseLifecycle.deleteCase(task.params[0])
```

Update SQLite write executor or keep SQLite delete on existing path until separate migration.

- [ ] **Step 5: Update cases IPC handler**

Modify `src/main/ipc/handlers/cases.ts`:

```ts
if (getDbManager().getCurrentSession().capabilities.backend === 'postgres') {
  await getDbManager().getCurrentSession().getWriteExecutor().execute({
    type: 'cases:delete',
    params: [validated.data]
  })
  deleteCallbacks.onDeleted({ id: validated.data })
  return undefined
}
```

Keep existing SQLite worker delete path for SQLite.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-case-lifecycle-repository.test.ts tests/main/handlers/cases-handlers.test.ts`

Expected: PASS.

## Task 2: Add PostgreSQL database overview

- [ ] **Step 1: Write test**

Create `tests/main/storage/postgres-overview-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresOverviewRepository } from '../../../src/main/storage/postgres/PostgresOverviewRepository'

describe('PostgresOverviewRepository', () => {
  it('returns overview counts', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)::int AS cases')) return { rows: [{ cases: 2 }] }
      if (sql.includes('COUNT(*)::int AS variants')) return { rows: [{ variants: 10 }] }
      if (sql.includes('pg_total_relation_size')) return { rows: [{ bytes: 1024 }] }
      return { rows: [{ count: 0 }] }
    })
    const repo = new PostgresOverviewRepository({ query } as never, 'public')

    await expect(repo.getOverview()).resolves.toMatchObject({ caseCount: 2, variantCount: 10 })
  })
})
```

- [ ] **Step 2: Implement repository**

Create `src/main/storage/postgres/PostgresOverviewRepository.ts`:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

export class PostgresOverviewRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getOverview(): Promise<unknown> {
    const [cases, variants, size] = await Promise.all([
      this.pool.query(`SELECT COUNT(*)::int AS cases FROM ${this.schemaName}."cases"`),
      this.pool.query(`SELECT COUNT(*)::int AS variants FROM ${this.schemaName}."variants"`),
      this.pool.query(
        `SELECT COALESCE(SUM(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass)), 0)::bigint AS bytes
         FROM pg_tables WHERE schemaname = $1`,
        [this.schemaName.replace(/^"|"$/g, '').replace(/""/g, '"')]
      )
    ])

    return {
      backend: 'postgres',
      caseCount: Number(cases.rows[0]?.cases ?? 0),
      variantCount: Number(variants.rows[0]?.variants ?? 0),
      sizeBytes: Number(size.rows[0]?.bytes ?? 0)
    }
  }
}
```

- [ ] **Step 3: Route read task and database handler**

Add to `StorageReadTask`:

```ts
| { type: 'database:overview'; params: [] }
```

Route through `PostgresReadExecutor` and `SqliteReadExecutor`.

Modify `database:overview` handler to use current session read executor for PostgreSQL and existing path for SQLite.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-overview-repository.test.ts tests/main/handlers/database-handlers.test.ts`

Expected: PASS after adjusting existing handler tests.

## Task 3: Add PostgreSQL streaming export

- [ ] **Step 1: Write repository test**

Create `tests/main/storage/postgres-export-repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresExportRepository } from '../../../src/main/storage/postgres/PostgresExportRepository'

describe('PostgresExportRepository', () => {
  it('builds a parameterized export query for variants', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: '1', chr: '1', pos: '123', ref: 'A', alt: 'G' }] }))
    const repo = new PostgresExportRepository({ query } as never, 'public')

    const rows = []
    for await (const row of repo.streamVariantRows({ case_id: 5 })) rows.push(row)

    expect(rows).toHaveLength(1)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE v.case_id = $1'), [5])
  })
})
```

- [ ] **Step 2: Implement simple async iterable export first**

Create `src/main/storage/postgres/PostgresExportRepository.ts`:

```ts
import type { Pool } from 'pg'

import type { VariantFilter } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'

export class PostgresExportRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async *streamVariantRows(filter: VariantFilter): AsyncGenerator<Record<string, unknown>> {
    const result = await this.pool.query(
      `SELECT v.* FROM ${this.schemaName}."variants" v WHERE v.case_id = $1 ORDER BY v.id`,
      [filter.case_id]
    )
    for (const row of result.rows as Array<Record<string, unknown>>) {
      yield row
    }
  }
}
```

This first implementation is not WGS-safe. Add a follow-up step before marking export capability true.

- [ ] **Step 3: Replace buffered query with cursor/stream**

Add dependency if chosen:

Run: `npm install pg-query-stream`

Update repository to use `pg-query-stream` and `client.query(new QueryStream(...))`, then pipe rows into existing export renderer. Ensure `client.release()` runs in `finally`.

- [ ] **Step 4: Route export handler**

Modify `src/main/ipc/handlers/export.ts`:

```ts
const session = getDbManager().getCurrentSession()
if (session.capabilities.backend === 'postgres') {
  return exportPostgresVariants(session, validated.data.caseId, validated.data.filters, validated.data.caseName, result.filePath, exportCallbacks)
}
```

Create `exportPostgresVariants` in `src/main/ipc/handlers/export-logic.ts` or a new storage-neutral export service. It should reuse existing XLSX/CSV formatting helpers, consuming an async iterable.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-export-repository.test.ts tests/main/handlers/postgres-export-routing.test.ts`

Expected: PASS.

## Task 4: Update capabilities and commit

- [ ] **Step 1: Update capabilities**

Set these to true only after tests pass:

```ts
POSTGRES_CAPABILITIES.cases.deleteOne = true
POSTGRES_CAPABILITIES.cases.overview = true
POSTGRES_CAPABILITIES.export.variants = true
POSTGRES_CAPABILITIES.export.streaming = true
```

- [ ] **Step 2: Commit**

Run:

```bash
git add src/main/storage/postgres/PostgresCaseLifecycleRepository.ts src/main/storage/postgres/PostgresOverviewRepository.ts src/main/storage/postgres/PostgresExportRepository.ts src/main/storage/read-executor.ts src/main/storage/write-executor.ts src/main/storage/postgres/PostgresReadExecutor.ts src/main/storage/postgres/PostgresWriteExecutor.ts src/main/storage/postgres/PostgresStorageSession.ts src/main/ipc/handlers/cases.ts src/main/ipc/handlers/database.ts src/main/ipc/handlers/export.ts tests/main/storage/postgres-case-lifecycle-repository.test.ts tests/main/storage/postgres-overview-repository.test.ts tests/main/storage/postgres-export-repository.test.ts tests/main/handlers/postgres-export-routing.test.ts
git commit -m "feat(postgres): add lifecycle and export parity"
```
