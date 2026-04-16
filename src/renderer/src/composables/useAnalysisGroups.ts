import { ref, computed } from 'vue'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

interface AnalysisGroupOption {
  id: number
  name: string
  group_type: string
}

const groups = ref<AnalysisGroupOption[]>([])
const loading = ref(false)

export function useAnalysisGroups() {
  const { api } = useApiService()

  async function loadGroups(): Promise<void> {
    if (!api) return
    loading.value = true
    try {
      groups.value = unwrapIpcResult(await api.analysisGroups.list()) as AnalysisGroupOption[]
    } catch (error) {
      const message =
        error instanceof Error ? error.message : isIpcError(error) ? (error.userMessage ?? error.message) : String(error)
      logService.error(`Failed to load analysis groups: ${message}`, 'useAnalysisGroups')
      groups.value = []
    } finally {
      loading.value = false
    }
  }

  const groupOptions = computed(() => groups.value.map((g) => ({ title: g.name, value: g.id })))

  return { groups, loading, loadGroups, groupOptions }
}
