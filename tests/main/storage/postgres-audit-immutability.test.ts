/**
 * Audit-trail tamper-evidence — real-instance check.
 *
 * Migration 0013's append-only triggers on varlens_audit.audit_log are the
 * Tier 1 tamper-evidence claim of the audit-schema-isolation spec
 * (.planning/specs/2026-06-10-audit-schema-isolation.md). A mock cannot
 * prove a trigger fires; this test runs the migrations against a real
 * Postgres and asserts UPDATE, DELETE, and TRUNCATE are all rejected.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { randomBytes } from 'node:crypto'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresAuditLogRepository } from '../../../src/main/storage/postgres/PostgresAuditLogRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

describe.skipIf(!RUN)('varlens_audit.audit_log append-only triggers', () => {
  const schema = `varlens_test_audit_${Date.now()}_${randomBytes(4).toString('hex')}`
  let pool: Pool
  let client: Client

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 2 })
    client = new Client({ connectionString: PG_URL })
    await client.connect()
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

    const repo = new PostgresAuditLogRepository(pool, schema)
    await repo.append({
      action_type: 'api_write',
      entity_type: 'api_call',
      entity_key: 'tags:create',
      new_value: { success: true, method: 'tags:create' },
      user_name: 'admin',
      metadata: { source: 'web-dispatcher' }
    })
  }, 60_000)

  afterAll(async () => {
    if (pool) await pool.end()
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      try {
        await client.query(
          'ALTER TABLE varlens_audit.audit_log DISABLE TRIGGER audit_log_block_mutation'
        )
        await client.query('DELETE FROM varlens_audit.audit_log WHERE project_schema = $1', [
          schema
        ])
      } finally {
        await client.query(
          'ALTER TABLE varlens_audit.audit_log ENABLE TRIGGER audit_log_block_mutation'
        )
        await client.end()
      }
    }
  }, 60_000)

  it('rejects UPDATE on audit rows', async () => {
    await expect(
      client.query(
        `UPDATE varlens_audit.audit_log SET user_name = 'forged' WHERE project_schema = $1`,
        [schema]
      )
    ).rejects.toThrow(/append-only/)
  })

  it('rejects DELETE on audit rows', async () => {
    await expect(
      client.query('DELETE FROM varlens_audit.audit_log WHERE project_schema = $1', [schema])
    ).rejects.toThrow(/append-only/)
  })

  it('rejects TRUNCATE on the audit table', async () => {
    await expect(client.query('TRUNCATE varlens_audit.audit_log')).rejects.toThrow(/append-only/)
  })

  it('still accepts INSERT and scoped reads through the repository', async () => {
    const repo = new PostgresAuditLogRepository(pool, schema)
    const result = await repo.query({})
    expect(result.total_count).toBe(1)
    expect(result.data[0]?.entity_key).toBe('tags:create')
  })
})

describe.skipIf(RUN)('varlens_audit.audit_log append-only triggers (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
