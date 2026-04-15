import { onMounted, onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { SelectedCaseInput } from './useAppState'
import type { WindowAPI } from '../../../shared/types/api'
import type { useImportStatusStore } from '../stores/importStatusStore'
import type AppDialogHostType from '../components/AppDialogHost.vue'

interface CaseListActions {
  refreshCases: () => Promise<unknown> | unknown
  selectCase: (caseId: number) => void
}

interface UseShellLifecycleOptions {
  api: WindowAPI | undefined
  currentDatabasePath: Ref<string | null>
  currentDatabaseName: Ref<string>
  incrementDataGeneration: () => void
  resetForDatabaseSwitch: () => void
  clearMetadataCache: () => void
  selectCase: (input: SelectedCaseInput) => void
  caseListRef: Ref<CaseListActions | null>
  dialogHostRef: Ref<InstanceType<typeof AppDialogHostType> | null>
  importStore: ReturnType<typeof useImportStatusStore>
}

export function useShellLifecycle({
  api,
  currentDatabasePath,
  currentDatabaseName,
  incrementDataGeneration,
  resetForDatabaseSwitch,
  clearMetadataCache,
  selectCase,
  caseListRef,
  dialogHostRef,
  importStore
}: UseShellLifecycleOptions) {
  let cleanupBatchImportComplete: (() => void) | null = null

  watch(currentDatabasePath, () => {
    resetForDatabaseSwitch()
  })

  const handleDatabaseSwitched = async (): Promise<void> => {
    resetForDatabaseSwitch()
    clearMetadataCache()
    await caseListRef.value?.refreshCases()
    dialogHostRef.value?.showSnackbar(`Switched to ${currentDatabaseName.value}`, 'success')
  }

  const handleImportComplete = async (result: SelectedCaseInput): Promise<void> => {
    incrementDataGeneration()
    await caseListRef.value?.refreshCases()
    selectCase(result)
    caseListRef.value?.selectCase(result.caseId)
  }

  const handleBatchImportComplete = (): Promise<unknown> | unknown => {
    incrementDataGeneration()
    return caseListRef.value?.refreshCases()
  }

  const registerBatchImportCompletionListener = (): (() => void) | null => {
    if (!api) return null

    return api.batchImport.onComplete((result) => {
      importStore.importComplete({
        ...result,
        details: result.details.map((d) => ({
          ...d,
          caseName: d.caseName ?? d.fileName,
          status: d.status === 'success' ? 'success' : d.status === 'failed' ? 'failed' : 'skipped'
        }))
      })
      void handleBatchImportComplete()
    })
  }

  onMounted(() => {
    cleanupBatchImportComplete = registerBatchImportCompletionListener()
  })

  onUnmounted(() => {
    cleanupBatchImportComplete?.()
  })

  return {
    handleDatabaseSwitched,
    handleImportComplete,
    handleBatchImportComplete,
    setupBatchImportCompletionListener: registerBatchImportCompletionListener
  }
}
