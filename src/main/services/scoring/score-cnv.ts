import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'
import { SCORING_CONFIG } from './scoring-config'

/**
 * CNV scoring.
 *
 * Formula:
 *
 *   impact =
 *     cn == null                            → neutralOrUnknownImpact
 *     cn <= homozygousDeletionCnCutoff      → homozygousDeletionImpact
 *     cn === heterozygousDeletionCn         → partialLossOrGainImpact
 *     cn >= duplicationCnCutoff             → partialLossOrGainImpact
 *     otherwise (neutral diploid, CN == 2)  → neutralOrUnknownImpact
 *
 *   pathogenicity = cnv_copy_number_quality == null
 *                     ? 0
 *                     : min(cnv_copy_number_quality / qualitySaturationCeiling, 1)
 *   rarity        = rarityPlaceholder    // no CNV frequency source wired
 *   clinvar       = mapClinvarBoost(clinvar)
 *   phenotype     = hpo_sim_score ?? defaults.nullPhenotypeScore
 *
 * Null-value contracts:
 *   - cnv_copy_number null         → impact neutralOrUnknownImpact
 *                                    (unknown is treated as neutral on
 *                                    purpose — caller didn't produce a
 *                                    usable number)
 *   - cnv_copy_number_quality null → pathogenicity 0
 *   - clinvar null                 → clinvar 0
 *   - hpo_sim_score null           → phenotype defaults.nullPhenotypeScore
 *
 * Every numeric threshold lives in `scoring-config.ts#cnv`.
 */
export function scoreCnv(row: ShortlistCandidate): RankComponents {
  const { cnv, defaults } = SCORING_CONFIG
  const cn = row.cnv_copy_number
  let impact: number
  if (cn == null) {
    impact = cnv.neutralOrUnknownImpact
  } else if (cn <= cnv.homozygousDeletionCnCutoff) {
    impact = cnv.homozygousDeletionImpact
  } else if (cn === cnv.heterozygousDeletionCn || cn >= cnv.duplicationCnCutoff) {
    impact = cnv.partialLossOrGainImpact
  } else {
    impact = cnv.neutralOrUnknownImpact
  }
  return {
    impact,
    pathogenicity:
      row.cnv_copy_number_quality == null
        ? 0
        : Math.min(row.cnv_copy_number_quality / cnv.qualitySaturationCeiling, 1),
    rarity: cnv.rarityPlaceholder,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? defaults.nullPhenotypeScore
  }
}
