<template>
  <div class="filter-toolbar-container">
    <!-- Main filter bar -->
    <v-toolbar
      density="default"
      flat
      class="filter-toolbar px-3 py-2"
      role="toolbar"
      aria-label="Variant filters"
    >
      <!-- Filter groups wrapper -->
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
                role="group"
                :aria-label="(filterGroupLabels[group.id] || group.id) + ' filter'"
              >
                <div class="filter-group-header">
                  <v-icon class="drag-handle" size="x-small">mdi-drag-vertical</v-icon>
                  <v-btn
                    size="x-small"
                    variant="text"
                    density="compact"
                    :icon="group.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    :aria-label="group.expanded ? 'Collapse filter' : 'Expand filter'"
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
                  <!-- GENERAL SEARCH GROUP -->
                  <div v-if="group.id === 'search'" class="filter-section search-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-magnify</v-icon>
                      <span>Search</span>
                    </div>
                    <v-text-field
                      v-model="filters.searchQuery"
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Gene, chr:pos, c./p. HGVS..."
                      prepend-inner-icon="mdi-magnify"
                      class="filter-input"
                      :class="{ 'filter-active': filters.searchQuery !== '' }"
                    />
                  </div>

                  <!-- GENE SEARCH GROUP -->
                  <div v-if="group.id === 'gene'" class="filter-section gene-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-dna</v-icon>
                      <span>Gene</span>
                    </div>
                    <v-autocomplete
                      v-model="filters.geneSymbol"
                      :items="geneSymbolSuggestions"
                      :loading="loadingSuggestions"
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Search gene symbol (e.g. BRCA1)"
                      prepend-inner-icon="mdi-magnify"
                      class="filter-input"
                      :class="{
                        'filter-active': filters.geneSymbol != null && filters.geneSymbol !== ''
                      }"
                      @update:search="searchGeneSymbols"
                      @click:clear="handleGeneClear"
                    />
                  </div>

                  <!-- VARIANT EFFECT GROUP -->
                  <div v-if="group.id === 'impact'" class="filter-section effect-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-flash</v-icon>
                      <span>Impact</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by predicted variant impact. HIGH: loss of function. MODERATE:
                          missense. LOW: synonymous.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                      <v-select
                        v-model="filters.consequences"
                        :items="filterOptions.consequences"
                        multiple
                        chips
                        closable-chips
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Specific..."
                        class="filter-input consequence-select"
                        :class="{ 'filter-active': filters.consequences.length > 0 }"
                      />
                    </div>
                  </div>

                  <!-- FUNCTIONAL ANNOTATION GROUP (Grouped Multi-Select) -->
                  <div v-if="group.id === 'function'" class="filter-section func-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-function</v-icon>
                      <span>Consequence</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by variant consequence: truncating (stop gained, frameshift),
                          missense, splice, non-coding, etc. Select groups or individual
                          types.</span
                        >
                      </v-tooltip>
                    </div>
                    <GroupedMultiSelect
                      v-model="filters.funcs"
                      :config="consequenceGroups"
                      :available-values="filterOptions.funcs"
                      label="Consequence"
                      placeholder="Select..."
                      icon="mdi-function"
                    />
                  </div>

                  <!-- CLINVAR GROUP (Grouped Multi-Select) -->
                  <div v-if="group.id === 'clinvar'" class="filter-section clinvar-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-hospital-box</v-icon>
                      <span>ClinVar</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by ClinVar pathogenicity: select groups (Pathogenic, VUS, Benign)
                          or individual classifications.</span
                        >
                      </v-tooltip>
                    </div>
                    <GroupedMultiSelect
                      v-model="filters.clinvars"
                      :config="clinvarGroups"
                      :available-values="filterOptions.clinvars"
                      label="ClinVar"
                      placeholder="Select..."
                      icon="mdi-hospital-box"
                    />
                  </div>

                  <!-- POPULATION FREQUENCY GROUP -->
                  <div v-if="group.id === 'frequency'" class="filter-section frequency-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
                      <span>Frequency</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Maximum gnomAD allele frequency. Lower = rarer in population. Unknown
                          frequencies are included.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                        v-model.number="filters.maxGnomadAf"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': filters.maxGnomadAf !== null }"
                        step="0.0001"
                        min="0"
                        max="1"
                      />
                    </div>
                  </div>

                  <!-- PATHOGENICITY GROUP -->
                  <div v-if="group.id === 'cadd'" class="filter-section pathogenicity-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-alert-circle</v-icon>
                      <span>CADD</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Minimum CADD phred score. Higher = more likely deleterious. 15+ moderate,
                          20+ high, 25+ very high. Unknown CADD included.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                        v-model.number="filters.minCadd"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': filters.minCadd !== null }"
                        step="1"
                        min="0"
                      />
                    </div>
                  </div>

                  <!-- TAGS GROUP -->
                  <div v-if="group.id === 'tags'" class="filter-section tags-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-tag-multiple</v-icon>
                      <span>Tags</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by variant tags. Selecting multiple tags shows variants with ANY
                          of the selected tags (OR logic).</span
                        >
                      </v-tooltip>
                    </div>
                    <v-select
                      v-model="filters.tagIds"
                      :items="availableTags"
                      item-title="name"
                      item-value="id"
                      multiple
                      chips
                      closable-chips
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Select..."
                      class="filter-input tags-select"
                      :class="{ 'filter-active': filters.tagIds.length > 0 }"
                    >
                      <template #chip="{ item }">
                        <v-chip
                          closable
                          size="small"
                          :color="(item.raw as Tag).color"
                          variant="flat"
                          @click:close="removeTagFilter((item.raw as Tag).id)"
                        >
                          {{ (item.raw as Tag).name }}
                        </v-chip>
                      </template>
                      <template #item="{ item, props: itemProps }">
                        <v-list-item v-bind="itemProps" :title="undefined">
                          <template #prepend>
                            <v-icon :color="(item.raw as Tag).color" size="small"
                              >mdi-circle</v-icon
                            >
                          </template>
                          <v-list-item-title>{{ (item.raw as Tag).name }}</v-list-item-title>
                        </v-list-item>
                      </template>
                    </v-select>
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

      <!-- RESULTS & ACTIONS (2x2 grid) -->
      <div class="results-section ml-auto">
        <v-chip
          :color="hasActiveFilters ? 'primary' : 'default'"
          :variant="hasActiveFilters ? 'flat' : 'tonal'"
          size="small"
          class="results-chip"
        >
          <v-icon start size="small">mdi-filter-variant</v-icon>
          <strong>{{ filteredCount.toLocaleString() }}</strong>
          <span class="mx-1 text-medium-emphasis">/</span>
          <span class="text-medium-emphasis">{{ totalCount.toLocaleString() }}</span>
        </v-chip>

        <v-btn
          :disabled="!hasActiveFilters"
          :color="hasActiveFilters ? 'error' : undefined"
          :variant="hasActiveFilters ? 'tonal' : 'text'"
          size="small"
          prepend-icon="mdi-filter-off"
          @click="clearAllFilters"
        >
          Clear
        </v-btn>

        <!-- Filter visibility menu (All Filters) -->
        <FilterVisibilityMenu
          :filter-groups="filterGroupsWithLabels"
          :active-filter-count="activeFilterCount"
          @toggle-visible="toggleFilterGroupVisible"
          @toggle-expand="toggleFilterGroupExpanded"
          @reorder="handleFilterReorder"
          @reset="resetFilterDefaults"
          @show-all="showAllFilters"
        />

        <!-- Column visibility menu -->
        <ColumnVisibilityMenu
          v-if="columns && columns.length > 0"
          :columns="orderedColumns"
          :visible-columns="visibleColumnKeys"
          table-id="variant-table"
          @toggle:column="toggleColumnVisibility"
          @reorder="setColumnOrder"
          @reset="resetColumnDefaults"
        />

        <!-- Export to Excel button -->
        <v-tooltip location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :loading="exporting"
              :disabled="filteredCount === 0"
              color="success"
              variant="tonal"
              size="small"
              prepend-icon="mdi-microsoft-excel"
              @click="exportToExcel"
            >
              Export
            </v-btn>
          </template>
          <span>Export {{ filteredCount.toLocaleString() }} variants to Excel</span>
        </v-tooltip>
      </div>
    </v-toolbar>

    <!-- Applied Filters Summary Bar -->
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
          @click:close="clearFilter(filter.id)"
        >
          <span class="font-weight-medium">{{ filter.label }}:</span>
          <span class="ml-1">{{ filter.value }}</span>
        </v-chip>
        <v-btn variant="text" size="x-small" color="error" class="ml-1" @click="clearAllFilters">
          Clear all
        </v-btn>
      </div>
    </v-expand-transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, toRef } from 'vue'
