# PostgreSQL WGS Query Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible WGS-scale PostgreSQL query benchmarks before adding speculative indexes or import-speed experiments.

**Architecture:** Build an opt-in Vitest perf suite and a comparison script that runs representative variant queries, captures timings and optional `EXPLAIN (ANALYZE, BUFFERS)`, and writes artifacts under `.planning/artifacts/perf/postgres-query/`.

**Tech Stack:** Vitest, PostgreSQL, Node scripts, existing WGS fixture conventions.

---

## Files

- Create: `tests/perf/postgres-wgs-query.perf.test.ts`
- Create: `scripts/perf/compare-postgres-query.mjs`
- Create: `src/main/storage/postgres/postgres-query-benchmark.ts`
- Modify: `Makefile`
- Modify: `AGENTS.md`

## Task 1: Add benchmark helper

- [ ] **Step 1: Create helper**

Create `src/main/storage/postgres/postgres-query-benchmark.ts`:

```ts
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
    const explainResult = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${queryCase.sql}`, queryCase.params)
    explainText = explainResult.rows.map((row: Record<string, unknown>) => String(row['QUERY PLAN'])).join('\n')
  }

  return { name: queryCase.name, elapsedMs, rowCount: result.rows.length, explain: explainText }
}
```

- [ ] **Step 2: Add unit smoke test if desired**

Run: `npx vitest run tests/perf/postgres-wgs-query.perf.test.ts`

Expected before file exists: no test found. Continue to next task.

## Task 2: Add opt-in WGS query perf suite

- [ ] **Step 1: Write perf test**

Create `tests/perf/postgres-wgs-query.perf.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { runPostgresQueryBenchmark, type QueryBenchmarkCase } from '../../src/main/storage/postgres/postgres-query-benchmark'

const SHOULD_RUN = process.env.VARLENS_RUN_WGS_QUERY_PERF === '1'
const EXPLAIN = process.env.VARLENS_PG_QUERY_EXPLAIN === '1'
const PG_URL = process.env.VARLENS_PG_URL ?? 'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const ARTIFACT_DIR = resolve('.planning/artifacts/perf/postgres-query')

function artifactPath(): string {
  return resolve(ARTIFACT_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-postgres-query.md`)
}

describe.skipIf(!SHOULD_RUN)('postgres WGS query perf', () => {
  it('records representative query timings', async () => {
    const pool = new Pool({ connectionString: PG_URL, max: 2 })
    try {
      const caseResult = await pool.query('SELECT id FROM public.cases ORDER BY variant_count DESC LIMIT 1')
      const caseId = Number(caseResult.rows[0]?.id)
      expect(caseId).toBeGreaterThan(0)

      const queries: QueryBenchmarkCase[] = [
        { name: 'first-page', sql: 'SELECT * FROM public.variants WHERE case_id = $1 ORDER BY id LIMIT 100', params: [caseId] },
        { name: 'count', sql: 'SELECT COUNT(*)::int FROM public.variants WHERE case_id = $1', params: [caseId] },
        { name: 'gene-filter', sql: 'SELECT * FROM public.variants WHERE case_id = $1 AND gene_symbol ILIKE $2 LIMIT 100', params: [caseId, 'BRCA%'] },
        { name: 'consequence-filter', sql: 'SELECT * FROM public.variants WHERE case_id = $1 AND consequence = $2 LIMIT 100', params: [caseId, 'HIGH'] },
        { name: 'search-query', sql: "SELECT * FROM public.variants WHERE case_id = $1 AND search_document @@ to_tsquery('simple', $2) LIMIT 100", params: [caseId, 'BRCA1:*'] }
      ]

      const results = []
      for (const query of queries) {
        results.push(await runPostgresQueryBenchmark(pool, query, EXPLAIN))
      }

      mkdirSync(ARTIFACT_DIR, { recursive: true })
      const lines = ['# PostgreSQL WGS Query Perf', '', `Date: ${new Date().toISOString()}`, '', '| Query | ms | rows |', '| --- | ---: | ---: |']
      for (const result of results) lines.push(`| ${result.name} | ${result.elapsedMs.toFixed(2)} | ${result.rowCount} |`)
      for (const result of results) {
        if (result.explain) lines.push('', `## ${result.name} EXPLAIN`, '', '```text', result.explain, '```')
      }
      writeFileSync(artifactPath(), lines.join('\n'))
    } finally {
      await pool.end()
    }
  }, 600_000)
})
```

- [ ] **Step 2: Run opt-in perf locally**

Run: `VARLENS_RUN_WGS_QUERY_PERF=1 VARLENS_PG_QUERY_EXPLAIN=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts`

Expected: PASS and writes a markdown artifact when local PostgreSQL contains a WGS case.

## Task 3: Add comparison script

- [ ] **Step 1: Create script**

Create `scripts/perf/compare-postgres-query.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve('.planning/artifacts/perf/postgres-query')
const files = readdirSync(dir).filter((name) => name.endsWith('-postgres-query.md')).sort()
if (files.length < 2) {
  console.log('Need at least two postgres query artifacts to compare.')
  process.exit(0)
}

function parse(file) {
  const text = readFileSync(resolve(dir, file), 'utf8')
  const rows = [...text.matchAll(/^\| ([^|]+) \| ([0-9.]+) \| ([0-9]+) \|$/gm)]
  return Object.fromEntries(rows.map((row) => [row[1].trim(), Number(row[2])]))
}

const previous = files.at(-2)
const current = files.at(-1)
const a = parse(previous)
const b = parse(current)

console.log(`# PostgreSQL Query Perf Comparison\n`)
console.log(`Previous: ${previous}`)
console.log(`Current: ${current}\n`)
console.log('| Query | previous ms | current ms | ratio |')
console.log('| --- | ---: | ---: | ---: |')
for (const query of Object.keys(b)) {
  const prev = a[query]
  const curr = b[query]
  const ratio = prev ? curr / prev : Number.NaN
  console.log(`| ${query} | ${prev?.toFixed(2) ?? 'n/a'} | ${curr.toFixed(2)} | ${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'} |`)
}
```

- [ ] **Step 2: Run script**

Run: `node scripts/perf/compare-postgres-query.mjs`

Expected: prints comparison or states that two artifacts are needed.

## Task 4: Add Makefile target and docs

- [ ] **Step 1: Update Makefile**

Add phony target:

```make
pg-query-perf: ## Run opt-in PostgreSQL WGS query perf benchmark
	VARLENS_RUN_WGS_QUERY_PERF=1 VARLENS_PG_QUERY_EXPLAIN=1 npx vitest run tests/perf/postgres-wgs-query.perf.test.ts
```

- [ ] **Step 2: Update AGENTS.md testing section**

Add:

```md
PostgreSQL WGS query benchmarks are opt-in via `VARLENS_RUN_WGS_QUERY_PERF=1`. They write artifacts under `.planning/artifacts/perf/postgres-query/` and should be used before adding query indexes.
```

- [ ] **Step 3: Commit**

Run:

```bash
git add src/main/storage/postgres/postgres-query-benchmark.ts tests/perf/postgres-wgs-query.perf.test.ts scripts/perf/compare-postgres-query.mjs Makefile AGENTS.md
git commit -m "perf(postgres): add WGS query benchmark harness"
```
