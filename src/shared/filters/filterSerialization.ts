import type { FilterIpcParams, FilterState } from '../types/filters'
import { cloneForIpc } from '../utils/cloneForIpc'

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
    params.column_filters = cloneForIpc(filters.columnFilters)
  }

  return params
}

export const buildIpcParams = buildFilterIpcParams
