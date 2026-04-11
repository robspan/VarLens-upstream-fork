import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

/**
 * CNV scoring.
 *
 * Impact branching on cnv_copy_number:
 *   - CN == 0 (homozygous deletion) -> impact 1.0 (highest)
 *   - CN == 1 (heterozygous del) or CN >= 3 (duplication) -> impact 0.66
 *   - CN == 2 (neutral) -> impact 0
 *   - CN NULL -> impact 0
 *
 * Pathogenicity is the caller-reported copy-number quality normalised to
 * [0, 1] with a hard cap at 100. NULL quality -> pathogenicity 0.
 *
 * Rarity is fixed at 1.0: no per-event population frequency source wired
 * for CNVs yet.
 */
export function scoreCnv(row: ShortlistCandidate): RankComponents {
  const cn = row.cnv_copy_number
  const impact = cn == null ? 0 : cn <= 0 ? 1.0 : cn === 1 || cn >= 3 ? 0.66 : 0
  return {
    impact,
    pathogenicity:
      row.cnv_copy_number_quality == null ? 0 : Math.min(row.cnv_copy_number_quality / 100, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
