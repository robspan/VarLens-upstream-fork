import type { Pool, PoolClient } from 'pg'

import { quoteIdentifier } from './identifiers'

type TransactionClient = Pick<PoolClient, 'query' | 'release'>

export class PostgresCaseLifecycleRepository {
  private readonly schemaName: string

  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async deleteCase(caseId: number): Promise<void> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM ${this.schemaName}."cases" WHERE id = $1`, [caseId])
      await this.rebuildVariantFrequency(client)
      await client.query('COMMIT')
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original transaction failure for callers.
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async rebuildVariantFrequency(client: TransactionClient): Promise<void> {
    await client.query(`TRUNCATE ${this.schemaName}."variant_frequency"`)
    await client.query(`
      INSERT INTO ${this.schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
      SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id)::bigint
      FROM ${this.schemaName}."variants"
      GROUP BY chr, pos, ref, alt
    `)
  }
}
