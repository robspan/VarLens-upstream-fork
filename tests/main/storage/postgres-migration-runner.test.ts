import { describe, expect, it, vi } from 'vitest'

import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import type { PostgresMigration } from '../../../src/main/storage/postgres/migrations/types'

function poolWithAppliedRows(appliedRows: unknown[] = []) {
  const client = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes('SELECT version, checksum') ? appliedRows : []
    })),
    release: vi.fn()
  }
  const connect = vi.fn(async () => client)
  return { query: vi.fn(), connect, client }
}

describe('PostgresMigrationRunner', () => {
  const migrations: PostgresMigration[] = [
    {
      version: '0001',
      name: 'one',
      sql: 'CREATE TABLE "__schema__"."one" (id bigint)',
      checksum: 'a'
    },
    {
      version: '0002',
      name: 'two',
      sql: 'CREATE TABLE "__schema__"."two" (id bigint)',
      checksum: 'b'
    }
  ]

  it('creates schema_migrations and applies pending migrations in order', async () => {
    const pool = poolWithAppliedRows()
    const runner = new PostgresMigrationRunner(pool as never, 'app_schema', migrations)

    const result = await runner.migrate()

    expect(result.applied).toEqual(['0001', '0002'])
    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(pool.client.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE SCHEMA IF NOT EXISTS "app_schema"')
    )
    expect(pool.client.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'))
    expect(pool.client.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['app_schema']
    )
    const lockOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')
    })
    const createSchemaOrder = pool.client.query.mock.invocationCallOrder.find((_, index) => {
      const [sql] = pool.client.query.mock.calls[index] ?? []
      return typeof sql === 'string' && sql.includes('CREATE SCHEMA')
    })
    expect(lockOrder).toBeLessThan(createSchemaOrder)
    expect(pool.client.query).toHaveBeenCalledWith(expect.stringContaining('COMMIT'))
    expect(pool.client.release).toHaveBeenCalledTimes(1)
  })

  it('throws when an applied migration checksum differs', async () => {
    const pool = poolWithAppliedRows([{ version: '0001', checksum: 'old' }])
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('checksum mismatch')
  })

  it('throws when the database has a migration newer than this app supports', async () => {
    const pool = poolWithAppliedRows([{ version: '9999', checksum: 'future' }])
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('newer than this app supports')
  })

  it('rolls back failed migration SQL without masking the migration error', async () => {
    const migrationError = new Error('boom')
    const rollbackError = new Error('rollback boom')
    const pool = poolWithAppliedRows()
    pool.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('CREATE TABLE "public"."one"')) throw migrationError
      if (sql === 'ROLLBACK') throw rollbackError
      return { rows: [] }
    })
    const runner = new PostgresMigrationRunner(pool as never, 'public', migrations)

    await expect(runner.migrate()).rejects.toThrow('boom')
    expect(pool.client.query).toHaveBeenCalledWith('ROLLBACK')
    expect((migrationError as Error & { rollbackError?: unknown }).rollbackError).toBe(
      rollbackError
    )
    expect(pool.client.release).toHaveBeenCalledTimes(1)
  })
})