import draggable from 'vuedraggable'
import { useFilterState } from '../composables/useFilterState'
import { useFilterPreferences } from '../composables/useFilterPreferences'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import ColumnVisibilityMenu from './ColumnVisibilityMenu.vue'
import FilterVisibilityMenu from './FilterVisibilityMenu.vue'
import GroupedMultiSelect from './GroupedMultiSelect.vue'
import { consequenceGroups, clinvarGroups } from '../config/filterGroups'
import type { VariantFilter, Tag } from '../../../shared/types/api'

interface ColumnDef {
  key: string
  title: string
}

interface Props {
  caseId: number
  caseName: string
  filteredCount: number
  totalCount: number
  hasSort?: boolean
  initialSearch?: string
  columns?: ColumnDef[]
}

const props = defineProps<Props>()

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
  (e: 'reset-sort'): void
  (
    e: 'export-success',
    data: { filePath: string; action: { text: string; callback: () => void } }
  ): void
  (e: 'export-error', error: string): void
}

const emit = defineEmits<Emits>()

// Filter state composable - single source of truth for all filter logic
const hasSortRef = toRef(props, 'hasSort')
const {
  filters,
  filterOptions,
  geneSymbolSuggestions,
  loadingSuggestions,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  exporting,
  afPresets,
  caddPresets,
  impactPresets,
  availableTags,
  hasActiveFilters,
  activeFilterCount,
  activeFiltersList,
  isFilterGroupActive,
  clearFilter,
  removeTagFilter,
  clearAllFilters,
  handleGeneClear,
  searchGeneSymbols,
  loadFilterOptions,
  setInitialSearch,
  exportToExcel: composableExportToExcel
} = useFilterState(
  computed(() => props.caseId),
  {
    onFiltersUpdate: (f) => emit('update:filters', f),
    onResetSort: () => emit('reset-sort'),
    hasSortRef
  }
)

