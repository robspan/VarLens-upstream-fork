/**
 * Sprint A PR-4 D5 — projects registry migration (0011) against a real Postgres.
 *
 * Verifies the projects table is created, the default row is seeded with the
 * actual (template-replaced) schema name, and that re-applying the migration is
 * idempotent (single default row). Mirrors SQLite v31.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('projects registry migration — Sprint A D5', () => {
  let schema: string
  let pool: Pool
  let probe: Client

  beforeEach(async () => {
    schema = `varlens_test_proj_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  it('creates the projects table + seeds the default row with the actual schema name', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const tablesRes = await probe.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [schema]
    )
    expect(tablesRes.rows.map((r) => r.table_name)).toContain('projects')

    const row = await probe.query<{ id: number; name: string; schema_name: string }>(
      `SELECT id, name, schema_name FROM "${schema}".projects WHERE id = 1`
    )
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].id).toBe(1)
    expect(row.rows[0].name).toBe('default')
    // schema_name is template-replaced to the real schema, not the literal token.
    expect(row.rows[0].schema_name).toBe(schema)
  }, 60_000)

  it('re-applying the migration is idempotent (single default row)', async () => {
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
    // A second migrate() is a no-op for already-applied versions.
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const count = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".projects`
    )
    expect(count.rows[0].count).toBe('1')
  }, 60_000)
})

describe.skipIf(RUN)('projects registry migration — Sprint A D5 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
