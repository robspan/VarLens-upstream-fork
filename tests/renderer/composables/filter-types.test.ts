import { describe, it, expect } from 'vitest'
import {
  buildFilterFromState,
  type FilterState
} from '../../../src/renderer/src/composables/filter-types'

const defaultState: FilterState = {
  searchQuery: '',
  geneSymbol: '',
  consequences: [],
  funcs: [],
  clinvars: [],
  maxGnomadAf: null,
  minCadd: null,
  tagIds: [],
  starredOnly: false,
  hasCommentOnly: false,
  acmgClassifications: [],
  annotationScope: 'case'
}

describe('buildFilterFromState', () => {
  it('returns empty filter for default state', () => {
    const result = buildFilterFromState(defaultState, [])
    expect(result).toEqual({})
  })

  it('includes search query when set', () => {
    const state = { ...defaultState, searchQuery: 'BRCA1' }
    const result = buildFilterFromState(state, [])
    expect(result.search_query).toBe('BRCA1')
  })

  it('includes gene symbol when set', () => {
    const state = { ...defaultState, geneSymbol: 'TP53' }
    const result = buildFilterFromState(state, [])
    expect(result.gene_symbol).toBe('TP53')
  })

  it('combines impact presets with consequences and deduplicates', () => {
    const state = { ...defaultState, consequences: ['missense_variant'] }
    const result = buildFilterFromState(state, ['HIGH', 'missense_variant'])
    expect(result.consequences).toEqual(['HIGH', 'missense_variant'])
  })

  it('skips NaN gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: NaN }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBeUndefined()
  })

  it('skips zero gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: 0 }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBeUndefined()
  })

  it('includes valid gnomad_af', () => {
    const state = { ...defaultState, maxGnomadAf: 0.01 }
    const result = buildFilterFromState(state, [])
    expect(result.gnomad_af_max).toBe(0.01)
  })

  it('includes cadd_min when zero (valid threshold)', () => {
    const state = { ...defaultState, minCadd: 0 }
    const result = buildFilterFromState(state, [])
    expect(result.cadd_min).toBe(0)
  })

  it('includes annotation scope when set to all', () => {
    const state = { ...defaultState, annotationScope: 'all' as const }
    const result = buildFilterFromState(state, [])
    expect(result.annotation_scope).toBe('all')
  })

  it('omits annotation scope when case (default)', () => {
    const result = buildFilterFromState(defaultState, [])
    expect(result.annotation_scope).toBeUndefined()
  })

  it('includes all filter types simultaneously', () => {
    const state: FilterState = {
      searchQuery: 'test',
      geneSymbol: 'BRCA1',
      consequences: ['missense_variant'],
      funcs: ['exonic'],
      clinvars: ['pathogenic'],
      maxGnomadAf: 0.01,
      minCadd: 15,
      tagIds: [1, 2],
      starredOnly: true,
      hasCommentOnly: true,
      acmgClassifications: ['Pathogenic'],
      annotationScope: 'all'
    }
    const result = buildFilterFromState(state, ['HIGH'])

    expect(result.search_query).toBe('test')
    expect(result.gene_symbol).toBe('BRCA1')
    expect(result.consequences).toEqual(['HIGH', 'missense_variant'])
    expect(result.funcs).toEqual(['exonic'])
    expect(result.clinvars).toEqual(['pathogenic'])
    expect(result.gnomad_af_max).toBe(0.01)
    expect(result.cadd_min).toBe(15)
    expect(result.tag_ids).toEqual([1, 2])
    expect(result.starred_only).toBe(true)
    expect(result.has_comment).toBe(true)
    expect(result.acmg_classifications).toEqual(['Pathogenic'])
    expect(result.annotation_scope).toBe('all')
  })
})
