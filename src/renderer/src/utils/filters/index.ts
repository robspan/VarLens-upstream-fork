/**
 * Filter utilities - pure functions for filter operations
 *
 * Barrel export for all filter utilities.
 * Import: `import { clearFilter, buildIpcParams, handleCustomNumericChange } from '@/utils/filters'`
 */

// Types re-exported from shared for convenience
export type { FilterState, ActiveFilter, FilterIpcParams } from '../../../../shared/types/filters'

// Default values
export { FILTER_DEFAULTS } from './filterDefaults'

// Clearing utilities
export { clearFilter, clearAllFilters, type FilterId } from './filterClearing'

// IPC serialization
export { buildIpcParams } from './filterSerialization'

// Active filters computation
export { buildActiveFiltersList } from './activeFilters'

// Custom input handlers
export {
  handleCustomNumericChange,
  type ConversionMode,
  type HandleCustomChangeParams
} from './customHandlers'

// Preset sync watchers
export {
  createPresetWatcher,
  type PresetOption,
  type CreatePresetWatcherParams
} from './presetSync'
