/**
 * Shared filter constants
 *
 * Extracted from FilterToolbar.vue and CohortFilterBar.vue to avoid duplication.
 * ACMG values use canonical sentence-case labels from domain.config.
 */
import { ACMG_CLASSIFICATIONS, ACMG_ABBREV } from '../../../../shared/config/domain.config'

/**
 * ACMG classification filter options (short labels for chips)
 */
export const ACMG_FILTER_OPTIONS = [
  { value: 'Pathogenic', label: 'P', color: 'error' },
  { value: 'Likely pathogenic', label: 'LP', color: 'deep-orange' },
  { value: 'Uncertain significance', label: 'VUS', color: 'warning' },
  { value: 'Likely benign', label: 'LB', color: 'blue-grey' },
  { value: 'Benign', label: 'B', color: 'success' }
] as const

/**
 * ACMG classification filter options with full labels
 */
export const ACMG_FILTER_OPTIONS_LONG = [
  { value: 'Pathogenic', label: 'Pathogenic', color: 'error' },
  { value: 'Likely pathogenic', label: 'Likely pathogenic', color: 'deep-orange' },
  { value: 'Uncertain significance', label: 'Uncertain significance', color: 'warning' },
  { value: 'Likely benign', label: 'Likely benign', color: 'blue-grey' },
  { value: 'Benign', label: 'Benign', color: 'success' }
] as const

export { ACMG_CLASSIFICATIONS, ACMG_ABBREV }
