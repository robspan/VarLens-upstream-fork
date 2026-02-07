/**
 * useTableFormatters composable
 *
 * Shared formatting utilities for variant table data display.
 * DRY extraction from VariantTable.vue and CohortTableRow.vue.
 *
 * @example
 * ```vue
 * import { useTableFormatters } from '@/composables/useTableFormatters'
 * const { formatPosition, formatScientific } = useTableFormatters()
 * ```
 */

export interface UseTableFormattersReturn {
  formatPosition: (pos: number) => string
  formatScientific: (value: number | null) => string
  formatPercentage: (value: number) => string
  formatCaddScore: (value: number | null) => string
  formatScore: (value: number | null, decimals?: number) => string
}

export function useTableFormatters(): UseTableFormattersReturn {
  /** Format genomic position with thousand separators */
  const formatPosition = (pos: number): string => {
    return new Intl.NumberFormat('en-US').format(pos)
  }

  /** Format allele frequency in scientific notation when small */
  const formatScientific = (value: number | null): string => {
    if (value === null || value === undefined) return '--'
    if (value === 0) return '0'
    if (value >= 0.01) return value.toFixed(4)
    return value.toExponential(1)
  }

  /** Format cohort frequency as percentage */
  const formatPercentage = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`
  }

  /** Format CADD score with one decimal */
  const formatCaddScore = (value: number | null): string => {
    return value !== null ? value.toFixed(1) : '--'
  }

  /** Format nullable score values with configurable decimals */
  const formatScore = (value: number | null, decimals = 2): string => {
    return value !== null ? value.toFixed(decimals) : '--'
  }

  return {
    formatPosition,
    formatScientific,
    formatPercentage,
    formatCaddScore,
    formatScore
  }
}

// Named exports for direct function import (tree-shaking friendly)
export const { formatPosition, formatScientific, formatPercentage, formatCaddScore, formatScore } =
  useTableFormatters()
