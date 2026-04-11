import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

/**
 * STR (short tandem repeat / expansion) scoring.
 *
 * Impact derives from `str_status`:
 *   - 'pathologic'   -> 1.0
 *   - 'intermediate' -> 0.66
 *   - everything else -> 0
 *
 * Pathogenicity reflects whether the locus has a known disease link:
 *   - known locus (non-empty str_disease) -> 1.0
 *   - unknown locus -> 0.5 (partial credit: expansion called but unclear
 *     clinical significance)
 *
 * For known-locus STRs we short-circuit ClinVar to 0.9 — these are
 * Mendelian expansion loci that are effectively always pathogenic when
 * status is pathologic/intermediate, even if the CA VCF lacks a direct
 * ClinVar string match.
 *
 * Rarity is fixed at 1.0: STR population frequency is not modelled here.
 */
export function scoreStr(row: ShortlistCandidate): RankComponents {
  const statusImpact =
    row.str_status === 'pathologic' ? 1.0 : row.str_status === 'intermediate' ? 0.66 : 0
  const knownLocus = row.str_disease != null && row.str_disease.trim() !== ''
  return {
    impact: statusImpact,
    pathogenicity: knownLocus ? 1.0 : 0.5,
    rarity: 1.0,
    clinvar: knownLocus ? 0.9 : mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
