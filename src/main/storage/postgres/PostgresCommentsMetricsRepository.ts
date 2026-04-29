import type { Pool, QueryResult } from 'pg'

import { NotFoundError } from '../../database/errors'
import type { CommentCategory, MetricDefinition } from '../../../shared/types/database'
import type { MetricValue } from '../../../shared/types/api'
import { quoteIdentifier } from './identifiers'

type Queryable = Pick<Pool, 'query'>
type Row = Record<string, unknown>

const integerFields = new Set(['id', 'case_id', 'metric_id', 'created_at', 'updated_at'])

function normalizeRow<T extends Row>(row: T): Row {
  const normalized: Row = { ...row }
  for (const field of integerFields) {
    const value = normalized[field]
    if (typeof value === 'string') {
      normalized[field] = Number(value)
    }
  }
  return normalized
}

function firstNormalized<T extends Row>(result: QueryResult<T>): Row | null {
  const row = result.rows[0]
  return row === undefined ? null : normalizeRow(row)
}

function allNormalized<T extends Row>(result: QueryResult<T>): Row[] {
  return result.rows.map((row) => normalizeRow(row))
}

export class PostgresCommentsMetricsRepository {
  constructor(
    private readonly pool: Queryable,
    private readonly schema: string
  ) {}

  async listCaseComments(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT *
        FROM ${this.table('case_comments')}
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [caseId]
    )
    return allNormalized(result)
  }

  async createCaseComment(
    caseId: number,
    category: CommentCategory,
    content: string
  ): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_comments')} (case_id, category, content, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [caseId, category, content, Date.now()]
    )
    return firstNormalized(result)
  }

  async updateCaseComment(commentId: number, content: string): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        UPDATE ${this.table('case_comments')}
        SET content = $1, updated_at = $2
        WHERE id = $3
        RETURNING *
      `,
      [content, Date.now(), commentId]
    )
    const comment = firstNormalized(result)
    if (comment === null) {
      throw new NotFoundError('CaseComment', commentId)
    }
    return comment
  }

  async deleteCaseComment(commentId: number): Promise<void> {
    const result = await this.pool.query<Row>(
      `
        DELETE FROM ${this.table('case_comments')}
        WHERE id = $1
        RETURNING id
      `,
      [commentId]
    )
    if (result.rows[0] === undefined) {
      throw new NotFoundError('CaseComment', commentId)
    }
  }

  async listMetricDefinitions(): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT *
        FROM ${this.table('metric_definitions')}
        ORDER BY category, name
      `,
      []
    )
    return allNormalized(result)
  }

  async createMetricDefinition(
    name: string,
    valueType: MetricDefinition['value_type'],
    unit: string,
    category: string
  ): Promise<unknown> {
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('metric_definitions')} (
          name,
          value_type,
          unit,
          category,
          is_predefined,
          created_at
        )
        VALUES ($1, $2, $3, $4, 0, $5)
        RETURNING *
      `,
      [name, valueType, unit, category, Date.now()]
    )
    return firstNormalized(result)
  }

  async listCaseMetrics(caseId: number): Promise<unknown[]> {
    const result = await this.pool.query<Row>(
      `
        SELECT
          cm.*,
          md.name,
          md.value_type,
          md.unit,
          md.category AS metric_category
        FROM ${this.table('case_metrics')} cm
        INNER JOIN ${this.table('metric_definitions')} md ON md.id = cm.metric_id
        WHERE cm.case_id = $1
        ORDER BY md.category, md.name
      `,
      [caseId]
    )
    return allNormalized(result)
  }

  async upsertCaseMetric(caseId: number, metricId: number, value: MetricValue): Promise<unknown> {
    const now = Date.now()
    const result = await this.pool.query<Row>(
      `
        INSERT INTO ${this.table('case_metrics')} (
          case_id,
          metric_id,
          numeric_value,
          text_value,
          date_value,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (case_id, metric_id) DO UPDATE SET
          numeric_value = EXCLUDED.numeric_value,
          text_value = EXCLUDED.text_value,
          date_value = EXCLUDED.date_value,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        caseId,
        metricId,
        value.numeric_value ?? null,
        value.text_value ?? null,
        value.date_value ?? null,
        now
      ]
    )
    return firstNormalized(result)
  }

  async deleteCaseMetric(caseId: number, metricId: number): Promise<void> {
    await this.pool.query(
      `
        DELETE FROM ${this.table('case_metrics')}
        WHERE case_id = $1 AND metric_id = $2
      `,
      [caseId, metricId]
    )
  }

  private table(name: string): string {
    return `${quoteIdentifier(this.schema)}.${quoteIdentifier(name)}`
  }
}
