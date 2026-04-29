import { describe, expect, it, vi } from 'vitest'

import { PostgresAnalysisGroupsRepository } from '../../../src/main/storage/postgres/PostgresAnalysisGroupsRepository'

function makePool(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }))
  return { query }
}

describe('PostgresAnalysisGroupsRepository', () => {
  it('lists groups ordered by creation with normalized numeric fields', async () => {
    const pool = makePool([
      {
        id: '11',
        name: 'FAM001',
        group_type: 'family',
        description: 'Family',
        created_at: '1000',
        updated_at: '2000'
      }
    ])
    const repo = new PostgresAnalysisGroupsRepository(pool as never, 'tenant"schema')

    await expect(repo.listGroups()).resolves.toEqual([
      {
        id: 11,
        name: 'FAM001',
        group_type: 'family',
        description: 'Family',
        created_at: 1000,
        updated_at: 2000
      }
    ])

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"tenant""schema"."analysis_groups"')
    )
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY created_at DESC')
  })

  it('creates a group and returns the inserted row', async () => {
    const pool = makePool([
      {
        id: '5',
        name: 'FAM002',
        group_type: 'family',
        description: null,
        created_at: '1000',
        updated_at: '1000'
      }
    ])
    const repo = new PostgresAnalysisGroupsRepository(pool as never, 'public')

    const created = await repo.createGroup('FAM002')

    expect(created.id).toBe(5)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('INSERT INTO "public"."analysis_groups"')
    expect(sql).toContain('RETURNING *')
    expect(params).toEqual(['FAM002', 'family', null, expect.any(Number), expect.any(Number)])
  })

  it('gets groups with members and resolves the group for a case', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            name: 'FAM002',
            group_type: 'family',
            description: null,
            created_at: 1000,
            updated_at: 1000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '20',
            group_id: '5',
            case_id: '8',
            role: 'proband',
            affected_status: 'affected',
            individual_id: 'P1'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ group_id: '5' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            name: 'FAM002',
            group_type: 'family',
            description: null,
            created_at: 1000,
            updated_at: 1000
          }
        ]
      })
    const repo = new PostgresAnalysisGroupsRepository(pool as never, 'public')

    await expect(repo.getGroupWithMembers(5)).resolves.toEqual({
      id: 5,
      name: 'FAM002',
      group_type: 'family',
      description: null,
      created_at: 1000,
      updated_at: 1000,
      members: [
        {
          id: 20,
          group_id: 5,
          case_id: 8,
          role: 'proband',
          affected_status: 'affected',
          individual_id: 'P1'
        }
      ]
    })

    await expect(repo.getGroupForCase(8)).resolves.toMatchObject({ id: 5, name: 'FAM002' })
    expect(pool.query.mock.calls[2]).toEqual([
      expect.stringContaining('SELECT group_id FROM "public"."analysis_group_members"'),
      [8]
    ])
  })

  it('updates and deletes groups with parameterized SQL', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            name: 'FAM002',
            group_type: 'family',
            description: 'Old',
            created_at: 1000,
            updated_at: 1000
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            name: 'FAM002-v2',
            group_type: 'family',
            description: null,
            created_at: 1000,
            updated_at: 2000
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
    const repo = new PostgresAnalysisGroupsRepository(pool as never, 'public')

    await expect(repo.updateGroup(5, { name: 'FAM002-v2', description: null })).resolves.toEqual(
      expect.objectContaining({ name: 'FAM002-v2', description: null })
    )
    await repo.deleteGroup(5)

    expect(pool.query.mock.calls[1]).toEqual([
      expect.stringContaining('UPDATE "public"."analysis_groups"'),
      ['FAM002-v2', null, expect.any(Number), 5]
    ])
    expect(pool.query.mock.calls[2]).toEqual([
      'DELETE FROM "public"."analysis_groups" WHERE id = $1',
      [5]
    ])
  })

  it('adds, removes, and lists members with normalized ids', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '30',
            group_id: '5',
            case_id: '8',
            role: 'father',
            affected_status: 'unaffected',
            individual_id: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '30',
            group_id: '5',
            case_id: '8',
            role: 'father',
            affected_status: 'unaffected',
            individual_id: null
          }
        ]
      })
    const repo = new PostgresAnalysisGroupsRepository(pool as never, 'public')

    await expect(repo.addMember(5, 8, 'father', 'unaffected')).resolves.toEqual({
      id: 30,
      group_id: 5,
      case_id: 8,
      role: 'father',
      affected_status: 'unaffected',
      individual_id: null
    })
    await repo.removeMember(5, 8)
    await expect(repo.getMembers(5)).resolves.toHaveLength(1)

    expect(pool.query.mock.calls[0]).toEqual([
      expect.stringContaining('INSERT INTO "public"."analysis_group_members"'),
      [5, 8, 'father', 'unaffected', null]
    ])
    expect(pool.query.mock.calls[1]).toEqual([
      expect.stringContaining(
        'DELETE FROM "public"."analysis_group_members" WHERE group_id = $1 AND case_id = $2'
      ),
      [5, 8]
    ])
    expect(pool.query.mock.calls[2]).toEqual([expect.stringContaining('ORDER BY role'), [5]])
  })

  it('matches SQLite behavior for missing group and unassigned case', async () => {
    const repo = new PostgresAnalysisGroupsRepository(makePool([]) as never, 'public')

    await expect(repo.getGroup(99)).rejects.toThrow(/Analysis group 99 not found/)
    await expect(repo.getGroupForCase(99)).resolves.toBeNull()
  })
})
