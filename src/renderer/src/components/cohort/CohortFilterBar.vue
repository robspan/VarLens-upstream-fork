<template>
  <div class="filter-toolbar-container">
    <v-toolbar density="default" flat class="filter-toolbar px-3 py-2">
      <!-- Filter groups wrapper with scroll arrows -->
      <div class="filter-groups-wrapper">
        <v-btn
          v-if="canScrollLeft"
          icon="mdi-chevron-left"
          size="x-small"
          variant="text"
          class="scroll-arrow"
          @click="scrollLeft"
        />

        <div ref="scrollContainer" class="filter-groups-scroll">
          <draggable
            v-model="orderedFilterGroups"
            class="filter-groups-container"
            item-key="id"
            :animation="200"
            handle=".drag-handle"
          >
            <template #item="{ element: group }">
              <div
                class="filter-section-wrapper"
                :class="{ collapsed: !group.expanded }"
                :data-filter-id="group.id"
              >
                <div class="filter-group-header">
                  <v-icon class="drag-handle" size="x-small">mdi-drag-vertical</v-icon>
                  <v-btn
                    size="x-small"
                    variant="text"
                    density="compact"
                    :icon="group.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    @click="toggleFilterGroupExpanded(group.id)"
                  />
                </div>

                <!-- Collapsed label (rotated 90 degrees) with active indicator -->
                <div
                  v-if="!group.expanded"
                  class="collapsed-label"
                  @click="toggleFilterGroupExpanded(group.id)"
                >
                  <v-badge
                    v-if="isFilterGroupActive(group.id)"
                    dot
                    color="primary"
                    offset-x="-2"
                    offset-y="-2"
                  >
                    <span>{{ filterGroupLabels[group.id] || group.id }}</span>
                  </v-badge>
                  <span v-else>{{ filterGroupLabels[group.id] || group.id }}</span>
                </div>

                <div v-if="group.expanded" class="filter-group-content">
                  <!-- Search filter -->
                  <div v-if="group.id === 'search'" class="filter-section search-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-magnify</v-icon>
                      <span>Search</span>
                    </div>
                    <v-text-field
                      :model-value="searchTerm"
                      prepend-inner-icon="mdi-magnify"
                      placeholder="Gene, position, HGVS..."
                      clearable
                      density="compact"
                      variant="outlined"
                      hide-details
                      class="filter-input"
                      :class="{ 'filter-active': searchTerm !== '' }"
                      @update:model-value="handleSearchChange"
                    />
                  </div>

                  <!-- Gene filter -->
                  <div v-if="group.id === 'gene'" class="filter-section gene-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-dna</v-icon>
                      <span>Gene</span>
                    </div>
                    <v-autocomplete
                      v-model="filters.geneSymbol"
                      :items="geneSymbolSuggestions"
                      :loading="loadingGeneSuggestions"
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Search gene symbol (e.g. BRCA1)"
                      prepend-inner-icon="mdi-magnify"
                      class="filter-input"
                      :class="{ 'filter-active': filters.geneSymbol !== '' }"
                      @update:search="searchGeneSymbols"
                    />
                  </div>

                  <!-- Impact filter -->
                  <div v-if="group.id === 'impact'" class="filter-section impact-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-flash</v-icon>
                      <span>Impact</span>
                    </div>
                    <v-chip-group v-model="selectedImpactPresets" multiple>
                      <v-chip
                        v-for="preset in impactPresets"
                        :key="preset.value"
                        :value="preset.value"
                        :color="preset.color"
                        filter
                        variant="outlined"
                        size="small"
                      >
                        {{ preset.label }}
                      </v-chip>
                    </v-chip-group>
                  </div>

                  <!-- Function/Consequence filter -->
                  <div v-if="group.id === 'function'" class="filter-section func-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-function</v-icon>
                      <span>Consequence</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <span>
                          Filter by variant consequence: truncating (stop gained, frameshift),
                          missense, splice, non-coding, etc. Select groups or individual types.
                        </span>
                      </v-tooltip>
                    </div>
                    <GroupedMultiSelect
                      v-model="filters.funcs"
                      :config="consequenceGroups"
                      label="Consequence"
                      placeholder="Select..."
                      icon="mdi-function"
                    />
                  </div>

                  <!-- ClinVar filter -->
                  <div v-if="group.id === 'clinvar'" class="filter-section clinvar-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-hospital-box</v-icon>
                      <span>ClinVar</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <span>
                          Filter by ClinVar pathogenicity: select groups (Pathogenic, VUS, Benign)
                          or individual classifications.
                        </span>
                      </v-tooltip>
                    </div>
                    <GroupedMultiSelect
                      v-model="filters.clinvars"
                      :config="clinvarGroups"
                      label="ClinVar"
                      placeholder="Select..."
                      icon="mdi-hospital-box"
                    />
                  </div>

                  <!-- Cohort Frequency filter (unique to cohort) -->
                  <div v-if="group.id === 'cohort-freq'" class="filter-section cohort-freq-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
                      <span>Cohort Freq</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <span>
                          Minimum frequency within the cohort. Higher values = more common variants.
                        </span>
                      </v-tooltip>
                    </div>
                    <div class="preset-with-custom">
                      <v-chip-group v-model="selectedCohortFreqPreset">
                        <v-chip
                          v-for="preset in cohortFreqPresets"
                          :key="preset.value"
                          :value="preset.value"
                          filter
                          variant="outlined"
                          size="small"
                          color="purple"
                        >
                          {{ preset.label }}
                        </v-chip>
                      </v-chip-group>
                      <v-text-field
                        v-model.number="customCohortFreq"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom %"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': customCohortFreq != null }"
                        step="1"
                        min="0"
                        max="100"
                      />
                    </div>
                  </div>

                  <!-- gnomAD Frequency filter -->
                  <div v-if="group.id === 'frequency'" class="filter-section frequency-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-earth</v-icon>
                      <span>gnomAD AF</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <span>
                          Maximum allele frequency in gnomAD. Lower values = rarer variants.
                        </span>
                      </v-tooltip>
                    </div>
                    <div class="preset-with-custom">
                      <v-chip-group v-model="selectedAfPreset">
                        <v-chip
                          v-for="preset in afPresets"
                          :key="preset.value"
                          :value="preset.value"
                          filter
                          variant="outlined"
                          size="small"
                          color="teal"
                        >
                          {{ preset.label }}
                        </v-chip>
                      </v-chip-group>
                      <v-text-field
                        v-model.number="customGnomadAf"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom %"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': customGnomadAf != null }"
                        step="0.001"
                        min="0"
                        max="100"
                      />
                    </div>
                  </div>

                  <!-- CADD filter -->
                  <div v-if="group.id === 'cadd'" class="filter-section cadd-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-alert-circle</v-icon>
                      <span>CADD</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                            mdi-information-outline
                          </v-icon>
                        </template>
                        <span>
                          Minimum CADD phred score. Higher scores = more likely deleterious. Typical
                          thresholds: 15 (top 3%), 20 (top 1%), 25 (top 0.3%).
                        </span>
                      </v-tooltip>
                    </div>
                    <div class="preset-with-custom">
                      <v-chip-group v-model="selectedCaddPreset">
                        <v-chip
                          v-for="preset in caddPresets"
                          :key="preset.value"
                          :value="preset.value"
                          filter
                          variant="outlined"
                          size="small"
                          color="deep-purple"
                        >
                          {{ preset.label }}
                        </v-chip>
                      </v-chip-group>
                      <v-text-field
                        v-model.number="customCadd"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': customCadd != null }"
                        step="1"
                        min="0"
                        max="60"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </draggable>
        </div>

        <div v-if="canScrollRight" class="scroll-arrow-wrapper">
          <v-btn
            icon="mdi-chevron-right"
            size="x-small"
            variant="text"
            class="scroll-arrow scroll-arrow-right"
            @click="scrollRight"
          />
          <span v-if="hiddenFilterCount > 0" class="hidden-filter-badge">
            +{{ hiddenFilterCount }}
          </span>
        </div>
      </div>

      <!-- RESULTS & ACTIONS — 3-column grid, 2 rows -->
      <div class="results-wrapper ml-auto" :class="{ compact: compactActions }">
        <button
          class="compact-toggle"
          :title="compactActions ? 'Expand buttons' : 'Compact buttons'"
          @click="toggleCompactActions"
        >
          <v-icon size="x-small">{{
            compactActions ? 'mdi-chevron-double-left' : 'mdi-chevron-double-right'
          }}</v-icon>
        </button>
        <div class="results-section">
          <v-chip
            :color="hasActiveFilters ? 'primary' : 'default'"
            :variant="hasActiveFilters ? 'flat' : 'tonal'"
            size="small"
            class="results-chip"
          >
            <v-icon :start="!compactActions" size="small">mdi-filter-variant</v-icon>
            <template v-if="!compactActions">
              <strong>{{ totalCount?.toLocaleString() ?? '0' }}</strong>
              <template v-if="cohortSummary && hasActiveFilters">
                <span class="mx-1 text-medium-emphasis">/</span>
                <span class="text-medium-emphasis">{{
                  cohortSummary.unique_variants?.toLocaleString() ?? '0'
                }}</span>
              </template>
            </template>
            <v-tooltip v-if="compactActions" activator="parent" location="bottom">
              {{ totalCount?.toLocaleString() ?? '0' }} variants
            </v-tooltip>
          </v-chip>

          <v-btn
            :disabled="!hasActiveFilters"
            :color="hasActiveFilters ? 'error' : undefined"
            :variant="hasActiveFilters ? 'tonal' : compactActions ? 'tonal' : 'text'"
            size="small"
            @click="handleClearAll"
          >
            <v-icon :start="!compactActions" size="small">mdi-filter-off</v-icon>
            <template v-if="!compactActions">Clear</template>
            <v-tooltip activator="parent" location="bottom">Clear all filters</v-tooltip>
          </v-btn>

          <v-btn size="small" variant="tonal" @click="filterDrawerOpen = true">
            <v-icon :start="!compactActions" size="small">mdi-filter-variant</v-icon>
            <template v-if="!compactActions">All Filters</template>
            <v-badge
              v-if="activeFilterCount > 0 && !compactActions"
              :content="activeFilterCount"
              color="primary"
              inline
              class="ml-1"
            />
            <v-tooltip activator="parent" location="bottom">
              Open full filter panel{{
                activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''
              }}
            </v-tooltip>
          </v-btn>

          <FilterVisibilityMenu
            :filter-groups="filterGroupsWithLabels"
            :compact="compactActions"
            @toggle-visible="toggleFilterGroupVisible"
            @toggle-expand="toggleFilterGroupExpanded"
            @reorder="handleFilterReorder"
            @reset="resetFilterDefaults"
            @show-all="showAllFilters"
          />

          <v-btn
            v-if="columns && columns.length > 0"
            size="small"
            variant="tonal"
            @click="columnsDrawerOpen = true"
          >
            <v-icon :start="!compactActions" size="small">mdi-table-column</v-icon>
            <template v-if="!compactActions">Columns</template>
            <v-tooltip activator="parent" location="bottom">
              Show/hide and reorder columns
            </v-tooltip>
          </v-btn>

          <v-btn
            :disabled="totalCount === 0 || exporting"
            :loading="exporting"
            color="success"
            variant="tonal"
            size="small"
            @click="handleExport"
          >
            <v-icon :start="!compactActions" size="small">mdi-microsoft-excel</v-icon>
            <template v-if="!compactActions">Export</template>
            <v-tooltip activator="parent" location="bottom">
              Export cohort variants to Excel
            </v-tooltip>
          </v-btn>
        </div>
      </div>
    </v-toolbar>

    <!-- Applied Filters Summary Bar (matching FilterToolbar) -->
    <v-expand-transition>
      <div v-if="activeFiltersList.length > 0" class="applied-filters-bar">
        <span class="text-caption text-medium-emphasis mr-2">Active:</span>
        <v-chip
          v-for="filter in activeFiltersList"
          :key="filter.id"
          size="small"
          closable
          variant="tonal"
          color="primary"
          class="mr-1"
          @click:close="handleClearFilter(filter.id)"
        >
          <span class="font-weight-medium">{{ filter.label }}:</span>
          <span class="ml-1">{{ filter.value }}</span>
        </v-chip>
        <v-btn variant="text" size="x-small" color="error" class="ml-1" @click="handleClearAll">
          Clear all
        </v-btn>
      </div>
    </v-expand-transition>

    <!-- Columns drawer (right-side slide-out panel) -->
    <ColumnsDrawer
      v-if="columns && columns.length > 0"
      v-model:open="columnsDrawerOpen"
      :columns="columns"
      :visible-columns="visibleColumns"
      table-id="cohort-table"
      @toggle:column="handleToggleColumn"
      @reorder="handleReorderColumns"
      @reset="handleResetColumns"
    />

    <!-- Filter drawer (right-side slide-out panel) -->
    <CohortFilterDrawer v-model:open="filterDrawerOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, onMounted, onBeforeUnmount } from 'vue'
