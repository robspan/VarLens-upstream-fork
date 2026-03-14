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
    carrier_count, het_count, hom_count, variant_key
  )
  SELECT
    chr, pos, ref, alt,
    MAX(gene_symbol), MAX(cdna), MAX(aa_change),
    MAX(consequence), MAX(func), MAX(clinvar),
    MAX(gnomad_af), MAX(cadd), MAX(transcript), MAX(omim_mim_number),
    COUNT(DISTINCT case_id),
    SUM(CASE WHEN gt_num IN ('0/1','1/0','0|1','1|0') THEN 1 ELSE 0 END),
    SUM(CASE WHEN gt_num IN ('1/1','1|1') THEN 1 ELSE 0 END),
    chr || ':' || pos || ':' || ref || ':' || alt
  FROM variants
  GROUP BY chr, pos, ref, alt;
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
