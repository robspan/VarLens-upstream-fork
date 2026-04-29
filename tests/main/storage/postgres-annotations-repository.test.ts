import { describe, expect, it, vi } from 'vitest'

import { PostgresAnnotationsRepository } from '../../../src/main/storage/postgres/PostgresAnnotationsRepository'

const makePool = () => ({
  query: vi.fn()
})

describe('PostgresAnnotationsRepository', () => {
  it('gets global annotations by coordinates and normalizes returned values', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '7',
          chr: '1',
          pos: '12345',
          ref: 'A',
          alt: 'G',
          global_comment: 'reviewed',
          starred: true,
          acmg_classification: 'Pathogenic',
          acmg_evidence: null,
          created_at: '1714060800000',
          updated_at: '1714060801000'
        }
      ]
    })
    const repository = new PostgresAnnotationsRepository(pool, 'tenant"schema')

    await expect(repository.getGlobalAnnotation('1', 12345, 'A', 'G')).resolves.toStrictEqual({
      id: 7,
      chr: '1',
      pos: 12345,
      ref: 'A',
      alt: 'G',
      global_comment: 'reviewed',
      starred: 1,
      acmg_classification: 'Pathogenic',
      acmg_evidence: null,
      created_at: 1714060800000,
      updated_at: 1714060801000
    })
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('"tenant""schema"."variant_annotations"'),
      ['1', 12345, 'A', 'G']
    )
  })

  it('upserts global annotations with only supported fields', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 8,
          chr: '1',
          pos: 12345,
          ref: 'A',
          alt: 'G',
          global_comment: null,
          starred: 1,
          acmg_classification: 'Likely benign',
          acmg_evidence: 'PM2',
          created_at: 1714060800000,
          updated_at: 1714060801000
        }
      ]
    })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await repository.upsertGlobalAnnotation('1', 12345, 'A', 'G', {
      global_comment: null,
      starred: 1,
      acmg_classification: 'Likely benign',
      acmg_evidence: 'PM2',
      unsupported_field: 'ignored'
    } as never)

    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (chr, pos, ref, alt) DO UPDATE')
    expect(sql).toContain('"public"."variant_annotations"')
    expect(sql).not.toContain('unsupported_field')
    expect(params).toStrictEqual([
      '1',
      12345,
      'A',
      'G',
      null,
      1,
      'Likely benign',
      'PM2',
      true,
      true,
      true,
      true
    ])
  })

  it('deletes global annotations by coordinates', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await repository.deleteGlobalAnnotation('1', 12345, 'A', 'G')

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."variant_annotations"'),
      ['1', 12345, 'A', 'G']
    )
  })

  it('gets and upserts per-case annotations by case and variant id', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '9',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'case note',
            starred: '0',
            acmg_classification: null,
            acmg_evidence: '{"notes":"case"}',
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '10',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'updated',
            starred: false,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060802000'
          }
        ]
      })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(repository.getPerCaseAnnotation(2, 3)).resolves.toMatchObject({
      id: 9,
      case_id: 2,
      variant_id: 3,
      per_case_comment: 'case note',
      starred: 0,
      acmg_evidence: '{"notes":"case"}'
    })
    await expect(
      repository.upsertPerCaseAnnotation(2, 3, { per_case_comment: 'updated', starred: 0 })
    ).resolves.toMatchObject({
      id: 10,
      case_id: 2,
      variant_id: 3,
      per_case_comment: 'updated',
      starred: 0
    })

    const [upsertSql, upsertParams] = pool.query.mock.calls[1]
    expect(upsertSql).toContain('ON CONFLICT (case_id, variant_id) DO UPDATE')
    expect(upsertSql).toContain('"public"."case_variant_annotations"')
    expect(upsertParams).toStrictEqual([2, 3, 'updated', 0, null, null, true, true, false, false])
  })

  it('deletes per-case annotations by case and variant id', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await repository.deletePerCaseAnnotation(2, 3)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."case_variant_annotations"'),
      [2, 3]
    )
  })

  it('gets global and per-case annotations for a case variant', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: '3' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '4',
            chr: '1',
            pos: '12345',
            ref: 'A',
            alt: 'G',
            global_comment: 'global',
            starred: '1',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '5',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'case',
            starred: '0',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(repository.getAnnotationsForVariant(2, '1', 12345, 'A', 'G')).resolves.toEqual({
      global: expect.objectContaining({ id: 4, starred: 1 }),
      perCase: expect.objectContaining({ id: 5, variant_id: 3, starred: 0 })
    })
    expect(pool.query.mock.calls[0]).toEqual([
      expect.stringContaining('FROM "public"."variants"'),
      [2, '1', 12345, 'A', 'G']
    ])
  })

  it('batch gets annotations keyed by variant coordinate', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '4',
            chr: '1',
            pos: '12345',
            ref: 'A',
            alt: 'G',
            global_comment: 'global',
            starred: '1',
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            key_chr: '1',
            key_pos: '12345',
            key_ref: 'A',
            key_alt: 'G',
            id: '5',
            case_id: '2',
            variant_id: '3',
            per_case_comment: 'case',
            starred: false,
            acmg_classification: null,
            acmg_evidence: null,
            created_at: '1714060800000',
            updated_at: '1714060801000'
          }
        ]
      })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(
      repository.getBatch(2, [
        { chr: '1', pos: 12345, ref: 'A', alt: 'G' },
        { chr: '2', pos: 23456, ref: 'C', alt: 'T' }
      ])
    ).resolves.toStrictEqual({
      '1:12345:A:G': {
        global: expect.objectContaining({ id: 4, starred: 1 }),
        perCase: expect.objectContaining({ id: 5, starred: 0 })
      },
      '2:23456:C:T': {
        global: null,
        perCase: null
      }
    })
    expect(pool.query).toHaveBeenCalledTimes(2)
  })

  it('returns null batch per-case annotations when case id is null', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresAnnotationsRepository(pool, 'public')

    await expect(
      repository.getBatch(null, [{ chr: '1', pos: 12345, ref: 'A', alt: 'G' }])
    ).resolves.toStrictEqual({
      '1:12345:A:G': { global: null, perCase: null }
    })
    expect(pool.query).toHaveBeenCalledTimes(1)
  })
})