import draggable from 'vuedraggable'
import { useFilters } from '../../composables/useFilters'
import {
  useFilterPreferences,
  DEFAULT_COHORT_FILTER_GROUPS
} from '../../composables/useFilterPreferences'
import { useDebounce } from '../../composables/useDebounce'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import FilterVisibilityMenu from '../FilterVisibilityMenu.vue'
import ColumnsDrawer from '../ColumnsDrawer.vue'
import CohortFilterDrawer from './CohortFilterDrawer.vue'
import { consequenceGroups, clinvarGroups } from '../../config/filterGroups'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { CohortFilterDrawerState } from './cohortFilterDrawerTypes'

/**
 * Props for CohortFilterBar component
 */
interface Props {
  /** Total count of filtered variants */
  totalCount: number | null
  /** Cohort summary with total cases and unique variants */
  cohortSummary: { total_cases: number; unique_variants: number } | null
  /** Column definitions for visibility menu */
  columns: Array<{ key: string; title: string }>
  /** Currently visible column keys */
  visibleColumns: string[]
  /** Whether export is in progress */
  exporting: boolean
}

defineProps<Props>()

/**
 * Events emitted by CohortFilterBar
 */
const emit = defineEmits<{
  /** Emitted when filter state changes (debounced) */
  'filter-change': []
  /** Emitted when clear all button clicked */
  'clear-all': []
  /** Emitted when individual filter chip closed */
  'clear-filter': [filterId: string]
  /** Emitted when export button clicked */
  export: []
  /** Emitted when column visibility toggled */
  'toggle-column': [key: string]
  /** Emitted when columns reordered */
  'reorder-columns': [keys: string[]]
  /** Emitted when columns reset to defaults */
  'reset-columns': []
}>()

