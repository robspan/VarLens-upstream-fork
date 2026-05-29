#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const console = globalThis.console

/**
 * Sprint A PR-2 Gate 6 — named-statement coverage gate.
 *
 * Launches the packaged renderer via Playwright `_electron` with
 * VARLENS_DEBUG_QUERY_COUNTERS=1, resets the proxy counters
 * (src/main/storage/postgres/query-counters.ts), runs a scripted exercise
 * (cases ×10, page-flip ×20, cohort ×3), reads debug:queryCounters:get, then
 * computes coverage = sum(top-20 named) / (sum(named) + unnamed). Exits
 * non-zero below the 80% floor.
 *
 * No pg_stat_statements dependency — counters come entirely from the in-process
 * pool proxy (Pass-7 MED #3).
 *
 * TOP_20_LOGICAL_NAMES are the logical-portion prefixes of the names committed
 * across PR2-5/6/7 (runNamed `name:` and runNamedDynamic `baseName:` args).
 * Effective names carry an `@${schemaToken}` suffix; runNamedDynamic names also
 * carry a `:t<sha1-8>` text-hash tail. The matcher below handles both shapes.
 */
const TOP_20_LOGICAL_NAMES = [
  // runNamed (static SQL) — effective name = `${name}@${schemaToken}`
  'overview:total_cases:v1',
  'overview:total_variants:v1',
  'overview:unique_variants:v1',
  'overview:genes_with_variants:v1',
  'variants:type_counts:v1',
  'variants:gene_symbols:v1',
  'annotations:upsert_global:v1',
  'annotations:upsert_per_case:v1',
  'annotations:delete_global:v1',
  'annotations:delete_per_case:v1',
  'annotations:get_batch_global:v1',
  'annotations:get_batch_per_case:v1',
  'cases:list_all:v1',
  'cases:count_all:v1',
  'filter_presets:list:v1',
  'filter_presets:create:v1',
  // runNamedDynamic (dynamic SQL) — effective name = `${baseName}:t<hash>@${schemaToken}`
  'variants:query_count',
  'variants:query_page',
  'variants:types_present',
  'variants:column_meta'
]

const ARTIFACT_DIR = '.planning/artifacts/perf/postgres-named-coverage'
const COVERAGE_FLOOR = 0.8

function inTop20(effectiveName) {
  return TOP_20_LOGICAL_NAMES.some(
    (logical) =>
      effectiveName === logical ||
      effectiveName.startsWith(`${logical}@`) ||
      effectiveName.startsWith(`${logical}:t`)
  )
}

async function exercise(window) {
  // navigate cases ×10
  for (let i = 0; i < 10; i++) {
    await window.click(`[data-test="case-list-item"]:nth-child(${(i % 8) + 1})`)
    await window.waitForLoadState('networkidle')
  }
  // page-flip ×20
  for (let i = 0; i < 20; i++) {
    await window.click('[data-test="page-next"]')
    await window.waitForTimeout(100)
  }
  // open cohort view ×3
  for (let i = 0; i < 3; i++) {
    await window.click('[data-test="cohort-view-link"]')
    await window.waitForLoadState('networkidle')
    await window.goBack()
  }
}

async function main() {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, VARLENS_DEBUG_QUERY_COUNTERS: '1' }
  })
  const window = await app.firstWindow()

  await window.evaluate(() => window.api.debug.queryCountersReset())

  await exercise(window)

  const result = await window.evaluate(() => window.api.debug.queryCountersGet())
  await app.close()

  const named = result?.named ?? {}
  const unnamed = result?.unnamed ?? 0

  let top20Sum = 0
  let totalNamed = 0
  for (const [eff, n] of Object.entries(named)) {
    totalNamed += n
    if (inTop20(eff)) top20Sum += n
  }
  const denom = totalNamed + unnamed
  const coverage = denom === 0 ? 0 : top20Sum / denom

  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const artifact = {
    capturedAt: new Date().toISOString(),
    coverage,
    coverageFloor: COVERAGE_FLOOR,
    pass: coverage >= COVERAGE_FLOOR,
    top20Sum,
    totalNamed,
    unnamed,
    counters: named
  }
  const path = join(ARTIFACT_DIR, `coverage-${ts}.json`)
  writeFileSync(path, JSON.stringify(artifact, null, 2))

  console.log(JSON.stringify(artifact, null, 2))
  console.log(`Artifact: ${path}`)

  if (coverage < COVERAGE_FLOOR) {
    console.error(
      `::error::named-statement coverage ${(coverage * 100).toFixed(1)}% < floor ${(COVERAGE_FLOOR * 100).toFixed(0)}%`
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
