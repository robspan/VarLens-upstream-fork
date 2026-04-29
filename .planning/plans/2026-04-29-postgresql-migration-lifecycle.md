# PostgreSQL Migration Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Docker-init-only PostgreSQL schema setup with a runtime migration lifecycle suitable for existing hosted schemas.

**Architecture:** Add a migration runner under `src/main/storage/postgres/migrations/` that applies forward-only SQL migrations to the configured schema, records checksums in `schema_migrations`, and runs during PostgreSQL session startup before opening the session.

**Tech Stack:** TypeScript, `pg`, PostgreSQL SQL migrations, Vitest, Docker-gated PostgreSQL integration tests.

---

## Files

- Create: `src/main/storage/postgres/migrations/types.ts`
- Create: `src/main/storage/postgres/migrations/PostgresMigrationRunner.ts`
- Create: `src/main/storage/postgres/migrations/definitions.ts`
- Create: `src/main/storage/postgres/migrations/sql/0001_create_cases.sql`
- Create: `src/main/storage/postgres/migrations/sql/0002_create_case_metadata.sql`
- Create: `src/main/storage/postgres/migrations/sql/0003_create_variants.sql`
- Create: `src/main/storage/postgres/migrations/sql/0004_generated_search_documents.sql`
- Modify: `src/main/database/startup.ts`
- Modify: `src/main/storage/postgres/PostgresStorageSession.ts`
- Create: `tests/main/storage/postgres-migration-runner.test.ts`
- Create: `tests/e2e/postgres-migrations-dev-mode.e2e.ts`
- Modify: `scripts/postgres/init-db/README.md`

## Task 1: Add migration runner unit behavior

- [ ] **Step 1: Write tests**

Create `tests/main/storage/postgres-migration-runner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import type { PostgresMigration } from '../../../src/main/storage/postgres/migrations/types'

function poolWithRows(rowsByCall: unknown[][]) {
  const query = vi.fn(async () => ({ rows: rowsByCall.shift() ?? [] }))
  return { query }
}

describe('PostgresMigrationRunner', () => {
  const migrations: PostgresMigration[] = [
    { version: '0001', name: 'one', sql: 'CREATE TABLE "__schema__"."one" (id bigint)', checksum: 'a' },
    { version: '0002', name: 'two', sql: 'CREATE TABLE "__schema__"."two" (id bigint)', checksum: 'b' }
  ]

  it('creates schema_migrations and applies pending migrations in order', async () => {
    const pool = poolWithRows([[], []])
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', migrations)

    const result = await runner.migrate()

    expect(result.applied).toEqual(['0001', '0002'])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE SCHEMA IF NOT EXISTS "app_schema"'))
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'))
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'))
  })

  it('throws when an applied migration checksum differs', async () => {
    const pool = poolWithRows([[{ version: '0001', checksum: 'old' }]])
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('checksum mismatch')
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npx vitest run tests/main/storage/postgres-migration-runner.test.ts`

Expected: FAIL because migration runner files do not exist.

- [ ] **Step 3: Define types**

Create `src/main/storage/postgres/migrations/types.ts`:

```ts
export interface PostgresMigration {
  version: string
  name: string
  sql: string
  checksum: string
}

export interface PostgresMigrationResult {
  applied: string[]
  currentVersion: string | null
}
```

- [ ] **Step 4: Implement migration runner**

Create `src/main/storage/postgres/migrations/PostgresMigrationRunner.ts`:

