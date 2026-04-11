import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'
import { SCORING_CONFIG } from './scoring-config'

/**
 * STR (short tandem repeat / expansion) scoring.
 *
 * Formula:
 *
 *   impact =
 *     str_status === 'pathologic'   → pathologicImpact
 *     str_status === 'intermediate' → intermediateImpact
 *     otherwise                     → normalOrUnknownImpact
 *
 *   pathogenicity = knownLocus
 *                     ? knownLocusPathogenicity
 *                     : unknownLocusPathogenicity
 *   rarity        = rarityPlaceholder    // no STR frequency source wired
 *   clinvar       = knownLocus
 *                     ? knownLocusClinvarShortcut   // bypass string match
 *                     : mapClinvarBoost(clinvar)
 *   phenotype     = hpo_sim_score ?? defaults.nullPhenotypeScore
 *
 * `knownLocus` is true iff `str_disease` is non-null and non-empty (after
 * trim).
 *
 * The known-locus ClinVar short-circuit is the deliberate design call —
 * Mendelian expansion loci (HTT, FMR1, C9orf72, etc.) are effectively
 * always pathogenic when their status is pathologic/intermediate, even
 * if the source VCF lacks a direct ClinVar string match for the sample's
 * exact expansion. Using `knownLocusClinvarShortcut` (set to 0.9 in the
 * config, matching the Likely_pathogenic boost) lets these rows
 * participate in `clinvarPinTop` without forcing the ClinVar string to
 * resolve.
 *
 * Null-value contracts:
 *   - str_status null     → impact normalOrUnknownImpact
 *   - str_disease null    → unknown locus → unknownLocusPathogenicity
 *   - clinvar null        → falls through to mapClinvarBoost (returns 0)
 *   - hpo_sim_score null  → phenotype defaults.nullPhenotypeScore
 *
 * Every numeric threshold lives in `scoring-config.ts#str`.
 */
export function scoreStr(row: ShortlistCandidate): RankComponents {
  const { str, defaults } = SCORING_CONFIG
  const statusImpact =
    row.str_status === 'pathologic'
      ? str.pathologicImpact
      : row.str_status === 'intermediate'
        ? str.intermediateImpact
        : str.normalOrUnknownImpact
  const knownLocus = row.str_disease != null && row.str_disease.trim() !== ''
  return {
    impact: statusImpact,
    pathogenicity: knownLocus ? str.knownLocusPathogenicity : str.unknownLocusPathogenicity,
    rarity: str.rarityPlaceholder,
    clinvar: knownLocus ? str.knownLocusClinvarShortcut : mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? defaults.nullPhenotypeScore
  }
}
