<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="340"
    @update:model-value="emit('update:open', $event)"
  >
    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-subtitle-1 font-weight-medium"> All Filters </v-toolbar-title>
        <v-chip
          v-if="activeFilterCount > 0"
          size="small"
          color="primary"
          variant="flat"
          class="mr-2"
        >
          {{ activeFilterCount }}
        </v-chip>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-divider />

      <!-- Scrollable filter groups -->
      <div class="flex-grow-1 overflow-y-auto pa-3">
        <!-- Search -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-magnify</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Search</span>
            <v-chip
              v-if="isFilterGroupActive('search')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
          </div>
          <v-text-field
            v-model="filters.searchQuery"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Gene, chr:pos, c./p. HGVS..."
            prepend-inner-icon="mdi-magnify"
          />
        </div>

        <!-- Gene -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-dna</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Gene</span>
            <v-chip
              v-if="isFilterGroupActive('gene')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
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
            @update:search="searchGeneSymbols"
            @click:clear="handleGeneClear"
          />
        </div>

        <!-- Impact -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-flash</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Impact</span>
            <v-chip
              v-if="isFilterGroupActive('impact')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
          </div>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in impactPresets"
              :key="preset.value"
              :color="selectedImpactPresets.includes(preset.value) ? preset.color : undefined"
              :variant="selectedImpactPresets.includes(preset.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleImpactPreset(preset.value)"
            >
              {{ preset.label }}
            </v-chip>
          </div>
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
            placeholder="Specific consequences..."
          />
        </div>

        <!-- Consequence (Function) -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-function</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Consequence</span>
            <v-chip
              v-if="isFilterGroupActive('function')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
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

        <!-- ClinVar -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-hospital-box</v-icon>
            <span class="text-subtitle-2 font-weight-medium">ClinVar</span>
            <v-chip
              v-if="isFilterGroupActive('clinvar')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
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

        <!-- Frequency -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-account-group</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Frequency</span>
            <v-chip
              v-if="isFilterGroupActive('frequency')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
          </div>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in afPresets"
              :key="preset.value"
              :color="selectedAfPreset === preset.value ? 'teal' : undefined"
              :variant="selectedAfPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="selectedAfPreset = selectedAfPreset === preset.value ? null : preset.value"
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="filters.maxGnomadAf"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="0.0001"
            min="0"
            max="1"
            placeholder="Max AF (e.g. 0.01)"
            clearable
          />
        </div>

        <!-- CADD -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-alert-circle</v-icon>
            <span class="text-subtitle-2 font-weight-medium">CADD</span>
            <v-chip
              v-if="isFilterGroupActive('cadd')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
          </div>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in caddPresets"
              :key="preset.value"
              :color="selectedCaddPreset === preset.value ? 'deep-purple' : undefined"
              :variant="selectedCaddPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="
                selectedCaddPreset = selectedCaddPreset === preset.value ? null : preset.value
              "
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="filters.minCadd"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            placeholder="Min CADD score"
            clearable
          />
        </div>

        <!-- Tags -->
        <div class="filter-drawer-group mb-4">
          <div class="filter-drawer-group-header d-flex align-center mb-2">
            <v-icon size="small" class="mr-2">mdi-tag-multiple</v-icon>
            <span class="text-subtitle-2 font-weight-medium">Tags</span>
            <v-chip
              v-if="isFilterGroupActive('tags')"
              size="x-small"
              color="primary"
              class="ml-2"
              label
            >
              Active
            </v-chip>
          </div>
          <v-select
            v-model="filters.tagIds"
            :items="availableTags"
            item-title="name"
            item-value="id"
            density="compact"
            variant="outlined"
            hide-details
            multiple
            chips
            closable-chips
            placeholder="Filter by tags..."
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
                  <v-icon :color="(item.raw as Tag).color" size="small">mdi-circle</v-icon>
                </template>
                <v-list-item-title>{{ (item.raw as Tag).name }}</v-list-item-title>
              </v-list-item>
            </template>
          </v-select>
        </div>
      </div>

      <!-- Footer -->
      <v-divider />
      <div class="pa-3 d-flex justify-space-between">
        <v-btn
          variant="text"
          size="small"
          color="error"
          :disabled="activeFilterCount === 0"
          @click="clearAllFilters"
        >
          <v-icon start>mdi-filter-off</v-icon>
          Clear All
        </v-btn>
        <v-btn variant="text" size="small" @click="emit('update:open', false)"> Done </v-btn>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import GroupedMultiSelect from './GroupedMultiSelect.vue'
import { consequenceGroups, clinvarGroups } from '../config/filterGroups'
import type { Tag } from '../../../shared/types/api'
import type { FilterDrawerState } from './filterDrawerTypes'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Inject shared filter state from FilterToolbar
const state = inject<FilterDrawerState>('filterDrawerState')

if (!state) {
  throw new Error('FilterDrawer must be rendered inside FilterToolbar (missing filterDrawerState)')
}

// Destructure for template convenience
const {
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
  activeFilterCount,
  isFilterGroupActive,
  clearAllFilters,
  handleGeneClear,
  searchGeneSymbols,
  removeTagFilter
} = state

/**
 * Toggle an impact preset chip on/off.
 * Mutates the shared ref directly (safe because it's the same instance via provide/inject).
 */
const toggleImpactPreset = (value: string): void => {
  const current = selectedImpactPresets.value
  if (current.includes(value)) {
    selectedImpactPresets.value = current.filter((v) => v !== value)
  } else {
    selectedImpactPresets.value = [...current, value]
  }
}
</script>

<style scoped>
.filter-drawer-group {
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.filter-drawer-group-header {
  font-size: 0.8rem;
}

.filter-drawer-group-header .v-icon {
  opacity: 0.7;
}
</style>
