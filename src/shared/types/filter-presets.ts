/**
 * Filter preset types shared across main and renderer.
 *
 * Presets store a named combination of filter values that can be
 * toggled on/off in the toolbar preset bar. Each preset stores
 * filter state as structured JSON for programmatic application.
 */

import type { FilterState } from './filters'

/**
 * Discriminator for filter presets.
 *
 * - `'filter'`: classic filter preset — applies `filterJson` to the
 *   current tab's filter state.
 * - `'shortlist'`: shortlist preset — `filterJson.shortlist` carries a
 *   `ShortlistConfig` that drives the unified Shortlist tab query.
 *
 * Repository layer defaults missing values to `'filter'` for backward
 * compatibility with presets created before migration v27.
 */
export type FilterPresetKind = 'filter' | 'shortlist'

/**
 * A saved filter preset as stored in the database.
 * Uses camelCase for TypeScript; database columns use snake_case.
 */
export interface FilterPreset {
  id: number
  name: string
  description: string | null
  /** Structured filter state (subset of FilterState) */
  filterJson: Partial<FilterState>
  /** Preset kind — see {@link FilterPresetKind}. */
  kind: FilterPresetKind
  /** Whether this is a built-in preset shipped with the app */
  isBuiltIn: boolean
  /** Whether this preset is visible in the preset bar */
  isVisible: boolean
  /** Sort order for display in the preset bar */
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Params for creating a new preset */
export interface FilterPresetCreate {
  name: string
  description?: string | null
  filterJson: Partial<FilterState>
  /** Defaults to `'filter'` at repository layer when omitted. */
  kind?: FilterPresetKind
  isVisible?: boolean
  sortOrder?: number
}

/** Params for updating an existing preset */
export interface FilterPresetUpdate {
  name?: string
  description?: string | null
  filterJson?: Partial<FilterState>
  kind?: FilterPresetKind
  isVisible?: boolean
  sortOrder?: number
}
