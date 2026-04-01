/**
 * Canonical GT-to-dosage SQL CASE expression.
 *
 * Maps VCF genotype strings to integer dosage values.
 * Standard mapping per VCF v4.3 spec + PLINK/Hail conventions.
 *
 * Usage: embed in SQL queries as a column expression, e.g.:
 *   `SELECT gene_symbol, ${GT_DOSAGE_SQL} AS dosage FROM variants`
 *
 * The expression references the `gt_num` column from the variants table.
 */
export const GT_DOSAGE_SQL = `CASE gt_num
    WHEN '1/1' THEN 2  WHEN '1|1' THEN 2
    WHEN '0/1' THEN 1  WHEN '1/0' THEN 1
    WHEN '0|1' THEN 1  WHEN '1|0' THEN 1
    WHEN '0/0' THEN 0  WHEN '0|0' THEN 0
    WHEN '1'   THEN 1
    WHEN '0'   THEN 0
    ELSE NULL
  END`
