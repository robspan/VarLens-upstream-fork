import type { Pool, PoolClient } from 'pg'

import { applyAnnotationFlagsOnCaseDelete } from './cohort-annotation-flags-sql'
import { quoteIdentifier } from './identifiers'
import {
  PostgresCohortSummaryRepository,
  SCOPED_DEDUPED_AGG_SQL
} from './PostgresCohortSummaryRepository'

type TransactionClient = Pick<PoolClient, 'query' | 'release'>

/** The subset of PostgresCohortSummaryRepository this repo drives (test seam). */
type CohortSummaryMaintenance = Pick<
  PostgresCohortSummaryRepository,
  'recomputeCohortFrequency' | 'removeColumnMetas'
>

export class PostgresCaseLifecycleRepository {
  private readonly schemaName: string
  private readonly summary: CohortSummaryMaintenance

  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    private readonly schema: string,
    summary?: CohortSummaryMaintenance
  ) {
    this.schemaName = quoteIdentifier(schema)
    this.summary = summary ?? new PostgresCohortSummaryRepository()
  }

  /**
   * Sprint A PR-3 C3 (delete half). Deletes one case and keeps the materialised
   * cohort summary in lockstep, all inside the existing single transaction. The
   * 8-step ordering is load-bearing:
   *
   *   1. SELECT genome_build (Pass-4 HIGH #1) — captured BEFORE the cascade so
   *      step 7 can narrow the cohort_frequency recompute to the right build.
   *   2. applyAnnotationFlagsOnCaseDelete (C5a third variant, Pass-5 HIGH #1) —
   *      runs BEFORE the case delete; the ` AND v.case_id <> $1` predicate
   *      excludes the about-to-be-cascade-deleted rows so flags backed solely by
   *      this case clear in the same transaction.
   *   3. UPDATE cohort_variant_summary subtracting carrier/het/hom together
   *      (Pass-6 MED #3) from the deduped per-case CTE.
   *   4. DELETE summary rows that dropped to zero carriers (sibling statement,
   *      Pass-2 verdict #1).
   *   5. DELETE the case (cascades to variants + case_variant_annotations +
   *      cohort_column_meta).
   *   6. rebuildVariantFrequency (Pass-6 HIGH #1) — vf.case_count powers
   *      internal_af, so it must be rebuilt after the cascade.
   *   7. recomputeCohortFrequency narrowed to the captured build — the
   *      denominator now excludes the deleted case.
   *   8. removeColumnMetas — keyed on case_id, independent of step 5's cascade.
   */
  async deleteCase(caseId: number): Promise<void> {
    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')

      // Step 1: capture genome_build for the step-7 recompute. A missing case
      // (zero rows) leaves capturedBuild undefined and the recompute falls back
      // to all builds — correct because there is nothing build-specific to scope.
      const buildRes = await client.query<{ genome_build: string }>(
        `SELECT genome_build FROM ${this.schemaName}."cases" WHERE id = $1`,
        [caseId]
      )
      const capturedBuild = buildRes.rows[0]?.genome_build

      // Step 2: recompute annotation flags excluding the about-to-be-deleted
      // case, BEFORE the cascade removes its annotations (Pass-5 HIGH #1).
      await applyAnnotationFlagsOnCaseDelete(client as unknown as Pool, {
        schema: this.schema,
        deletedCaseId: caseId
      })

      // Step 3: subtract carrier_count, het_count, hom_count simultaneously
      // (Pass-6 MED #3). Reuses the canonical SCOPED_DEDUPED_AGG_SQL so intra-case
      // duplicate coordinate rows (multiple gt_num under one case, no unique
      // constraint on variants(case_id,chr,pos,ref,alt,variant_type)) collapse to
      // a single carrier — keeping the remove delta symmetric with incrementalAdd
      // (one carrier per coordinate per case) instead of over-subtracting COUNT(*).
      const tbl = (t: string): string => `${this.schemaName}."${t}"`
      await client.query(
        `
        ${SCOPED_DEDUPED_AGG_SQL(tbl)}
        UPDATE ${this.schemaName}."cohort_variant_summary" cvs
        SET carrier_count = cvs.carrier_count - per_case.carrier_delta,
            het_count = cvs.het_count - per_case.het_delta,
            hom_count = cvs.hom_count - per_case.hom_delta
        FROM per_case
        WHERE cvs.chr = per_case.chr AND cvs.pos = per_case.pos
          AND cvs.ref = per_case.ref AND cvs.alt = per_case.alt
          AND cvs.variant_type = per_case.variant_type
          AND cvs.genome_build = per_case.genome_build
        `,
        [caseId]
      )

      // Step 4: drop summary rows that fell to zero carriers (sibling DELETE,
      // Pass-2 verdict #1 — not a sibling CTE).
      await client.query(
        `DELETE FROM ${this.schemaName}."cohort_variant_summary" WHERE carrier_count <= 0`
      )

      // Step 5: delete the case — cascades to variants, case_variant_annotations
      // and cohort_column_meta.
      await client.query(`DELETE FROM ${this.schemaName}."cases" WHERE id = $1`, [caseId])

      // Step 6: rebuild variant_frequency so internal_af stays current
      // (Pass-6 HIGH #1).
      await this.rebuildVariantFrequency(client)

      // Step 7: recompute cohort_frequency narrowed to the captured build so the
      // denominator excludes the deleted case (Pass-4 HIGH #1).
      await this.summary.recomputeCohortFrequency({
        schema: this.schema,
        client: client as unknown as PoolClient,
        affectedBuilds: capturedBuild !== undefined ? [capturedBuild] : undefined
      })

      // Step 8: drop the case's column-meta rows. Keyed on case_id and therefore
      // independent of step 5's cascade.
      await this.summary.removeColumnMetas({
        schema: this.schema,
        client: client as unknown as PoolClient,
        caseId
      })

      await client.query('COMMIT')
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original transaction failure for callers.
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async rebuildVariantFrequency(client: TransactionClient): Promise<void> {
    await client.query(`TRUNCATE ${this.schemaName}."variant_frequency"`)
    await client.query(`
      INSERT INTO ${this.schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
      SELECT chr, pos, ref, alt, COUNT(DISTINCT case_id)::bigint
      FROM ${this.schemaName}."variants"
      GROUP BY chr, pos, ref, alt
    `)
  }
}
