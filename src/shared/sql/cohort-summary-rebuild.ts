/**
 * Shared SQL constants for cohort summary table rebuild.
 *
 * Used by CohortSummaryService (main thread), import-worker, delete-worker,
 * and rebuild-summary-worker. Single source of truth to avoid SQL drift.
 */

export const REBUILD_VARIANT_SUMMARY_SQL = `
  DELETE FROM cohort_variant_summary;
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key
  )
  SELECT
    d.chr, d.pos, d.ref, d.alt,
    d.gene_symbol, d.cdna, d.aa_change,
    d.consequence, d.func, d.clinvar, d.gnomad_af, d.cadd,
    d.transcript, d.omim_mim_number,
    d.carrier_count, d.het_count, d.hom_count,
    CAST(d.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases),
    CASE WHEN va.starred = 1 THEN 1 ELSE 0 END,
    CASE WHEN va.global_comment IS NOT NULL AND va.global_comment != '' THEN 1 ELSE 0 END,
    va.acmg_classification,
    d.chr || ':' || d.pos || ':' || d.ref || ':' || d.alt
  FROM (
    WITH deduped AS (
      SELECT chr, pos, ref, alt, case_id,
        MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
        MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
        MAX(func) AS func, MAX(clinvar) AS clinvar,
        MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
        MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
        MAX(gt_num) AS gt_num
      FROM variants
      GROUP BY chr, pos, ref, alt, case_id
    )
    SELECT chr, pos, ref, alt,
      MAX(gene_symbol) AS gene_symbol, MAX(cdna) AS cdna,
      MAX(aa_change) AS aa_change, MAX(consequence) AS consequence,
      MAX(func) AS func, MAX(clinvar) AS clinvar,
      MAX(gnomad_af) AS gnomad_af, MAX(cadd) AS cadd,
      MAX(transcript) AS transcript, MAX(omim_mim_number) AS omim_mim_number,
      COUNT(*) AS carrier_count,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
    FROM deduped
    GROUP BY chr, pos, ref, alt
  ) d
  LEFT JOIN variant_annotations va
    ON va.chr = d.chr AND va.pos = d.pos AND va.ref = d.ref AND va.alt = d.alt;
`

export const UPDATE_PER_CASE_ANNOTATION_FLAGS_SQL = `
  UPDATE cohort_variant_summary SET
    has_star = CASE WHEN cohort_variant_summary.has_star = 1 THEN 1 WHEN pca.has_star = 1 THEN 1 ELSE 0 END,
    has_comment = CASE WHEN cohort_variant_summary.has_comment = 1 THEN 1 WHEN pca.has_comment = 1 THEN 1 ELSE 0 END,
    acmg_best = CASE
      WHEN pca.acmg_rank > CASE cohort_variant_summary.acmg_best
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END
      THEN pca.acmg_best
      ELSE cohort_variant_summary.acmg_best
    END
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt,
      MAX(cva.starred) AS has_star,
      MAX(CASE WHEN cva.per_case_comment IS NOT NULL AND cva.per_case_comment != ''
        THEN 1 ELSE 0 END) AS has_comment,
      CASE MAX(CASE cva.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END)
        WHEN 5 THEN 'Pathogenic' WHEN 4 THEN 'Likely pathogenic'
        WHEN 3 THEN 'Uncertain significance' WHEN 2 THEN 'Likely benign'
        WHEN 1 THEN 'Benign' ELSE NULL
      END AS acmg_best,
      MAX(CASE cva.acmg_classification
        WHEN 'Pathogenic' THEN 5 WHEN 'Likely pathogenic' THEN 4
        WHEN 'Uncertain significance' THEN 3 WHEN 'Likely benign' THEN 2
        WHEN 'Benign' THEN 1 ELSE 0 END) AS acmg_rank
    FROM case_variant_annotations cva
    JOIN variants v ON cva.variant_id = v.id
    GROUP BY v.chr, v.pos, v.ref, v.alt
  ) pca
  WHERE cohort_variant_summary.chr = pca.chr
    AND cohort_variant_summary.pos = pca.pos
    AND cohort_variant_summary.ref = pca.ref
    AND cohort_variant_summary.alt = pca.alt;
`

