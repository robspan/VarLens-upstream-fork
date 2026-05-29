import type { ColumnFiltersParam } from '../types/column-filters'
import type { VariantFilter } from '../types/api'
import type { FilterIpcParams, FilterState } from '../types/filters'

/**
 * Sprint A A2: this serializer runs in renderer-reachable code and receives
 * `FilterState` whose `columnFilters` may still be a Vue reactive() proxy
 * (callers spread `filters.value` shallowly — see
 * `useFilters.getIpcParams()` and `AssociationConfigPanel.handleRun()`).
 *
 * Do NOT use the shared `cloneForIpc` here: it is now backed by
 * `structuredClone`, which throws DataCloneError on a Vue proxy. We also must
 * not import the renderer-only `stripVueProxies` into `src/shared` (layering
 * boundary). `ColumnFiltersParam` is plain JSON data by contract (strings,
 * numbers, string arrays, booleans), so a JSON round-trip both strips any
 * proxy and produces an IPC-safe deep clone.
 */
function cloneColumnFilters(columnFilters: ColumnFiltersParam): ColumnFiltersParam {
  return JSON.parse(JSON.stringify(columnFilters)) as ColumnFiltersParam
}

export function buildFilterIpcParams(filters: FilterState): FilterIpcParams {
  const params: FilterIpcParams = {}

  if (filters.searchQuery !== '') {
    params.search_term = filters.searchQuery
  }
  if (filters.geneSymbol !== '') {
    params.gene_symbol = filters.geneSymbol
  }

  if (filters.consequences.length > 0) {
    params.consequences = [...filters.consequences]
  }
  if (filters.funcs.length > 0) {
    params.funcs = [...filters.funcs]
  }
  if (filters.clinvars.length > 0) {
    params.clinvars = [...filters.clinvars]
  }

  if (
    filters.maxGnomadAf !== null &&
    Number.isNaN(filters.maxGnomadAf) === false &&
    filters.maxGnomadAf > 0
  ) {
    params.gnomad_af_max = filters.maxGnomadAf
  }
  if (filters.minCadd !== null && Number.isNaN(filters.minCadd) === false && filters.minCadd >= 0) {
    params.cadd_min = filters.minCadd
  }
  if (
    filters.minCarriers !== null &&
    Number.isNaN(filters.minCarriers) === false &&
    filters.minCarriers > 0
  ) {
    params.carrier_count_min = filters.minCarriers
  }

  if (filters.starredOnly) {
    params.starred_only = true
  }
  if (filters.hasCommentOnly) {
    params.has_comment = true
  }
  if (filters.acmgClassifications.length > 0) {
    params.acmg_classifications = [...filters.acmgClassifications]
  }

  if (filters.activePanelIds.length > 0) {
    params.active_panel_ids = [...filters.activePanelIds]
    params.panel_padding_bp = filters.panelPaddingBp
  }

  if (
    filters.maxInternalAf !== null &&
    Number.isNaN(filters.maxInternalAf) === false &&
    filters.maxInternalAf > 0
  ) {
    params.max_internal_af = Math.min(filters.maxInternalAf, 1)
  }

  if (filters.inheritanceModes.length > 0) {
    params.inheritance_modes = [...filters.inheritanceModes]
  }
  if (filters.analysisGroupId !== null) {
    params.analysis_group_id = filters.analysisGroupId
  }
  if (filters.considerPhasing) {
    params.consider_phasing = true
  }

  if (Object.keys(filters.columnFilters).length > 0) {
    params.column_filters = cloneColumnFilters(filters.columnFilters)
  }

  return params
}

export function buildVariantFilterFromState(
  filters: FilterState,
  selectedImpactPresets: string[]
): Omit<VariantFilter, 'case_id'> {
  const variantFilter: Omit<VariantFilter, 'case_id'> = {}
  const ipcParams = buildFilterIpcParams(filters)

  if (ipcParams.search_term !== undefined) {
    variantFilter.search_query = ipcParams.search_term
  }
  if (ipcParams.gene_symbol !== undefined) {
    variantFilter.gene_symbol = ipcParams.gene_symbol
  }
  if (ipcParams.funcs !== undefined) {
    variantFilter.funcs = ipcParams.funcs
  }
  if (ipcParams.clinvars !== undefined) {
    variantFilter.clinvars = ipcParams.clinvars
  }
  if (ipcParams.gnomad_af_max !== undefined) {
    variantFilter.gnomad_af_max = ipcParams.gnomad_af_max
  }
  if (ipcParams.cadd_min !== undefined) {
    variantFilter.cadd_min = ipcParams.cadd_min
  }
  if (ipcParams.has_comment !== undefined) {
    variantFilter.has_comment = ipcParams.has_comment
  }
  if (ipcParams.acmg_classifications !== undefined) {
    variantFilter.acmg_classifications = ipcParams.acmg_classifications
  }
  if (ipcParams.active_panel_ids !== undefined) {
    variantFilter.active_panel_ids = ipcParams.active_panel_ids
    variantFilter.panel_padding_bp = ipcParams.panel_padding_bp
  }
  if (ipcParams.max_internal_af !== undefined) {
    variantFilter.max_internal_af = ipcParams.max_internal_af
  }
  if (ipcParams.inheritance_modes !== undefined) {
    variantFilter.inheritance_modes = ipcParams.inheritance_modes
  }
  if (ipcParams.analysis_group_id !== undefined) {
    variantFilter.analysis_group_id = ipcParams.analysis_group_id
  }
  if (ipcParams.consider_phasing !== undefined) {
    variantFilter.consider_phasing = ipcParams.consider_phasing
  }
  if (ipcParams.column_filters !== undefined) {
    variantFilter.column_filters = ipcParams.column_filters
  }

  const allConsequences = [...selectedImpactPresets, ...filters.consequences]
  if (allConsequences.length > 0) {
    variantFilter.consequences = [...new Set(allConsequences)]
  }
  if (filters.tagIds.length > 0) {
    variantFilter.tag_ids = [...filters.tagIds]
  }
  if (ipcParams.starred_only !== undefined) {
    variantFilter.starred_only = ipcParams.starred_only
  }
  if (filters.annotationScope === 'all') {
    variantFilter.annotation_scope = 'all'
  }

  return variantFilter
}

export const buildIpcParams = buildFilterIpcParams
