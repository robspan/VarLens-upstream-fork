/**
 * Composable for gene symbol validation and autocomplete
 *
 * Provides text parsing, symbol validation via the gene reference database,
 * autocomplete suggestions, and result manipulation (accept alias, resolve
 * ambiguous, remove).
 */

import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useApiService } from './useApiService'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of validating a single gene symbol */
export interface ValidationResult {
  input: string
  status: 'approved' | 'alias' | 'ambiguous' | 'unknown'
  symbol?: string
  hgncId?: string
  name?: string
  locusGroup?: string
  /** For alias results: the current approved symbol */
  currentSymbol?: string
  aliasType?: string
  /** For ambiguous results: possible matches */
  candidates?: Array<{ symbol: string; hgncId: string }>
}

/** Autocomplete suggestion for gene search */
export interface AutocompleteResult {
  symbol: string
  hgncId: string
  name: string
  locusGroup: string
  matchType: 'symbol' | 'alias'
  matchedAlias?: string
}

/** Approved gene ready for saving to a panel */
export interface ApprovedGene {
  hgncId: string
  symbol: string
}

/** Return type for useGeneValidation composable */
export interface UseGeneValidationReturn {
  validationResults: Ref<ValidationResult[]>
  suggestions: Ref<AutocompleteResult[]>
  validating: Ref<boolean>
  loadingSuggestions: Ref<boolean>
  parseGeneText: (text: string) => string[]
  validateSymbols: (symbols: string[]) => Promise<ValidationResult[]>
  autocomplete: (query: string, limit?: number) => Promise<void>
  acceptAlias: (index: number) => void
  removeResult: (index: number) => void
  resolveAmbiguous: (index: number, chosen: { symbol: string; hgncId: string }) => void
  approvedCount: ComputedRef<number>
  aliasCount: ComputedRef<number>
  ambiguousCount: ComputedRef<number>
  unknownCount: ComputedRef<number>
  canSave: ComputedRef<boolean>
  approvedGenes: ComputedRef<ApprovedGene[]>
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Composable for gene symbol validation and autocomplete
 *
 * @returns Validation state, results, and manipulation methods
 */
export function useGeneValidation(): UseGeneValidationReturn {
  const { api } = useApiService()

  const validationResults = ref<ValidationResult[]>([])
  const suggestions = ref<AutocompleteResult[]>([])
  const validating = ref(false)
  const loadingSuggestions = ref(false)

  // -------------------------------------------------------------------------
  // Text parsing
  // -------------------------------------------------------------------------

  /**
   * Parse raw text into an array of gene symbol strings.
   * Splits on newline, comma, semicolon, and tab. Trims, uppercases,
   * and filters out empty strings and duplicates.
   */
  const parseGeneText = (text: string): string[] => {
    const symbols = text
      .split(/[\n,;\t]+/)
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0)

    // Deduplicate while preserving order
    return [...new Set(symbols)]
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate an array of gene symbols via the IPC API.
   * Updates validationResults ref and returns the results.
   */
  const validateSymbols = async (symbols: string[]): Promise<ValidationResult[]> => {
    if (!api || symbols.length === 0) {
      validationResults.value = []
      return []
    }

    validating.value = true
    try {
      const results: ValidationResult[] = await api.panels.validateSymbols(symbols)
      validationResults.value = results
      return results
    } catch (e) {
      console.error('Failed to validate gene symbols:', e)
      validationResults.value = []
      return []
    } finally {
      validating.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------

  /**
   * Fetch autocomplete suggestions for a gene query.
   */
  const autocomplete = async (query: string, limit?: number): Promise<void> => {
    if (!api || !query || query.length < 2) {
      suggestions.value = []
      return
    }

    loadingSuggestions.value = true
    try {
      suggestions.value = await api.panels.autocomplete(query, limit)
    } catch (e) {
      console.error('Failed to autocomplete gene:', e)
      suggestions.value = []
    } finally {
      loadingSuggestions.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Result manipulation
  // -------------------------------------------------------------------------

  /**
   * Accept an alias result: change its status to approved
   * and set the symbol to the current approved symbol.
   */
  const acceptAlias = (index: number): void => {
    const result = validationResults.value[index]
    if (result === undefined || result.status !== 'alias') return

    validationResults.value[index] = {
      ...result,
      status: 'approved',
      symbol: result.currentSymbol ?? result.symbol
    }
  }

  /**
   * Remove a validation result at the given index.
   */
  const removeResult = (index: number): void => {
    if (index < 0 || index >= validationResults.value.length) return
    validationResults.value.splice(index, 1)
  }

  /**
   * Resolve an ambiguous result by selecting one of the candidates.
   */
  const resolveAmbiguous = (index: number, chosen: { symbol: string; hgncId: string }): void => {
    const result = validationResults.value[index]
    if (result === undefined || result.status !== 'ambiguous') return

    validationResults.value[index] = {
      ...result,
      status: 'approved',
      symbol: chosen.symbol,
      hgncId: chosen.hgncId
    }
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

  const approvedCount = computed(
    () => validationResults.value.filter((r) => r.status === 'approved').length
  )

  const aliasCount = computed(
    () => validationResults.value.filter((r) => r.status === 'alias').length
  )

  const ambiguousCount = computed(
    () => validationResults.value.filter((r) => r.status === 'ambiguous').length
  )

  const unknownCount = computed(
    () => validationResults.value.filter((r) => r.status === 'unknown').length
  )

  /**
   * True only when all results are approved AND there is at least one result.
   */
  const canSave = computed(
    () =>
      validationResults.value.length > 0 &&
      validationResults.value.every((r) => r.status === 'approved')
  )

  /**
   * List of approved genes with hgncId and symbol, ready for saving.
   */
  const approvedGenes = computed<ApprovedGene[]>(() =>
    validationResults.value
      .filter(
        (r): r is ValidationResult & { hgncId: string; symbol: string } =>
          r.status === 'approved' && r.hgncId !== undefined && r.symbol !== undefined
      )
      .map((r) => ({ hgncId: r.hgncId, symbol: r.symbol }))
  )

  return {
    validationResults,
    suggestions,
    validating,
    loadingSuggestions,
    parseGeneText,
    validateSymbols,
    autocomplete,
    acceptAlias,
    removeResult,
    resolveAmbiguous,
    approvedCount,
    aliasCount,
    ambiguousCount,
    unknownCount,
    canSave,
    approvedGenes
  }
}
