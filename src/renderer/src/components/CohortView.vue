<template>
  <div class="cohort-content">
    <CohortTable
      ref="cohortTableRef"
      @navigate-to-case="$emit('navigate-to-case', $event)"
      @row-click="$emit('row-click', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
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

const cohortTableRef = ref<InstanceType<typeof CohortTable> | null>(null)

// Refresh function that delegates to CohortTable
const refresh = async (): Promise<void> => {
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
