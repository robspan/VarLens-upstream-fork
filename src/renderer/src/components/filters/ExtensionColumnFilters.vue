<template>
  <div class="extension-column-filters">
    <v-expansion-panels
      v-if="typeSections.length > 0"
      variant="accordion"
      multiple
      class="extension-filter-accordion"
    >
      <v-expansion-panel
        v-for="section in typeSections"
        :key="section.typeKey"
        :title="section.label"
      >
        <v-expansion-panel-text>
          <div
            v-for="col in section.columns"
            :key="col.dottedKey"
            class="extension-filter-row mb-3"
          >
            <div class="text-caption text-medium-emphasis mb-1">{{ col.label }}</div>
            <NumericRangeControl
              v-if="col.kind === 'number'"
              :model-value="getFilterValue(col.dottedKey)"
              :meta="getMeta(col.dottedKey)"
              @update:model-value="updateFilter(col.dottedKey, $event)"
            />
            <EnumSelectControl
              v-else-if="col.kind === 'enum'"
              :model-value="getFilterValue(col.dottedKey)"
              :meta="getMeta(col.dottedKey)"
              @update:model-value="updateFilter(col.dottedKey, $event)"
            />
            <TextFilterControl
              v-else
              :model-value="getFilterValue(col.dottedKey)"
              :meta="getMeta(col.dottedKey)"
              @update:model-value="updateFilter(col.dottedKey, $event)"
            />
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <div v-else class="text-caption text-medium-emphasis py-2">
      No structural variants in the current scope.
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ExtensionColumnFilters — shared filter UI surface mounted in the case
 * view filter drawer, cohort filter bar, and burden analysis panel.
 *
 * Responsibilities:
 * - Iterate `VARIANT_EXTENSION_REGISTRY` to discover type sections and
 *   their columns.
 * - Call `ensureTypesPresent(scope)` to auto-hide variant-type sections
 *   that have NO data in the current case/cohort (so single-SNV datasets
 *   don't show empty SV/CNV/STR accordions).
 * - Lazy-load per-column metadata via `getColumnMeta(scope, dottedKey)`
 *   on first cell render, caching subsequent accesses via `metaMap`.
 * - Dispatch `update:modelValue` with a NEW `ColumnFiltersParam` map each
 *   time a control changes.
 *
 * The component is a *view layer* — it does not apply filters itself. The
 * parent (FilterToolbar / CohortFilterBar) receives the updated map via
 * `v-model` and pipes it through FilterState + useFilters.buildIpcParams.
 */
import { computed, ref, watch } from 'vue'
import type {
  ColumnFilter,
  ColumnFiltersParam,
  ColumnFilterMeta
} from '../../../../shared/types/column-filters'
import {
  VARIANT_EXTENSION_REGISTRY,
  type FilterKind
} from '../../../../shared/types/variant-extension-registry-data'
import { useVariantColumnMeta } from '../../composables/useVariantColumnMeta'
import NumericRangeControl from './NumericRangeControl.vue'
import EnumSelectControl from './EnumSelectControl.vue'
import TextFilterControl from './TextFilterControl.vue'

interface Scope {
  caseId?: number
  caseIds?: number[]
}

const props = defineProps<{
  scope: Scope
  modelValue: ColumnFiltersParam
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFiltersParam]
}>()

const { getColumnMeta, ensureTypesPresent } = useVariantColumnMeta()
const typesPresent = ref<Set<string>>(new Set())
const metaMap = ref<Record<string, ColumnFilterMeta>>({})

watch(
  () => props.scope,
  async (next) => {
    try {
      typesPresent.value = await ensureTypesPresent(next)
    } catch {
      // Swallow — the drawer stays hidden on failure. The main-side handler
      // logs via mainLogger; the renderer doesn't need to surface a toast
      // here because the filter drawer is a non-critical affordance.
      typesPresent.value = new Set()
    }
  },
  { immediate: true, deep: true }
)

interface TypeSection {
  typeKey: string
  label: string
  columns: Array<{
    dottedKey: string
    label: string
    kind: FilterKind
  }>
}

const typeSections = computed<TypeSection[]>(() => {
  const sections: TypeSection[] = []
  for (const [typeKey, def] of Object.entries(VARIANT_EXTENSION_REGISTRY)) {
    if (!typesPresent.value.has(def.variantTypeValue)) continue
    const columns: TypeSection['columns'] = []
    for (const [colName, colDef] of Object.entries(def.columns)) {
      const dottedKey = `${typeKey}.${colName}`
      columns.push({
        dottedKey,
        label: colDef.label ?? colName.replace(/_/g, ' '),
        kind: colDef.kind
      })
    }
    sections.push({
      typeKey,
      label: typeKey.toUpperCase(),
      columns
    })
  }
  return sections
})

function getFilterValue(dottedKey: string): ColumnFilter | undefined {
  return props.modelValue[dottedKey]
}

function getMeta(dottedKey: string): ColumnFilterMeta | undefined {
  const existing = metaMap.value[dottedKey]
  if (existing !== undefined) return existing
  // Fetch lazily — first render triggers the load, subsequent updates use cache.
  // The void + .then pattern is intentional: we do NOT want to await here
  // (a computed template binding cannot be async), so we fire-and-forget
  // and let the reactive `metaMap` re-render the control when the promise
  // resolves.
  void getColumnMeta(props.scope, dottedKey)
    .then((meta) => {
      metaMap.value[dottedKey] = meta
    })
    .catch(() => {
      // Metadata failure degrades gracefully: controls render without
      // min/max hints or enum options. Parent can still type values.
    })
  return undefined
}

function updateFilter(dottedKey: string, filter: ColumnFilter | undefined): void {
  const next: ColumnFiltersParam = { ...props.modelValue }
  if (filter === undefined) {
    delete next[dottedKey]
  } else {
    next[dottedKey] = filter
  }
  emit('update:modelValue', next)
}
</script>
