/**
 * Sprint A PR-3 C2 — PostgresCohortSummaryRepository.
 *
 * Materialises the deduped cohort variant summary for the Postgres backend.
 * Mirrors the SQLite source of truth in src/shared/sql/cohort-summary-rebuild.ts
 * and src/main/database/CohortSummaryService.ts:
 *
 *   - rebuild(): TRUNCATE + INSERT from the deduped CTE (Pass-2 #4 — duplicate
 *     per-case rows count once). has_star/has_comment/acmg_best are derived
 *     from variant_annotations + case_variant_annotations at insertion time
 *     (Pass-9 #8 — otherwise every rebuild would reset the flags to false).
 *     cohort_frequency is left NULL; the caller runs the C2a recompute next.
 *
 * Note on column names: the Postgres workflow schema names the comment columns
 * global_comment / per_case_comment and the ACMG column acmg_classification
 * (src/main/storage/postgres/migrations/sql/0005_create_workflow_tables.sql) —
 * not the placeholder names in the plan. The variants table has no variant_key
 * column, so it is composed inline as chr:pos:ref:alt to match SQLite.
 *
 * The remaining methods are stubbed for the subsequent Sprint A tasks.
 */
import type { PoolClient } from 'pg'

interface ScopedClient {
  schema: string
  client: PoolClient
}

/**
 * ACMG rank ladder mirroring the SQLite CASE expression in
 * src/shared/sql/cohort-summary-rebuild.ts. Higher rank wins; the textual
 * label is reconstructed from the winning rank.
 */
const ACMG_RANK_SQL = (col: string) => `CASE ${col}
  WHEN 'Pathogenic' THEN 5
  WHEN 'Likely pathogenic' THEN 4
  WHEN 'Uncertain significance' THEN 3
  WHEN 'Likely benign' THEN 2
  WHEN 'Benign' THEN 1
  ELSE 0 END`

/**
 * Deduped per-coordinate aggregate for a single case_id ($1). Mirrors the
 * SQLite INCREMENTAL_ADD_SQL / INCREMENTAL_REMOVE_SQL deduped sub-selects in
 * src/shared/sql/cohort-summary-rebuild.ts:134-184 — duplicate per-case rows
 * collapse to one carrier (Pass-2 #4). Emits carrier/het/hom deltas so both
 * the add and remove paths can reuse the same shape.
 */
const SCOPED_DEDUPED_AGG_SQL = (tbl: (t: string) => string) => `
  WITH deduped AS (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build,
           MAX(v.end_pos) AS end_pos,
           MAX(v.gene_symbol) AS gene_symbol,
           MAX(v.cdna) AS cdna,
           MAX(v.aa_change) AS aa_change,
           MAX(v.consequence) AS consequence,
           MAX(v.func) AS func,
           MAX(v.clinvar) AS clinvar,
           MAX(v.gnomad_af) AS gnomad_af,
           MAX(v.cadd) AS cadd,
           MAX(v.transcript) AS transcript,
           MAX(v.omim_mim_number) AS omim_mim_number,
           MAX(v.gt_num) AS gt_num
    FROM ${tbl('variants')} v
    JOIN ${tbl('cases')} c ON c.id = v.case_id
    WHERE v.case_id = $1
    GROUP BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build
  ),
  per_case AS (
    SELECT chr, pos, ref, alt, variant_type, genome_build,
           MAX(end_pos) AS end_pos,
           MAX(gene_symbol) AS gene_symbol,
           MAX(cdna) AS cdna,
           MAX(aa_change) AS aa_change,
           MAX(consequence) AS consequence,
           MAX(func) AS func,
           MAX(clinvar) AS clinvar,
           MAX(gnomad_af) AS gnomad_af,
           MAX(cadd) AS cadd,
           MAX(transcript) AS transcript,
           MAX(omim_mim_number) AS omim_mim_number,
           COUNT(*) AS carrier_delta,
           SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_delta,
           SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_delta
    FROM deduped
    GROUP BY chr, pos, ref, alt, variant_type, genome_build
  )`