// Access filter state from composable
const {
  filters,
  searchTerm,
  selectedImpactPresets,
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
  customGnomadAf,
  customCadd,
  hasActiveFilters,
  activeFiltersList,
  clearAllFilters,
  clearFilter
} = useFilters()

// Filter preferences composable (cohort-specific storage key and groups)
const {
  filterGroups,
  visibleFilterGroups,
  setFilterGroupOrder,
  toggleFilterGroupExpanded,
  toggleFilterGroupVisible,
  resetToDefaults: resetFilterDefaults,
  showAll: showAllFilters
} = useFilterPreferences({
  storageKey: 'varlens_cohort_filter_groups_v1',
  defaultGroups: DEFAULT_COHORT_FILTER_GROUPS
})

// Drawer state
const columnsDrawerOpen = ref(false)
const filterDrawerOpen = ref(false)

// Compact actions toggle (persisted in localStorage, shared with FilterToolbar)
const COMPACT_STORAGE_KEY = 'varlens_compact_actions_v1'
// eslint-disable-next-line no-undef
const compactActions = ref(localStorage.getItem(COMPACT_STORAGE_KEY) === 'true')
const toggleCompactActions = () => {
  compactActions.value = !compactActions.value
  // eslint-disable-next-line no-undef
  localStorage.setItem(COMPACT_STORAGE_KEY, String(compactActions.value))
}

