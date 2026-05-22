import { describe, expect, it, vi } from 'vitest'

import {
  DatabaseError,
  NotFoundError,
  UniqueConstraintError
} from '../../../src/main/database/errors'
import { PostgresFilterPresetsRepository } from '../../../src/main/storage/postgres/PostgresFilterPresetsRepository'

function makePool(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }))
  return { query }
}

describe('PostgresFilterPresetsRepository', () => {
  it('lists presets ordered by sort order and name with hydrated JSON and numeric ids', async () => {
    const pool = makePool([
      {
        id: '42',
        name: 'Rare',
        description: null,
        filter_json: '{"maxGnomadAf":0.01}',
        kind: 'shortlist',
        is_built_in: false,
        is_visible: true,
        sort_order: '7',
        created_at: '1000',
        updated_at: '2000'
      }
    ])
    const repo = new PostgresFilterPresetsRepository(pool as never, 'tenant"schema')

    await expect(repo.listPresets()).resolves.toEqual([
      {
        id: 42,
        name: 'Rare',
        description: null,
        filterJson: { maxGnomadAf: 0.01 },
        kind: 'shortlist',
        isBuiltIn: false,
        isVisible: true,
        sortOrder: 7,
        createdAt: 1000,
        updatedAt: 2000
      }
    ])

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"tenant""schema"."filter_presets"')
    )
    const sql = pool.query.mock.calls[0][0] as string
    expect(sql).toContain('ORDER BY sort_order, name')
  })

  it('creates presets with parameterized JSON and defaults', async () => {
    const pool = makePool([
      {
        id: '3',
        name: 'User filter',
        description: null,
        filter_json: '{"genes":["BRCA1"]}',
        kind: 'filter',
        is_built_in: false,
        is_visible: true,
        sort_order: '0',
        created_at: '1000',
        updated_at: '1000'
      }
    ])
    const repo = new PostgresFilterPresetsRepository(pool as never, 'public')

    await repo.createPreset({ name: 'User filter', filterJson: { genes: ['BRCA1'] } })

    expect(pool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO "public"."filter_presets"')
    expect(sql).toContain('RETURNING *')
    expect(params).toEqual([
      'User filter',
      null,
      JSON.stringify({ genes: ['BRCA1'] }),
      'filter',
      0,
      1,
      0,
      expect.any(Number),
      expect.any(Number)
    ])
  })

  it('only updates visibility and sort order for built-in presets', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            name: 'Built in',
            description: null,
            filter_json: '{}',
            kind: 'filter',
            is_built_in: true,
            is_visible: true,
            sort_order: 1,
            created_at: 100,
            updated_at: 100
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9,
            name: 'Built in',
            description: null,
            filter_json: '{}',
            kind: 'filter',
            is_built_in: true,
            is_visible: false,
            sort_order: 5,
            created_at: 100,
            updated_at: 200
          }
        ]
      })
    const repo = new PostgresFilterPresetsRepository(pool as never, 'public')

    const updated = await repo.updatePreset(9, {
      name: 'Ignored',
      filterJson: { maxGnomadAf: 0.1 },
      kind: 'shortlist',
      isVisible: false,
      sortOrder: 5
    })

    expect(updated.name).toBe('Built in')
    expect(updated.isVisible).toBe(false)
    const [sql, params] = pool.query.mock.calls[1]
    expect(sql).toContain('UPDATE "public"."filter_presets"')
    expect(sql).toContain('"is_visible" = $1')
    expect(sql).toContain('"sort_order" = $2')
    expect(sql).not.toContain('name =')
    expect(sql).not.toContain('filter_json =')
    expect(sql).not.toContain('kind =')
    expect(params).toEqual([0, 5, expect.any(Number), 9])
  })

  it('throws typed errors for missing, duplicate, and protected presets', async () => {
    const repo = new PostgresFilterPresetsRepository(makePool([]) as never, 'public')
    await expect(repo.updatePreset(404, { name: 'missing' })).rejects.toBeInstanceOf(NotFoundError)

    const duplicatePool = makePool()
    duplicatePool.query.mockRejectedValueOnce({ code: '23505' })
    const duplicateRepo = new PostgresFilterPresetsRepository(duplicatePool as never, 'public')
    await expect(
      duplicateRepo.createPreset({ name: 'Duplicate', filterJson: {} })
    ).rejects.toBeInstanceOf(UniqueConstraintError)

    const builtInPool = makePool([
      {
        id: 1,
        name: 'Built in',
        description: null,
        filter_json: '{}',
        kind: 'filter',
        is_built_in: true,
        is_visible: true,
        sort_order: 0,
        created_at: 1,
        updated_at: 1
      }
    ])
    const builtInRepo = new PostgresFilterPresetsRepository(builtInPool as never, 'public')
    await expect(builtInRepo.deletePreset(1)).rejects.toBeInstanceOf(DatabaseError)
  })

  it('reorders presets inside one transaction and rolls back on failure', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn()
    }
    const pool = { connect: vi.fn(async () => client) }
    const repo = new PostgresFilterPresetsRepository(pool as never, 'public')

    await repo.reorderPresets([
      { id: 2, sortOrder: 0 },
      { id: 1, sortOrder: 1 }
    ])

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE "public"."filter_presets"'),
      [0, expect.any(Number), 2]
    )
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE "public"."filter_presets"'),
      [1, expect.any(Number), 1]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)

    const failingClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE')) throw new Error('update failed')
        return { rows: [] }
      }),
      release: vi.fn()
    }
    const failingRepo = new PostgresFilterPresetsRepository(
      { connect: vi.fn(async () => failingClient) } as never,
      'public'
    )

    await expect(failingRepo.reorderPresets([{ id: 1, sortOrder: 1 }])).rejects.toThrow(
      /update failed/
    )
    expect(failingClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(failingClient.release).toHaveBeenCalledTimes(1)
  })
})
