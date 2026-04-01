import { describe, it, expect } from 'vitest'
import { emitFts5Search } from '../../../../src/main/database/search/fts5-search-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

function emit(input: string) {
  return emitFts5Search(parse(tokenize(input)))
}

describe('emitFts5Search', () => {
  it('emits FTS5 MATCH for single term', () => {
    const { sql, params } = emit('BRCA1')
    expect(sql).toContain('variants_fts MATCH ?')
    expect(params[0]).toContain('BRCA1')
  })

  it('emits AND between two FTS terms', () => {
    const { sql, params } = emit('BRCA1 AND TP53')
    expect(sql).toContain('AND')
    expect(params.length).toBe(2)
  })

  it('emits OR between two FTS terms', () => {
    const { sql } = emit('BRCA1 OR TP53')
    expect(sql).toContain('OR')
  })

  it('emits valid SQL for A OR NOT B', () => {
    const { sql } = emit('BRCA1 OR NOT TP53')
    expect(sql).toContain('OR')
    expect(sql).toContain('NOT')
    // The bug: old code could emit "OR AND NOT" — verify it's gone
    expect(sql).not.toMatch(/OR\s+AND\s+NOT/)
  })

  it('handles HGVS pattern with LIKE fallback', () => {
    const { sql, params } = emit('c.1234A>G')
    expect(sql).toContain('LIKE ?')
    expect(params).toContain('%c.1234A>G%')
  })

  it('escapes double quotes in FTS terms', () => {
    const { params } = emit('BRCA"1')
    const ftsParam = params.find((p) => typeof p === 'string' && p.includes('BRCA'))
    expect(ftsParam).toContain('""')
  })
})
