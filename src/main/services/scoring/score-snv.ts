import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapConsequenceImpact, mapClinvarBoost } from './index'
import { SCORING_CONFIG } from './scoring-config'

/**
 * SNV / indel scoring. Applies to BOTH `'snv'` and `'indel'` variant types.
 *
 * Formula (all five components bounded to [0, 1]):
 *
 *   impact        = mapConsequenceImpact(consequence)            // VEP IMPACT table
 *   pathogenicity = min(cadd / caddSaturationCeiling, 1)         // linear → 1.0 at the ceiling
 *   rarity        = max(0, 1 - min(af / rarityUpperCutoffAf, 1)) // linear 0..cutoff
 *   clinvar       = mapClinvarBoost(clinvar)                     // ClinVar significance table
 *   phenotype     = hpo_sim_score ?? defaults.nullPhenotypeScore
 *
 * Null-value contracts:
 *   - consequence null  → impact 0   (unknown consequence ≠ high-impact)
 *   - cadd null         → pathogenicity 0
 *   - gnomad_af null    → rarity nullRarityDefault (1.0: absence of evidence
 *                         in gnomAD ≠ evidence of absence; novel variants
 *                         surface to the top)
 *   - clinvar null      → clinvar 0
 *   - hpo_sim_score null → phenotype 0
 *
 * Every numeric threshold lives in `scoring-config.ts`; every rationale
 * comment is on the corresponding field in that file.
 */
export function scoreSnv(row: ShortlistCandidate): RankComponents {
  const { snv, defaults } = SCORING_CONFIG
  return {
    impact: mapConsequenceImpact(row.consequence),
    pathogenicity: row.cadd == null ? 0 : Math.min(row.cadd / snv.caddSaturationCeiling, 1),
    rarity:
      row.gnomad_af == null
        ? snv.nullRarityDefault
        : Math.max(0, 1 - Math.min(row.gnomad_af / snv.rarityUpperCutoffAf, 1)),
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? defaults.nullPhenotypeScore
  }
}
