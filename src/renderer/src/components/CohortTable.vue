<template>
  <div class="cohort-table-container">
    <!-- IPC Error Banner (SOL-11) -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="error = null"
    >
      <div class="d-flex align-center justify-space-between">
        <span>{{ error.message || 'Failed to load cohort data' }}</span>
        <v-btn variant="tonal" size="small" prepend-icon="mdi-refresh" @click="handleRetry">
          Retry
        </v-btn>
      </div>
    </v-alert>

    <!-- Filter Bar -->
    <CohortFilterBar
      :total-count="totalCount"
      :cohort-summary="summary"
      :columns="orderedColumns.map((h) => ({ key: h.key, title: h.title }))"
      :visible-columns="visibleHeaders.map((h) => h.key)"
      :exporting="annotationDialogsRef?.exporting ?? false"
      :has-sort="currentSortBy !== undefined"
      @filter-change="handleFilterChange"
      @clear-all="handleClearAll"
      @clear-filter="handleClearFilter"
      @export="handleExport"
      @toggle-column="toggleColumnVisibility"
      @reorder-columns="setColumnOrder"
      @reset-columns="resetToDefaults"
    />

    <!-- Data Table -->
    <CohortDataTable
      ref="dataTableRef"
      :variants="variants"
      :total-count="totalCount ?? 0"
      :loading="isLoading"
      :headers="visibleHeaders"
      :page="currentPage"
      :selected-variant-key="selectedVariantKey"
      :is-global-starred="isGlobalStarred"
      :get-global-acmg-classification="getGlobalAcmgClassification"
      :get-global-comment="getGlobalComment"
      @update:options="handleTableOptions"
      @row-click="handleRowClick"
      @star-toggle="handleStarToggle"
      @acmg-select="handleAcmgSelect"
      @acmg-evidence-click="handleAcmgEvidenceClick"
      @comment-click="handleCommentClick"
      @navigate-to-case="handleNavigateToCase"
      @load-carriers="handleLoadCarriers"
      @column-filters-change="handleColumnFiltersChange"
    />

    <!-- Annotation Dialogs (Comment, ACMG Evidence, Snackbar) -->
    <CohortAnnotationDialogs
      ref="annotationDialogsRef"
      :annotation-actions="annotationActions"
      :filter-state="filterState"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
// Composables
import { useCohortData } from '../composables/useCohortData'
import { useFilters } from '../composables/useFilters'
import { useCarriers } from '../composables/useCarriers'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useSettingsStore } from '../stores/settingsStore'
// Sub-components
import CohortFilterBar from './cohort/CohortFilterBar.vue'
import CohortDataTable from './cohort/CohortDataTable.vue'
import CohortAnnotationDialogs from './cohort/CohortAnnotationDialogs.vue'
// Column composable
import { useCohortColumns } from './cohort/useCohortColumns'
// Types
import type { CohortVariant, CohortPaginationCursor } from '../../../shared/types/cohort'

// Emit for navigation and row click
const emit = defineEmits<{
  'navigate-to-case': [
    payload: {
      caseId: number
      chr: string
      pos: number
      ref: string
      alt: string
      geneSymbol: string | null
      cdna: string | null
    }
  ]
  'row-click': [variant: CohortVariant]
}>()

// Composables
const {
  variants,
  totalCount,
  isLoading,
  error,
  summary,
  nextCursor,
  fetchVariants,
  queryVariants,
  fetchSummary
} = useCohortData()

// Cursor tracking: page number -> cursor to use for that page
// Page 1 has no cursor (first page), page 2 uses cursor from page 1, etc.
const pageCursors = ref<Map<number, CohortPaginationCursor>>(new Map())
const currentPage = ref(1)
const currentSortBy = ref<string | undefined>(undefined)
const currentSortOrder = ref<'asc' | 'desc'>('desc')
const settingsStore = useSettingsStore()
const currentItemsPerPage = ref(settingsStore.itemsPerPage)
// useFilters is a singleton - CohortFilterBar and CohortTable share the same state
const { filters, searchTerm, selectedImpactPresets, clearAllFilters, clearFilter } = useFilters()
const { loadCarriers } = useCarriers()
const {
  isGlobalStarred,
  getGlobalAcmgClassification,
  getGlobalAcmgEvidence,
  getGlobalComment,
  loadGlobalAnnotationsBatch,
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  upsertGlobalComment,
  getAnnotations
} = useAnnotations()
const { prefs, resetToDefaults, toggleColumnVisibility, setColumnOrder } =
  useColumnPreferences('cohort-table')

