import type { AcmgClassification } from '../config/domain.config'

/**
 * Map of known ACMG label variants to canonical form.
 * Covers: canonical values, title-case variants, and common abbreviations.
 */
const ACMG_NORMALIZATION: Record<string, AcmgClassification> = {
  // Canonical (pass-through)
  Pathogenic: 'Pathogenic',
  'Likely pathogenic': 'Likely pathogenic',
  'Uncertain significance': 'Uncertain significance',
  'Likely benign': 'Likely benign',
  Benign: 'Benign',
  // Title-case variants (old format)
  'Likely Pathogenic': 'Likely pathogenic',
  'Uncertain Significance': 'Uncertain significance',
  'Likely Benign': 'Likely benign',
  // Abbreviations
  P: 'Pathogenic',
  LP: 'Likely pathogenic',
  VUS: 'Uncertain significance',
  LB: 'Likely benign',
  B: 'Benign'
}

/**
 * Normalize an ACMG classification string to canonical form.
 * Returns null if the input is not a recognized ACMG value.
 */
export function normalizeAcmgClassification(raw: string): AcmgClassification | null {
  return ACMG_NORMALIZATION[raw] ?? null
}
