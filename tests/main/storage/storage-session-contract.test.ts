/**
 * StorageSession contract — same observable behavior across both backends.
 *
 * Pins the interface that desktop (SQLite) and web (Postgres) must agree on.
 * The refactor that extracts code behind StorageSession is the most likely
 * place for the two backends to diverge silently; this test catches it.
 *
 * SQLite half: always runs.
 * Postgres half: gated by VARLENS_RUN_POSTGRES_E2E=1 + a running dev container
 *   (make pg-up). Each run uses a unique schema and drops it on cleanup.
 *
 *   make pg-up
 *   VARLENS_RUN_POSTGRES_E2E=1 npx vitest run --project main \
 *     tests/main/storage/storage-session-contract.test.ts
 *
 * Plan: .planning/web/testing/desktop-preservation.md
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'

import { DatabaseService } from '../../../src/main/database/DatabaseService'
import { SqliteStorageSession } from '../../../src/main/storage/sqlite/SqliteStorageSession'
import { createPostgresStorageSession } from '../../../src/main/storage/postgres/createPostgresStorageSession'
import type { PostgresStorageConfig } from '../../../src/main/storage/config'
import type { StorageSession } from '../../../src/main/storage/session'

interface BackendFixture {
  name: 'sqlite' | 'postgres'
  setup: () => Promise<{ session: StorageSession; cleanup: () => Promise<void> }>
}

const POSTGRES_E2E = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

async function setupSqlite() {
  const tempDir = mkdtempSync(join(tmpdir(), 'varlens-storage-contract-sqlite-'))
  const dbPath = join(tempDir, 'session.db')
  const db = new DatabaseService(dbPath)
  const session = new SqliteStorageSession({ databaseService: db, dbPool: null })

  return {
    session,
    cleanup: async () => {
      await session.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

async function setupPostgres() {
  const schema = `varlens_test_${Date.now()}_${randomBytes(4).toString('hex')}`

  const provisioner = new Client({ connectionString: PG_URL })
  await provisioner.connect()
  await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
  await provisioner.end()

  const config: PostgresStorageConfig = {
    url: PG_URL,
    schema,
    applicationName: 'varlens-test',
    sslMode: 'disable',
    connectionTimeoutMillis: 5000,
    statementTimeoutMs: 30_000,
    queryTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    idleInTransactionSessionTimeoutMs: 10_000,
    poolMax: 2
  }

  const session = await createPostgresStorageSession(config)

  return {
    session,
    cleanup: async () => {
      await session.close()
      const cleaner = new Client({ connectionString: PG_URL })
      await cleaner.connect()
      await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await cleaner.end()
    }
  }
}

const fixtures: BackendFixture[] = [
  { name: 'sqlite', setup: setupSqlite },
  ...(POSTGRES_E2E ? [{ name: 'postgres' as const, setup: setupPostgres }] : [])
]

describe.each(fixtures)('StorageSession contract — $name', ({ name, setup }) => {
  let s: { session: StorageSession; cleanup: () => Promise<void> }

  beforeAll(async () => {
    s = await setup()
  }, 60_000)

  afterAll(async () => {
    if (s) await s.cleanup()
  }, 60_000)

  it('exposes workspace metadata with the expected backend kind', () => {
    expect(s.session.workspace.kind).toBe(name)
  })

  it('reports ok health on a fresh session', async () => {
    const health = await s.session.health()
    expect(health.ok).toBe(true)
    expect(health.backend).toBe(name)
  })

  it('returns an empty array from listCases on a fresh DB', async () => {
    expect(await s.session.listCases()).toEqual([])
  })

  it('exposes a defined read executor', () => {
    expect(s.session.getReadExecutor()).toBeDefined()
  })

  it('exposes a defined import executor with importSingleFile + cancel', () => {
    const executor = s.session.getImportExecutor()
    expect(executor).toBeDefined()
    expect(typeof executor.importSingleFile).toBe('function')
    expect(typeof executor.cancel).toBe('function')
  })

  it('exposes a capabilities object with the expected backend tag', () => {
    expect(s.session.capabilities.backend).toBe(name)
  })
})

describe.skipIf(POSTGRES_E2E)('StorageSession contract — postgres half (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(POSTGRES_E2E).toBe(false)
  })
})

/**
 * Deferred (rule-of-three): cross-backend behavioral parity.
 *
 * The contract tests above pin the *interface* — both backends expose the
 * same observable surface for shape-level operations. The next layer is
 * behavioral parity: insert N variants on each backend, run 3 filter
 * queries, assert identical normalized results.
 *
 * Why deferred: behavioral parity for VCF-derived data is already pinned
 * on the SQLite path by `tests/web-gate/parity/import-and-filter.test.ts`.
 * Adding the Postgres equivalent requires Postgres-side variant fixture
 * setup (COPY-from-stdin or repository writes) and a normalized comparator.
 * That work lands when the third parity scenario is needed (rule of three).
 */
describe.skip('StorageSession behavioral parity — cross-backend filter results', () => {
  it('insert N variants on each backend, run 3 filter queries, assert identical', () => {
    expect(true).toBe(true)
  })
})
