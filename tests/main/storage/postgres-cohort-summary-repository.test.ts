/**
 * Sprint A PR-3 C2 — PostgresCohortSummaryRepository.rebuild against a real
 * Postgres.
 *
 * Verifies the deduped CTE rebuild (Pass-2 #4 — duplicate per-case rows count
 * once) and that has_star/has_comment/acmg_best are derived from the existing
 * variant_annotations + case_variant_annotations tables at rebuild time
 * (Pass-9 #8 — without this, every rebuild resets flags to false). The
 * cohort_frequency column is left NULL by rebuild() and populated by the C2a
 * recompute called by the caller next.
 *
 * Gated by VARLENS_RUN_POSTGRES_E2E=1. Requires `make pg-up`.
 */
import { randomBytes } from 'node:crypto'

import { Client, Pool } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { POSTGRES_MIGRATIONS } from '../../../src/main/storage/postgres/migrations/definitions'
import { PostgresMigrationRunner } from '../../../src/main/storage/postgres/migrations/PostgresMigrationRunner'
import { PostgresCohortSummaryRepository } from '../../../src/main/storage/postgres/PostgresCohortSummaryRepository'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'

interface SeedVariant {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  variantType?: string
  geneSymbol?: string | null
  gtNum?: string | null
}

describe.skipIf(!RUN)('PostgresCohortSummaryRepository.rebuild — Sprint A C2', () => {
  let schema: string
  let pool: Pool
  let probe: Client
  const now = Date.now()

  beforeEach(async () => {
    schema = `varlens_test_cvs_rebuild_${Date.now()}_${randomBytes(4).toString('hex')}`
    const provisioner = new Client({ connectionString: PG_URL })
    await provisioner.connect()
    await provisioner.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    await provisioner.end()

    pool = new Pool({ connectionString: PG_URL, max: 2 })
    probe = new Client({ connectionString: PG_URL })
    await probe.connect()

    await new PostgresMigrationRunner(pool, schema, POSTGRES_MIGRATIONS).migrate()
  }, 60_000)

  afterEach(async () => {
    if (probe) await probe.end()
    if (pool) await pool.end()
    const cleaner = new Client({ connectionString: PG_URL })
    await cleaner.connect()
    await cleaner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await cleaner.end()
  }, 60_000)

  async function seedCase(name: string, genomeBuild = 'GRCh38'): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".cases (name, file_path, file_size, created_at, genome_build)
         VALUES ($1, $2, 0, $3, $4) RETURNING id`,
      [name, `/tmp/${name}.json`, now, genomeBuild]
    )
    return res.rows[0].id
  }

  async function seedVariant(v: SeedVariant): Promise<number> {
    const res = await probe.query<{ id: number }>(
      `INSERT INTO "${schema}".variants
         (case_id, chr, pos, ref, alt, variant_type, gene_symbol, gt_num)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        v.caseId,
        v.chr,
        v.pos,
        v.ref,
        v.alt,
        v.variantType ?? 'snv',
        v.geneSymbol ?? null,
        v.gtNum ?? null
      ]
    )
    return res.rows[0].id
  }

  async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client as unknown as Client)
    } finally {
      ;(client as { release: () => void }).release()
    }
  }

  it('TRUNCATEs and reinserts from the deduped CTE', async () => {
    const caseA = await seedCase('case-a')
    const caseB = await seedCase('case-b')
    // Two carriers (het + hom) of the same coordinate, one carrier elsewhere.
    await seedVariant({ caseId: caseA, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '0/1' })
    await seedVariant({ caseId: caseB, chr: '1', pos: 100, ref: 'A', alt: 'T', gtNum: '1/1' })
    await seedVariant({ caseId: caseA, chr: '2', pos: 200, ref: 'C', alt: 'G', gtNum: '0/1' })

    // Pre-populate with stale data that must be wiped by TRUNCATE.
    await probe.query(
      `INSERT INTO "${schema}".cohort_variant_summary
         (chr, pos, ref, alt, variant_type, genome_build, carrier_count)
         VALUES ('99', 1, 'X', 'Y', 'snv', 'GRCh38', 42)`
    )

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const rows = await probe.query<{
      chr: string
      pos: string
      ref: string
      alt: string
      carrier_count: string
      het_count: string
      hom_count: string
      variant_key: string
      cohort_frequency: number | null
    }>(
      `SELECT chr, pos, ref, alt, carrier_count, het_count, hom_count, variant_key, cohort_frequency
         FROM "${schema}".cohort_variant_summary ORDER BY chr, pos`
    )

    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.some((r) => r.chr === '99')).toBe(false)

    const first = rows.rows.find((r) => r.chr === '1')!
    expect(Number(first.carrier_count)).toBe(2)
    expect(Number(first.het_count)).toBe(1)
    expect(Number(first.hom_count)).toBe(1)
    expect(first.variant_key).toBe('1:100:A:T')
    // cohort_frequency is populated by the C2a recompute, not rebuild().
    expect(first.cohort_frequency).toBeNull()

    const second = rows.rows.find((r) => r.chr === '2')!
    expect(Number(second.carrier_count)).toBe(1)
  }, 60_000)

  it('mirrors SQLite deduplication — duplicate per-case rows count once (Pass-2 #4)', async () => {
    const caseA = await seedCase('case-dedup')
    // Same case_id has two rows with identical (chr, pos, ref, alt).
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })
    await seedVariant({ caseId: caseA, chr: '3', pos: 300, ref: 'G', alt: 'A', gtNum: '0/1' })

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const res = await probe.query<{ carrier_count: string }>(
      `SELECT carrier_count FROM "${schema}".cohort_variant_summary
         WHERE chr = '3' AND pos = 300 AND ref = 'G' AND alt = 'A'`
    )
    expect(res.rows).toHaveLength(1)
    expect(Number(res.rows[0].carrier_count)).toBe(1)
  }, 60_000)

  it('populates has_star/has_comment/acmg_best from existing annotations (Pass-9 #8)', async () => {
    const caseA = await seedCase('case-anno')

    // Global star + comment annotation (variant_annotations).
    const starred = await seedVariant({
      caseId: caseA,
      chr: '4',
      pos: 400,
      ref: 'T',
      alt: 'C',
      gtNum: '0/1'
    })
    void starred
    await probe.query(
      `INSERT INTO "${schema}".variant_annotations
         (chr, pos, ref, alt, global_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ('4', 400, 'T', 'C', NULL, 1, NULL, $1, $1)`,
      [now]
    )

    // Per-case comment + ACMG (case_variant_annotations) on a second coord.
    const commented = await seedVariant({
      caseId: caseA,
      chr: '5',
      pos: 500,
      ref: 'A',
      alt: 'G',
      gtNum: '0/1'
    })
    await probe.query(
      `INSERT INTO "${schema}".case_variant_annotations
         (case_id, variant_id, per_case_comment, starred, acmg_classification, created_at, updated_at)
         VALUES ($1, $2, 'looks pathogenic', 0, 'Pathogenic', $3, $3)`,
      [caseA, commented, now]
    )

    // A plain variant with no annotations.
    await seedVariant({ caseId: caseA, chr: '6', pos: 600, ref: 'C', alt: 'T', gtNum: '0/1' })

    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const rows = await probe.query<{
      chr: string
      has_star: boolean
      has_comment: boolean
      acmg_best: string | null
    }>(
      `SELECT chr, has_star, has_comment, acmg_best
         FROM "${schema}".cohort_variant_summary ORDER BY chr`
    )

    const star = rows.rows.find((r) => r.chr === '4')!
    expect(star.has_star).toBe(true)
    expect(star.has_comment).toBe(false)
    expect(star.acmg_best).toBeNull()

    const comment = rows.rows.find((r) => r.chr === '5')!
    expect(comment.has_comment).toBe(true)
    expect(comment.has_star).toBe(false)
    expect(comment.acmg_best).toBe('Pathogenic')

    const plain = rows.rows.find((r) => r.chr === '6')!
    expect(plain.has_star).toBe(false)
    expect(plain.has_comment).toBe(false)
    expect(plain.acmg_best).toBeNull()
  }, 60_000)

  it('survives an empty variants table (no rows inserted)', async () => {
    const repo = new PostgresCohortSummaryRepository()
    await withClient((client) => repo.rebuild({ schema, client: client as never }))

    const res = await probe.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "${schema}".cohort_variant_summary`
    )
    expect(Number(res.rows[0].count)).toBe(0)
  }, 60_000)
})

describe.skipIf(RUN)('PostgresCohortSummaryRepository.rebuild — Sprint A C2 (skipped)', () => {
  it('runs only when VARLENS_RUN_POSTGRES_E2E=1 and `make pg-up` is up', () => {
    expect(RUN).toBe(false)
  })
})
