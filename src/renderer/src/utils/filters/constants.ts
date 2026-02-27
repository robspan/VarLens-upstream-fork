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
