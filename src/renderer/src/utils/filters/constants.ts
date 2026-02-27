/**
 * Shared filter constants
 *
 * Extracted from FilterToolbar.vue and CohortFilterBar.vue to avoid duplication.
 */

/**
 * ACMG classification filter options
 * Used by both case-level FilterToolbar and cohort CohortFilterBar
 */
export const ACMG_FILTER_OPTIONS = [
  { value: 'Pathogenic', label: 'P', color: 'error' },
  { value: 'Likely Pathogenic', label: 'LP', color: 'deep-orange' },
  { value: 'VUS', label: 'VUS', color: 'warning' },
  { value: 'Likely Benign', label: 'LB', color: 'blue-grey' },
  { value: 'Benign', label: 'B', color: 'success' }
] as const

/**
 * ACMG classification filter options with full labels
 * Used by filter drawers where space allows longer labels
 */
export const ACMG_FILTER_OPTIONS_LONG = [
  { value: 'Pathogenic', label: 'Pathogenic', color: 'error' },
  { value: 'Likely Pathogenic', label: 'Likely Pathogenic', color: 'deep-orange' },
  { value: 'VUS', label: 'VUS', color: 'warning' },
  { value: 'Likely Benign', label: 'Likely Benign', color: 'blue-grey' },
  { value: 'Benign', label: 'Benign', color: 'success' }
] as const
