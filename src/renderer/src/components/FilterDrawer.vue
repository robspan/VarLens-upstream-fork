<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="300"
    @update:model-value="emit('update:open', $event)"
  >
    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-body-large font-weight-medium"> All Filters </v-toolbar-title>
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
      <div class="flex-grow-1 overflow-y-auto">
        <v-expansion-panels v-model="expandedPanels" multiple variant="accordion">
          <!-- Search -->
          <v-expansion-panel value="search">
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-magnify</v-icon>
                <span class="text-title-small font-weight-medium">Search</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-dna</v-icon>
                <span class="text-title-small font-weight-medium">Gene</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-flash</v-icon>
                <span class="text-title-small font-weight-medium">Impact</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-function</v-icon>
                <span class="text-title-small font-weight-medium">Consequence</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-hospital-box</v-icon>
                <span class="text-title-small font-weight-medium">ClinVar</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-earth</v-icon>
                <span class="text-title-small font-weight-medium">Frequency</span>
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
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="d-flex ga-1 flex-wrap mb-2">
                <v-chip
                  v-for="preset in afPresets"
                  :key="preset.value"
                  :color="selectedAfPreset === preset.value ? 'primary' : undefined"
                  :variant="selectedAfPreset === preset.value ? 'flat' : 'outlined'"
                  size="small"
                  label
                  @click="
                    selectedAfPreset = selectedAfPreset === preset.value ? null : preset.value
                  "
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-alert-circle</v-icon>
                <span class="text-title-small font-weight-medium">CADD</span>
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
            </v-expansion-panel-title>
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
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-tag-multiple</v-icon>
                <span class="text-title-small font-weight-medium">Tags</span>
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
            </v-expansion-panel-title>
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
                      <v-icon :color="(item as unknown as Tag).color" size="small"
                        >mdi-circle</v-icon
                      >
                    </template>
                    <v-list-item-title>{{ (item as unknown as Tag).name }}</v-list-item-title>
                  </v-list-item>
                </template>
              </v-select>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <!-- Annotations -->
          <v-expansion-panel value="annotations">
            <v-expansion-panel-title>
              <div class="d-flex align-center">
                <v-icon size="small" class="mr-2">mdi-star-circle</v-icon>
                <span class="text-title-small font-weight-medium">Annotations</span>
                <v-chip
                  v-if="isFilterGroupActive('annotations')"
                  size="x-small"
                  color="primary"
                  class="ml-2"
                  label
                >
                  Active
                </v-chip>
              </div>
            </v-expansion-panel-title>
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
import { inject, ref } from 'vue'
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

// Default expanded panels
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

/**
 * Toggle ACMG classification filter chip on/off.
 */
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
