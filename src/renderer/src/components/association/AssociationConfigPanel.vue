<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-title class="d-flex align-center">
      <span class="text-h6">Gene Burden Analysis</span>
      <v-spacer />
      <v-btn
        v-if="hasResults"
        variant="text"
        size="small"
        :icon="collapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
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
            <v-row dense>
              <v-col cols="4">
                <v-text-field
                  v-model.number="gnomadAfMax"
                  label="Max gnomAD AF"
                  type="number"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="4">
                <v-text-field
                  v-model.number="caddMin"
                  label="Min CADD score"
                  type="number"
                  :min="0"
                  :max="60"
                  density="compact"
                  variant="outlined"
                  hide-details
                />
              </v-col>
              <v-col cols="4">
                <v-select
                  v-model="selectedConsequences"
                  label="Consequences"
                  :items="consequenceOptions"
                  multiple
                  chips
                  density="compact"
                  variant="outlined"
                  hide-details
                  closable-chips
                />
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
        prepend-icon="mdi-play"
        @click="handleRun"
      >
        Run Analysis
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import GroupBuilder from './GroupBuilder.vue'

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

const weightOptions = [
  { label: 'Uniform (equal)', value: 'uniform' },
  { label: 'Beta(MAF; 1, 25)', value: 'beta_maf' },
  { label: 'Beta(MAF) x CADD', value: 'beta_maf_cadd' }
]

const covariateOptions = ['sex', 'age']

const consequenceOptions = [
  'frameshift_variant',
  'stop_gained',
  'splice_acceptor_variant',
  'splice_donor_variant',
  'missense_variant',
  'inframe_deletion',
  'inframe_insertion',
  'start_lost',
  'stop_lost',
  'splice_region_variant',
  'synonymous_variant'
]

const overlapCount = computed(() => {
  const setA = new Set(groupAIds.value)
  return groupBIds.value.filter((id) => setA.has(id)).length
})

const canRun = computed(
  () => groupAIds.value.length > 0 && groupBIds.value.length > 0 && overlapCount.value === 0
)

function handleRun(): void {
  const filters: Record<string, unknown> = {}
  if (gnomadAfMax.value !== undefined) filters.gnomad_af_max = gnomadAfMax.value
  if (caddMin.value !== undefined) filters.cadd_min = caddMin.value
  if (selectedConsequences.value.length > 0) filters.consequences = selectedConsequences.value

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
