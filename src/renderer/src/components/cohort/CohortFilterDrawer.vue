<template>
  <FilterDrawerShell
    :open="open"
    :active-filter-count="activeFilterCount"
    @update:open="emit('update:open', $event)"
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
            v-model="searchTerm"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Gene, position, HGVS..."
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
            :loading="loadingGeneSuggestions"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Search gene symbol (e.g. BRCA1)"
            prepend-inner-icon="mdi-magnify"
            @update:search="searchGeneSymbols"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Impact -->
      <v-expansion-panel value="impact">
        <FilterPanelTitle icon="mdi-flash" label="Impact" :active="isFilterGroupActive('impact')" />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap">
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
            label="ClinVar"
            placeholder="Select..."
            icon="mdi-hospital-box"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Annotations (starred, comments, ACMG) -->
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
          <div class="d-flex ga-1 flex-wrap">
            <v-chip
              v-for="cls in acmgFilterOptions"
              :key="cls.value"
              :color="filters.acmgClassifications.includes(cls.value) ? cls.color : undefined"
              :variant="filters.acmgClassifications.includes(cls.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleAcmgClassification(cls.value)"
            >
              {{ cls.label }}
            </v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Cohort Frequency (unique to cohort view) -->
      <v-expansion-panel value="cohortFreq">
        <FilterPanelTitle
          icon="mdi-account-group"
          label="Cohort Freq"
          :active="isFilterGroupActive('cohortFreq')"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in cohortFreqPresets"
              :key="preset.value"
              :color="selectedCohortFreqPreset === preset.value ? 'primary' : undefined"
              :variant="selectedCohortFreqPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="
                selectedCohortFreqPreset =
                  selectedCohortFreqPreset === preset.value ? null : preset.value
              "
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="customCohortFreq"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            max="100"
            placeholder="Custom % (e.g. 15)"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- gnomAD AF -->
      <v-expansion-panel value="frequency">
        <FilterPanelTitle
          icon="mdi-earth"
          label="gnomAD AF"
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
            v-model.number="customGnomadAf"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="0.001"
            min="0"
            max="100"
            placeholder="Custom % (e.g. 0.5)"
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
            v-model.number="customCadd"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            max="60"
            placeholder="Min CADD score"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </FilterDrawerShell>
</template>

<script setup lang="ts">
import { inject, ref } from 'vue'
import FilterDrawerShell from '../filters/FilterDrawerShell.vue'
import FilterPanelTitle from '../filters/FilterPanelTitle.vue'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import { consequenceGroups, clinvarGroups } from '../../config/filterGroups'
import { ACMG_FILTER_OPTIONS } from '../../utils/filters'
import type { CohortFilterDrawerState } from './cohortFilterDrawerTypes'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Default expanded panels (same defaults as case drawer)
const expandedPanels = ref<string[]>(['search', 'impact', 'frequency'])

// Inject shared filter state from CohortFilterBar
const state = inject<CohortFilterDrawerState>('cohortFilterDrawerState')

if (!state) {
  throw new Error(
    'CohortFilterDrawer must be rendered inside CohortFilterBar (missing cohortFilterDrawerState)'
  )
}

// Destructure for template convenience
const {
  filters,
  searchTerm,
  geneSymbolSuggestions,
  loadingGeneSuggestions,
  selectedImpactPresets,
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
  customGnomadAf,
  customCadd,
  impactPresets,
  cohortFreqPresets,
  afPresets,
  caddPresets,
  activeFilterCount,
  isFilterGroupActive,
  clearAllFilters,
  searchGeneSymbols
} = state

const acmgFilterOptions = ACMG_FILTER_OPTIONS

const toggleImpactPreset = (value: string): void => {
  const current = selectedImpactPresets.value
  if (current.includes(value)) {
    selectedImpactPresets.value = current.filter((v) => v !== value)
  } else {
    selectedImpactPresets.value = [...current, value]
  }
}

const toggleAcmgClassification = (value: string): void => {
  const current = filters.value.acmgClassifications
  if (current.includes(value)) {
    filters.value.acmgClassifications = current.filter((v: string) => v !== value)
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
