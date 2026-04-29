import type { Pool, PoolClient } from 'pg'
import QueryStream from 'pg-query-stream'

import type { VariantFilter } from '../../../shared/types/database'
import { quoteIdentifier } from './identifiers'
import { buildPostgresVariantQueryParts } from './PostgresVariantReadRepository'

type ExportPool = Pick<Pool, 'connect'>
type ExportClient = Pick<PoolClient, 'query' | 'release'>

export class PostgresExportRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: ExportPool,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async *streamVariantRows(filter: VariantFilter): AsyncGenerator<Record<string, unknown>> {
    const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
      filter,
      this.schemaName
    )
    const client: ExportClient = await this.pool.connect()
    const stream = client.query(
      new QueryStream(
        `SELECT ${projections.join(', ')}
         ${fromAndWhereSql}
         ${orderBySql}`,
        params
      )
    ) as AsyncIterable<Record<string, unknown>>

    try {
      for await (const row of stream) {
        yield row
      }
    } finally {
      client.release()
    }
  }
}
