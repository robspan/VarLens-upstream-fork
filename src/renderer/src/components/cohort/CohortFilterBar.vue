<template>
  <div class="filter-toolbar-container">
    <v-toolbar density="default" flat class="filter-toolbar px-3 py-2">
      <!-- Filter groups wrapper -->
      <div class="filter-groups-scroll">
        <div class="filter-groups-container">
          <!-- Search filter -->
          <div class="filter-section search-section">
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

          <!-- Gene filter (autocomplete matching Case Analysis) -->
          <div class="filter-section gene-section">
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
          <div class="filter-section impact-section">
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

          <!-- Function/Consequence filter (GroupedMultiSelect matching FilterToolbar) -->
          <div class="filter-section func-section">
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
                  Filter by variant consequence: truncating (stop gained, frameshift), missense,
                  splice, non-coding, etc. Select groups or individual types.
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

          <!-- ClinVar filter (GroupedMultiSelect matching FilterToolbar) -->
          <div class="filter-section clinvar-section">
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
                  Filter by ClinVar pathogenicity: select groups (Pathogenic, VUS, Benign) or
                  individual classifications.
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
          <div class="filter-section cohort-freq-section">
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
          <div class="filter-section frequency-section">
            <div class="section-label">
              <v-icon size="small" class="mr-1">mdi-earth</v-icon>
              <span>gnomAD AF</span>
              <v-tooltip location="top" max-width="280">
                <template #activator="{ props: tooltipProps }">
                  <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                    mdi-information-outline
                  </v-icon>
                </template>
                <span> Maximum allele frequency in gnomAD. Lower values = rarer variants. </span>
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
          <div class="filter-section cadd-section">
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

      <!-- Results & Actions (matching FilterToolbar layout) -->
      <div class="results-section ml-auto">
        <v-chip
          :color="hasActiveFilters ? 'primary' : 'default'"
          :variant="hasActiveFilters ? 'flat' : 'tonal'"
          size="small"
          class="results-chip"
        >
          <v-icon start size="small">mdi-filter-variant</v-icon>
          <strong>{{ totalCount?.toLocaleString() ?? '0' }}</strong>
          <template v-if="cohortSummary && hasActiveFilters">
            <span class="mx-1 text-medium-emphasis">/</span>
            <span class="text-medium-emphasis">{{
              cohortSummary.unique_variants?.toLocaleString() ?? '0'
            }}</span>
          </template>
        </v-chip>

        <v-btn
          :disabled="!hasActiveFilters"
          :color="hasActiveFilters ? 'error' : undefined"
          :variant="hasActiveFilters ? 'tonal' : 'text'"
          size="small"
          prepend-icon="mdi-filter-off"
          @click="handleClearAll"
        >
          Clear
        </v-btn>

        <!-- Placeholder for filter visibility menu -->
        <div class="placeholder-cell"></div>

        <ColumnVisibilityMenu
          :columns="columns"
          :visible-columns="visibleColumns"
          table-id="cohort-table"
          @toggle:column="handleToggleColumn"
          @reorder="handleReorderColumns"
          @reset="handleResetColumns"
        />

        <!-- Export button -->
        <v-tooltip location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :disabled="totalCount === 0 || exporting"
              :loading="exporting"
              color="success"
              variant="tonal"
              size="small"
              prepend-icon="mdi-microsoft-excel"
              @click="handleExport"
            >
              Export
            </v-btn>
          </template>
          <span>Export cohort variants to Excel</span>
        </v-tooltip>

        <!-- Empty cell to complete grid -->
        <div class="placeholder-cell"></div>
      </div>
    </v-toolbar>

    <!-- Applied Filters Summary Bar (matching FilterToolbar) -->
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
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useFilters } from '../../composables/useFilters'
import { useDebounce } from '../../composables/useDebounce'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import ColumnVisibilityMenu from '../ColumnVisibilityMenu.vue'
import { consequenceGroups, clinvarGroups } from '../../config/filterGroups'
import type { CohortVariant } from '../../../../shared/types/cohort'

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

// Impact presets matching Case Analysis
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Cohort frequency presets
const cohortFreqPresets = [
  { label: '≥50%', value: 0.5 },
  { label: '≥25%', value: 0.25 },
  { label: '≥10%', value: 0.1 }
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

// Gene autocomplete state (DRY: matches FilterToolbar pattern)
const geneSymbolSuggestions = ref<string[]>([])
const loadingGeneSuggestions = ref(false)

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

.results-section {
  display: grid;
  grid-template-columns: auto auto auto;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  flex-shrink: 0;
  align-self: flex-start;
}

.placeholder-cell {
  /* Empty cell placeholder for grid alignment */
}
</style>
