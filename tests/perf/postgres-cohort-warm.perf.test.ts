/**
 * PostgreSQL cohort warm-perf gate — Sprint A PR-3 (C6 + Gate 8).
 *
 * Opens the 100-case fixture (tests/.cache/perf-100case/, built by
 * scripts/perf/build-100-case-fixture.mjs) into a fresh PG schema, bulk-loads
 * all cases via COPY, rebuilds the cohort summary once (cold), then runs the
 * cohort page-load 5× warm (after 1 cold) and asserts the warm p95 < 500 ms.
 *
 * Reads the materialised cohort_variant_summary page exactly as the renderer
 * does (PostgresCohortRepository.queryVariants, default page: limit 50,
 * offset 0). The timing artifact lands under
 * .planning/artifacts/perf/postgres-cohort/.
 *
 * Gated two ways:
 *   - describe.skipIf when the 100-case fixture manifest is absent, so CI stays
 *     green without the (gitignored) fixture.
 *   - VARLENS_RUN_POSTGRES_E2E=1 + a reachable VARLENS_PG_URL are required for
 *     the body to do real work; without them the schema setup would fail, so
 *     the run is skipped unless both the fixture and a live PG are present.
 *
 * Setup:
 *   node scripts/perf/build-100-case-fixture.mjs   # if the fixture is missing
 *   make pg-reset && make pg-up && make rebuild-node
 *   VARLENS_RUN_POSTGRES_E2E=1 npx vitest run tests/perf/postgres-cohort-warm.perf.test.ts
 *   make pg-down
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gunzipSync } from 'node:zlib'

import { Client, Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortRepository } from '../../src/main/storage/postgres/PostgresCohortRepository'
import { PostgresCohortSummaryRepository } from '../../src/main/storage/postgres/PostgresCohortSummaryRepository'
import {
  encodeFloat,
  encodeInteger,
  encodeText,
  type CopyColumn
} from '../../src/main/storage/postgres/copy-text-encoder'
import { runBulkCopy } from '../../src/main/storage/postgres/postgres-bulk-write'

const FIXTURE_DIR = resolve(process.cwd(), 'tests/.cache/perf-100case')
const MANIFEST_PATH = join(FIXTURE_DIR, 'manifest.json')
const ARTIFACT_DIR = resolve(process.cwd(), '.planning/artifacts/perf/postgres-cohort')

const RUN_PG = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

/** Warm page-load p95 budget (Gate 8). */
const P95_BUDGET_MS = Number(process.env.VARLENS_PG_COHORT_P95_MS ?? '500')
const WARM_RUNS = 5
const GENOME_BUILD = 'GRCh38'

interface ManifestCase {
  id: string
  filePath: string
  variantCount: number
}

interface Manifest {
  totalCases: number
  totalVariants: number
  cases: ManifestCase[]
}

/**
 * COPY columns for the variants table. coord_hash is a GENERATED column and is
 * deliberately omitted; variant_type defaults to 'snv'. The encoders mirror the
 * production bulk-write path.
 */
const VARIANT_COPY_COLUMNS: ReadonlyArray<CopyColumn> = [
  { name: 'case_id', encoder: encodeInteger },
  { name: 'chr', encoder: encodeText },
  { name: 'pos', encoder: encodeInteger },
  { name: 'ref', encoder: encodeText },
  { name: 'alt', encoder: encodeText },
  { name: 'gene_symbol', encoder: encodeText },
  { name: 'consequence', encoder: encodeText },
  { name: 'func', encoder: encodeText },
  { name: 'gnomad_af', encoder: encodeFloat },
  { name: 'cadd', encoder: encodeFloat },
  { name: 'clinvar', encoder: encodeText },
  { name: 'gt_num', encoder: encodeText },
  { name: 'transcript', encoder: encodeText },
  { name: 'cdna', encoder: encodeText },
  { name: 'aa_change', encoder: encodeText },
  { name: 'variant_type', encoder: encodeText }
]

function readManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
}

/** Decompress one wrapped-columnar .json.gz fixture case into header + rows. */
function readCaseFile(filePath: string): {
  header: Array<{ id: string }>
  data: unknown[][]
} {
  const raw = JSON.parse(
    gunzipSync(readFileSync(resolve(process.cwd(), filePath))).toString('utf8')
  ) as Record<string, { header: Array<{ id: string }>; data: unknown[][] }>
  const caseKey = Object.keys(raw)[0]
  return raw[caseKey]
}

function colIndexer(header: Array<{ id: string }>): (id: string) => number {
  const map = new Map(header.map((c, i) => [c.id, i]))
  return (id) => map.get(id) ?? -1
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil(0.95 * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]
}

function writeArtifact(args: {
  manifest: Manifest
  loadSec: number
  rebuildSec: number
  coldMs: number
  warmMs: number[]
  warmP95Ms: number
}): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(ARTIFACT_DIR, `${ts}-postgres-cohort-warm.md`)
  writeFileSync(
    path,
    [
      `# Postgres cohort warm-perf — Sprint A C6 / Gate 8`,
      ``,
      `- timestamp: ${ts}`,
      `- fixture: ${FIXTURE_DIR}`,
      `- cases: ${args.manifest.totalCases}`,
      `- variants: ${args.manifest.totalVariants}`,
      `- bulk-load: ${args.loadSec.toFixed(2)}s`,
      `- summary rebuild (cold): ${args.rebuildSec.toFixed(2)}s`,
      `- page-load cold: ${args.coldMs.toFixed(1)}ms`,
      `- page-load warm samples (ms): ${args.warmMs.map((m) => m.toFixed(1)).join(', ')}`,
      `- page-load warm p95: ${args.warmP95Ms.toFixed(1)}ms`,
      `- budget: ${P95_BUDGET_MS.toFixed(1)}ms (override via VARLENS_PG_COHORT_P95_MS)`,
      ``
    ].join('\n')
  )
  return path
}