// Column management
const { orderedColumns, visibleHeaders } = useCohortColumns(prefs)

// Per-column text filters from CohortDataTable
const cohortColumnFilters = ref<Record<string, string> | undefined>(undefined)

// Local state
const dataTableRef = ref<InstanceType<typeof CohortDataTable> | null>(null)
const selectedVariantKey = ref<string | null>(null)
const annotationDialogsRef = ref<InstanceType<typeof CohortAnnotationDialogs> | null>(null)

// Annotation actions passed to CohortAnnotationDialogs
const annotationActions = {
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  upsertGlobalComment,
  getGlobalAcmgEvidence,
  getGlobalComment,
  getAnnotations
}

// Filter state passed to CohortAnnotationDialogs for export
const filterState = {
  searchTerm,
  filters,
  selectedImpactPresets
}

// Build query params from filter state
// NOTE: buildQueryParams is temporary scaffolding. Phase 28 (DRY-07, DRY-09) will
// introduce shared filter serialization utilities that this function should use.
// For now, implement inline to maintain Phase 29's independence from Phase 28.
const buildQueryParams = (cursor?: CohortPaginationCursor) => ({
  limit: currentItemsPerPage.value,
  cursor,
  sort_order: (currentSortOrder.value ?? 'desc') as 'asc' | 'desc',
  sort_by: currentSortBy.value,
  search_term: searchTerm.value || undefined,
  gene_symbol: filters.value.geneSymbol || undefined,
  consequences: selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined,
  funcs: filters.value.funcs.length > 0 ? filters.value.funcs : undefined,
  clinvars: filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined,
  gnomad_af_max: filters.value.maxGnomadAf ?? undefined,
  cadd_min: filters.value.minCadd ?? undefined,
  cohort_frequency_min: filters.value.minCohortFrequency ?? undefined,
  starred_only: filters.value.starredOnly || undefined,
  has_comment: filters.value.hasCommentOnly || undefined,
  acmg_classifications:
    filters.value.acmgClassifications.length > 0
      ? [...filters.value.acmgClassifications]
      : undefined,
  column_filters: cohortColumnFilters.value
})

// Shared helper: invalidate cursor cache, reset to page 1, and reload
const invalidateAndReload = async () => {
  pageCursors.value.clear()
  currentPage.value = 1
  await fetchVariants(buildQueryParams())
}

// Event handlers
const handleFilterChange = () => invalidateAndReload()

const handleClearAll = async () => {
  clearAllFilters()
  dataTableRef.value?.resetSort()
  currentSortBy.value = undefined
  currentSortOrder.value = 'desc'
  await invalidateAndReload()
}

const handleClearFilter = async (filterId: string) => {
  clearFilter(filterId)
  await invalidateAndReload()
}

// Re-entrancy guard: intermediate cursor fetches update reactive state which
// triggers @update:options, causing infinite loops without this guard.
let tableOptionsLoading = false

