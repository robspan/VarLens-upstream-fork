<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-title class="d-flex align-center">
      <span class="text-h6">Gene Burden Analysis</span>
      <v-spacer />
      <v-btn
        v-if="hasResults"
        variant="text"
        size="small"
        :icon="collapsed ? mdiChevronDown : mdiChevronUp"
        @click="collapsed = !collapsed"
      />
    </v-card-title>

    <v-card-text v-show="!collapsed">
      <!-- Group builders side by side -->
      <v-row>
        <v-col cols="6">
          <GroupBuilder
            v-model="groupAIds"
            label="Group A (Cases)"
            :all-cases="allCases"
            :cohort-groups="cohortGroups"
          />
        </v-col>
        <v-col cols="6">
          <GroupBuilder
            v-model="groupBIds"
            label="Group B (Controls)"
            :all-cases="allCases"
            :cohort-groups="cohortGroups"
          />
        </v-col>
      </v-row>

      <!-- Overlap warning -->
      <v-alert v-if="overlapCount > 0" type="error" variant="tonal" density="compact" class="mb-2">
        {{ overlapCount }} case(s) appear in both groups. Remove duplicates before running.
      </v-alert>

      <!-- Variant filters -->
      <v-expansion-panels variant="accordion" class="mb-2">
        <v-expansion-panel title="Variant Filters">
          <v-expansion-panel-text>
            <!-- Impact preset chips -->
            <div class="d-flex align-center mb-3">
              <span class="text-body-2 text-medium-emphasis mr-2">Impact:</span>
              <v-chip-group v-model="selectedImpactPresets" multiple>
                <v-chip
                  v-for="preset in impactPresets"
                  :key="preset.value"
                  :color="preset.color"
                  variant="outlined"
                  filter
                  size="small"
                >
                  {{ preset.label }}
                </v-chip>
              </v-chip-group>
            </div>

            <v-row dense>
              <!-- gnomAD AF with presets -->
              <v-col cols="4">
                <div class="d-flex align-center mb-1">
                  <span class="text-body-2 text-medium-emphasis mr-2">Max gnomAD AF:</span>
                  <v-chip-group v-model="selectedAfPreset" class="flex-grow-0">
                    <v-chip
                      v-for="preset in afPresets"
                      :key="preset.value"
                      size="x-small"
                      variant="outlined"
                      filter
                    >
                      {{ preset.label }}
                    </v-chip>
                  </v-chip-group>
                </div>
                <v-text-field
                  v-model.number="gnomadAfMax"
                  type="number"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  density="compact"
                  variant="outlined"
                  hide-details
                  placeholder="e.g. 0.01"
                />
              </v-col>

              <!-- CADD with presets -->
              <v-col cols="4">
                <div class="d-flex align-center mb-1">
                  <span class="text-body-2 text-medium-emphasis mr-2">Min CADD:</span>
                  <v-chip-group v-model="selectedCaddPreset" class="flex-grow-0">
                    <v-chip
                      v-for="preset in caddPresets"
                      :key="preset.value"
                      size="x-small"
                      variant="outlined"
                      filter
                    >
                      {{ preset.label }}
                    </v-chip>
                  </v-chip-group>
                </div>
                <v-text-field
                  v-model.number="caddMin"
                  type="number"
                  :min="0"
                  :max="60"
                  density="compact"
                  variant="outlined"
                  hide-details
                  placeholder="e.g. 20"
                />
              </v-col>

              <!-- Consequences with GroupedMultiSelect -->
              <v-col cols="4">
                <div class="mb-1">
                  <span class="text-body-2 text-medium-emphasis">Consequences:</span>
                </div>
                <GroupedMultiSelect
                  v-model:model-value="selectedConsequences"
                  :config="consequenceGroupConfig"
                  label="Consequences"
                  :icon="mdiFilterVariant"
                />
              </v-col>
            </v-row>

            <!-- Gene list input -->
            <v-row dense class="mt-2">
              <v-col cols="12">
                <v-textarea
                  v-model="geneListText"
                  label="Gene list (optional)"
                  placeholder="Paste gene symbols, one per line or comma-separated (e.g. BRCA1, TP53, EGFR)"
                  density="compact"
                  variant="outlined"
                  hide-details
                  rows="2"
                  auto-grow
                >
                  <template #prepend-inner>
                    <v-icon size="small" class="mr-1" :icon="mdiDna" />
                  </template>
                  <template #append-inner>
                    <v-chip v-if="parsedGeneList.length > 0" size="x-small" color="primary">
                      {{ parsedGeneList.length }} genes
                    </v-chip>
                  </template>
                </v-textarea>
              </v-col>
            </v-row>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <!-- Analysis settings -->
      <v-row dense class="mb-2">
        <v-col cols="4">
          <v-radio-group
            v-model="primaryTest"
            label="Primary test"
            density="compact"
            hide-details
            inline
          >
            <v-radio label="Fisher's exact" value="fisher" />
            <v-radio label="Logistic burden" value="logistic_burden" />
          </v-radio-group>
        </v-col>
        <v-col cols="4">
          <v-select
            v-model="weightScheme"
            label="Weight scheme"
            :items="weightOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="4">
          <v-select
            v-model="selectedCovariates"
            label="Covariates"
            :items="covariateOptions"
            multiple
            chips
            density="compact"
            variant="outlined"
            hide-details
            closable-chips
          />
        </v-col>
      </v-row>
    </v-card-text>

    <v-card-actions v-show="!collapsed">
      <v-chip v-if="groupAIds.length > 0" size="small" color="primary" variant="tonal">
        Group A: {{ groupAIds.length }}
      </v-chip>
      <v-chip
        v-if="groupBIds.length > 0"
        size="small"
        color="secondary"
        variant="tonal"
        class="ml-1"
      >
        Group B: {{ groupBIds.length }}
      </v-chip>
      <v-spacer />
      <v-btn
        color="primary"
        variant="elevated"
        :disabled="!canRun"
        :loading="running"
        :prepend-icon="mdiPlay"
        @click="handleRun"
      >
        Run Analysis
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import GroupBuilder from './GroupBuilder.vue'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import { consequenceGroups, getGroupValues } from '../../config/filterGroups'
import { mdiChevronDown, mdiChevronUp, mdiDna, mdiFilterVariant, mdiPlay } from '@mdi/js'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

