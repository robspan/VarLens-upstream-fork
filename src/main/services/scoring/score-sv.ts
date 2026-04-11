import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'
import { SCORING_CONFIG } from './scoring-config'

/**
 * SV scoring.
 *
 * Formula:
 *
 *   impact        = sv_length >= largeEventLengthThresholdBp
 *                     ? largeEventImpact
 *                     : smallEventImpact
 *   pathogenicity = min(vaf × precisionFactor, 1)
 *                   where vaf             = sv_vaf ?? nullVafDefault
 *                         precisionFactor = sv_is_precise === 1
 *                                             ? precisePathogenicityFactor
 *                                             : imprecisePathogenicityFactor
 *   rarity        = rarityPlaceholder    // no gnomAD-SV source wired yet
 *   clinvar       = mapClinvarBoost(clinvar)
 *   phenotype     = hpo_sim_score ?? defaults.nullPhenotypeScore
 *
 * Null-value contracts:
 *   - sv_vaf null         → vaf defaults to `nullVafDefault` (middling)
 *   - sv_is_precise null  → treated as imprecise (uses imprecise factor)
 *   - sv_length null      → falls into the "small" bucket on purpose —
 *                           unknown length is not a confident large-event signal
 *   - clinvar null        → clinvar 0
 *   - hpo_sim_score null  → phenotype defaults.nullPhenotypeScore
 *
 * Every numeric threshold lives in `scoring-config.ts#sv`.
 */
export function scoreSv(row: ShortlistCandidate): RankComponents {
  const { sv, defaults } = SCORING_CONFIG
  const precisionFactor =
    row.sv_is_precise === 1 ? sv.precisePathogenicityFactor : sv.imprecisePathogenicityFactor
  const vaf = row.sv_vaf ?? sv.nullVafDefault
  const impact =
    row.sv_length != null && row.sv_length >= sv.largeEventLengthThresholdBp
      ? sv.largeEventImpact
      : sv.smallEventImpact
  return {
    impact,
    pathogenicity: Math.min(vaf * precisionFactor, 1),
    rarity: sv.rarityPlaceholder,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? defaults.nullPhenotypeScore
  }
}
