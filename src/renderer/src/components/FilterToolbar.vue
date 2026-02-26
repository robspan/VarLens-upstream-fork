<template>
  <div class="filter-toolbar-container">
    <!-- Slim single-row toolbar -->
    <v-defaults-provider
      :defaults="{ VBtn: { size: 'small' }, VTextField: { density: 'compact' } }"
    >
      <v-toolbar
        density="compact"
        flat
        class="filter-toolbar px-2"
        role="toolbar"
        aria-label="Variant filters"
      >
        <!-- Search field — always visible -->
        <v-text-field
          v-model="filters.searchQuery"
          variant="outlined"
          hide-details
          clearable
          placeholder="Gene, chr:pos, c./p. HGVS..."
          prepend-inner-icon="mdi-magnify"
          class="filter-search-input mr-2"
          :class="{ 'filter-active': filters.searchQuery !== '' }"
        />

        <!-- Star toggle -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :color="filters.starredOnly ? 'amber-darken-2' : undefined"
              :variant="filters.starredOnly ? 'flat' : 'text'"
              density="compact"
              icon
              @click="toggleStarred"
            >
              <v-icon size="small">{{
                filters.starredOnly ? 'mdi-star' : 'mdi-star-outline'
              }}</v-icon>
            </v-btn>
          </template>
          {{
            filters.starredOnly
              ? 'Showing starred only — click to clear'
              : 'Show starred variants only'
          }}
        </v-tooltip>

        <!-- Comment toggle -->
        <v-tooltip location="bottom">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :color="filters.hasCommentOnly ? 'primary' : undefined"
              :variant="filters.hasCommentOnly ? 'flat' : 'text'"
              density="compact"
              icon
              @click="toggleCommented"
            >
              <v-icon size="small">{{
                filters.hasCommentOnly ? 'mdi-comment-text' : 'mdi-comment-text-outline'
              }}</v-icon>
            </v-btn>
          </template>
          {{
            filters.hasCommentOnly
              ? 'Showing commented only — click to clear'
              : 'Show variants with comments only'
          }}
        </v-tooltip>

        <!-- ACMG classification chips -->
        <v-chip-group v-model="filters.acmgClassifications" multiple class="ml-2 flex-nowrap">
          <v-chip
            v-for="cls in acmgFilterOptions"
            :key="cls.value"
            :value="cls.value"
            :color="cls.color"
            filter
            variant="outlined"
            size="small"
          >
            {{ cls.label }}
          </v-chip>
        </v-chip-group>

        <!-- Tag filter -->
        <v-select
          v-if="availableTags.length > 0"
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
          placeholder="Tags..."
          prepend-inner-icon="mdi-tag-multiple"
          class="filter-tag-input ml-1"
          :class="{ 'filter-active': filters.tagIds.length > 0 }"
        >
          <template #chip="{ item }">
            <v-chip
              closable
              size="x-small"
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
                <v-icon :color="(item.raw as Tag).color" size="small">mdi-circle</v-icon>
              </template>
              <v-list-item-title>{{ (item.raw as Tag).name }}</v-list-item-title>
            </v-list-item>
          </template>
        </v-select>

        <v-spacer />

        <!-- Result count chip -->
        <v-chip
          :color="hasActiveFilters ? 'primary' : 'default'"
          :variant="hasActiveFilters ? 'flat' : 'tonal'"
          size="small"
          class="results-chip mr-1"
        >
          <v-icon start size="small">mdi-filter-variant</v-icon>
          <strong>{{ filteredCount.toLocaleString() }}</strong>
          <span class="mx-1 text-medium-emphasis">/</span>
          <span class="text-medium-emphasis">{{ totalCount.toLocaleString() }}</span>
        </v-chip>

        <!-- Clear filters -->
        <v-btn
          :disabled="!hasActiveFilters"
          :color="hasActiveFilters ? 'error' : undefined"
          :variant="hasActiveFilters ? 'tonal' : 'text'"
          @click="clearAllFilters"
        >
          <v-icon start size="small">mdi-filter-off</v-icon>
          Clear
          <v-tooltip activator="parent" location="bottom">Clear all filters</v-tooltip>
        </v-btn>

        <!-- Open filter drawer -->
        <v-btn variant="tonal" @click="filterDrawerOpen = true">
          <v-icon start size="small">mdi-filter-variant</v-icon>
          Filters
          <v-badge
            v-if="activeFilterCount > 0"
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

        <!-- Columns drawer -->
        <v-btn
          v-if="columns && columns.length > 0"
          variant="tonal"
          @click="columnsDrawerOpen = true"
        >
          <v-icon start size="small">mdi-table-column</v-icon>
          Columns
          <v-tooltip activator="parent" location="bottom">Show/hide and reorder columns</v-tooltip>
        </v-btn>

        <!-- Export -->
        <v-btn
          :loading="exporting"
          :disabled="filteredCount === 0"
          color="success"
          variant="tonal"
          @click="exportToExcel"
        >
          <v-icon start size="small">mdi-microsoft-excel</v-icon>
          Export
          <v-tooltip activator="parent" location="bottom">
            Export {{ filteredCount.toLocaleString() }} variants to Excel
          </v-tooltip>
        </v-btn>
      </v-toolbar>
    </v-defaults-provider>

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

    <!-- Annotation filter hint when active but 0 results -->
    <v-expand-transition>
      <div
        v-if="(filters.starredOnly || filters.hasCommentOnly) && filteredCount === 0"
        class="annotation-hint-bar"
      >
        <v-icon size="small" class="mr-1">mdi-information-outline</v-icon>
        <span class="text-caption">
          No variants match the annotation filter. Star or comment on variants first, then filter.
        </span>
      </div>
    </v-expand-transition>

    <!-- Filter drawer (right-side slide-out panel) -->
    <FilterDrawer v-model:open="filterDrawerOpen" />

    <!-- Columns drawer (right-side slide-out panel) -->
    <ColumnsDrawer
      v-if="columns && columns.length > 0"
      v-model:open="columnsDrawerOpen"
      :columns="orderedColumns"
      :visible-columns="visibleColumnKeys"
      table-id="variant-table"
      @toggle:column="toggleColumnVisibility"
      @reorder="setColumnOrder"
      @reset="resetColumnDefaults"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, toRef, provide } from 'vue'