defineProps<{
  allCases: CaseInfo[]
  cohortGroups: CohortGroup[]
  running?: boolean
  hasResults?: boolean
}>()

const emit = defineEmits<{
  run: [
    config: {
      groupA_ids: number[]
      groupB_ids: number[]
      primary_test: string
      weight_scheme: string
      covariates: string[]
      filters: {
        gnomad_af_max?: number
        cadd_min?: number
        consequences?: string[]
        gene_list?: string[]
      }
      max_threads: number
    }
  ]
}>()

const collapsed = ref(false)
const groupAIds = ref<number[]>([])
const groupBIds = ref<number[]>([])
const primaryTest = ref('fisher')
const weightScheme = ref('uniform')
const selectedCovariates = ref<string[]>([])
const gnomadAfMax = ref<number | undefined>(undefined)
const caddMin = ref<number | undefined>(undefined)
const selectedConsequences = ref<string[]>([])
const geneListText = ref('')

// Impact presets
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Map impact levels to consequence groups
const impactToConsequences: Record<string, string[]> = {
  HIGH: [...getGroupValues(consequenceGroups, 'truncating')],
  MODERATE: [
    ...getGroupValues(consequenceGroups, 'missense_inframe'),
    ...getGroupValues(consequenceGroups, 'splice_region')
  ],
  LOW: [...getGroupValues(consequenceGroups, 'synonymous')]
}

const selectedImpactPresets = ref<number[]>([])

// When impact presets change, update consequences
watch(selectedImpactPresets, (indices) => {
  if (indices.length === 0) return
  const consequences = new Set<string>(selectedConsequences.value)
  // Add consequences for each selected impact
  for (const idx of indices) {
    const preset = impactPresets[idx]
    const vals = impactToConsequences[preset.value] ?? []
    for (const v of vals) consequences.add(v)
  }
  selectedConsequences.value = [...consequences]
})

// gnomAD AF presets
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

const selectedAfPreset = ref<number | undefined>(undefined)

watch(selectedAfPreset, (idx) => {
  if (idx !== undefined && idx >= 0 && idx < afPresets.length) {
    gnomadAfMax.value = afPresets[idx].value
  }
})

// CADD presets
const caddPresets = [
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

const selectedCaddPreset = ref<number | undefined>(undefined)

watch(selectedCaddPreset, (idx) => {
  if (idx !== undefined && idx >= 0 && idx < caddPresets.length) {
    caddMin.value = caddPresets[idx].value
  }
})

// Consequence group config
const consequenceGroupConfig = consequenceGroups

const weightOptions = [
  { label: 'Uniform (equal)', value: 'uniform' },
  { label: 'Beta(MAF; 1, 25)', value: 'beta_maf' },
  { label: 'Beta(MAF) x CADD', value: 'beta_maf_cadd' }
]

const covariateOptions = ['sex', 'age']

// Parse gene list from textarea
const parsedGeneList = computed(() => {
  if (!geneListText.value.trim()) return []
  return geneListText.value
    .split(/[\n,;]+/)
    .map((g) => g.trim().toUpperCase())
    .filter((g) => g.length > 0)
})

const overlapCount = computed(() => {
  const setA = new Set(groupAIds.value)
  return groupBIds.value.filter((id) => setA.has(id)).length
})

const canRun = computed(
  () => groupAIds.value.length > 0 && groupBIds.value.length > 0 && overlapCount.value === 0
)

function handleRun(): void {
  const filters: Record<string, unknown> = {}
  const afVal =
    typeof gnomadAfMax.value === 'number' && !Number.isNaN(gnomadAfMax.value)
      ? gnomadAfMax.value
      : undefined
  const caddVal =
    typeof caddMin.value === 'number' && !Number.isNaN(caddMin.value) ? caddMin.value : undefined
  if (afVal !== undefined) filters.gnomad_af_max = afVal
  if (caddVal !== undefined) filters.cadd_min = caddVal
  if (selectedConsequences.value.length > 0) filters.consequences = [...selectedConsequences.value]
  if (parsedGeneList.value.length > 0) filters.gene_list = [...parsedGeneList.value]

  emit('run', {
    groupA_ids: [...groupAIds.value],
    groupB_ids: [...groupBIds.value],
    primary_test: primaryTest.value,
    weight_scheme: weightScheme.value,
    covariates: [...selectedCovariates.value],
    filters,
    max_threads: 4
  })
}
</script>
