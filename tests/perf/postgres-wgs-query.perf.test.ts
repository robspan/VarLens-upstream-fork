import { basename, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import {
  runPostgresQueryBenchmark,
  type QueryBenchmarkCase
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
const FIXTURE =
  process.env.VARLENS_WGS_FIXTURE ??
  'tests/.cache/wgs/HG002_GRCh38_1_22_v4.2.1_benchmark.vcf.gz'
const REPORT_SCRIPT_URL = pathToFileURL(resolve('scripts/perf/compare-postgres-query.mjs')).href
const BENCHMARK_ITERATIONS = 5

interface BudgetedBenchmarkCase extends QueryBenchmarkCase {
  budgetP95Ms: number
  representative: boolean
}

interface QueryReport {
  name: string
  p50Ms: number
  p95Ms: number
  maxMs: number
  rows: number
  budgetP95Ms: number
  budgetStatus: 'pass' | 'fail' | 'unavailable'
  representative: boolean
  explain?: string
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1
  )
  return sorted[index] ?? 0
}

function appDataQuery(
  name: string,
  filter: VariantFilter,
  budgetP95Ms: number,
  limit = 100,
  representative = true
): BudgetedBenchmarkCase {
  const { fromAndWhereSql, orderBySql, params, projections } = buildPostgresVariantQueryParts(
    filter,
    SCHEMA_NAME
  )
  const dataParams = [...params, limit, 0]
  return {
    name,
    budgetP95Ms,
    representative,
    sql: `SELECT ${projections.join(', ')}
      ${fromAndWhereSql}
      ${orderBySql}
      LIMIT $${dataParams.length - 1}
      OFFSET $${dataParams.length}`,
    params: dataParams
  }
}

function cohortCarrierQuery(budgetP95Ms: number): BudgetedBenchmarkCase {
  return {
    name: 'cohort carrier query',
    budgetP95Ms,
    representative: true,
    sql: `SELECT
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        MAX(v.gene_symbol) AS gene_symbol,
        COUNT(DISTINCT v.case_id)::int AS carrier_count
      FROM ${SCHEMA_NAME}."variants" v
      GROUP BY v.chr, v.pos, v.ref, v.alt
      HAVING COUNT(DISTINCT v.case_id) >= $1
      ORDER BY carrier_count DESC, v.chr ASC, v.pos ASC
      LIMIT $2`,
    params: [1, 100]
  }
}

async function runBudgetedBenchmark(
  pool: Pool,
  queryCase: BudgetedBenchmarkCase
): Promise<QueryReport> {
  const timings: number[] = []
  let rows = 0
  let explain: string | undefined

  for (let index = 0; index < BENCHMARK_ITERATIONS; index += 1) {
    const result = await runPostgresQueryBenchmark(pool, queryCase, EXPLAIN && index === 0)
    timings.push(result.elapsedMs)
    rows = result.rowCount
    explain ??= result.explain
  }

  const p95Ms = percentile(timings, 95)
  return {
    name: queryCase.name,
    p50Ms: percentile(timings, 50),
    p95Ms,
    maxMs: Math.max(...timings),
    rows,
    budgetP95Ms: queryCase.budgetP95Ms,
    budgetStatus:
      queryCase.representative && rows > 0
        ? p95Ms <= queryCase.budgetP95Ms
          ? 'pass'
          : 'fail'
        : 'unavailable',
    representative: queryCase.representative && rows > 0,
    ...(explain !== undefined ? { explain } : {})
  }
}

function fixtureIdentity(): string {
  const resolved = resolve(FIXTURE)
  const repoRelative = relative(process.cwd(), resolved)
  if (!repoRelative.startsWith('..')) {
    return repoRelative
  }
  return basename(resolved)
}

async function writeReport(report: {
  generatedAt: string
  postgresVersion: string
  fixture: string
  caseCount: number
  variantCount: number
  queries: QueryReport[]
}): Promise<string> {
  const module = (await import(REPORT_SCRIPT_URL)) as {
    buildPostgresQueryPerfReport: (input: typeof report) => typeof report
    writePostgresQueryPerfReport: (input: typeof report) => string
  }
  return module.writePostgresQueryPerfReport(module.buildPostgresQueryPerfReport(report))
}

describe.skipIf(!SHOULD_RUN)('postgres WGS query perf', () => {
  it('records representative query timings', async () => {
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const postgresVersionResult = await pool.query<{ version: string }>(
        'SELECT version() AS version'
      )
      const countResult = await pool.query<{ case_count: string; variant_count: string }>(
        `SELECT
            (SELECT COUNT(*) FROM ${SCHEMA_NAME}."cases")::text AS case_count,
            (SELECT COUNT(*) FROM ${SCHEMA_NAME}."variants")::text AS variant_count`
      )
      const caseResult = await pool.query<{ id: string }>(
        `SELECT id FROM ${SCHEMA_NAME}."cases" ORDER BY variant_count DESC LIMIT 1`
      )
      const coordinateResult = await pool.query<{
        chr: string
        pos: string
        ref: string
        alt: string
      }>(
        `SELECT chr, pos::text, ref, alt
         FROM ${SCHEMA_NAME}."variants"
         WHERE case_id = $1
         ORDER BY pos ASC
         LIMIT 1`,
        [caseResult.rows[0]?.id]
      )

      const caseId = Number(caseResult.rows[0]?.id)
      expect(caseId).toBeGreaterThan(0)
      expect(coordinateResult.rows[0]).toBeDefined()

      const baseFilter: VariantFilter = { case_id: caseId }
      const coordinate = coordinateResult.rows[0]
      const queries: BudgetedBenchmarkCase[] = [
        appDataQuery(
          'exact coordinate lookup',
          {
            ...baseFilter,
            chr: coordinate.chr,
            pos: Number(coordinate.pos),
            ref: coordinate.ref,
            alt: coordinate.alt
          },
          250,
          100,
          true
        ),
        appDataQuery('gene query', { ...baseFilter, gene_symbol: 'BRCA' }, 1500, 100, false),
        appDataQuery(
          'impact/pathogenicity filter',
          {
            ...baseFilter,
            consequences: ['HIGH', 'MODERATE'],
            clinvars: ['Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic']
          },
          2500,
          100,
          false
        ),
        appDataQuery('text search', { ...baseFilter, search_query: 'BRCA1' }, 3000, 100, false),
        cohortCarrierQuery(5000)
      ]

      const results = []
      for (const query of queries) {
        results.push(await runBudgetedBenchmark(pool, query))
      }

      const reportPath = await writeReport({
        generatedAt: new Date().toISOString(),
        postgresVersion: postgresVersionResult.rows[0]?.version ?? 'unknown',
        fixture: fixtureIdentity(),
        caseCount: Number(countResult.rows[0]?.case_count ?? 0),
        variantCount: Number(countResult.rows[0]?.variant_count ?? 0),
        queries: results
      })

      expect(reportPath).toContain('-postgres-query.json')
    } finally {
      await pool.end()
    }
  }, 600_000)
})
