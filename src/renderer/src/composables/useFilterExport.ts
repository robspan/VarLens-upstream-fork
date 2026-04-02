import { type Ref } from 'vue'
import { useApiService } from './useApiService'
import { buildFilterFromState, type FilterState, type ExportResult } from './filter-types'
import { logService } from '../services/LogService'
import { isIpcError } from '../../../shared/types/errors'

/**
 * Composable for variant export functionality.
 * Extracted from useFilterState to separate export concerns.
 */
export function useFilterExport(
  filters: Ref<FilterState>,
  selectedImpactPresets: Ref<string[]>,
  exporting: Ref<boolean>
) {
  const { api } = useApiService()

  const exportToExcel = async (caseId: number, caseName: string): Promise<ExportResult | null> => {
    if (!api) {
      logService.warn('API not available - running outside Electron', 'export')
      return null
    }

    exporting.value = true
    try {
      const exportFilters = buildFilterFromState(filters.value, selectedImpactPresets.value)

      const result = await api.export.variants(
        caseId,
        exportFilters,
        caseName !== '' ? caseName : `case_${caseId}`
      )

      if (isIpcError(result)) {
        return {
          success: false,
          error: result.userMessage ?? result.message ?? 'Unknown error'
        }
      }

      if (result !== null && result !== undefined && result.success === true) {
        return { success: true, filePath: result.filePath }
      } else if (
        result !== null &&
        result !== undefined &&
        typeof result.error === 'string' &&
        result.error !== 'Export cancelled'
      ) {
        return { success: false, error: result.error }
      }

      return result?.error === 'Export cancelled' ? { success: false, cancelled: true } : null
    } catch (error) {
      logService.error(
        'Export error: ' + (error instanceof Error ? error.message : String(error)),
        'export'
      )
      return null
    } finally {
      exporting.value = false
    }
  }

  return { exportToExcel }
}
