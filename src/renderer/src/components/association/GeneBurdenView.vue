<template>
  <div class="gene-burden-view pa-3">
    <!-- Config panel -->
    <AssociationConfigPanel
      :all-cases="cases"
      :cohort-groups="cohortGroups"
      :running="isRunning"
      :has-results="results !== null"
      @run="runAnalysis"
    />

    <!-- Progress bar -->
    <div v-if="isRunning" class="mb-3">
      <v-progress-linear :model-value="progressPercent" color="primary" height="20" rounded>
        <template #default>
          <span class="text-caption"> {{ progressCompleted }} / {{ progressTotal }} genes </span>
        </template>
      </v-progress-linear>
      <v-btn variant="text" color="error" size="small" class="mt-1" @click="cancelAnalysis">
        Cancel
      </v-btn>
    </div>

    <!-- Error -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      closable
      class="mb-3"
      @click:close="error = null"
    >
      {{ error }}
    </v-alert>

    <!-- Warnings -->
    <v-alert
      v-if="results && results.warnings.length > 0"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ results.warnings.length }} warning(s) during analysis
      <template #append>
        <v-btn size="x-small" variant="text" @click="showWarnings = !showWarnings">
          {{ showWarnings ? 'Hide' : 'Show' }}
        </v-btn>
      </template>
      <div
        v-if="showWarnings"
        class="mt-1 text-caption"
        style="max-height: 100px; overflow-y: auto"
      >
        <div v-for="(w, i) in results.warnings.slice(0, 50)" :key="i">
          {{ w }}
        </div>
        <div v-if="results.warnings.length > 50">
          ... and {{ results.warnings.length - 50 }} more
        </div>
      </div>
    </v-alert>

    <!-- Results summary -->
    <v-alert v-if="results" type="success" variant="tonal" density="compact" class="mb-3">
      Analysis complete: {{ results.results.length }} genes tested,
      {{ significantCount }} significant (FDR &lt; 0.05) in
      {{ (results.elapsed_ms / 1000).toFixed(1) }}s
    </v-alert>

    <!-- Results tabs -->
    <v-tabs v-if="results" v-model="activeTab" color="secondary" class="mb-2">
      <v-tab value="table">Table</v-tab>
      <v-tab value="volcano">Volcano Plot</v-tab>
      <v-tab value="manhattan">Manhattan Plot</v-tab>
    </v-tabs>

    <v-tabs-window v-if="results" v-model="activeTab">
      <v-tabs-window-item value="table">
        <AssociationResultsTable :results="results.results" :primary-test="results.primary_test" />
      </v-tabs-window-item>
      <v-tabs-window-item value="volcano">
        <VolcanoPlot :results="results.results" :primary-test="results.primary_test" />
      </v-tabs-window-item>
      <v-tabs-window-item value="manhattan">
        <ManhattanPlot :results="results.results" :primary-test="results.primary_test" />
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AssociationConfigPanel from './AssociationConfigPanel.vue'
import AssociationResultsTable from './AssociationResultsTable.vue'
import VolcanoPlot from './VolcanoPlot.vue'
import ManhattanPlot from './ManhattanPlot.vue'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AssociationResultsData = any

const cases = ref<CaseInfo[]>([])
const cohortGroups = ref<CohortGroup[]>([])
const results = ref<AssociationResultsData | null>(null)
const isRunning = ref(false)
const error = ref<string | null>(null)
const showWarnings = ref(false)
const activeTab = ref('table')
const progressCompleted = ref(0)
const progressTotal = ref(0)

const progressPercent = computed(() =>
  progressTotal.value > 0 ? (progressCompleted.value / progressTotal.value) * 100 : 0
)

const significantCount = computed(
  () =>
    results.value?.results.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.q_value !== null && r.q_value < 0.05
    ).length ?? 0
)

let cleanupProgress: (() => void) | null = null

async function loadCases(): Promise<void> {
  if (typeof window === 'undefined') return
  // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
  if (typeof (window as any).api === 'undefined') return

  try {
    // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
    const caseList = await (window as any).api.cases.list()
    // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
    const cohorts = await (window as any).api.caseMetadata.listCohorts()
    cohortGroups.value = cohorts

    // Load metadata for all cases in parallel
    // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
    const api = (window as any).api
    const caseInfos = await Promise.all(
      caseList.map(async (c: { id: number; name: string }) => {
        try {
          const fullMeta = await api.caseMetadata.getFullMetadata(c.id)
          return {
            id: c.id,
            name: c.name,
            status: fullMeta?.metadata?.affected_status ?? null,
            sex: fullMeta?.metadata?.sex ?? null,
            cohortIds: fullMeta?.cohorts?.map((co: CohortGroup) => co.id) ?? []
          }
        } catch {
          return {
            id: c.id,
            name: c.name,
            status: null,
            sex: null,
            cohortIds: []
          }
        }
      })
    )
    cases.value = caseInfos
  } catch (err) {
    error.value = `Failed to load cases: ${err instanceof Error ? err.message : String(err)}`
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAnalysis(config: any): Promise<void> {
  error.value = null
  results.value = null
  isRunning.value = true
  progressCompleted.value = 0
  progressTotal.value = 0

  // Listen for progress
  // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
  cleanupProgress = (window as any).api.cohort.onAssociationProgress(
    (progress: { completed: number; total: number }) => {
      progressCompleted.value = progress.completed
      progressTotal.value = progress.total
    }
  )

  try {
    // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
    const result = await (window as any).api.cohort.runAssociation(config)
    if (result !== null && typeof result === 'object' && 'error' in result) {
      throw new Error(String(result.error))
    }
    results.value = result
  } catch (err) {
    error.value = `Analysis failed: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    isRunning.value = false
    if (cleanupProgress) {
      cleanupProgress()
      cleanupProgress = null
    }
  }
}

function cancelAnalysis(): void {
  // eslint-disable-next-line no-undef, @typescript-eslint/no-explicit-any
  ;(window as any).api.cohort.cancelAssociation()
}

onMounted(loadCases)

onBeforeUnmount(() => {
  if (cleanupProgress) {
    cleanupProgress()
    cleanupProgress = null
  }
})

const refresh = async (): Promise<void> => {
  await loadCases()
}

defineExpose({ refresh })
</script>

<style scoped>
.gene-burden-view {
  overflow-y: auto;
  max-height: calc(100vh - 120px);
}
</style>
