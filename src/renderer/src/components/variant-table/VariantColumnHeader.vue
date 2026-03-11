<template>
  <div class="d-flex align-center justify-space-between header-wrapper">
    <div
      class="d-flex align-center flex-grow-1 sortable-header"
      :class="{ 'sorted-header': isSorted(headerColumn) }"
      @click="toggleSort(headerColumn)"
    >
      <span class="header-title">{{ headerColumn.title }}</span>
      <span v-if="isSorted(headerColumn)" class="sort-indicator ml-1">
        <v-icon size="x-small">{{ getSortIcon(headerColumn) }}</v-icon>
        <span v-if="sortIndex > 0" class="sort-priority">{{ sortIndex }}</span>
      </span>
      <v-icon v-else size="x-small" class="ml-1 sort-icon-inactive">mdi-sort</v-icon>
    </div>
    <v-menu :close-on-content-click="false" location="bottom">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon
          size="x-small"
          variant="text"
          :color="hasFilter ? 'primary' : undefined"
          @click.stop
        >
          <v-icon size="small">
            {{ hasFilter ? 'mdi-filter' : 'mdi-filter-outline' }}
          </v-icon>
          <v-tooltip activator="parent" location="bottom">Filter this column</v-tooltip>
        </v-btn>
      </template>
      <v-card min-width="250" max-width="350">
        <v-card-title class="text-subtitle-2 py-2"> Filter: {{ headerColumn.title }} </v-card-title>
        <v-divider />
        <v-card-text class="pa-3">
          <v-text-field
            :model-value="filterValue"
            label="Filter value"
            placeholder="Type to filter..."
            density="compact"
            variant="outlined"
            clearable
            hide-details
            autofocus
            @update:model-value="(v: string | null) => emit('update:filter', v)"
          >
            <template #prepend-inner>
              <v-icon size="small">mdi-magnify</v-icon>
            </template>
          </v-text-field>
          <div class="text-caption text-medium-emphasis mt-2">Case-insensitive partial match</div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-2">
          <v-spacer />
          <v-btn size="small" variant="text" @click="emit('clear-filter')"> Clear </v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
/**
 * VariantColumnHeader - Shared header template for variant/cohort table columns
 *
 * Renders a sortable header with sort priority indicator and per-column filter menu.
 * Used by both VariantTable and CohortDataTable for consistent behavior.
 */
import { computed } from 'vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VuetifyInternalColumn = any

interface SortItem {
  key: string
  order?: boolean | 'asc' | 'desc'
}

interface Props {
  /** The Vuetify internal column object from the header slot */
  headerColumn: VuetifyInternalColumn
  /** Function to get the sort icon for a column (Vuetify returns IconValue - complex union type) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSortIcon: (...args: any[]) => any
  /** Function to toggle sort on a column */
  toggleSort: (column: VuetifyInternalColumn) => void
  /** Function to check if a column is sorted */
  isSorted: (column: VuetifyInternalColumn) => boolean
  /** Current sortBy array from Vuetify (for multi-sort priority display) */
  sortBy?: readonly SortItem[]
  /** Whether this column currently has an active filter */
  hasFilter: boolean
  /** Current filter value for this column */
  filterValue: string
}

const props = defineProps<Props>()

/** 1-based sort priority index. Only shown when multiple columns are sorted. */
const sortIndex = computed(() => {
  if (!props.sortBy || props.sortBy.length <= 1) return 0
  const idx = props.sortBy.findIndex((s) => s.key === props.headerColumn.key)
  return idx >= 0 ? idx + 1 : 0
})

const emit = defineEmits<{
  'update:filter': [value: string | null]
  'clear-filter': []
}>()
</script>

<style scoped>
.header-wrapper {
  width: 100%;
  gap: 4px;
}

.sortable-header {
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.sortable-header:hover {
  opacity: 0.7;
}

.sorted-header {
  color: rgb(var(--v-theme-primary));
}

.header-title {
  font-weight: 600;
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-indicator {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.sort-priority {
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  opacity: 0.8;
}

.sort-icon-inactive {
  opacity: 0.3;
}

.sortable-header:hover .sort-icon-inactive {
  opacity: 0.6;
}
</style>
