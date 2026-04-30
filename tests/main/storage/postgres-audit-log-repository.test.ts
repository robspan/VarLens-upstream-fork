import { describe, expect, it, vi } from 'vitest'

import { PostgresAuditLogRepository } from '../../../src/main/storage/postgres/PostgresAuditLogRepository'

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('PostgresAuditLogRepository', () => {
  it('queries by entity key ordered chronologically and maps created_at to timestamp', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '1',
            action_type: 'star',
            entity_type: 'variant_annotation',
            entity_key: 'v:1',
            old_value: null,
            new_value: '{}',
            metadata_json: null,
            created_at: '1234'
          }
        ]
      })
    }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    const result = await repo.getByEntityKey('v:1')

    expect(result).toEqual([
      {
        id: 1,
        action_type: 'star',
        entity_type: 'variant_annotation',
        entity_key: 'v:1',
        old_value: null,
        new_value: '{}',
        user_name: null,
        timestamp: 1234
      }
    ])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at ASC'), [
      'v:1'
    ])
  })

  it('queries with parameterized filters and returns a total count', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total_count: '2' }] })
        .mockResolvedValueOnce({ rows: [] })
    }
    const repo = new PostgresAuditLogRepository(pool as never, 'tenant"schema')

    const result = await repo.query({
      action_type: 'star',
      entity_type: 'case_variant_annotation',
      entity_key: `case:1' OR TRUE --`,
      from_timestamp: 100,
      to_timestamp: 200,
      limit: 25,
      offset: 50
    })

    const countSql = normalizeSql(pool.query.mock.calls[0][0] as string)
    const dataSql = normalizeSql(pool.query.mock.calls[1][0] as string)
    const params = pool.query.mock.calls[1][1] as unknown[]

    expect(result).toEqual({ data: [], total_count: 2 })
    expect(countSql).toContain('FROM "tenant""schema"."audit_log"')
    expect(dataSql).toContain('ORDER BY created_at DESC')
    expect(dataSql).not.toContain('OR TRUE')
    expect(params).toEqual([
      'star',
      'case_variant_annotation',
      `case:1' OR TRUE --`,
      100,
      200,
      25,
      50
    ])
  })

  it('appends json-encoded old and new values', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')

    await repo.append({
      action_type: 'star',
      entity_type: 'case_variant_annotation',
      entity_key: 'case:1:variant:2',
      old_value: { starred: 0 },
      new_value: { starred: 1 },
      user_name: 'analyst',
      metadata: { source: 'test' }
    })

    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toContain(JSON.stringify({ starred: 0 }))
    expect(params).toContain(JSON.stringify({ starred: 1 }))
    expect(params).toContain('analyst')
    expect(params).toContain(JSON.stringify({ source: 'test' }))
  })

  it('preserves pre-serialized audit values and SQL nulls', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    const repo = new PostgresAuditLogRepository(pool as never, 'public')
    const serializedNewValue = JSON.stringify({ starred: 1 })

    await repo.append({
      action_type: 'star',
      entity_type: 'variant_annotation',
      entity_key: '1:100:A:G',
      old_value: null,
      new_value: serializedNewValue
    })

    const params = pool.query.mock.calls[0][1] as unknown[]
    expect(params).toEqual([
      'star',
      'variant_annotation',
      '1:100:A:G',
      null,
      serializedNewValue,
      null,
      null
    ])
  })
})
