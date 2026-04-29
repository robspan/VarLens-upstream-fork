import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotFoundError } from '../../../src/main/database/errors'
import { PostgresCommentsMetricsRepository } from '../../../src/main/storage/postgres/PostgresCommentsMetricsRepository'

const makePool = () => ({
  query: vi.fn()
})

describe('PostgresCommentsMetricsRepository', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists case comments newest first and normalizes bigint fields', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '12',
          case_id: '3',
          category: 'Clinical Note',
          content: 'reviewed',
          created_at: '1776988800000',
          updated_at: null
        }
      ]
    })
    const repository = new PostgresCommentsMetricsRepository(pool, 'public')

    await expect(repository.listCaseComments(3)).resolves.toStrictEqual([
      {
        id: 12,
        case_id: 3,
        category: 'Clinical Note',
        content: 'reviewed',
        created_at: 1776988800000,
        updated_at: null
      }
    ])
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM "public"."case_comments"'),
      [3]
    )
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC')
  })

  it('creates, updates, and deletes case comments with DatabaseService metadata semantics', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            case_id: '4',
            category: 'Lab Result',
            content: 'WBC elevated',
            created_at: '1776988800000',
            updated_at: null
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            case_id: '4',
            category: 'Lab Result',
            content: 'WBC normalized',
            created_at: '1776988800000',
            updated_at: '1776988800000'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: '1' }] })
    const repository = new PostgresCommentsMetricsRepository(pool, 'public')

    await expect(
      repository.createCaseComment(4, 'Lab Result', 'WBC elevated')
    ).resolves.toMatchObject({
      id: 1,
      case_id: 4,
      category: 'Lab Result',
      content: 'WBC elevated',
      created_at: 1776988800000,
      updated_at: null
    })
    await expect(repository.updateCaseComment(1, 'WBC normalized')).resolves.toMatchObject({
      id: 1,
      case_id: 4,
      content: 'WBC normalized',
      updated_at: 1776988800000
    })
    await expect(repository.deleteCaseComment(1)).resolves.toBeUndefined()

    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO "public"."case_comments"'),
      [4, 'Lab Result', 'WBC elevated', 1776988800000]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE "public"."case_comments"'),
      ['WBC normalized', 1776988800000, 1]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DELETE FROM "public"."case_comments"'),
      [1]
    )
  })

  it('throws NotFoundError for missing comment updates and deletes', async () => {
    const pool = makePool()
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCommentsMetricsRepository(pool, 'public')

    await expect(repository.updateCaseComment(999, 'missing')).rejects.toThrow(NotFoundError)
    await expect(repository.deleteCaseComment(999)).rejects.toThrow(NotFoundError)
  })

  it('lists and creates metric definitions', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '5',
            name: 'Hemoglobin (Hb)',
            value_type: 'numeric',
            unit: 'g/dL',
            category: 'Hematology',
            is_predefined: 1,
            created_at: '1776988800000'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '6',
            name: 'Custom Score',
            value_type: 'numeric',
            unit: 'points',
            category: 'Custom',
            is_predefined: 0,
            created_at: '1776988800000'
          }
        ]
      })
    const repository = new PostgresCommentsMetricsRepository(pool, 'research"schema')

    await expect(repository.listMetricDefinitions()).resolves.toStrictEqual([
      {
        id: 5,
        name: 'Hemoglobin (Hb)',
        value_type: 'numeric',
        unit: 'g/dL',
        category: 'Hematology',
        is_predefined: 1,
        created_at: 1776988800000
      }
    ])
    await expect(
      repository.createMetricDefinition('Custom Score', 'numeric', 'points', 'Custom')
    ).resolves.toMatchObject({
      id: 6,
      name: 'Custom Score',
      is_predefined: 0,
      created_at: 1776988800000
    })

    expect(pool.query.mock.calls[0][0]).toContain('FROM "research""schema"."metric_definitions"')
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY category, name')
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO "research""schema"."metric_definitions"'),
      ['Custom Score', 'numeric', 'points', 'Custom', 1776988800000]
    )
  })

  it('lists, upserts, and deletes case metrics', async () => {
    const pool = makePool()
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '7',
            case_id: '4',
            metric_id: '5',
            numeric_value: 13.5,
            text_value: null,
            date_value: null,
            created_at: '1776988800000',
            updated_at: '1776988800000',
            name: 'Hemoglobin (Hb)',
            value_type: 'numeric',
            unit: 'g/dL',
            metric_category: 'Hematology'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '7',
            case_id: '4',
            metric_id: '5',
            numeric_value: null,
            text_value: 'European',
            date_value: null,
            created_at: '1776988800000',
            updated_at: '1776988800000'
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCommentsMetricsRepository(pool, 'public')

    await expect(repository.listCaseMetrics(4)).resolves.toStrictEqual([
      {
        id: 7,
        case_id: 4,
        metric_id: 5,
        numeric_value: 13.5,
        text_value: null,
        date_value: null,
        created_at: 1776988800000,
        updated_at: 1776988800000,
        name: 'Hemoglobin (Hb)',
        value_type: 'numeric',
        unit: 'g/dL',
        metric_category: 'Hematology'
      }
    ])
    await expect(
      repository.upsertCaseMetric(4, 5, { text_value: 'European' })
    ).resolves.toMatchObject({
      id: 7,
      case_id: 4,
      metric_id: 5,
      numeric_value: null,
      text_value: 'European',
      date_value: null
    })
    await expect(repository.deleteCaseMetric(4, 5)).resolves.toBeUndefined()

    expect(pool.query.mock.calls[0][0]).toContain(
      'INNER JOIN "public"."metric_definitions" md ON md.id = cm.metric_id'
    )
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY md.category, md.name')
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (case_id, metric_id) DO UPDATE'),
      [4, 5, null, 'European', null, 1776988800000]
    )
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DELETE FROM "public"."case_metrics"'),
      [4, 5]
    )
  })
})