// Watch initialSearch prop to pre-populate search from cohort navigation
watch(
  () => props.initialSearch,
  (newSearch) => {
    if (newSearch !== undefined && newSearch !== '') {
      setInitialSearch(newSearch)
    }
  },
  { immediate: true }
)

// Export to Excel - wrapper that bridges composable result to emit events
const exportToExcel = async () => {
  const result = await composableExportToExcel(props.caseId, props.caseName)

  if (result === null) return

  if (!result.success && result.error !== undefined && result.error !== '') {
    emit('export-error', result.error)
  } else if (result.success && result.filePath !== undefined && result.filePath !== '') {
    emit('export-success', {
      filePath: result.filePath,
      action: {
        text: 'Open folder',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
        callback: () => (window as any).api.shell.showItemInFolder(result.filePath)
      }
    })
  }
}

// Filter preferences composable
const {
  filterGroups,
  visibleFilterGroups,
  setFilterGroupOrder,
  toggleFilterGroupExpanded,
  toggleFilterGroupVisible,
  resetToDefaults: resetFilterDefaults,
  showAll: showAllFilters
} = useFilterPreferences()

// Handle filter reorder from menu
const handleFilterReorder = (groups: { id: string; label: string; visible: boolean }[]) => {
  setFilterGroupOrder(groups.map((g) => g.id))
}