// Impact presets matching Case Analysis
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Cohort frequency presets
const cohortFreqPresets = [
  { label: '>=50%', value: 0.5 },
  { label: '>=25%', value: 0.25 },
  { label: '>=10%', value: 0.1 }
]

// gnomAD AF presets matching Case Analysis
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

// CADD presets matching Case Analysis
const caddPresets = [
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

// Filter group labels for display
const filterGroupLabels: Record<string, string> = {
  search: 'Search',
  gene: 'Gene',
  impact: 'Impact',
  function: 'Function',
  clinvar: 'ClinVar',
  'cohort-freq': 'Cohort Freq',
  frequency: 'gnomAD AF',
  cadd: 'CADD'
}

// Filter groups with labels for FilterVisibilityMenu (all groups, not just visible)
const filterGroupsWithLabels = computed(() =>
  filterGroups.value.map((g) => ({
    id: g.id,
    label: filterGroupLabels[g.id] || g.id,
    visible: g.visible,
    expanded: g.expanded
  }))
)

// Handle filter reorder from menu
const handleFilterReorder = (groups: { id: string; label: string; visible: boolean }[]) => {
  setFilterGroupOrder(groups.map((g) => g.id))
}

// Ordered filter groups with two-way binding for draggable (only visible ones)
const orderedFilterGroups = computed({
  get: () => visibleFilterGroups.value,
  set: (newOrder) => {
    setFilterGroupOrder(newOrder.map((g) => g.id))
  }
})

// Gene autocomplete state (DRY: matches FilterToolbar pattern)
const geneSymbolSuggestions = ref<string[]>([])
const loadingGeneSuggestions = ref(false)

// Computed: active filter count for badge display
const activeFilterCount = computed(() => activeFiltersList.value.length)

/**
 * Check whether a specific filter group has active filters.
 * Used by CohortFilterDrawer for "Active" chip display on each group.
 */
const isFilterGroupActive = (groupId: string): boolean => {
  switch (groupId) {
    case 'search':
      return searchTerm.value !== ''
    case 'gene':
      return filters.value.geneSymbol !== ''
    case 'impact':
      return selectedImpactPresets.value.length > 0
    case 'function':
      return filters.value.funcs.length > 0
    case 'clinvar':
      return filters.value.clinvars.length > 0
    case 'cohort-freq':
    case 'cohortFreq':
      return (
        filters.value.minCohortFrequency !== null &&
        !Number.isNaN(filters.value.minCohortFrequency) &&
        filters.value.minCohortFrequency > 0
      )
    case 'frequency':
      return (
        filters.value.maxGnomadAf !== null &&
        !Number.isNaN(filters.value.maxGnomadAf) &&
        filters.value.maxGnomadAf > 0
      )
    case 'cadd':
      return (
        filters.value.minCadd !== null &&
        !Number.isNaN(filters.value.minCadd) &&
        filters.value.minCadd >= 0
      )
    default:
      return false
  }
}

/**
 * Search gene symbols for autocomplete suggestions
 * Uses cohort:variants API with gene_symbol filter for fast partial matching
 * (DRY: same pattern as FilterToolbar.vue searchGeneSymbols)
 */
const searchGeneSymbols = async (query: string) => {
  if (!query || query.length < 2) {
    geneSymbolSuggestions.value = []
    return
  }

  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
  if (typeof window === 'undefined' || typeof (window as any).api === 'undefined') {
    return
  }

  loadingGeneSuggestions.value = true
  try {
    // Use gene_symbol filter (LIKE) for faster partial matching than FTS5 search_term
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.cohort.getVariants({
      gene_symbol: query,
      limit: 100
    })

    // Check for error response (wrapHandler returns {code, message} on error)
    if (result !== null && result !== undefined && 'code' in result) {
      geneSymbolSuggestions.value = []
      return
    }

    // Extract unique gene symbols from results
    const variants: CohortVariant[] = result?.data ?? []
    geneSymbolSuggestions.value = [
      ...new Set(variants.map((v) => v.gene_symbol).filter((s): s is string => s !== null))
    ]
  } catch {
    geneSymbolSuggestions.value = []
  } finally {
    loadingGeneSuggestions.value = false
  }
}

// Provide shared filter state for CohortFilterDrawer (via provide/inject)
provide<CohortFilterDrawerState>('cohortFilterDrawerState', {
  filters,
  searchTerm,
  selectedImpactPresets,
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
  customGnomadAf,
  customCadd,
  geneSymbolSuggestions,
  loadingGeneSuggestions,
  impactPresets,
  cohortFreqPresets,
  afPresets,
  caddPresets,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearAllFilters,
  clearFilter,
  searchGeneSymbols
})

// Debounced filter change emission
const { debouncedFn: emitFilterChange } = useDebounce(() => emit('filter-change'), 300)

/**
 * Filter change watchers with debounce emission
 *
 * Watches all filter state changes and emits 'filter-change' event
 * with 300ms debounce to parent for query execution.
 *
 * Bidirectional preset-custom sync is handled internally by useFilters composable:
 * - Preset selection -> updates filter state and clears custom input
 * - Custom input change -> updates filter state and clears preset
 *
 * This ensures UI consistency without duplicate logic in the component.
 */
watch(filters, () => emitFilterChange(), { deep: true })
watch(selectedImpactPresets, () => emitFilterChange())
watch([selectedCohortFreqPreset, selectedAfPreset, selectedCaddPreset], () => emitFilterChange())

/**
 * Handle search input change with debounce
 */
const handleSearchChange = (value: string | null) => {
  searchTerm.value = value ?? ''
  emitFilterChange()
}

/**
 * Handle clear all filters action
 */
const handleClearAll = () => {
  clearAllFilters()
  emit('clear-all')
}

/**
 * Handle clear individual filter action
 */
const handleClearFilter = (filterId: string) => {
  clearFilter(filterId)
  emit('clear-filter', filterId)
}

/**
 * Handle column visibility toggle
 */
const handleToggleColumn = (key: string) => {
  emit('toggle-column', key)
}

/**
 * Handle column reorder
 */
const handleReorderColumns = (keys: string[]) => {
  emit('reorder-columns', keys)
}

/**
 * Handle column reset to defaults
 */
const handleResetColumns = () => {
  emit('reset-columns')
}

/**
 * Handle export button click
 */
const handleExport = () => {
  emit('export')
}

// Horizontal scroll state
const scrollContainer = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const hiddenFilterCount = ref(0)

// Update scroll button visibility
const updateScrollButtons = () => {
  if (!scrollContainer.value) return
  const el = scrollContainer.value
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 1

  // Count filter groups whose right edge is beyond the visible area
  const visibleRight = el.scrollLeft + el.clientWidth
  const filterElements = el.querySelectorAll('.filter-section-wrapper')
  let hidden = 0
  filterElements.forEach((child) => {
    const childEl = child as HTMLElement
    if (childEl.offsetLeft + childEl.offsetWidth > visibleRight + 1) {
      hidden++
    }
  })
  hiddenFilterCount.value = hidden
}

// Scroll left
const scrollLeft = () => {
  scrollContainer.value?.scrollBy({ left: -200, behavior: 'smooth' })
}

// Scroll right
const scrollRight = () => {
  scrollContainer.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

// ResizeObserver to detect when the scroll container becomes visible (e.g., tab switch)
let resizeObserver: ResizeObserver | null = null

// Setup scroll listeners
onMounted(() => {
  scrollContainer.value?.addEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.addEventListener('resize', updateScrollButtons)

  // Use ResizeObserver to re-calculate scroll buttons when the container
  // transitions from hidden (0 dimensions) to visible (tab switch)
  if (scrollContainer.value) {
    resizeObserver = new ResizeObserver(() => updateScrollButtons())
    resizeObserver.observe(scrollContainer.value)
  }

  updateScrollButtons()
})

onBeforeUnmount(() => {
  scrollContainer.value?.removeEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.removeEventListener('resize', updateScrollButtons)
  resizeObserver?.disconnect()
})
</script>

<style scoped>
/* Import shared filter styles for DRY principle */
@import '../../styles/_filter-common.scss';

/* FilterToolbar-like styling for visual consistency */
.filter-toolbar-container {
  position: sticky;
  top: 48px; /* Below tabs */
  z-index: 3;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgb(var(--v-theme-surface));
}

.filter-toolbar {
  background: transparent !important;
  height: auto !important;
  align-items: flex-start !important;
  padding-top: 16px !important;
  padding-bottom: 16px !important;
}

.filter-groups-wrapper {
  display: flex;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.filter-groups-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: clip;
  min-width: 0;
  scrollbar-width: thin;
  padding-top: 4px;
}

.filter-groups-container {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 6px 2px 4px 2px;
  width: max-content;
}

.filter-section-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 2px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  padding: 6px;
}

.filter-section-wrapper.collapsed {
  padding: 6px 4px;
  min-height: 60px;
}

.collapsed-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  padding: 4px 0;
  white-space: nowrap;
}

