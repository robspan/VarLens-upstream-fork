import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT_URL = pathToFileURL(resolve('scripts/perf/compare-postgres-query.mjs')).href
const SCRIPT_PATH = resolve('scripts/perf/compare-postgres-query.mjs')

type PostgresQueryPerfReport = {
  generatedAt: string
  postgresVersion: string
  fixture: string
  caseCount: number
  variantCount: number
  queries: Array<{
    name: string
    p50Ms: number
    p95Ms: number
    maxMs: number
    rows: number
    budgetP95Ms: number
    budgetStatus: string
  }>
}

const validReport: PostgresQueryPerfReport = {
  generatedAt: '2026-04-30T00:00:00.000Z',
  postgresVersion: 'PostgreSQL 17.4',
  fixture: 'tests/.cache/wgs/HG002.vcf.gz',
  caseCount: 1,
  variantCount: 123,
  queries: [
    {
      name: 'first-page-data',
      p50Ms: 12.3,
      p95Ms: 20.4,
      maxMs: 25.6,
      rows: 100,
      budgetP95Ms: 100,
      budgetStatus: 'pass'
    }
  ]
}

describe('postgres query perf report validation', () => {
  it('accepts valid report construction', async () => {
    const { buildPostgresQueryPerfReport } = await import(SCRIPT_URL)

    expect(buildPostgresQueryPerfReport(validReport)).toEqual(validReport)
  })

  it('rejects missing p50Ms, p95Ms, and query names', async () => {
    const { validatePostgresQueryPerfReport } = await import(SCRIPT_URL)

    expect(() =>
      validatePostgresQueryPerfReport({
        ...validReport,
        queries: [
          {
            name: 'first-page-data',
            p95Ms: 20.4,
            maxMs: 25.6,
            rows: 100,
            budgetP95Ms: 100,
            budgetStatus: 'pass'
          }
        ]
      })
    ).toThrow(/queries\[0\]\.p50Ms/)

    expect(() =>
      validatePostgresQueryPerfReport({
        ...validReport,
        queries: [
          {
            name: 'first-page-data',
            p50Ms: 12.3,
            maxMs: 25.6,
            rows: 100,
            budgetP95Ms: 100,
            budgetStatus: 'pass'
          }
        ]
      })
    ).toThrow(/queries\[0\]\.p95Ms/)

    expect(() =>
      validatePostgresQueryPerfReport({
        ...validReport,
        queries: [
          {
            p50Ms: 12.3,
            p95Ms: 20.4,
            maxMs: 25.6,
            rows: 100,
            budgetP95Ms: 100,
            budgetStatus: 'pass'
          }
        ]
      })
    ).toThrow(/queries\[0\]\.name/)
  })

  it('rejects missing or invalid budget metadata', async () => {
    const { validatePostgresQueryPerfReport } = await import(SCRIPT_URL)

    expect(() =>
      validatePostgresQueryPerfReport({
        ...validReport,
        queries: [
          {
            name: 'first-page-data',
            p50Ms: 12.3,
            p95Ms: 20.4,
            maxMs: 25.6,
            rows: 100,
            budgetStatus: 'pass'
          }
        ]
      })
    ).toThrow(/queries\[0\]\.budgetP95Ms/)

    expect(() =>
      validatePostgresQueryPerfReport({
        ...validReport,
        queries: [
          {
            name: 'first-page-data',
            p50Ms: 12.3,
            p95Ms: 20.4,
            maxMs: 25.6,
            rows: 100,
            budgetP95Ms: 100,
            budgetStatus: 'maybe'
          }
        ]
      })
    ).toThrow(/queries\[0\]\.budgetStatus/)
  })

  it('writes reports with a safe artifact basename', async () => {
    const { writePostgresQueryPerfReport } = await import(SCRIPT_URL)
    const artifactDir = mkdtempSync(join(tmpdir(), 'varlens-pg-query-report-'))

    const path = writePostgresQueryPerfReport(
      {
        ...validReport,
        generatedAt: '../2026/04/30T00:00:00.000Z'
      },
      artifactDir
    )

    expect(dirname(path)).toBe(artifactDir)
    expect(basename(path)).toMatch(/^[A-Za-z0-9TZ_-]+-postgres-query\.json$/u)
    expect(readFileSync(path, 'utf8')).toContain('"p95Ms": 20.4')
  })

  it('rejects malformed JSON artifacts when comparing JSON reports', async () => {
    const { writePostgresQueryPerfReport } = await import(SCRIPT_URL)
    const repoRoot = mkdtempSync(join(tmpdir(), 'varlens-pg-query-malformed-'))
    const artifactDir = join(repoRoot, '.planning/artifacts/perf/postgres-query')
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(
      join(artifactDir, '2026-04-30T00-00-00-postgres-query.json'),
      `${JSON.stringify(validReport)}\n`
    )
    writeFileSync(join(artifactDir, '2026-04-30T00-00-01-postgres-query.json'), '{')

    expect(() => writePostgresQueryPerfReport(validReport, artifactDir)).not.toThrow()

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('SyntaxError')
  })

  it('tells CLI users to regenerate JSON when only legacy markdown artifacts exist', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'varlens-pg-query-cli-'))
    const targetDir = join(repoRoot, '.planning/artifacts/perf/postgres-query')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(
      join(targetDir, '2026-04-30T00-00-00-postgres-query.md'),
      '| Query | ms | rows |\n| --- | ---: | ---: |\n| first-page-data | 1.00 | 100 |\n'
    )

    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: repoRoot,
      encoding: 'utf8'
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Legacy markdown postgres query artifacts were found')
    expect(result.stdout).toContain('Rerun the benchmark to generate JSON artifacts')
    expect(result.stdout).not.toContain('| Query | previous ms | current ms | ratio |')
  })
})
