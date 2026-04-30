import type { Pool } from 'pg'

import type {
  AuditLogEntry,
  AuditActionType,
  AuditEntityType
} from '../../../shared/types/database'
import type { AuditAppendParams, AuditQueryParams, AuditQueryResult } from '../audit-log-types'
import { quoteIdentifier } from './identifiers'

type AuditRow = Record<string, unknown>

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function serializeAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function toAuditLogEntry(row: AuditRow): AuditLogEntry {
  return {
    id: toNumber(row.id),
    timestamp: toNumber(row.created_at ?? row.timestamp),
    action_type: String(row.action_type ?? '') as AuditActionType,
    entity_type: String(row.entity_type ?? '') as AuditEntityType,
    entity_key: String(row.entity_key ?? ''),
    old_value: toNullableString(row.old_value),
    new_value: toNullableString(row.new_value),
    user_name: toNullableString(row.user_name)
  }
}

export class PostgresAuditLogRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getByEntityKey(entityKey: string): Promise<AuditLogEntry[]> {
    const result = await this.pool.query<AuditRow>(
      `SELECT * FROM ${this.schemaName}."audit_log"
       WHERE entity_key = $1
       ORDER BY created_at ASC`,
      [entityKey]
    )
    return result.rows.map(toAuditLogEntry)
  }

  async query(params: AuditQueryParams): Promise<AuditQueryResult> {
    const { whereSql, values } = this.buildWhere(params)

    const countResult = await this.pool.query<{ total_count: unknown }>(
      `SELECT COUNT(*)::bigint AS total_count
       FROM ${this.schemaName}."audit_log"
       ${whereSql}`,
      values
    )

    const limit = params.limit ?? 100
    const offset = params.offset ?? 0
    const dataParams = [...values, limit, offset]
    const result = await this.pool.query<AuditRow>(
      `SELECT *
       FROM ${this.schemaName}."audit_log"
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    )

    return {
      data: result.rows.map(toAuditLogEntry),
      total_count: toNumber(countResult.rows[0]?.total_count)
    }
  }

  async append(params: AuditAppendParams): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schemaName}."audit_log" (
        action_type, entity_type, entity_key, old_value, new_value, user_name, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.action_type,
        params.entity_type,
        params.entity_key,
        serializeAuditValue(params.old_value),
        serializeAuditValue(params.new_value),
        params.user_name ?? null,
        serializeAuditValue(params.metadata)
      ]
    )
  }

  private buildWhere(params: AuditQueryParams): { whereSql: string; values: unknown[] } {
    const where: string[] = []
    const values: unknown[] = []
    const add = (value: unknown): string => {
      values.push(value)
      return `$${values.length}`
    }

    if (params.action_type !== undefined) where.push(`action_type = ${add(params.action_type)}`)
    if (params.entity_type !== undefined) where.push(`entity_type = ${add(params.entity_type)}`)
    if (params.entity_key !== undefined) where.push(`entity_key = ${add(params.entity_key)}`)
    if (params.from_timestamp !== undefined) {
      where.push(`created_at >= ${add(params.from_timestamp)}`)
    }
    if (params.to_timestamp !== undefined) {
      where.push(`created_at <= ${add(params.to_timestamp)}`)
    }

    return {
      whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      values
    }
  }
}