import { useFilterState } from '../composables/useFilterState'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import ColumnsDrawer from './ColumnsDrawer.vue'
import FilterDrawer from './FilterDrawer.vue'
import type { VariantFilter, Tag } from '../../../shared/types/api'
import type { FilterDrawerState } from './filterDrawerTypes'

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

// Toggle methods for star/comment (explicit methods avoid template reactivity issues)
const toggleStarred = () => {
  filters.value.starredOnly = !filters.value.starredOnly
}
const toggleCommented = () => {
  filters.value.hasCommentOnly = !filters.value.hasCommentOnly
}

// ACMG classification options
const acmgFilterOptions = [
  { value: 'Pathogenic', label: 'P', color: 'error' },
  { value: 'Likely Pathogenic', label: 'LP', color: 'deep-orange' },
  { value: 'VUS', label: 'VUS', color: 'warning' },
  { value: 'Likely Benign', label: 'LB', color: 'blue-grey' },
  { value: 'Benign', label: 'B', color: 'success' }
] as const

// Drawer states
const filterDrawerOpen = ref(false)
const columnsDrawerOpen = ref(false)

// Provide shared filter state for FilterDrawer (via provide/inject)
provide<FilterDrawerState>('filterDrawerState', {
  filters,
  filterOptions,
  geneSymbolSuggestions,
  loadingSuggestions,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
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
  searchGeneSymbols
})

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

// Column preferences composable
const {
  prefs: columnPrefs,
  resetToDefaults: resetColumnDefaults,
  toggleColumnVisibility,
  setColumnOrder
} = useColumnPreferences('variant-table')

// Computed columns for ColumnsDrawer
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

// Load filter options on mount
onMounted(async () => {
  await loadFilterOptions(props.caseId)
})
</script>

<style scoped>
.filter-toolbar-container {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgb(var(--v-theme-surface));
}

.filter-toolbar {
  background: transparent !important;
}

.filter-search-input {
  max-width: 240px;
  flex-shrink: 1;
}

.filter-search-input :deep(.v-field) {
  border-radius: 6px;
  border-color: rgba(0, 0, 0, 0.15);
}

.filter-search-input :deep(.v-field--focused) {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.15);
}

.filter-search-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.filter-search-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: rgba(var(--v-theme-primary), 0.04);
}

.filter-tag-input {
  max-width: 200px;
  flex-shrink: 1;
}

.filter-tag-input :deep(.v-field) {
  border-radius: 6px;
  border-color: rgba(0, 0, 0, 0.15);
}

.filter-tag-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.filter-tag-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: rgba(var(--v-theme-primary), 0.04);
}

.results-chip {
  font-size: 0.85rem;
}

/* Applied filters summary bar */
.applied-filters-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 16px;
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

/* Annotation hint bar */
.annotation-hint-bar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  background: rgba(var(--v-theme-warning), 0.08);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
