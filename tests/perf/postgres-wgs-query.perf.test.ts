import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  runPostgresQueryBenchmark,
  type QueryBenchmarkCase,
  type QueryBenchmarkResult
} from '../../src/main/storage/postgres/postgres-query-benchmark'
import { buildPostgresVariantQueryParts } from '../../src/main/storage/postgres/PostgresVariantReadRepository'
import { quoteIdentifier } from '../../src/main/storage/postgres/identifiers'
import type { VariantFilter } from '../../src/shared/types/database'

const SHOULD_RUN = process.env.VARLENS_RUN_WGS_QUERY_PERF === '1'
const EXPLAIN = process.env.VARLENS_PG_QUERY_EXPLAIN === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const PG_SCHEMA = process.env.VARLENS_PG_SCHEMA ?? 'public'
const SCHEMA_NAME = quoteIdentifier(PG_SCHEMA)
const ARTIFACT_DIR = resolve('.planning/artifacts/perf/postgres-query')

function artifactPath(): string {
  return resolve(
    ARTIFACT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-postgres-query.md`
  )
}

function markdownForResults(results: QueryBenchmarkResult[]): string {
  const lines = [
    '# PostgreSQL WGS Query Perf',
    '',
    `Date: ${new Date().toISOString()}`,
    `Postgres URL: ${redactConnectionString(PG_URL)}`,
    `Schema: ${PG_SCHEMA}`,
    '',
    '| Query | ms | rows |',
    '| --- | ---: | ---: |'
  ]

  for (const result of results) {
    lines.push(`| ${result.name} | ${result.elapsedMs.toFixed(2)} | ${result.rowCount} |`)
  }

  for (const result of results) {
    if (result.explain !== undefined) {
      lines.push('', `## ${result.name} EXPLAIN`, '', '```text', result.explain, '```')
    }
  }

  return lines.join('\n')
}

function appDataQuery(name: string, filter: VariantFilter, limit = 100): QueryBenchmarkCase {
  const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
    filter,
    SCHEMA_NAME
  )
  const dataParams = [...params, limit, 0]
  return {
    name,
    sql: `SELECT ${projections.join(', ')}
      ${fromAndWhereSql}
      ${orderBySql}
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}`,
    params: dataParams
  }
}

function appCountQuery(name: string, filter: VariantFilter): QueryBenchmarkCase {
  const { fromAndWhereSql, params } = buildPostgresVariantQueryParts(filter, SCHEMA_NAME)
  return {
    name,
    sql: `SELECT COUNT(*)::int AS count ${fromAndWhereSql}`,
    params
  }
}

function redactConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    if (url.password !== '') url.password = '<redacted>'
    return url.toString()
  } catch {
    return '<unparseable>'
  }
}

describe.skipIf(!SHOULD_RUN)('postgres WGS query perf', () => {
  it('records representative query timings', async () => {
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const caseResult = await pool.query(
        `SELECT id FROM ${SCHEMA_NAME}."cases" ORDER BY variant_count DESC LIMIT 1`
      )
      const caseId = Number(caseResult.rows[0]?.id)
      expect(caseId).toBeGreaterThan(0)

      const baseFilter: VariantFilter = { case_id: caseId }
      const queries: QueryBenchmarkCase[] = [
        appDataQuery('first-page-data', baseFilter),
        appCountQuery('first-page-count', baseFilter),
        appDataQuery('skip-count-first-page', baseFilter),
        appDataQuery('gene-filter', { ...baseFilter, gene_symbol: 'BRCA' }),
        appDataQuery('consequence-filter', { ...baseFilter, consequence: 'HIGH' }),
        appDataQuery('af-cadd-filter', { ...baseFilter, gnomad_af_max: 0.01, cadd_min: 20 }),
        appDataQuery('clinvar-filter', {
          ...baseFilter,
          clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']
        }),
        appDataQuery('region-filter', {
          ...baseFilter,
          chr: '22',
          panel_intervals: [{ chr: '22', start: 29_000_000, end: 30_500_000 }]
        }),
        appDataQuery('search-query', { ...baseFilter, search_query: 'BRCA1' })
      ]

      const results = []
      for (const query of queries) {
        results.push(await runPostgresQueryBenchmark(pool, query, EXPLAIN))
      }

      mkdirSync(ARTIFACT_DIR, { recursive: true })
      writeFileSync(artifactPath(), markdownForResults(results))
    } finally {
      await pool.end()
    }
  }, 600_000)
})
