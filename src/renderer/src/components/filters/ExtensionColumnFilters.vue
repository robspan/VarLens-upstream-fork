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
import { logService } from '../../services/LogService'
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
// Dotted keys whose IPC fetch previously rejected. Tracked so an eager
// re-render does NOT re-fire the same failing fetch forever (the old
// template-side `getMeta()` fire-and-forget pattern caused a render loop on
// failure). Keys stay until the scope changes or the component remounts.
const failedKeys = ref<Set<string>>(new Set())

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

// Eagerly prefetch metadata for every visible extension column whenever the
// scope or the set of visible sections changes. Previously `getMeta()` was
// called directly from the template and fire-and-forgot an IPC request on
// every render — on failure, `metaMap[key]` stayed undefined, so the next
// render re-entered the fetch path, producing an infinite retry loop. Now
// the watch drives fetching (bounded by scope changes) and `getMeta()` is a
// pure cache lookup. Failed keys are tracked so a successful re-render
// doesn't re-fire the same failing fetch.
watch(
  () => ({ scope: props.scope, sections: typeSections.value }),
  async () => {
    if (typeSections.value.length === 0) return
    const fetches = typeSections.value.flatMap((section) =>
      section.columns.map(async (col) => {
        if (col.dottedKey in metaMap.value) return // already cached
        if (failedKeys.value.has(col.dottedKey)) return // previously failed
        try {
          const meta = await getColumnMeta(props.scope, col.dottedKey)
          metaMap.value[col.dottedKey] = meta
        } catch (err) {
          failedKeys.value.add(col.dottedKey)
          logService.warn(
            `Failed to load column meta for ${col.dottedKey}: ${
              err instanceof Error ? err.message : String(err)
            }`,
            'ExtensionColumnFilters'
          )
        }
      })
    )
    await Promise.all(fetches)
  },
  { immediate: true, deep: false }
)

function getMeta(dottedKey: string): ColumnFilterMeta | undefined {
  return metaMap.value[dottedKey]
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
