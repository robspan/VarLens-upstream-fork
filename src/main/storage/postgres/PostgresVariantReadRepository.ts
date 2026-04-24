import type { Pool } from 'pg'

import { quoteIdentifier } from './identifiers'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  return 0
}

function toPrefixTsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z0-9_]/g, ''))
    .filter((token) => token.length > 0)
    .map((token) => `${token}:*`)
    .join(' & ')
}

export const toPrefixTsQueryForTest = toPrefixTsQuery

export class PostgresVariantReadRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async getVariantTypeCounts(caseId: number): Promise<Record<string, number>> {
    const result = await this.pool.query(
      `SELECT variant_type, COUNT(*)::int AS count
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
       GROUP BY variant_type
       ORDER BY variant_type`,
      [caseId]
    )
    const counts: Record<string, number> = {}
    for (const row of result.rows as Array<{ variant_type: string; count: unknown }>) {
      counts[row.variant_type] = toNumber(row.count)
    }
    return counts
  }

  async getVariantTypesPresent(
    scope: { caseId: number } | { caseIds: number[] }
  ): Promise<string[]> {
    const caseIds = 'caseId' in scope ? [scope.caseId] : scope.caseIds
    if (caseIds.length === 0) return []
    const result =
      caseIds.length === 1
        ? await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = $1 AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds[0]]
          )
        : await this.pool.query(
            `SELECT DISTINCT variant_type FROM ${this.schemaName}."variants" WHERE case_id = ANY($1::bigint[]) AND variant_type IS NOT NULL ORDER BY variant_type`,
            [caseIds]
          )
    return (result.rows as Array<{ variant_type: string }>).map((row) => row.variant_type)
  }

  async getGeneSymbols(caseId: number, query: string, limit: number): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT gene_symbol
       FROM ${this.schemaName}."variants"
       WHERE case_id = $1
         AND gene_symbol IS NOT NULL
         AND gene_symbol ILIKE $2
       ORDER BY gene_symbol
       LIMIT $3`,
      [caseId, `${query}%`, limit]
    )
    return (result.rows as Array<{ gene_symbol: string }>).map((row) => row.gene_symbol)
  }
}
