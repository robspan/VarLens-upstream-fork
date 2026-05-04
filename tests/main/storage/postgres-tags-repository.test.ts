import { describe, expect, it, vi } from 'vitest'

import { NotFoundError, UniqueConstraintError } from '../../../src/main/database/errors'
import { PostgresTagsRepository } from '../../../src/main/storage/postgres/PostgresTagsRepository'

function makeQueryPool(rows: unknown[] = [], rowCount = rows.length) {
  const query = vi.fn(async () => ({ rows, rowCount }))

  return { pool: { query }, query }
}

function makeTransactionPool() {
  const client = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    release: vi.fn()
  }
  const pool = {
    connect: vi.fn(async () => client)
  }

  return { client, pool }
}

describe('PostgresTagsRepository', () => {
  it('lists tags ordered by name with the configured schema quoted', async () => {
    const { pool, query } = makeQueryPool([
      { id: 2, name: 'Review', color: '#ffcc00', created_at: '1700000000000' },
      { id: 1, name: 'Candidate', color: '#3366ff', created_at: 1700000000001 }
    ])
    const repo = new PostgresTagsRepository(pool as never, 'tenant"schema')

    await expect(repo.listTags()).resolves.toEqual([
      { id: 2, name: 'Review', color: '#ffcc00', created_at: 1700000000000 },
      { id: 1, name: 'Candidate', color: '#3366ff', created_at: 1700000000001 }
    ])

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM "tenant""schema"."tags"'), [])
    expect(query.mock.calls[0][0]).toContain('ORDER BY name')
  })

  it('creates a tag using parameters and maps unique-name violations', async () => {
    const { pool, query } = makeQueryPool([
      { id: 3, name: 'Flagged', color: '#00aa88', created_at: 1700000000002 }
    ])
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.createTag('Flagged', '#00aa88')).resolves.toEqual({
      id: 3,
      name: 'Flagged',
      color: '#00aa88',
      created_at: 1700000000002
    })

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "public"."tags"'), [
      'Flagged',
      '#00aa88',
      expect.any(Number)
    ])
    expect(query.mock.calls[0][0]).toContain('RETURNING id, name, color, created_at')

    query.mockRejectedValueOnce({ code: '23505' })
    await expect(repo.createTag('Flagged', '#00aa88')).rejects.toBeInstanceOf(UniqueConstraintError)
  })

  it('updates a tag, returns existing rows for empty updates, and maps not found', async () => {
    const { pool, query } = makeQueryPool([
      { id: 4, name: 'Old', color: '#111111', created_at: 1700000000003 }
    ])
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.updateTag(4, {})).resolves.toEqual({
      id: 4,
      name: 'Old',
      color: '#111111',
      created_at: 1700000000003
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [4])

    query.mockResolvedValueOnce({
      rows: [{ id: 4, name: 'Old', color: '#111111', created_at: 1700000000003 }],
      rowCount: 1
    })
    query.mockResolvedValueOnce({
      rows: [{ id: 4, name: 'New', color: '#222222', created_at: 1700000000003 }],
      rowCount: 1
    })

    await expect(repo.updateTag(4, { name: 'New', color: '#222222' })).resolves.toEqual({
      id: 4,
      name: 'New',
      color: '#222222',
      created_at: 1700000000003
    })

    const [sql, params] = query.mock.calls[2]
    expect(sql).toContain('UPDATE "public"."tags"')
    expect(sql).toContain('SET name = $1, color = $2')
    expect(sql).toContain('WHERE id = $3')
    expect(params).toEqual(['New', '#222222', 4])

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await expect(repo.updateTag(99, { name: 'Missing' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('deletes tags and throws when the tag does not exist', async () => {
    const { pool, query } = makeQueryPool([], 1)
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.deleteTag(5)).resolves.toBeUndefined()

    expect(query).toHaveBeenCalledWith('DELETE FROM "public"."tags" WHERE id = $1', [5])

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await expect(repo.deleteTag(404)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('gets a tag by id and returns null for missing rows', async () => {
    const { pool, query } = makeQueryPool([
      { id: 6, name: 'Candidate', color: '#3366ff', created_at: '1700000000004' }
    ])
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.getTag(6)).resolves.toEqual({
      id: 6,
      name: 'Candidate',
      color: '#3366ff',
      created_at: 1700000000004
    })

    expect(query).toHaveBeenCalledWith(
      'SELECT id, name, color, created_at FROM "public"."tags" WHERE id = $1',
      [6]
    )

    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    await expect(repo.getTag(7)).resolves.toBeNull()
  })

  it('returns tag usage counts as numbers', async () => {
    const { pool, query } = makeQueryPool([{ count: '12' }])
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.getTagUsageCount(8)).resolves.toBe(12)

    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM "public"."variant_tags"'), [8])
  })

  it('gets variant tags ordered by tag name', async () => {
    const { pool, query } = makeQueryPool([
      { id: 9, name: 'Candidate', color: '#3366ff', created_at: 1700000000005 }
    ])
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await expect(repo.getVariantTags(11, 22)).resolves.toEqual([
      { id: 9, name: 'Candidate', color: '#3366ff', created_at: 1700000000005 }
    ])

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('JOIN "public"."variant_tags"'),
      [11, 22]
    )
    expect(query.mock.calls[0][0]).toContain('ORDER BY t.name')
  })

  it('assigns and removes variant tags with parameterized SQL', async () => {
    const { pool, query } = makeQueryPool()
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await repo.assignVariantTag(1, 2, 3)
    await repo.removeVariantTag(1, 2, 3)

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ON CONFLICT (case_id, variant_id, tag_id) DO NOTHING'),
      [1, 2, 3, expect.any(Number)]
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM "public"."variant_tags" WHERE case_id = $1 AND variant_id = $2 AND tag_id = $3',
      [1, 2, 3]
    )
  })

  it('sets variant tags in one transaction and rolls back original failures', async () => {
    const { client, pool } = makeTransactionPool()
    const repo = new PostgresTagsRepository(pool as never, 'public')

    await repo.setVariantTags(1, 2, [3, 4])

    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM "public"."variant_tags" WHERE case_id = $1 AND variant_id = $2',
      [1, 2]
    )
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO "public"."variant_tags"'),
      [1, 2, 3, expect.any(Number)]
    )
    expect(client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO "public"."variant_tags"'),
      [1, 2, 4, expect.any(Number)]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)

    const insertError = new Error('insert failed')
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO')) throw insertError
      return { rows: [], rowCount: 0 }
    })

    await expect(repo.setVariantTags(1, 2, [5])).rejects.toBe(insertError)
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(2)
  })
})
