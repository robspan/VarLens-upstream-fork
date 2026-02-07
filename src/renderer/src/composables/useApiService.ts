/**
 * Composable for dependency injection of the window.api service
 *
 * Provides a typed wrapper around window.api access for:
 * 1. Cleaner test mocking (inject mock API)
 * 2. Type-safe access without casting
 * 3. Availability check before calls (for browser dev mode)
 *
 * SOL-10: Extracted window.api guard pattern from CohortTable.vue
 * where 10+ occurrences of `typeof window.api === 'undefined'` checks exist.
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { WindowAPI } from '../../../shared/types/api'

/**
 * Return type for useApiService composable
 *
 * @property api - Typed reference to window.api (undefined if not in Electron)
 * @property isAvailable - Computed boolean indicating if API is available
 */
export interface UseApiServiceReturn {
  /** The window.api instance, or undefined when running outside Electron */
  api: WindowAPI | undefined
  /** Reactive availability check - true when running in Electron context */
  isAvailable: ComputedRef<boolean>
}

/**
 * Composable for accessing the Electron IPC API
 *
 * @returns Object containing the API reference and availability check
 *
 * @example
 * ```typescript
 * const { api, isAvailable } = useApiService()
 *
 * // Guard API calls
 * if (!isAvailable.value) {
 *   console.warn('Running outside Electron')
 *   return
 * }
 *
 * // Safe to use api now
 * const cases = await api!.cases.list()
 * ```
 */
export function useApiService(): UseApiServiceReturn {
  // Check availability - will be false when running in browser dev mode
  const isAvailable = computed(
    () => typeof window !== 'undefined' && typeof window.api !== 'undefined'
  )

  // Get API reference - undefined if not available
  // We check at call time to support hot reload scenarios
  const api =
    typeof window !== 'undefined' && typeof window.api !== 'undefined' ? window.api : undefined

  return {
    api,
    isAvailable
  }
}
