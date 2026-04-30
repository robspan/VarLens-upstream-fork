#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/postgres-query')

const REQUIRED_REPORT_FIELDS = [
  ['generatedAt', 'string'],
  ['postgresVersion', 'string'],
  ['fixture', 'string'],
  ['caseCount', 'number'],
  ['variantCount', 'number']
]

const REQUIRED_QUERY_FIELDS = [
  ['name', 'string'],
  ['p50Ms', 'number'],
  ['p95Ms', 'number'],
  ['maxMs', 'number'],
  ['rows', 'number'],
  ['budgetP95Ms', 'number'],
  ['budgetStatus', 'string']
]

export function validatePostgresQueryPerfReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('postgres query perf report must be an object')
  }

  for (const [field, type] of REQUIRED_REPORT_FIELDS) {
    assertFieldType(report, field, type)
  }

  if (!Array.isArray(report.queries)) {
    throw new Error('postgres query perf report queries must be an array')
  }

  for (const [index, query] of report.queries.entries()) {
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
      throw new Error(`postgres query perf report queries[${index}] must be an object`)
    }

    for (const [field, type] of REQUIRED_QUERY_FIELDS) {
      assertFieldType(query, field, type, `queries[${index}].`)
    }
    if (
      query.budgetStatus !== 'pass' &&
      query.budgetStatus !== 'fail' &&
      query.budgetStatus !== 'unavailable'
    ) {
      throw new Error(
        `postgres query perf report queries[${index}].budgetStatus must be pass, fail, or unavailable`
      )
    }
  }

  return report
}

export function buildPostgresQueryPerfReport({
  generatedAt = new Date().toISOString(),
  postgresVersion,
  fixture,
  caseCount,
  variantCount,
  queries
}) {
  return validatePostgresQueryPerfReport({
    generatedAt,
    postgresVersion,
    fixture,
    caseCount,
    variantCount,
    queries
  })
}

export function writePostgresQueryPerfReport(report, artifactDir = ARTIFACT_DIR) {
  const validReport = validatePostgresQueryPerfReport(report)
  mkdirSync(artifactDir, { recursive: true })
  const filename = `${safeTimestampForFilename(validReport.generatedAt)}-postgres-query.json`
  const path = resolve(artifactDir, filename)
  writeFileSync(path, `${JSON.stringify(validReport, null, 2)}\n`)
  return path
}

export function listJsonArtifacts(artifactDir = ARTIFACT_DIR) {
  if (!existsSync(artifactDir)) {
    return []
  }

  return readdirSync(artifactDir)
    .filter((name) => name.endsWith('-postgres-query.json'))
    .sort()
}

function assertFieldType(object, field, type, prefix = '') {
  if (!(field in object)) {
    throw new Error(`postgres query perf report missing ${prefix}${field}`)
  }

  const value = object[field]
  if (typeof value !== type) {
    throw new Error(`postgres query perf report ${prefix}${field} must be a ${type}`)
  }

  if (type === 'number' && !Number.isFinite(value)) {
    throw new Error(`postgres query perf report ${prefix}${field} must be finite`)
  }

  if (type === 'string' && value.trim() === '') {
    throw new Error(`postgres query perf report ${prefix}${field} must not be empty`)
  }
}

function safeTimestampForFilename(value) {
  const normalized = value.replace(/[:.]/g, '-').replace(/[^A-Za-z0-9TZ_-]/g, '-')
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '')
  const filename = basename(collapsed)

  if (filename === '') {
    throw new Error('postgres query perf report generatedAt cannot produce a safe filename')
  }

  return filename
}

function listLegacyMarkdownArtifacts(artifactDir = ARTIFACT_DIR) {
  if (!existsSync(artifactDir)) {
    return []
  }

  return readdirSync(artifactDir)
    .filter((name) => name.endsWith('-postgres-query.md'))
    .sort()
}

function readJsonArtifact(filename, artifactDir = ARTIFACT_DIR) {
  const report = JSON.parse(readFileSync(resolve(artifactDir, filename), 'utf8'))
  return validatePostgresQueryPerfReport(report)
}

function queryMetricsByName(report) {
  return Object.fromEntries(report.queries.map((query) => [query.name, query]))
}

function formatRatio(previousMs, currentMs) {
  if (previousMs === undefined || previousMs === 0) {
    return 'n/a'
  }
  return (currentMs / previousMs).toFixed(2)
}

function compareJsonArtifacts(previous, current) {
  const previousReport = readJsonArtifact(previous)
  const currentReport = readJsonArtifact(current)
  const previousQueries = queryMetricsByName(previousReport)

  globalThis.console.log(`# PostgreSQL Query Perf Comparison\n`)
  globalThis.console.log(`Previous: ${previous}`)
  globalThis.console.log(`Current: ${current}\n`)
  globalThis.console.log(
    `Current fixture: ${currentReport.fixture}, cases: ${currentReport.caseCount}, variants: ${currentReport.variantCount}`
  )
  globalThis.console.log(`Current PostgreSQL: ${currentReport.postgresVersion}\n`)
  globalThis.console.log(
    '| Query | previous p50 ms | current p50 ms | p95 ms | max ms | rows | p50 ratio |'
  )
  globalThis.console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')

  for (const query of currentReport.queries) {
    const previousQuery = previousQueries[query.name]
    const previousLabel = previousQuery?.p50Ms.toFixed(2) ?? 'n/a'
    globalThis.console.log(
      `| ${query.name} | ${previousLabel} | ${query.p50Ms.toFixed(2)} | ${query.p95Ms.toFixed(
        2
      )} | ${query.maxMs.toFixed(2)} | ${query.rows} | ${formatRatio(
        previousQuery?.p50Ms,
        query.p50Ms
      )} |`
    )
  }
}

function main() {
  const jsonFiles = listJsonArtifacts()
  if (jsonFiles.length >= 2) {
    const previous = jsonFiles.at(-2)
    const current = jsonFiles.at(-1)
    compareJsonArtifacts(previous, current)
    return
  }

  const markdownFiles = listLegacyMarkdownArtifacts()
  if (markdownFiles.length > 0) {
    globalThis.console.log(
      'Legacy markdown postgres query artifacts were found. Rerun the benchmark to generate JSON artifacts with p50Ms, p95Ms, and maxMs.'
    )
    return
  }

  if (!existsSync(ARTIFACT_DIR)) {
    globalThis.console.log(
      `No artifact directory at ${ARTIFACT_DIR}. Run the postgres query perf benchmark first.`
    )
    return
  }

  globalThis.console.log('Need at least two postgres query artifacts to compare.')
  if (jsonFiles.length === 1) {
    globalThis.console.log('Found one JSON artifact; run the benchmark again to compare.')
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
