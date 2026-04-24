import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PostgresCaseMetadataRepository } from '../../../src/main/storage/postgres/PostgresCaseMetadataRepository'

const makePool = () => {
  const client = {
    query: vi.fn(),
    release: vi.fn()
  }

  return {
    pool: {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client)
    },
    client
  }
}

describe('PostgresCaseMetadataRepository', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads case metadata and normalizes numeric ids', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          case_id: '1',
          affected_status: 'affected',
          sex: 'female',
          notes: 'index case'
        }
      ]
    })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await expect(repository.getCaseMetadata(1)).resolves.toStrictEqual({
      id: 7,
      case_id: 1,
      affected_status: 'affected',
      sex: 'female',
      notes: 'index case'
    })
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"public"."case_metadata"'),
      [1]
    )
  })

  it('upserts case metadata with conflict on case_id', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '8',
          case_id: '1',
          affected_status: 'affected',
          sex: 'female',
          notes: null,
          age: 42,
          date_of_birth: '1984-01-02'
        }
      ]
    })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await repository.upsertCaseMetadata(1, {
      affected_status: 'affected',
      sex: 'female',
      age: 42,
      date_of_birth: '1984-01-02'
    })

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (case_id) DO UPDATE'),
      expect.arrayContaining([1, 'affected', 'female', 42, '1984-01-02'])
    )
  })

  it('sets case cohorts transactionally on one checked-out client', async () => {
    const { pool, client } = makePool()
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await repository.setCaseCohorts(1, [2, 3])

    expect(pool.connect).toHaveBeenCalledTimes(1)
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."case_cohort_links"'),
      [1]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "public"."case_cohort_links"'),
      [1, [2, 3]]
    )
    expect(client.query).toHaveBeenLastCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back setCaseCohorts when an insert fails', async () => {
    const { pool, client } = makePool()
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('insert failed'))
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await expect(repository.setCaseCohorts(1, [2])).rejects.toThrow('insert failed')

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('returns full case metadata with comments and metrics included', async () => {
    const { pool } = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '1', case_id: '1', affected_status: 'affected' }] })
      .mockResolvedValueOnce({ rows: [{ id: '2', name: 'rare disease' }] })
      .mockResolvedValueOnce({
        rows: [{ id: '3', hpo_id: 'HP:0001250', hpo_label: 'Seizure' }]
      })
      .mockResolvedValueOnce({ rows: [{ id: '4', category: 'clinical', content: 'reviewed' }] })
      .mockResolvedValueOnce({
        rows: [{ id: '5', metric_id: '6', name: 'Age', value_type: 'numeric', numeric_value: 42 }]
      })
      .mockResolvedValueOnce({ rows: [{ id: '7', platform: 'WGS' }] })
      .mockResolvedValueOnce({ rows: [{ id: '8', id_type: 'MRN', id_value: '12345' }] })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await expect(repository.getFullCaseMetadata(1)).resolves.toStrictEqual({
      metadata: { id: 1, case_id: 1, affected_status: 'affected' },
      cohorts: [{ id: 2, name: 'rare disease' }],
      hpoTerms: [{ id: 3, hpo_id: 'HP:0001250', hpo_label: 'Seizure' }],
      comments: [{ id: 4, category: 'clinical', content: 'reviewed' }],
      metrics: [{ id: 5, metric_id: 6, name: 'Age', value_type: 'numeric', numeric_value: 42 }],
      dataInfo: { id: 7, platform: 'WGS' },
      externalIds: [{ id: 8, id_type: 'MRN', id_value: '12345' }]
    })
  })

  it('normalizes bigint timestamps and nullable linked ids in returned rows', async () => {
    const { pool } = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            case_id: '1',
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '2',
            case_id: '1',
            gene_list_id: '3',
            region_file_id: '4',
            created_at: '1714060802000',
            updated_at: '1714060803000'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await expect(repository.getFullCaseMetadata(1)).resolves.toMatchObject({
      metadata: {
        id: 1,
        case_id: 1,
        created_at: 1714060800000,
        updated_at: 1714060801000
      },
      dataInfo: {
        id: 2,
        case_id: 1,
        gene_list_id: 3,
        region_file_id: 4,
        created_at: 1714060802000,
        updated_at: 1714060803000
      }
    })
  })

  it('returns stable distinct HPO terms grouped by hpo_id', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [{ hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: '2' }]
    })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await expect(repository.getDistinctHpoTerms()).resolves.toStrictEqual([
      { hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: 2 }
    ])
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('GROUP BY hpo_id'), [])
  })

  it('keeps distinct HPO terms to one row per HPO id with deterministic labels', async () => {
    const { pool } = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [{ hpo_id: 'HP:0001250', hpo_label: 'Seizure', case_count: '2' }]
    })
    const repository = new PostgresCaseMetadataRepository(pool, 'public')

    await repository.getDistinctHpoTerms()

    const sql = pool.query.mock.calls[0][0] as string
    expect(sql).toContain('MIN(hpo_label) AS hpo_label')
    expect(sql).toContain('GROUP BY hpo_id')
    expect(sql).not.toContain('GROUP BY hpo_id, hpo_label')
  })
})
