/**
 * Postgres migrations — real-instance idempotency check.
 *
 * Web ships on Postgres (see .planning/web/decision-postgres-as-web-backend.md).
 * Migration correctness against a real Postgres engine is therefore load-bearing
 * and the existing migration tests (mock-only) do not cover it.
 *
 * This test boots a real schema, runs all migrations, captures the resulting
 * schema state from information_schema, runs migrations again on the same
 * schema, and asserts the captured state is identical. Catches:
 *
 *   - Migrations that produce different output on a second run (non-idempotent)
 *   - Migrations that depend on Postgres extensions / GUC state we don't ship
 *   - Type/grammar incompatibilities relative to SQLite that the mock tests miss
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { randomBytes } from 'node:crypto'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { Pool } from 'pg'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface SchemaSnapshot {
  tables: Array<{ table_name: string; columns: string[] }>
  indexes: string[]
  appliedVersions: number[]
}

async function captureSchema(client: Client, schema: string): Promise<SchemaSnapshot> {
  const tablesRes = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
    [schema]
  )

  const tables: SchemaSnapshot['tables'] = []
  for (const row of tablesRes.rows) {
    const colsRes = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
      [schema, row.table_name]
    )
    tables.push({
      table_name: row.table_name,
      columns: colsRes.rows.map((r) => r.column_name)
    })
  }

  const indexRes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
       WHERE schemaname = $1 ORDER BY indexname`,
    [schema]
  )

  const versionsRes = await client.query<{ version: number }>(
    `SELECT version FROM "${schema}".schema_migrations ORDER BY version`
  )

  return {
    tables,
    indexes: indexRes.rows.map((r) => r.indexname),
    appliedVersions: versionsRes.rows.map((r) => r.version)
  }
}

describe.skipIf(!RUN)('Postgres migrations: real-instance idempotency', () => {
  const schema = `varlens_test_mig_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let probeClient: Client

  beforeAll(async () => {
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probeClient = new Client({ connectionString: PG_URL })
    await probeClient.connect()
  }, 60_000)

  afterAll(async () => {
    if (probeClient) await probeClient.end()
    if (pool) await pool.end()

    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('runs all migrations end-to-end and produces a non-empty schema', async () => {
    const result = await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(result.applied.length).toBeGreaterThan(0)

    const snapshot = await captureSchema(probeClient, schema)
    expect(snapshot.tables.length).toBeGreaterThan(0)
    expect(snapshot.appliedVersions).toEqual([...snapshot.appliedVersions].sort((a, b) => a - b))
  }, 60_000)

  it('is idempotent — a second run produces the same schema state', async () => {
    const before = await captureSchema(probeClient, schema)

    const result = await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    expect(result.applied.length).toBe(0) // nothing new to apply

    const after = await captureSchema(probeClient, schema)
    expect(after).toEqual(before)
  }, 60_000)
})

describe.skipIf(RUN)('Postgres migrations: real-instance idempotency (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