export class PostgresCohortSummaryRepository {
  async rebuild({ schema, client }: ScopedClient): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(`TRUNCATE ${tbl('cohort_variant_summary')}`)

    // Deduped CTE + flag-bearing projection. Mirrors SQLite
    // src/main/database/CohortSummaryService.ts and the deduped pattern in
    // src/shared/sql/cohort-summary-rebuild.ts.
    await client.query(`
      INSERT INTO ${tbl('cohort_variant_summary')}
        (chr, pos, end_pos, ref, alt, variant_type, genome_build,
         gene_symbol, cdna, aa_change, consequence, func, clinvar,
         gnomad_af, cadd, transcript, omim_mim_number,
         carrier_count, het_count, hom_count, variant_key,
         has_star, has_comment, acmg_best, cohort_frequency)
      WITH deduped AS (
        SELECT v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build,
               MAX(v.end_pos) AS end_pos,
               MAX(v.gene_symbol) AS gene_symbol,
               MAX(v.cdna) AS cdna,
               MAX(v.aa_change) AS aa_change,
               MAX(v.consequence) AS consequence,
               MAX(v.func) AS func,
               MAX(v.clinvar) AS clinvar,
               MAX(v.gnomad_af) AS gnomad_af,
               MAX(v.cadd) AS cadd,
               MAX(v.transcript) AS transcript,
               MAX(v.omim_mim_number) AS omim_mim_number,
               MAX(v.gt_num) AS gt_num
        FROM ${tbl('variants')} v
        JOIN ${tbl('cases')} c ON c.id = v.case_id
        GROUP BY v.chr, v.pos, v.ref, v.alt, v.case_id, v.variant_type, c.genome_build
      ),
      agg AS (
        SELECT d.chr, d.pos, MAX(d.end_pos) AS end_pos, d.ref, d.alt,
               d.variant_type, d.genome_build,
               MAX(d.gene_symbol) AS gene_symbol,
               MAX(d.cdna) AS cdna,
               MAX(d.aa_change) AS aa_change,
               MAX(d.consequence) AS consequence,
               MAX(d.func) AS func,
               MAX(d.clinvar) AS clinvar,
               MAX(d.gnomad_af) AS gnomad_af,
               MAX(d.cadd) AS cadd,
               MAX(d.transcript) AS transcript,
               MAX(d.omim_mim_number) AS omim_mim_number,
               COUNT(*) AS carrier_count,
               SUM(CASE WHEN d.gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
               SUM(CASE WHEN d.gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
        FROM deduped d
        GROUP BY d.chr, d.pos, d.ref, d.alt, d.variant_type, d.genome_build
      )
      SELECT
        a.chr, a.pos, a.end_pos, a.ref, a.alt, a.variant_type, a.genome_build,
        a.gene_symbol, a.cdna, a.aa_change, a.consequence, a.func, a.clinvar,
        a.gnomad_af, a.cadd, a.transcript, a.omim_mim_number,
        a.carrier_count, a.het_count, a.hom_count,
        a.chr || ':' || a.pos || ':' || a.ref || ':' || a.alt AS variant_key,
        -- Pass-9 #8: derive flag columns from current annotation tables.
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.starred = 1
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.starred = 1
        )) AS has_star,
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = a.chr AND va.pos = a.pos
            AND va.ref = a.ref AND va.alt = a.alt
            AND va.global_comment IS NOT NULL AND va.global_comment <> ''
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = a.chr AND v.pos = a.pos
            AND v.ref = a.ref AND v.alt = a.alt
            AND v.variant_type = a.variant_type
            AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> ''
        )) AS has_comment,
        -- acmg_best: highest-ranked classification across global + per-case
        -- annotations, reconstructed from the winning rank (mirrors the SQLite
        -- CASE ladder in src/shared/sql/cohort-summary-rebuild.ts).
        (CASE (
          SELECT MAX(rank) FROM (
            SELECT ${ACMG_RANK_SQL('va.acmg_classification')} AS rank
            FROM ${tbl('variant_annotations')} va
            WHERE va.chr = a.chr AND va.pos = a.pos
              AND va.ref = a.ref AND va.alt = a.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT ${ACMG_RANK_SQL('cva.acmg_classification')} AS rank
            FROM ${tbl('case_variant_annotations')} cva
            JOIN ${tbl('variants')} v ON cva.variant_id = v.id
            WHERE v.chr = a.chr AND v.pos = a.pos
              AND v.ref = a.ref AND v.alt = a.alt
              AND v.variant_type = a.variant_type
              AND cva.acmg_classification IS NOT NULL
          ) ranked
        )
          WHEN 5 THEN 'Pathogenic'
          WHEN 4 THEN 'Likely pathogenic'
          WHEN 3 THEN 'Uncertain significance'
          WHEN 2 THEN 'Likely benign'
          WHEN 1 THEN 'Benign'
          ELSE NULL
        END) AS acmg_best,
        NULL AS cohort_frequency  -- populated by C2a recompute, called next
      FROM agg a;
    `)

