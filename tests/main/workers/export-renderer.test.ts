import { describe, it, expect } from 'vitest'
import { formatCellValue, csvEscape } from '../../../src/main/workers/export-renderer'

describe('formatCellValue', () => {
  it('formats gnomAD AF in exponential notation', () => {
    expect(formatCellValue('gnomad_af', 0.001)).toBe('1.00e-3')
  })
  it('formats CADD as fixed 2-decimal', () => {
    expect(formatCellValue('cadd', 25.123)).toBe('25.12')
  })
  it('formats hpo_sim_score as fixed 4-decimal', () => {
    expect(formatCellValue('hpo_sim_score', 0.87654)).toBe('0.8765')
  })
  it('returns string for other columns', () => {
    expect(formatCellValue('gene_symbol', 'BRCA1')).toBe('BRCA1')
  })
  it('returns empty string for null', () => {
    expect(formatCellValue('gene_symbol', null)).toBe('')
  })
  it('returns empty string for undefined', () => {
    expect(formatCellValue('gene_symbol', undefined)).toBe('')
  })
  it('passes through number for non-special columns', () => {
    expect(formatCellValue('qual', 42)).toBe(42)
  })
})

describe('csvEscape', () => {
  it('wraps values containing commas in quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
  })
  it('escapes double quotes by doubling them', () => {
    expect(csvEscape('a"b')).toBe('"a""b"')
  })
  it('passes through simple values unchanged', () => {
    expect(csvEscape('BRCA1')).toBe('BRCA1')
  })
  it('wraps values containing newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"')
  })
  it('wraps values containing carriage returns', () => {
    expect(csvEscape('a\rb')).toBe('"a\rb"')
  })
  it('returns empty string for null', () => {
    expect(csvEscape(null)).toBe('')
  })
  it('converts numbers to strings', () => {
    expect(csvEscape(42)).toBe('42')
  })
})