export const REBUILD_GENE_BURDEN_SQL = `
  DELETE FROM gene_burden_summary;
  INSERT INTO gene_burden_summary (
    gene_symbol, variant_count, unique_variant_count,
    affected_case_count, updated_at
  )
  SELECT
    gene_symbol,
    COUNT(*) AS variant_count,
    COUNT(DISTINCT chr || ':' || pos || ':' || ref || ':' || alt) AS unique_variant_count,
    COUNT(DISTINCT case_id) AS affected_case_count,
    CAST(strftime('%s', 'now') AS INTEGER)
  FROM variants
  WHERE gene_symbol IS NOT NULL AND gene_symbol != ''
  GROUP BY gene_symbol;
`

export const UPDATE_META_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('last_rebuilt_at', CAST(strftime('%s', 'now') AS TEXT));
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '0');
`

export const MARK_STALE_SQL = `
  INSERT OR REPLACE INTO cohort_summary_meta (key, value)
  VALUES ('is_stale', '1');
`

/** Check if summary tables exist (for workers on pre-v13 databases) */
export const CHECK_TABLE_EXISTS_SQL =
  "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='cohort_variant_summary'"

export const INCREMENTAL_ADD_SQL = `
  INSERT INTO cohort_variant_summary (
    chr, pos, ref, alt, gene_symbol, cdna, aa_change,
    consequence, func, clinvar, gnomad_af, cadd,
    transcript, omim_mim_number,
    carrier_count, het_count, hom_count,
    cohort_frequency, has_star, has_comment, acmg_best,
    variant_key
  )
  SELECT
    chr, pos, ref, alt,
    MAX(gene_symbol), MAX(cdna), MAX(aa_change),
    MAX(consequence), MAX(func), MAX(clinvar),
    MAX(gnomad_af), MAX(cadd), MAX(transcript), MAX(omim_mim_number),
    1,
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
    CAST(1 AS REAL) / (SELECT COUNT(*) FROM cases),
    0, 0, NULL,
    chr || ':' || pos || ':' || ref || ':' || alt
  FROM variants
  WHERE case_id = ?
  GROUP BY chr, pos, ref, alt
  ON CONFLICT(chr, pos, ref, alt) DO UPDATE SET
    carrier_count = carrier_count + excluded.carrier_count,
    het_count = het_count + excluded.het_count,
    hom_count = hom_count + excluded.hom_count,
    cohort_frequency = CAST(carrier_count + excluded.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases);
`

export const INCREMENTAL_REMOVE_SQL = `
  UPDATE cohort_variant_summary SET
    carrier_count = cohort_variant_summary.carrier_count - sub.carrier_count,
    het_count = cohort_variant_summary.het_count - sub.het_count,
    hom_count = cohort_variant_summary.hom_count - sub.hom_count,
    cohort_frequency = CAST(cohort_variant_summary.carrier_count - sub.carrier_count AS REAL) / (SELECT COUNT(*) FROM cases)
  FROM (
    SELECT chr, pos, ref, alt,
      COUNT(DISTINCT case_id) AS carrier_count,
      SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END) AS het_count,
      SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END) AS hom_count
    FROM variants
    WHERE case_id = ?
    GROUP BY chr, pos, ref, alt
  ) sub
  WHERE cohort_variant_summary.chr = sub.chr
    AND cohort_variant_summary.pos = sub.pos
    AND cohort_variant_summary.ref = sub.ref
    AND cohort_variant_summary.alt = sub.alt;
`

export const CLEANUP_ZERO_CARRIERS_SQL = `
  DELETE FROM cohort_variant_summary WHERE carrier_count <= 0;
`
