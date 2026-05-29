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

  // Stub for next tasks
  async incrementalAdd(_args: ScopedClient & { caseId: number }): Promise<void> {
    throw new Error('TODO PR3-3')
  }
  async incrementalRemove(_args: ScopedClient & { caseId: number }): Promise<void> {
    throw new Error('TODO PR3-3')
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
