import { describe, it, expect } from 'vitest'
import { tokenize, parse } from '../../../src/shared/utils/boolean-search'

describe('tokenize', () => {
  it('tokenizes single term', () => {
    expect(tokenize('BRCA1')).toEqual([{ type: 'TERM', value: 'BRCA1' }])
  })

  it('tokenizes AND expression', () => {
    expect(tokenize('BRCA1 AND TP53')).toEqual([
      { type: 'TERM', value: 'BRCA1' },
      { type: 'AND' },
      { type: 'TERM', value: 'TP53' }
    ])
  })

  it('tokenizes OR expression', () => {
    expect(tokenize('BRCA1 OR TP53')).toEqual([
      { type: 'TERM', value: 'BRCA1' },
      { type: 'OR' },
      { type: 'TERM', value: 'TP53' }
    ])
  })

  it('tokenizes NOT expression', () => {
    expect(tokenize('NOT BRCA1')).toEqual([{ type: 'NOT' }, { type: 'TERM', value: 'BRCA1' }])
  })

  it('tokenizes parenthesized expression', () => {
    expect(tokenize('(BRCA1 OR TP53) AND EGFR')).toEqual([
      { type: 'LPAREN' },
      { type: 'TERM', value: 'BRCA1' },
      { type: 'OR' },
      { type: 'TERM', value: 'TP53' },
      { type: 'RPAREN' },
      { type: 'AND' },
      { type: 'TERM', value: 'EGFR' }
    ])
  })

  it('treats lowercase and/or/not as terms, not operators', () => {
    expect(tokenize('anderson')).toEqual([{ type: 'TERM', value: 'anderson' }])
  })

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('parse', () => {
  it('parses single term', () => {
    const ast = parse(tokenize('BRCA1'))
    expect(ast).toEqual({ type: 'term', value: 'BRCA1' })
  })

  it('parses AND expression', () => {
    const ast = parse(tokenize('BRCA1 AND TP53'))
    expect(ast).toEqual({
      type: 'and',
      left: { type: 'term', value: 'BRCA1' },
      right: { type: 'term', value: 'TP53' }
    })
  })

  it('parses OR expression', () => {
    const ast = parse(tokenize('BRCA1 OR TP53'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'BRCA1' },
      right: { type: 'term', value: 'TP53' }
    })
  })

  it('parses NOT expression', () => {
    const ast = parse(tokenize('NOT BRCA1'))
    expect(ast).toEqual({
      type: 'not',
      operand: { type: 'term', value: 'BRCA1' }
    })
  })

  it('respects precedence: NOT > AND > OR', () => {
    const ast = parse(tokenize('BRCA1 OR TP53 AND NOT EGFR'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'BRCA1' },
      right: {
        type: 'and',
        left: { type: 'term', value: 'TP53' },
        right: {
          type: 'not',
          operand: { type: 'term', value: 'EGFR' }
        }
      }
    })
  })

  it('respects explicit parentheses', () => {
    const ast = parse(tokenize('(BRCA1 OR TP53) AND NOT EGFR'))
    expect(ast).toEqual({
      type: 'and',
      left: {
        type: 'or',
        left: { type: 'term', value: 'BRCA1' },
        right: { type: 'term', value: 'TP53' }
      },
      right: {
        type: 'not',
        operand: { type: 'term', value: 'EGFR' }
      }
    })
  })

  it('AND binds tighter than OR', () => {
    const ast = parse(tokenize('A OR B AND C'))
    expect(ast).toEqual({
      type: 'or',
      left: { type: 'term', value: 'A' },
      right: {
        type: 'and',
        left: { type: 'term', value: 'B' },
        right: { type: 'term', value: 'C' }
      }
    })
  })

  it('throws on empty input', () => {
    expect(() => parse([])).toThrow()
  })

  it('throws on unbalanced parentheses', () => {
    expect(() => parse(tokenize('(BRCA1 AND TP53'))).toThrow()
  })

  it('throws on adjacent operators', () => {
    expect(() => parse(tokenize('AND AND'))).toThrow()
  })

  it('throws on trailing operator', () => {
    expect(() => parse(tokenize('BRCA1 AND'))).toThrow()
  })
})
