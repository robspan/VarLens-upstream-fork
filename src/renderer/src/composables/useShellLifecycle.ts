import type { Ref } from 'vue'
import type { SelectedCaseInput } from './useAppState'

interface SnackbarHost {
  showSnackbar: (message: string, type: string) => void
}

interface CaseListActions {
  refreshCases: () => Promise<unknown> | unknown
  selectCase: (caseId: number) => void
}

interface UseShellLifecycleOptions {
  currentDatabaseName: Ref<string>
  dataGeneration: Ref<number>
  resetForDatabaseSwitch: () => void
  clearMetadataCache: () => void
  selectCase: (input: SelectedCaseInput) => void
  caseListRef: Ref<CaseListActions | null>
  dialogHostRef: Ref<SnackbarHost | null>
}

export function useShellLifecycle({
  currentDatabaseName,
  dataGeneration,
  resetForDatabaseSwitch,
  clearMetadataCache,
  selectCase,
  caseListRef,
  dialogHostRef
}: UseShellLifecycleOptions) {
  const handleDatabaseSwitched = async (): Promise<void> => {
    resetForDatabaseSwitch()
    clearMetadataCache()
    await caseListRef.value?.refreshCases()
    dialogHostRef.value?.showSnackbar(`Switched to ${currentDatabaseName.value}`, 'success')
  }

  const handleImportComplete = async (result: SelectedCaseInput): Promise<void> => {
    dataGeneration.value++
    await caseListRef.value?.refreshCases()
    selectCase(result)
    caseListRef.value?.selectCase(result.caseId)
  }

  const handleBatchImportComplete = (): Promise<unknown> | unknown => {
    return caseListRef.value?.refreshCases()
  }

  return {
    handleDatabaseSwitched,
    handleImportComplete,
    handleBatchImportComplete
  }
}