describe.skipIf(!existsSync(MANIFEST_PATH) || !RUN_PG)(
  'postgres cohort warm-perf — Sprint A C6 / Gate 8',
  () => {
    it(`cohort page-load p95 < ${P95_BUDGET_MS}ms warm on the 100-case fixture`, async () => {
      const manifest = readManifest()
      expect(manifest.cases.length).toBeGreaterThan(0)

      const schema = `varlens_perf_cohort_${Date.now()}_${randomBytes(4).toString('hex')}`

      const provisioner = new Client({ connectionString: PG_URL })
      await provisioner.connect()
      await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
      await provisioner.end()

      const pool = new Pool({ connectionString: PG_URL, max: 4 })

      try {
        // 1. Fresh schema + migrations.
        await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()

        // 2. Bulk-load all cases via COPY (fast path).
        const loadT0 = performance.now()
        const loadClient = await pool.connect()
        try {
          for (const entry of manifest.cases) {
            const { header, data } = readCaseFile(entry.filePath)
            const idx = colIndexer(header)
            const iChr = idx('Chr')
            const iPos = idx('Pos')
            const iRef = idx('Ref')
            const iAlt = idx('Alt')
            const iGene = idx('Gene')
            const iConsequence = idx('Consequence')
            const iFunc = idx('Func')
            const iTranscript = idx('Transcript')
            const iCdna = idx('cDNA')
            const iAa = idx('AAChange')
            const iGnomad = idx('GnomadAF')
            const iCadd = idx('CADDPhredScore')
            const iClinvar = idx('ClinVSig')
            const iGt = idx('GTNum-Index')

            const inserted = await loadClient.query<{ id: number }>(
              `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
                   VALUES ($1, $2, 0, $3, $4) RETURNING id`,
              [entry.id, entry.filePath, Date.now(), GENOME_BUILD]
            )
            const caseId = inserted.rows[0].id

            const rows = data.map((row) => ({
              case_id: caseId,
              chr: String(row[iChr]),
              pos: Number(row[iPos]),
              ref: String(row[iRef]),
              alt: String(row[iAlt]),
              gene_symbol: iGene >= 0 ? (row[iGene] ?? null) : null,
              consequence: iConsequence >= 0 ? (row[iConsequence] ?? null) : null,
              func: iFunc >= 0 ? (row[iFunc] ?? null) : null,
              gnomad_af: toNum(row[iGnomad]),
              cadd: toNum(row[iCadd]),
              clinvar: iClinvar >= 0 ? (row[iClinvar] ?? null) : null,
              gt_num: iGt >= 0 ? (row[iGt] === null ? null : String(row[iGt])) : null,
              transcript: iTranscript >= 0 ? (row[iTranscript] ?? null) : null,
              cdna: iCdna >= 0 ? (row[iCdna] ?? null) : null,
              aa_change: iAa >= 0 ? (row[iAa] ?? null) : null,
              variant_type: 'snv'
            }))

            await runBulkCopy({
              client: loadClient,
              sql: `COPY "${schema}".variants (${VARIANT_COPY_COLUMNS.map((c) => c.name).join(', ')}) FROM STDIN`,
              columns: VARIANT_COPY_COLUMNS,
              rows
            })
          }
        } finally {
          loadClient.release()
        }
        const loadSec = (performance.now() - loadT0) / 1000

        // 3. Rebuild the cohort summary once (cold).
        const summaryRepo = new PostgresCohortSummaryRepository()
        const rebuildT0 = performance.now()
        const rebuildClient = await pool.connect()
        try {
          await summaryRepo.rebuild({ schema, client: rebuildClient as never })
        } finally {
          rebuildClient.release()
        }
        const rebuildSec = (performance.now() - rebuildT0) / 1000

        // 4. Cohort page-load: 1 cold, then WARM_RUNS warm.
        const cohortRepo = new PostgresCohortRepository(pool, schema)
        const pageParams = { limit: 50, offset: 0 }

        const coldT0 = performance.now()
        const coldResult = await cohortRepo.queryVariants(pageParams)
        const coldMs = performance.now() - coldT0
        expect(coldResult.data.length).toBeGreaterThan(0)

        const warmMs: number[] = []
        for (let i = 0; i < WARM_RUNS; i++) {
          const t0 = performance.now()
          const result = await cohortRepo.queryVariants(pageParams)
          warmMs.push(performance.now() - t0)
          expect(result.data.length).toBeGreaterThan(0)
        }

        const warmP95Ms = p95(warmMs)
        const artifactPath = writeArtifact({
          manifest,
          loadSec,
          rebuildSec,
          coldMs,
          warmMs,
          warmP95Ms
        })

        // Surface the numbers for the run log without console.* in app code —
        // this is test code, where reporters expect stdout.
        process.stdout.write(
          `[cohort-warm-perf] cold=${coldMs.toFixed(1)}ms warm-p95=${warmP95Ms.toFixed(1)}ms ` +
            `budget=${P95_BUDGET_MS}ms artifact=${artifactPath}\n`
        )

        expect(warmP95Ms).toBeLessThan(P95_BUDGET_MS)
      } finally {
        await pool.end()
        const cleaner = new Client({ connectionString: PG_URL })
        await cleaner.connect()
        await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await cleaner.end()
      }
    }, 600_000)
  }
)
