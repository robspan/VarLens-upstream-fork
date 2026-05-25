#!/usr/bin/env node
/**
 * Compare the most recent WGS import perf baselines for postgres and sqlite.
 *
 * Reads timestamped baseline reports written by
 *   tests/perf/postgres-vcf-wgs-import.perf.test.ts
 *   tests/perf/sqlite-vcf-wgs-import.perf.test.ts
 * from `.planning/artifacts/perf/wgs-import/<ts>-<backend>.md`. Picks the most
 * recent file per backend, computes the postgres / sqlite ratio, and writes a
 * comparison file alongside the baselines.
 *
 * Escalation rule (per Phase 9 spec): if postgres > 2× sqlite, open a follow-up
 * phase to switch the postgres path to COPY FROM STDIN via pg-copy-streams.
 *
 * Usage: node scripts/perf/compare-wgs-import.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/wgs-import')
const BUDGET = 2.0

function listBaselines() {
  let entries
  try {
    entries = readdirSync(ARTIFACT_DIR)
  } catch {
    globalThis.console.error(`No artifact directory at ${ARTIFACT_DIR}. Run the perf tests first.`)
    process.exit(1)
  }
  return entries.filter((f) => f.endsWith('.md') && !f.endsWith('-comparison.md'))
}

function latestForBackend(entries, backend) {
  const matches = entries.filter((f) => f.endsWith(`-${backend}.md`)).sort()
  return matches.at(-1)
}

function parseElapsed(filename) {
  const text = readFileSync(resolve(ARTIFACT_DIR, filename), 'utf8')
  const match = text.match(/elapsed:\s*([\d.]+)\s*s/)
  if (match === null) {
    throw new Error(`No elapsed line in ${filename}`)
  }
  return Number(match[1])
}

function main() {
  const entries = listBaselines()
  const pgFile = latestForBackend(entries, 'postgres')
  const sqliteFile = latestForBackend(entries, 'sqlite')

  if (pgFile === undefined || sqliteFile === undefined) {
    globalThis.console.error(
      `Need at least one postgres and one sqlite baseline artifact in ${ARTIFACT_DIR}`
    )
    globalThis.console.error(`Found postgres: ${String(pgFile)}, sqlite: ${String(sqliteFile)}`)
    process.exit(1)
  }

  const pg = parseElapsed(pgFile)
  const sqlite = parseElapsed(sqliteFile)
  const ratio = pg / sqlite
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const out = resolve(ARTIFACT_DIR, `${ts}-comparison.md`)

  const escalates = ratio > BUDGET
  const escalationLine = escalates
    ? `- escalation triggered: postgres / sqlite = ${ratio.toFixed(2)}× (> ${BUDGET.toFixed(1)}×). Open a follow-up phase to switch postgres to COPY FROM STDIN via pg-copy-streams.`
    : `- escalation rule: postgres / sqlite must stay ≤ ${BUDGET.toFixed(1)}×; current ratio is within budget.`

  writeFileSync(
    out,
    [
      `# WGS import comparison — ${ts}`,
      ``,
      `- postgres: ${pg.toFixed(2)}s (source: ${pgFile})`,
      `- sqlite:   ${sqlite.toFixed(2)}s (source: ${sqliteFile})`,
      `- ratio:    ${ratio.toFixed(2)}× (postgres / sqlite)`,
      escalationLine,
      ``
    ].join('\n')
  )
  globalThis.console.log(`Wrote ${out}`)
  if (escalates) {
    globalThis.console.error(
      `::error::WGS import budget breach: ratio ${ratio.toFixed(2)} exceeds budget ${BUDGET.toFixed(2)}`
    )
    process.exit(1)
  }
}

main()