    // C2a recompute is invoked by the caller immediately after rebuild() —
    // the cohort_frequency NULL above is intentional. See the rebuild()
    // call site in C3 (PostgresCaseLifecycleRepository and
    // postgres-import-worker.ts).
  }

  /**
   * Add one case's variants to the summary. INSERT … SELECT from the deduped
   * per-case CTE, ON CONFLICT bumping all three counters simultaneously
   * (Pass-6 MED #3). Flags use OR semantics so an add never clears an existing
   * annotation flag; on the INSERT (brand-new row) path the flags come from the
   * same EXISTS expressions as rebuild().
   */
  async incrementalAdd({
    schema,
    client,
    caseId
  }: ScopedClient & { caseId: number }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(
      `
      INSERT INTO ${tbl('cohort_variant_summary')}
        (chr, pos, end_pos, ref, alt, variant_type, genome_build,
         gene_symbol, cdna, aa_change, consequence, func, clinvar,
         gnomad_af, cadd, transcript, omim_mim_number,
         carrier_count, het_count, hom_count, variant_key,
         has_star, has_comment, acmg_best, cohort_frequency)
      ${SCOPED_DEDUPED_AGG_SQL(tbl)}
      SELECT
        pc.chr, pc.pos, pc.end_pos, pc.ref, pc.alt, pc.variant_type, pc.genome_build,
        pc.gene_symbol, pc.cdna, pc.aa_change, pc.consequence, pc.func, pc.clinvar,
        pc.gnomad_af, pc.cadd, pc.transcript, pc.omim_mim_number,
        pc.carrier_delta, pc.het_delta, pc.hom_delta,
        pc.chr || ':' || pc.pos || ':' || pc.ref || ':' || pc.alt AS variant_key,
        -- Pass-9 #8: brand-new rows derive flags from current annotation tables.
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = pc.chr AND va.pos = pc.pos
            AND va.ref = pc.ref AND va.alt = pc.alt
            AND va.starred = 1
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = pc.chr AND v.pos = pc.pos
            AND v.ref = pc.ref AND v.alt = pc.alt
            AND v.variant_type = pc.variant_type
            AND cva.starred = 1
        )) AS has_star,
        (EXISTS (
          SELECT 1 FROM ${tbl('variant_annotations')} va
          WHERE va.chr = pc.chr AND va.pos = pc.pos
            AND va.ref = pc.ref AND va.alt = pc.alt
            AND va.global_comment IS NOT NULL AND va.global_comment <> ''
        ) OR EXISTS (
          SELECT 1 FROM ${tbl('case_variant_annotations')} cva
          JOIN ${tbl('variants')} v ON cva.variant_id = v.id
          WHERE v.chr = pc.chr AND v.pos = pc.pos
            AND v.ref = pc.ref AND v.alt = pc.alt
            AND v.variant_type = pc.variant_type
            AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> ''
        )) AS has_comment,
        (CASE (
          SELECT MAX(rank) FROM (
            SELECT ${ACMG_RANK_SQL('va.acmg_classification')} AS rank
            FROM ${tbl('variant_annotations')} va
            WHERE va.chr = pc.chr AND va.pos = pc.pos
              AND va.ref = pc.ref AND va.alt = pc.alt
              AND va.acmg_classification IS NOT NULL
            UNION ALL
            SELECT ${ACMG_RANK_SQL('cva.acmg_classification')} AS rank
            FROM ${tbl('case_variant_annotations')} cva
            JOIN ${tbl('variants')} v ON cva.variant_id = v.id
            WHERE v.chr = pc.chr AND v.pos = pc.pos
              AND v.ref = pc.ref AND v.alt = pc.alt
              AND v.variant_type = pc.variant_type
              AND cva.acmg_classification IS NOT NULL
          ) ranked
        )
          WHEN 5 THEN 'Pathogenic'
          WHEN 4 THEN 'Likely pathogenic'
          WHEN 3 THEN 'Uncertain significance'
          WHEN 2 THEN 'Likely benign'
          WHEN 1 THEN 'Benign'
          ELSE NULL
        END) AS acmg_best,
        NULL AS cohort_frequency  -- recomputed by C2a, called by the caller next
      FROM per_case pc
      ON CONFLICT (chr, pos, ref, alt, variant_type, genome_build) DO UPDATE SET
        carrier_count = cohort_variant_summary.carrier_count + EXCLUDED.carrier_count,
        het_count = cohort_variant_summary.het_count + EXCLUDED.het_count,
        hom_count = cohort_variant_summary.hom_count + EXCLUDED.hom_count,
        -- Adds never clear annotation flags (OR semantics).
        has_star = cohort_variant_summary.has_star OR EXCLUDED.has_star,
        has_comment = cohort_variant_summary.has_comment OR EXCLUDED.has_comment;
    `,
      [caseId]
    )
  }

  /**
   * Remove one case's variants from the summary. UPDATE-from-CTE subtracting all
   * three counters simultaneously (Pass-6 MED #3), then a sibling DELETE of any
   * row that dropped to zero carriers (Pass-2 verdict #1 — separate statement,
   * not a sibling CTE). Mirrors SQLite INCREMENTAL_REMOVE_SQL +
   * CLEANUP_ZERO_CARRIERS_SQL.
   */
  async incrementalRemove({
    schema,
    client,
    caseId
  }: ScopedClient & { caseId: number }): Promise<void> {
    const tbl = (t: string): string => `"${schema}"."${t}"`

    await client.query(
      `
      ${SCOPED_DEDUPED_AGG_SQL(tbl)}
      UPDATE ${tbl('cohort_variant_summary')} cvs
      SET carrier_count = cvs.carrier_count - per_case.carrier_delta,
          het_count = cvs.het_count - per_case.het_delta,
          hom_count = cvs.hom_count - per_case.hom_delta
      FROM per_case
      WHERE cvs.chr = per_case.chr AND cvs.pos = per_case.pos
        AND cvs.ref = per_case.ref AND cvs.alt = per_case.alt
        AND cvs.variant_type = per_case.variant_type
        AND cvs.genome_build = per_case.genome_build;
    `,
      [caseId]
    )

    await client.query(`DELETE FROM ${tbl('cohort_variant_summary')} WHERE carrier_count <= 0`)
  }
  async refreshColumnMetas(_args: ScopedClient & { caseId: number }): Promise<void> {
    throw new Error('TODO PR3-4')
  }
  async removeColumnMetas(_args: ScopedClient & { caseId: number }): Promise<void> {
    throw new Error('TODO PR3-4')
  }
  async getState(_args: ScopedClient): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
    throw new Error('TODO PR3-9')
  }
  async markStale(_args: ScopedClient & { reason: string }): Promise<void> {
    throw new Error('TODO PR3-9')
  }
}
