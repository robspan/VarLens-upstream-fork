/**
 * Preset-to-filter sync watchers
 *
 * Provides reusable watcher factories for syncing preset selections to filter values.
 * Extracts duplicate preset sync logic from CohortTable.vue and FilterToolbar.vue.
 *
 * DRY-05: Eliminate duplicate preset-to-filter sync watchers.
 */

import type { Ref, WatchStopHandle } from 'vue'
import { watch } from 'vue'

/**
 * Preset definition with label and numeric value
 */
export interface PresetOption {
  /** Display label for the preset */
  label: string
  /** Numeric value when selected */
  value: number
}

/**
 * Parameters for creating a preset watcher
 */
export interface CreatePresetWatcherParams {
  /** Preset selection ref (index or null) */
  presetRef: Ref<number | null>
  /** Target filter ref to update */
  targetFilter: Ref<number | null>
  /** Available preset options */
  presets: PresetOption[]
  /** How to convert preset value */
  conversionMode: 'percentage' | 'raw'
}

/**
 * Create a watcher that syncs preset selection to filter value
 *
 * Consolidates the duplicate preset-to-filter sync watchers (DRY-05).
 * When preset changes, updates filter; when preset is cleared, clears filter.
 *
 * @param params - Watcher parameters
 * @returns WatchStopHandle to stop the watcher on cleanup
 *
 * @example
 * ```typescript
 * // In component setup:
 * const stopWatcher = createPresetWatcher({
 *   presetRef: selectedAfPreset,
 *   targetFilter: toRef(() => filters.value.maxGnomadAf, (v) => { filters.value.maxGnomadAf = v }),
 *   presets: AF_PRESETS,
 *   conversionMode: 'percentage'
 * })
 *
 * // Cleanup on unmount:
 * onBeforeUnmount(() => stopWatcher())
 * ```
 */
export function createPresetWatcher({
  presetRef,
  targetFilter,
  presets,
  conversionMode
}: CreatePresetWatcherParams): WatchStopHandle {
  return watch(presetRef, (newPresetIndex) => {
    if (newPresetIndex !== null && newPresetIndex >= 0 && newPresetIndex < presets.length) {
      const presetValue = presets[newPresetIndex].value
      // Convert percentage presets (0-100) to decimal (0-1) if needed
      targetFilter.value = conversionMode === 'percentage' ? presetValue / 100 : presetValue
    } else {
      // Preset cleared - clear filter value
      targetFilter.value = null
    }
  })
}