const handleTableOptions = async (options: {
  page: number
  itemsPerPage: number
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>
}) => {
  if (tableOptionsLoading) return
  tableOptionsLoading = true
  try {
    const newSortBy = options.sortBy.length > 0 ? options.sortBy[0].key : undefined
    const newSortOrder = (options.sortBy.length > 0 ? options.sortBy[0].order : 'desc') as
      | 'asc'
      | 'desc'

    // Reset cursors if sort or page size changed
    const sortChanged = newSortBy !== currentSortBy.value || newSortOrder !== currentSortOrder.value
    const pageSizeChanged = options.itemsPerPage !== currentItemsPerPage.value
    if (sortChanged || pageSizeChanged) {
      pageCursors.value.clear()
      currentPage.value = 1
    }
    currentSortBy.value = newSortBy
    currentSortOrder.value = newSortOrder
    currentItemsPerPage.value = options.itemsPerPage

    // Determine effective page
    const effectivePage = sortChanged || pageSizeChanged ? 1 : options.page

    // For cursor-based pagination, if the target page has no cached cursor,
    // sequentially fetch forward from the nearest cached page to build up cursors.
    // This handles "Last page" and arbitrary page jumps correctly.
    if (effectivePage > 1 && !pageCursors.value.has(effectivePage)) {
      // Find the highest page <= effectivePage that has a cursor (or page 1)
      let startPage = 1
      for (let p = effectivePage; p > 1; p--) {
        if (pageCursors.value.has(p)) {
          startPage = p
          break
        }
      }

      // Fetch intermediate pages to fill cursor gaps.
      // Uses queryVariants (non-reactive) to avoid triggering table re-renders.
      for (let p = startPage; p < effectivePage; p++) {
        const intermediateCursor =
          p === 1 ? undefined : JSON.parse(JSON.stringify(pageCursors.value.get(p)))
        const intermediateParams = {
          ...buildQueryParams(intermediateCursor),
          limit: options.itemsPerPage,
          sort_by: newSortBy,
          sort_order: newSortOrder
        }
        const result = await queryVariants(intermediateParams)
        if (result.next_cursor && result.has_more) {
          pageCursors.value.set(p + 1, result.next_cursor)
        }
      }
    }

    // Fetch the target page
    const cursor =
      effectivePage === 1
        ? undefined
        : pageCursors.value.has(effectivePage)
          ? JSON.parse(JSON.stringify(pageCursors.value.get(effectivePage)))
          : undefined

    const baseParams = buildQueryParams(cursor)
    const params = {
      ...baseParams,
      limit: options.itemsPerPage,
      sort_by: newSortBy,
      sort_order: newSortOrder
    }

    await fetchVariants(params)
    currentPage.value = effectivePage

    // Store cursor for next page based on the page we actually loaded
    if (nextCursor.value) {
      pageCursors.value.set(effectivePage + 1, nextCursor.value)
    }
  } finally {
    tableOptionsLoading = false
  }
}

const handleRowClick = (variant: CohortVariant) => {
  selectedVariantKey.value = variant.variant_key
  emit('row-click', variant)
}

const handleColumnFiltersChange = async (
  filters: Record<string, string> | undefined
): Promise<void> => {
  cohortColumnFilters.value = filters
  await invalidateAndReload()
}

const handleRetry = async () => {
  error.value = null
  await invalidateAndReload()
}

// Delegate annotation events to CohortAnnotationDialogs
const handleStarToggle = (item: CohortVariant) => {
  annotationDialogsRef.value?.handleStarToggle(item)
}

const handleAcmgSelect = (payload: {
  item: CohortVariant
  classification: import('../../../main/database/types').AcmgClassification | null
}) => {
  annotationDialogsRef.value?.handleAcmgSelect(payload)
}

const handleAcmgEvidenceClick = (item: CohortVariant) => {
  annotationDialogsRef.value?.openAcmgEvidenceDialog(item)
}

const handleCommentClick = (item: CohortVariant) => {
  annotationDialogsRef.value?.openCommentDialog(item)
}

const handleExport = () => {
  annotationDialogsRef.value?.exportToExcel()
}

const handleNavigateToCase = (payload: { caseId: number; item: CohortVariant }) => {
  emit('navigate-to-case', {
    caseId: payload.caseId,
    chr: payload.item.chr,
    pos: payload.item.pos,
    ref: payload.item.ref,
    alt: payload.item.alt,
    geneSymbol: payload.item.gene_symbol,
    cdna: payload.item.cdna
  })
}

const handleLoadCarriers = async (variant: CohortVariant) => {
  await loadCarriers(variant)
}

// Watch variants and load annotations
watch(variants, async (newVariants) => {
  if (newVariants.length > 0) {
    await loadGlobalAnnotationsBatch(
      newVariants.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
    )
  }
})

// Lifecycle
onMounted(async () => {
  void fetchSummary()
  await fetchVariants(buildQueryParams())
})

// Expose refresh method
const refresh = async () => {
  void fetchSummary()
  await fetchVariants(buildQueryParams())
}
defineExpose({ refresh })
</script>

<style scoped>
/* CohortTable fills remaining height in flex parent.
   height: 100% is needed because the parent v-tabs-window-item is display: block,
   so flex: 1 alone has no effect. */
.cohort-table-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
