<script setup lang="ts">
/**
 * RankScoreTooltip — pure presentational content for the v-tooltip attached
 * to a shortlist row's `rank_score` cell.
 *
 * Shows the total score plus the per-component breakdown
 * (impact / pathogenicity / rarity / clinvar / phenotype) so reviewers can
 * audit WHY a row ranked where it did. When the row was promoted by
 * `clinvarPinTop` or `pinStarredTop`, a "Pinned: ..." footer line is shown.
 *
 * Stateless: no composable, no IPC. Composition lives in ShortlistPanel
 * (Wave 5).
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import type { RankComponents } from '../../../../shared/types/shortlist'

const props = defineProps<{
  score: number
  components: RankComponents
  pinned: 'starred' | 'clinvar' | null
}>()

interface Row {
  label: string
  value: number
}

const rows: Row[] = [
  { label: 'Impact', value: props.components.impact },
  { label: 'Pathogenicity', value: props.components.pathogenicity },
  { label: 'Rarity', value: props.components.rarity },
  { label: 'ClinVar', value: props.components.clinvar },
  { label: 'Phenotype', value: props.components.phenotype }
]

function pinLabel(): string {
  if (props.pinned === 'starred') return 'Pinned: Starred'
  if (props.pinned === 'clinvar') return 'Pinned: ClinVar P/LP'
  return ''
}
</script>

<template>
  <div class="rank-tooltip">
    <div class="rank-tooltip__score">Rank score: {{ score.toFixed(2) }}</div>
    <v-divider class="my-1" />
    <div v-for="row in rows" :key="row.label" class="rank-tooltip__row">
      <span class="rank-tooltip__label">{{ row.label }}</span>
      <span class="rank-tooltip__value">{{ row.value.toFixed(2) }}</span>
    </div>
    <template v-if="pinned !== null">
      <v-divider class="my-1" />
      <div class="rank-tooltip__pin">{{ pinLabel() }}</div>
    </template>
  </div>
</template>

<style scoped>
.rank-tooltip {
  font-size: 0.82rem;
  min-width: 180px;
}
.rank-tooltip__score {
  font-weight: 600;
}
.rank-tooltip__row {
  display: flex;
  justify-content: space-between;
}
.rank-tooltip__label {
  opacity: 0.75;
}
.rank-tooltip__pin {
  font-style: italic;
  font-size: 0.78rem;
}
</style>
