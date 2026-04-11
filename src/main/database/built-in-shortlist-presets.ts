/**
 * Built-in shortlist presets seeded by migration v27.
 *
 * Each preset defines a `ShortlistConfig` that drives the two-stage
 * candidate-generation + ranking pipeline backing the unified case
 * Shortlist tab. The `config.rankConfig.weights` feed the scoring
 * module's `combine()` step; `clinvarPinTop` / `pinStarredTop` pin
 * classes of rows above the score-driven ordering.
 *
 * `baseFilters` / `perTypeOverrides` only reference filter fields that
 * already exist on `FilterState` (`consequences`, `maxGnomadAf`,
 * `minCadd`, `inheritanceModes`), so no new filter plumbing is needed
 * in downstream waves.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§5 built-in presets)
 */

import type { ShortlistConfig } from '../../shared/types/shortlist'

export interface BuiltInShortlistPreset {
  name: string
  description: string
  sortOrder: number
  config: ShortlistConfig
}

export const BUILT_IN_SHORTLIST_PRESETS: readonly BuiltInShortlistPreset[] = [
  {
    name: 'Tier 1 candidates',
    description:
      'Strict ranking: rare HIGH/MOD impact, top-50. ClinVar P/LP and starred variants pinned to top.',
    sortOrder: 0,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 50,
      baseFilters: {
        // Intentionally NO `clinvars` hard filter — the preset RANKS via
        // clinvarPinTop, it does not gate on ClinVar. A rare HIGH SNV with
        // no ClinVar entry is still a Tier 1 candidate.
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.001
      },
      perTypeOverrides: {
        sv: { maxGnomadAf: 0.01 },
        cnv: { maxGnomadAf: 0.01 },
        str: {}
      },
      rankConfig: {
        weights: { impact: 0.25, pathogenicity: 0.25, rarity: 0.25, clinvar: 0.25, phenotype: 0 },
        clinvarPinTop: true,
        pinStarredTop: true
      },
      tieBreakers: [
        { key: 'cadd', order: 'desc' },
        { key: 'chr', order: 'asc' },
        { key: 'pos', order: 'asc' }
      ]
    }
  },
  {
    name: 'All rare damaging',
    description: 'Broad shortlist: any rare HIGH/MOD variant. Score-driven ordering, no pins.',
    sortOrder: 1,
    config: {
      variantTypeScope: ['snv', 'indel', 'sv', 'cnv', 'str'],
      topN: 200,
      baseFilters: {
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.01,
        minCadd: 15
      },
      rankConfig: {
        weights: { impact: 0.4, pathogenicity: 0.3, rarity: 0.3, clinvar: 0, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [{ key: 'cadd', order: 'desc' }]
    }
  },
  {
    name: 'Recessive candidates',
    description: 'SNV/indel only. Homozygous or compound-het inheritance. Rare coding impact.',
    sortOrder: 2,
    config: {
      variantTypeScope: ['snv', 'indel'],
      topN: 100,
      baseFilters: {
        consequences: ['HIGH', 'MODERATE'],
        maxGnomadAf: 0.02,
        inheritanceModes: ['homozygous', 'candidate_compound_het', 'autosomal_recessive']
      },
      rankConfig: {
        weights: { impact: 0.3, pathogenicity: 0.2, rarity: 0.3, clinvar: 0.2, phenotype: 0 },
        clinvarPinTop: false,
        pinStarredTop: false
      },
      tieBreakers: [
        { key: 'gene_symbol', order: 'asc' },
        { key: 'cadd', order: 'desc' }
      ]
    }
  }
] as const
