import type { Pool } from 'pg'

export interface QueryBenchmarkCase {
  name: string
  sql: string
  params: unknown[]
}

export interface QueryBenchmarkResult {
  name: string
  elapsedMs: number
  rowCount: number
  explain?: string
}

export async function runPostgresQueryBenchmark(
  pool: Pick<Pool, 'query'>,
  queryCase: QueryBenchmarkCase,
  explain: boolean
): Promise<QueryBenchmarkResult> {
  const startedAt = performance.now()
  const result = await pool.query(queryCase.sql, queryCase.params)
  const elapsedMs = performance.now() - startedAt
  let explainText: string | undefined

  if (explain) {
    const explainResult = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS) ${queryCase.sql}`,
      queryCase.params
    )
    explainText = explainResult.rows
      .map((row: Record<string, unknown>) => String(row['QUERY PLAN']))
      .join('\n')
  }

  return { name: queryCase.name, elapsedMs, rowCount: result.rows.length, explain: explainText }
}
