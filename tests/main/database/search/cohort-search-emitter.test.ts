import { describe, it, expect } from 'vitest'
import { emitCohortSearch } from '../../../../src/main/database/search/cohort-search-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

function emit(input: string) {
  return emitCohortSearch(parse(tokenize(input)))
}

describe('emitCohortSearch', () => {
  it('emits LIKE conditions for single term', () => {
    const { sql, params } = emit('BRCA1')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%'])
  })

  it('emits AND between two terms', () => {
    const { sql, params } = emit('BRCA1 AND TP53')
    expect(sql).toContain('AND')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
  })

  it('emits OR between two terms', () => {
    const { sql, params } = emit('BRCA1 OR TP53')
    expect(sql).toContain('OR')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
  })

  it('emits NOT correctly for A OR NOT B', () => {
    const { sql, params } = emit('BRCA1 OR NOT TP53')
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT')
    expect(params).toEqual(['%BRCA1%', '%BRCA1%', '%BRCA1%', '%TP53%', '%TP53%', '%TP53%'])
    // The bug: old code emitted "OR AND NOT" — verify it's gone
    expect(sql).not.toMatch(/OR\s+AND\s+NOT/)
  })

  it('handles genomic coordinate pattern', () => {
    const { sql, params } = emit('chr1:12345')
    expect(sql).toContain('chr = ?')
    expect(sql).toContain('pos = ?')
    expect(params).toContain('1')
    expect(params).toContain(12345)
  })

  it('handles HGVS pattern', () => {
    const { sql, params } = emit('c.1234A>G')
    expect(sql).toContain('LIKE ?')
    expect(params).toEqual(['%c.1234A>G%', '%c.1234A>G%'])
  })
})
