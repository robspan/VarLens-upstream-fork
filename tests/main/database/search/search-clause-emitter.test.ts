import { describe, it, expect } from 'vitest'
import {
  classifySearchAst,
  composeSearchClauses,
  type SearchClause
} from '../../../../src/main/database/search/search-clause-emitter'
import { tokenize, parse } from '../../../../src/shared/utils/boolean-search'

describe('classifySearchAst', () => {
  it('single term → fts leaf', () => {
    const ast = parse(tokenize('BRCA1'))
    const clause = classifySearchAst(ast)
    expect(clause).toEqual({ type: 'fts', term: 'BRCA1' })
  })

  it('HGVS cdna term → hgvs leaf', () => {
    const ast = parse(tokenize('c.76A>T'))
    const clause = classifySearchAst(ast)
    expect(clause).toEqual({ type: 'hgvs', term: 'c.76A>T' })
  })

  it('HGVS protein term → hgvs leaf', () => {
    const ast = parse(tokenize('p.Arg123Gln'))
    const clause = classifySearchAst(ast)
    expect(clause).toEqual({ type: 'hgvs', term: 'p.Arg123Gln' })
  })

  it('AND expression mixing FTS and HGVS', () => {
    const ast = parse(tokenize('BRCA1 AND c.76A>T'))
    const clause = classifySearchAst(ast)
    expect(clause.type).toBe('and')
    if (clause.type === 'and') {
      expect(clause.left).toEqual({ type: 'fts', term: 'BRCA1' })
      expect(clause.right).toEqual({ type: 'hgvs', term: 'c.76A>T' })
    }
  })

  it('NOT expression preserves structure', () => {
    const ast = parse(tokenize('NOT BRCA1'))
    const clause = classifySearchAst(ast)
    expect(clause.type).toBe('not')
  })
})

describe('composeSearchClauses', () => {
  const present = {
    baseFts: 'variants_fts' as const,
    extensionFts: [
      {
        typeKey: 'sv' as const,
        ftsTable: 'variant_sv_fts',
        sourceTable: 'variant_sv',
        variantTypeValue: 'sv' as const,
        ftsColumns: ['event_id', 'mate_id']
      },
      {
        typeKey: 'str' as const,
        ftsTable: 'variant_str_fts',
        sourceTable: 'variant_str',
        variantTypeValue: 'str' as const,
        ftsColumns: ['repeat_id', 'repeat_unit', 'disease']
      }
    ]
  }

  it('single FTS term → UNION across all present FTS tables', () => {
    const clause: SearchClause = { type: 'fts', term: 'BRCA1' }
    const { sql, params } = composeSearchClauses(clause, present)
    expect(sql).toContain('id IN (')
    expect(sql).toContain('SELECT rowid FROM variants_fts WHERE variants_fts MATCH ?')
    expect(sql).toContain('SELECT rowid FROM variant_sv_fts WHERE variant_sv_fts MATCH ?')
    expect(sql).toContain('SELECT rowid FROM variant_str_fts WHERE variant_str_fts MATCH ?')
    expect(sql).toContain('UNION')
    expect(params).toEqual(['"BRCA1"*', '"BRCA1"*', '"BRCA1"*'])
  })

  it('single HGVS term → base-table LIKE (no UNION, no FTS)', () => {
    const clause: SearchClause = { type: 'hgvs', term: 'c.76A>T' }
    const { sql, params } = composeSearchClauses(clause, present)
    expect(sql).toContain('cdna LIKE ?')
    expect(sql).toContain('aa_change LIKE ?')
    expect(sql).not.toContain('UNION')
    expect(sql).not.toContain('variants_fts MATCH')
    expect(params).toEqual(['%c.76A>T%', '%c.76A>T%'])
  })

  it('BRCA1 AND c.76A>T mixes FTS UNION and base LIKE at outer AND', () => {
    const clause: SearchClause = {
      type: 'and',
      left: { type: 'fts', term: 'BRCA1' },
      right: { type: 'hgvs', term: 'c.76A>T' }
    }
    const { sql } = composeSearchClauses(clause, present)
    expect(sql).toContain('id IN (')
    expect(sql).toContain('variants_fts MATCH')
    expect(sql).toContain('cdna LIKE')
    expect(sql).toMatch(/\(.*AND.*\)/)
  })

  it('no extension FTS tables → fallback to variants_fts only', () => {
    const clause: SearchClause = { type: 'fts', term: 'BRCA1' }
    const { sql, params } = composeSearchClauses(clause, {
      baseFts: 'variants_fts',
      extensionFts: []
    })
    expect(sql).toContain('variants_fts MATCH ?')
    expect(sql).not.toContain('UNION')
    expect(params).toEqual(['"BRCA1"*'])
  })

  it('nested OR with two FTS terms', () => {
    const clause: SearchClause = {
      type: 'or',
      left: { type: 'fts', term: 'BRCA1' },
      right: { type: 'fts', term: 'TP53' }
    }
    const { sql, params } = composeSearchClauses(clause, present)
    expect(sql).toMatch(/\(.*OR.*\)/)
    // Each term expands to 3 UNION arms → 3 params per term → 6 total
    expect(params.length).toBe(6)
  })

  it('FTS term escapes double quotes', () => {
    const clause: SearchClause = { type: 'fts', term: 'ab"cd' }
    const { params } = composeSearchClauses(clause, {
      baseFts: 'variants_fts',
      extensionFts: []
    })
    expect(params).toEqual(['"ab""cd"*'])
  })
})