.collapsed-label:hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.filter-group-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding-top: 2px;
}

.drag-handle {
  cursor: grab;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.drag-handle:hover {
  opacity: 0.8;
}

.drag-handle:active {
  cursor: grabbing;
}

.filter-group-content {
  flex: 1;
}

.scroll-arrow {
  flex-shrink: 0;
  align-self: center;
}

.scroll-arrow-wrapper {
  position: relative;
  flex-shrink: 0;
  align-self: center;
}

.hidden-filter-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: rgb(var(--v-theme-primary));
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 8px;
  pointer-events: none;
}

/* Collapsed filter group - just show small indicator */
.filter-section-wrapper.collapsed .filter-group-header {
  flex-direction: row;
}

.search-section {
  min-width: 180px;
}

.search-section .filter-input {
  width: 100%;
}

.gene-section {
  min-width: 140px;
}

.gene-section .filter-input {
  width: 100%;
}

.impact-section,
.cohort-freq-section,
.frequency-section,
.cadd-section {
  min-width: fit-content;
}

.func-section {
  min-width: 140px;
}

.func-section .func-select {
  min-width: 120px;
  max-width: 160px;
}

.clinvar-section {
  min-width: 140px;
}

.clinvar-section .clinvar-select {
  min-width: 120px;
  max-width: 160px;
}

.results-wrapper {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  align-self: flex-start;
}

.compact-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 8px 0 0 8px;
  border: none;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.35);
  transition:
    background 0.2s,
    color 0.2s;
}

.compact-toggle:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.results-section {
  display: grid;
  grid-template-columns: auto auto auto;
  gap: 4px 6px;
  padding: 8px 10px;
  border-radius: 0 8px 8px 0;
  background: rgba(var(--v-theme-on-surface), 0.03);
  align-items: center;
}

/* Compact mode: fixed-width grid cells prevent layout shift when filter state changes */
.results-wrapper.compact .results-section {
  justify-items: center;
}

.results-wrapper.compact .results-section > :deep(.v-btn),
.results-wrapper.compact .results-section > :deep(.v-chip) {
  min-width: 36px;
  justify-content: center;
}
</style>
