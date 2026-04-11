import type { RankComponents, ShortlistCandidate } from '../../../shared/types/shortlist'
import { mapConsequenceImpact, mapClinvarBoost } from './index'

/**
 * SNV / indel scoring.
 *
 * NULL defaults:
 *   - consequence NULL -> impact 0
 *   - cadd NULL         -> pathogenicity 0
 *   - gnomad_af NULL    -> rarity 1.0 (assume rare until proven otherwise)
 *   - clinvar NULL      -> clinvar 0
 *   - hpo_sim_score NULL -> phenotype 0
 *
 * The CADD curve saturates at 40 (CADD score threshold commonly cited as
 * the high-confidence damaging ceiling). Rarity curve is linear from
 * AF=0 (score 1.0) down to AF=0.01 (score 0.0); anything more common is
 * considered non-rare.
 *
 * Applies to BOTH `'snv'` and `'indel'` variant types.
 */
export function scoreSnv(row: ShortlistCandidate): RankComponents {
  return {
    impact: mapConsequenceImpact(row.consequence),
    pathogenicity: row.cadd == null ? 0 : Math.min(row.cadd / 40, 1),
    rarity: row.gnomad_af == null ? 1 : Math.max(0, 1 - Math.min(row.gnomad_af / 0.01, 1)),
    clinvar: mapClinvarBoost(row.clinvar),
    phenotype: row.hpo_sim_score ?? 0
  }
}
