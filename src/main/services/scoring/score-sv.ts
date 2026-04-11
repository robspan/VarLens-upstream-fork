import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapClinvarBoost } from './index'

/**
 * SV scoring.
 *
 * NULL defaults / design choices:
 *   - No gnomAD-SV frequency source wired yet -> rarity = 1.0 (assume rare).
 *   - Pathogenicity is a proxy: sv_vaf * precision factor (precise = 1.0,
 *     imprecise = 0.7). Imprecise calls are penalised because confidence
 *     in the breakpoint — and therefore the called VAF — is lower.
 *   - sv_vaf NULL defaults to 0.5 (middling).
 *   - Large SVs (>=1kb) score impact 1.0; smaller SVs score 0.66.
 *   - sv_length NULL falls into the "small" bucket (0.66) on purpose:
 *     unknown length is not a confident large-event signal.
 */
export function scoreSv(row: ShortlistCandidate): RankComponents {
  const precisionFactor = row.sv_is_precise === 1 ? 1.0 : 0.7
  const vaf = row.sv_vaf ?? 0.5
  return {
    impact: row.sv_length != null && row.sv_length >= 1000 ? 1.0 : 0.66,
    pathogenicity: Math.min(vaf * precisionFactor, 1),
    rarity: 1.0,
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
