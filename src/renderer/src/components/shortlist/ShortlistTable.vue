<script setup lang="ts">
/**
 * ShortlistTable — pure presentational v-data-table specialized for the
 * case Shortlist tab.
 *
 * Receives `rows: ShortlistRow[]` as a prop and emits `row-click`,
 * `open-in-tab`, and `toggle-star`. No composable, no IPC — composition
 * into a host panel lives in ShortlistPanel.vue (Wave 5).
 *
 * Columns: # / Score / Type / Gene / Variant / Impact / AF / ClinVar /
 * ★ / actions. `rank_score` is non-sortable (ranking is the feature);
 * `variant_notation` is computed in the renderer from per-type fields so
 * SV / CNV / STR rows get type-appropriate notation. Type chips use
 * explicit palette colors per the CLAUDE.md "no surface-variant" rule.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import RankScoreTooltip from './RankScoreTooltip.vue'
import type { ShortlistRow } from '../../../../shared/types/shortlist'

const props = defineProps<{
  rows: ShortlistRow[]
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: 'snv' | 'sv' | 'cnv' | 'str'): void
  (e: 'toggle-star', row: ShortlistRow): void
}>()

const headers = [
  { title: '#', key: 'rank', width: 60, sortable: false },
  { title: 'Score', key: 'rank_score', width: 90, sortable: false },
  { title: 'Type', key: 'variant_type', width: 80, sortable: false },
  { title: 'Gene', key: 'gene_symbol', width: 140 },
  { title: 'Variant', key: 'variant_notation', width: 220, sortable: false },
  { title: 'Impact', key: 'consequence', width: 110 },
  { title: 'AF', key: 'gnomad_af', width: 90 },
  { title: 'ClinVar', key: 'clinvar', width: 130 },
  { title: '★', key: 'is_starred', width: 50, sortable: false },
  { title: '', key: 'actions', width: 80, sortable: false }
] as const

function variantNotation(row: ShortlistRow): string {
  if (row.variant_type === 'sv') {
    return `${row.chr}:${row.pos} ${row.sv_type ?? ''} ${row.sv_length ?? '?'}bp`.trim()
  }
  if (row.variant_type === 'cnv') {
    return `${row.chr}:${row.pos} CNV CN=${row.cnv_copy_number ?? '?'}`
  }
  if (row.variant_type === 'str') {
    return `${row.chr}:${row.pos} STR ${row.str_alt_copies ?? '?'} copies`
  }
  return `${row.chr}:${row.pos} ${row.ref}>${row.alt}`
}

function pinFor(row: ShortlistRow): 'starred' | 'clinvar' | null {
  if (row.rank_starred_pinned) return 'starred'
  if (row.rank_clinvar_pinned) return 'clinvar'
  return null
}

function typeChipColor(t: ShortlistRow['variant_type']): string {
  // NEVER surface-variant (CLAUDE.md rule). Use explicit palette entries.
  switch (t) {
    case 'snv':
      return 'primary'
    case 'indel':
      return 'primary'
    case 'sv':
      return 'deep-purple'
    case 'cnv':
      return 'teal-darken-2'
    case 'str':
      return 'orange-darken-2'
    default:
      return 'primary'
  }
}

function targetTabFor(t: ShortlistRow['variant_type']): 'snv' | 'sv' | 'cnv' | 'str' {
  if (t === 'sv' || t === 'cnv' || t === 'str') return t
  // indel (and any unknown) folds into the SNV tab.
  return 'snv'
}

function displayVariantType(t: ShortlistRow['variant_type']): string {
  return (t ?? 'snv').toUpperCase()
}
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="props.rows"
    item-value="id"
    density="compact"
    hide-default-footer
    :items-per-page="-1"
    @click:row="(_: MouseEvent, { item }: { item: ShortlistRow }) => emit('row-click', item)"
  >
    <template #[`item.rank_score`]="{ item }">
      <v-tooltip location="right">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps">{{ item.rank_score.toFixed(2) }}</span>
        </template>
        <RankScoreTooltip
          :score="item.rank_score"
          :components="item.rank_components"
          :pinned="pinFor(item)"
        />
      </v-tooltip>
    </template>

    <template #[`item.variant_type`]="{ item }">
      <v-chip :color="typeChipColor(item.variant_type)" size="x-small" variant="flat">
        {{ displayVariantType(item.variant_type) }}
      </v-chip>
    </template>

    <template #[`item.variant_notation`]="{ item }">
      {{ variantNotation(item) }}
    </template>

    <template #[`item.gnomad_af`]="{ item }">
      {{ item.gnomad_af == null ? '—' : item.gnomad_af.toExponential(2) }}
    </template>

    <template #[`item.is_starred`]="{ item }">
      <v-btn
        icon
        variant="text"
        size="x-small"
        :data-testid="`shortlist-star-${item.id}`"
        @click.stop="emit('toggle-star', item)"
      >
        <v-icon :color="item.is_starred ? 'primary' : undefined">
          {{ item.is_starred ? 'mdi-star' : 'mdi-star-outline' }}
        </v-icon>
      </v-btn>
    </template>

    <template #[`item.actions`]="{ item }">
      <v-menu>
        <template #activator="{ props: actProps }">
          <v-btn icon variant="text" size="x-small" v-bind="actProps">
            <v-icon>mdi-dots-vertical</v-icon>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item @click="emit('row-click', item)">
            <v-list-item-title>View details</v-list-item-title>
          </v-list-item>
          <v-list-item @click="emit('open-in-tab', targetTabFor(item.variant_type))">
            <v-list-item-title>
              View in {{ targetTabFor(item.variant_type).toUpperCase() }} tab
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </template>
  </v-data-table>
</template>