```ts
import type { Pool } from 'pg'

import { quoteIdentifier } from '../identifiers'
import type { PostgresMigration, PostgresMigrationResult } from './types'

interface MigrationRow {
  version: string
  checksum: string
}

export class PostgresMigrationRunner {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string,
    private readonly migrations: readonly PostgresMigration[]
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async migrate(): Promise<PostgresMigrationResult> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schemaName}."schema_migrations" (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        execution_ms BIGINT NOT NULL
      )
    `)

    const appliedResult = await this.pool.query<MigrationRow>(
      `SELECT version, checksum FROM ${this.schemaName}."schema_migrations" ORDER BY version`
    )
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]))

    for (const migration of this.migrations) {
      const existingChecksum = applied.get(migration.version)
      if (existingChecksum !== undefined && existingChecksum !== migration.checksum) {
        throw new Error(`PostgreSQL migration checksum mismatch for ${migration.version}`)
      }
    }

    const appliedNow: string[] = []
    for (const migration of this.migrations) {
      if (applied.has(migration.version)) continue
      const startedAt = Date.now()
      await this.pool.query('BEGIN')
      try {
        await this.pool.query(this.interpolateSchema(migration.sql))
        await this.pool.query(
          `INSERT INTO ${this.schemaName}."schema_migrations" (version, name, checksum, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt]
        )
        await this.pool.query('COMMIT')
        appliedNow.push(migration.version)
      } catch (error) {
        await this.pool.query('ROLLBACK')
        throw error
      }
    }

    const current = this.migrations[this.migrations.length - 1]?.version ?? null
    return { applied: appliedNow, currentVersion: current }
  }

  private interpolateSchema(sql: string): string {
    return sql.split('"__schema__"').join(this.schemaName)
  }
}
```

- [ ] **Step 5: Run unit test**

Run: `npx vitest run tests/main/storage/postgres-migration-runner.test.ts`

Expected: PASS.

## Task 2: Add initial migration definitions

- [ ] **Step 1: Create SQL files from current init SQL**

Create SQL files under `src/main/storage/postgres/migrations/sql/` by splitting current init SQL:

- `0001_create_cases.sql`: contents from `scripts/postgres/init-db/10-phase3-cases.sql`, with every table as `"__schema__"."table"`.
- `0002_create_case_metadata.sql`: contents from `11-phase6-case-metadata.sql`, schema-qualified.
- `0003_create_variants.sql`: contents from `12-phase7-variants.sql`, schema-qualified and without trigger-backed `search_document` final state if `0004` replaces it.
- `0004_generated_search_documents.sql`: contents from `16-phase16-search-document-fns.sql`, schema-qualified.

Use this pattern for function definitions:

```sql
CREATE OR REPLACE FUNCTION "__schema__".compute_variants_search_doc(...)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$ ... $$;
```

Use this pattern for generated column calls:

```sql
GENERATED ALWAYS AS (
  "__schema__".compute_variants_search_doc(...)
) STORED
```

- [ ] **Step 2: Create migration definitions**

Create `src/main/storage/postgres/migrations/definitions.ts`:

```ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PostgresMigration } from './types'

function loadSql(fileName: string): string {
  return readFileSync(join(__dirname, 'sql', fileName), 'utf8')
}

function migration(version: string, name: string, fileName: string): PostgresMigration {
  const sql = loadSql(fileName)
  return {
    version,
    name,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex')
  }
}

export const POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  migration('0001', 'create_cases', '0001_create_cases.sql'),
  migration('0002', 'create_case_metadata', '0002_create_case_metadata.sql'),
  migration('0003', 'create_variants', '0003_create_variants.sql'),
  migration('0004', 'generated_search_documents', '0004_generated_search_documents.sql')
]
```

- [ ] **Step 3: Ensure SQL files are packaged**

Modify `package.json` build file inclusion if needed so migration SQL files are present in packaged app:

```json
{
  "from": "src/main/storage/postgres/migrations/sql",
  "to": "migrations/postgres/sql"
}
```

If electron-vite bundles `readFileSync(__dirname, 'sql', file)` incorrectly, replace file loading with static imports using Vite raw imports and add a unit test for `POSTGRES_MIGRATIONS.length`.

## Task 3: Run migrations at PostgreSQL startup

- [ ] **Step 1: Write startup test**

Extend `tests/main/database/startup.test.ts` or create `tests/main/database/postgres-startup-migrations.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { openConfiguredDatabase } from '../../../src/main/database/startup'

describe('PostgreSQL startup migrations', () => {
  it('migrates before opening a postgres session', async () => {
    const manager = { openPostgresSession: vi.fn() }
    const pool = { query: vi.fn(async () => ({ rows: [] })), end: vi.fn() }
    const createPostgresSession = vi.fn(() => ({ close: vi.fn() }))

    await openConfiguredDatabase(manager as never, {
      userDataPath: '/tmp',
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: 'postgres://u:p@localhost/db'
      },
      createPostgresPool: () => pool as never,
      createPostgresSession: createPostgresSession as never
    })

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('schema_migrations'))
    expect(manager.openPostgresSession).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run: `npx vitest run tests/main/database/postgres-startup-migrations.test.ts`

Expected: FAIL because startup does not run migrations.

- [ ] **Step 3: Wire migration runner into startup**

Modify `src/main/database/startup.ts`:

```ts
import { PostgresMigrationRunner } from '../storage/postgres/migrations/PostgresMigrationRunner'
import { POSTGRES_MIGRATIONS } from '../storage/postgres/migrations/definitions'

const runner = new PostgresMigrationRunner(pool, config.schema, POSTGRES_MIGRATIONS)
await runner.migrate()
session = sessionFactory(config, pool)
```

Place migration before `sessionFactory` and before `manager.openPostgresSession(session)`.

- [ ] **Step 4: Update capabilities after runner exists**

Modify `POSTGRES_CAPABILITIES.workspace.migrations` to `true` once startup migration runner is active.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/main/storage/postgres-migration-runner.test.ts tests/main/database/postgres-startup-migrations.test.ts tests/main/storage/backend-capabilities.test.ts`

Expected: PASS.

## Task 4: Add Docker-gated migration E2E

- [ ] **Step 1: Write E2E test**

Create `tests/e2e/postgres-migrations-dev-mode.e2e.ts`:

```ts
import { test, expect } from '@playwright/test'
import { Client } from 'pg'

const SHOULD_RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL = process.env.VARLENS_PG_URL ?? 'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

test.skip(!SHOULD_RUN, 'Set VARLENS_RUN_POSTGRES_E2E=1 and start local postgres')

test('postgres migrations create schema_migrations entries', async () => {
  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  try {
    const result = await client.query('SELECT version FROM public.schema_migrations ORDER BY version')
    expect(result.rows.map((row) => row.version)).toContain('0001')
    expect(result.rows.map((row) => row.version)).toContain('0004')
  } finally {
    await client.end()
  }
})
```

- [ ] **Step 2: Run with local PostgreSQL only when requested**

Run: `VARLENS_RUN_POSTGRES_E2E=1 npx playwright test tests/e2e/postgres-migrations-dev-mode.e2e.ts --workers=1`

Expected: PASS when local PostgreSQL is running and app startup has applied migrations.

## Task 5: Documentation cleanup and commit

- [ ] **Step 1: Update init README**

Modify `scripts/postgres/init-db/README.md` to state:

```md
Runtime PostgreSQL schema creation is owned by `src/main/storage/postgres/migrations/`.
This folder is retained only for local Docker bootstrap compatibility and must not be updated independently from migrations.
```

- [ ] **Step 2: Commit**

Run:

```bash
git add src/main/storage/postgres/migrations src/main/database/startup.ts src/main/storage/postgres/PostgresStorageSession.ts tests/main/storage/postgres-migration-runner.test.ts tests/main/database/postgres-startup-migrations.test.ts tests/e2e/postgres-migrations-dev-mode.e2e.ts scripts/postgres/init-db/README.md package.json
git commit -m "feat(postgres): add schema migration lifecycle"
```
