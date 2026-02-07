<template>
  <div class="cohort-content">
    <CohortDashboard ref="dashboardRef" />
    <CohortTable
      ref="cohortTableRef"
      @navigate-to-case="$emit('navigate-to-case', $event)"
      @row-click="$emit('row-click', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import CohortDashboard from './CohortDashboard.vue'
import CohortTable from './CohortTable.vue'
import type { CohortVariant } from '../../../shared/types/cohort'

// Emit for navigation and row click
defineEmits<{
  'navigate-to-case': [
    payload: {
      caseId: number
      chr: string
      pos: number
      ref: string
      alt: string
      geneSymbol: string | null
      cdna: string | null
    }
  ]
  'row-click': [variant: CohortVariant]
}>()

const dashboardRef = ref<InstanceType<typeof CohortDashboard> | null>(null)
const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)

// Refresh function that delegates to all child components
const refresh = async (): Promise<void> => {
  await dashboardRef.value?.refresh()
  await cohortTableRef.value?.refresh()
}

// Expose refresh method to parent
defineExpose({ refresh })
</script>

<style scoped>
/* Cohort content fills available height (mirrors .case-content in App.vue) */
.cohort-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px - 32px); /* viewport minus app-bar minus footer */
  overflow: hidden;
}
</style>