// Column preferences composable
const {
  prefs: columnPrefs,
  resetToDefaults: resetColumnDefaults,
  toggleColumnVisibility,
  setColumnOrder
} = useColumnPreferences('variant-table')

// Computed columns for ColumnVisibilityMenu
const orderedColumns = computed(() => {
  if (!props.columns) return []
  if (columnPrefs.value.order.length > 0) {
    return [...props.columns].sort((a, b) => {
      const aIdx = columnPrefs.value.order.indexOf(a.key)
      const bIdx = columnPrefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return props.columns
})

const visibleColumnKeys = computed(() => {
  return orderedColumns.value
    .filter((h) => columnPrefs.value.visibility[h.key] !== false)
    .map((h) => h.key)
})

// Filter group labels for menu
const filterGroupLabels: Record<string, string> = {
  search: 'Search',
  gene: 'Gene',
  impact: 'Impact',
  function: 'Function',
  clinvar: 'ClinVar',
  frequency: 'Frequency',
  cadd: 'CADD',
  tags: 'Tags'
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

// Horizontal scroll state
const scrollContainer = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

// Ordered filter groups with two-way binding for draggable (only visible ones)
const orderedFilterGroups = computed({
  get: () => visibleFilterGroups.value,
  set: (newOrder) => {
    setFilterGroupOrder(newOrder.map((g) => g.id))
  }
})

// Hidden filter count for right-scroll badge
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

// Load filter options on mount
onMounted(async () => {
  await loadFilterOptions(props.caseId)

  // Setup scroll listeners
  scrollContainer.value?.addEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.addEventListener('resize', updateScrollButtons)
  updateScrollButtons()
})

onBeforeUnmount(() => {
  scrollContainer.value?.removeEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.removeEventListener('resize', updateScrollButtons)
})
</script>

<style scoped>
/* Import shared filter styles for DRY principle */
@import '../styles/_filter-common.scss';

.filter-toolbar-container {
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
  /* Add top padding to prevent clipping of filter labels */
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

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 4px 0 4px;
  min-width: fit-content;
}

.search-section {
  min-width: 160px;
}

.search-section .filter-input {
  width: 100%;
}

.gene-section {
  min-width: 160px;
}

.gene-section .filter-input {
  width: 100%;
}

.effect-section .consequence-select {
  max-width: 130px;
}

.func-section {
  min-width: 140px;
}

.clinvar-section {
  min-width: 140px;
}

.tags-section .tags-select {
  min-width: 120px;
  max-width: 180px;
}

.custom-input {
  max-width: 90px;
}

.section-label {
  display: flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
  margin-top: 2px;
}

.section-label .v-icon {
  opacity: 0.7;
}

.info-icon {
  opacity: 0.5;
  cursor: help;
}

.info-icon:hover {
  opacity: 1;
}

.divider-subtle {
  opacity: 0.3;
}

.filter-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: rgba(var(--v-theme-primary), 0.04);
}

/* Visual indicator for active filters - adds checkmark icon */
.filter-input.filter-active :deep(.v-field__prepend-inner .v-icon)::after {
  content: '';
  position: absolute;
  top: -4px;
  right: -4px;
  width: 8px;
  height: 8px;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
}

.filter-input :deep(.v-field) {
  border-radius: 6px;
  border-color: rgba(0, 0, 0, 0.15);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.filter-input :deep(.v-field--focused) {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.15);
}

.filter-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.results-chip {
  font-size: 0.85rem;
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

/* Collapsed filter group - just show small indicator */
.filter-section-wrapper.collapsed .filter-group-header {
  flex-direction: row;
}

/* Applied filters summary bar */
.applied-filters-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 16px;
  background: rgba(var(--v-theme-primary), 0.04);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}

.applied-filters-bar .v-chip {
  max-width: 200px;
}

.applied-filters-bar .v-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
