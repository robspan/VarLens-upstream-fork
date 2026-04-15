<script setup lang="ts">
import CohortViewComponent from '../components/CohortView.vue'
import { useAppState } from '../composables/useAppState'
import { useApiService } from '../composables/useApiService'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import { logService } from '../services/LogService'

const { api } = useApiService()
const {
  initialSearch,
  panelOpen,
  selectedPanelVariant,
  cohortViewRef,
  selectCase
} = useAppState()

// cohortViewRef is used as template ref (not detected by vue-tsc from destructured composable)
void cohortViewRef

async function handleNavigateToCase(payload: {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  geneSymbol: string | null
  cdna: string | null
}): Promise<void> {
  if (!api) return

  // Build search query from gene symbol and/or cDNA
  const parts: string[] = []
  if (payload.geneSymbol != null && payload.geneSymbol !== '') {
    parts.push(payload.geneSymbol)
  }
  if (payload.cdna != null && payload.cdna !== '') {
    parts.push(payload.cdna)
  }
  const variantSearch = parts.length > 0 ? parts.join(' AND ') : undefined

  initialSearch.value = variantSearch
  let caseName = ''

  // Look up case name
  try {
    const cases = await api.cases.list()
    const selectedCase = cases.find((c) => c.id === payload.caseId)
    if (selectedCase !== undefined) {
      caseName = selectedCase.name
    }
  } catch (error) {
    logService.error(
      'Failed to fetch case name: ' + (error instanceof Error ? error.message : String(error)),
      'cohort'
    )
  }
  selectCase({ caseId: payload.caseId, caseName })
}

function handleRowClick(variant: Variant | CohortVariant): void {
  selectedPanelVariant.value = variant
  panelOpen.value = true
}

function handleDeselect(): void {
  if (panelOpen.value) {
    panelOpen.value = false
  }
}
</script>

<template>
  <CohortViewComponent
    ref="cohortViewRef"
    @navigate-to-case="handleNavigateToCase"
    @row-click="handleRowClick"
    @deselect="handleDeselect"
  />
</template>
