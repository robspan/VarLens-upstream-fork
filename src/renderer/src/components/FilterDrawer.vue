<template>
  <FilterDrawerShell
    :open="open"
    :active-filter-count="activeFilterCount"
    :expanded-panels="expandedPanels"
    :all-panel-values="allPanelValues"
    @update:open="emit('update:open', $event)"
    @update:expanded-panels="expandedPanels = $event"
    @clear-all="clearAllFilters"
  >
    <v-expansion-panels v-model="expandedPanels" multiple variant="accordion">
      <!-- Search -->
      <v-expansion-panel value="search">
        <FilterPanelTitle
          icon="mdi-magnify"
          label="Search"
          :active="isFilterGroupActive('search')"
        />
        <v-expansion-panel-text>
          <v-text-field
            v-model="filters.searchQuery"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Gene, chr:pos, c./p. HGVS..."
            prepend-inner-icon="mdi-magnify"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Gene -->
      <v-expansion-panel value="gene">
        <FilterPanelTitle icon="mdi-dna" label="Gene" :active="isFilterGroupActive('gene')" />
        <v-expansion-panel-text>
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
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Impact -->
      <v-expansion-panel value="impact">
        <FilterPanelTitle icon="mdi-flash" label="Impact" :active="isFilterGroupActive('impact')" />
        <v-expansion-panel-text>
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
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Consequence (Function) -->
      <v-expansion-panel value="function">
        <FilterPanelTitle
          icon="mdi-function"
          label="Consequence"
          :active="isFilterGroupActive('function')"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.funcs"
            :config="consequenceGroups"
            :available-values="filterOptions.funcs"
            label="Consequence"
            placeholder="Select..."
            icon="mdi-function"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- ClinVar -->
      <v-expansion-panel value="clinvar">
        <FilterPanelTitle
          icon="mdi-hospital-box"
          label="ClinVar"
          :active="isFilterGroupActive('clinvar')"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.clinvars"
            :config="clinvarGroups"
            :available-values="filterOptions.clinvars"
            label="ClinVar"
            placeholder="Select..."
            icon="mdi-hospital-box"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Frequency -->
      <v-expansion-panel value="frequency">
        <FilterPanelTitle
          icon="mdi-earth"
          label="Frequency"
          :active="isFilterGroupActive('frequency')"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in afPresets"
              :key="preset.value"
              :color="selectedAfPreset === preset.value ? 'primary' : undefined"
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
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- CADD -->
      <v-expansion-panel value="cadd">
        <FilterPanelTitle
          icon="mdi-alert-circle"
          label="CADD"
          :active="isFilterGroupActive('cadd')"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in caddPresets"
              :key="preset.value"
              :color="selectedCaddPreset === preset.value ? 'primary' : undefined"
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
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Tags -->
      <v-expansion-panel value="tags">
        <FilterPanelTitle
          icon="mdi-tag-multiple"
          label="Tags"
          :active="isFilterGroupActive('tags')"
        />
        <v-expansion-panel-text>
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
                :color="(item as unknown as Tag).color"
                variant="flat"
                @click:close="removeTagFilter((item as unknown as Tag).id)"
              >
                {{ (item as unknown as Tag).name }}
              </v-chip>
            </template>
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps" :title="undefined">
                <template #prepend>
                  <v-icon :color="(item as unknown as Tag).color" size="small">mdi-circle</v-icon>
                </template>
                <v-list-item-title>{{ (item as unknown as Tag).name }}</v-list-item-title>
              </v-list-item>
            </template>
          </v-select>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Annotations -->
      <v-expansion-panel value="annotations">
        <FilterPanelTitle
          icon="mdi-star-circle"
          label="Annotations"
          :active="isFilterGroupActive('annotations')"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-2 mb-3">
            <v-btn
              :color="filters.starredOnly ? 'amber-darken-2' : undefined"
              :variant="filters.starredOnly ? 'flat' : 'outlined'"
              size="small"
              rounded="pill"
              @click="filters.starredOnly = !filters.starredOnly"
            >
              <v-icon size="small" start>mdi-star</v-icon>
              Starred
            </v-btn>
            <v-btn
              :color="filters.hasCommentOnly ? 'primary' : undefined"
              :variant="filters.hasCommentOnly ? 'flat' : 'outlined'"
              size="small"
              rounded="pill"
              @click="filters.hasCommentOnly = !filters.hasCommentOnly"
            >
              <v-icon size="small" start>mdi-comment-text</v-icon>
              Commented
            </v-btn>
          </div>
          <div class="text-body-small text-medium-emphasis mb-1">ACMG Classification</div>
          <div class="d-flex flex-wrap ga-1">
            <v-chip
              v-for="cls in acmgFilterOptions"
              :key="cls.value"
              :color="filters.acmgClassifications.includes(cls.value) ? cls.color : undefined"
              :variant="filters.acmgClassifications.includes(cls.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleAcmgFilter(cls.value)"
            >
              {{ cls.label }}
            </v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </FilterDrawerShell>
</template>

<script setup lang="ts">
import { inject, ref } from 'vue'
import FilterDrawerShell from './filters/FilterDrawerShell.vue'
import FilterPanelTitle from './filters/FilterPanelTitle.vue'
import GroupedMultiSelect from './GroupedMultiSelect.vue'
import { consequenceGroups, clinvarGroups } from '../config/filterGroups'
import { ACMG_FILTER_OPTIONS_LONG } from '../utils/filters'
import type { Tag } from '../../../shared/types/api'
import type { FilterDrawerState } from './filterDrawerTypes'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Panel state
const allPanelValues = [
  'search',
  'gene',
  'impact',
  'function',
  'clinvar',
  'frequency',
  'cadd',
  'tags',
  'annotations'
]
const expandedPanels = ref<string[]>(['search', 'impact', 'frequency'])

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

const acmgFilterOptions = ACMG_FILTER_OPTIONS_LONG

const toggleImpactPreset = (value: string): void => {
  const current = selectedImpactPresets.value
  if (current.includes(value)) {
    selectedImpactPresets.value = current.filter((v) => v !== value)
  } else {
    selectedImpactPresets.value = [...current, value]
  }
}

const toggleAcmgFilter = (value: string): void => {
  const current = filters.value.acmgClassifications
  if (current.includes(value)) {
    filters.value.acmgClassifications = current.filter((v) => v !== value)
  } else {
    filters.value.acmgClassifications = [...current, value]
  }
}
</script>

<style scoped>
:deep(.v-expansion-panel-title) {
  min-height: 36px !important;
  padding: 8px 12px;
}

:deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 12px 12px;
}
</style>
