import { describe, it, expect } from 'vitest'
import { generateSuggestions } from '../../../../src/renderer/src/utils/acmg/acmg-suggestions'

describe('generateSuggestions', () => {
  it('returns empty array for null annotations', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: null,
      clinvar: null
    })
    expect(result).toEqual([])
  })

  it('suggests PM2 for gnomAD AF = 0', () => {
    const result = generateSuggestions({ gnomad_af: 0, cadd: null, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'PM2', source: 'gnomad_af' }))
  })

  it('suggests PM2 for gnomAD AF < 0.00001', () => {
    const result = generateSuggestions({ gnomad_af: 0.000005, cadd: null, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'PM2', source: 'gnomad_af' }))
  })

  it('suggests BA1 for gnomAD AF > 0.05', () => {
    const result = generateSuggestions({ gnomad_af: 0.06, cadd: null, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'BA1', source: 'gnomad_af' }))
  })

  it('suggests BS1 for gnomAD AF 0.01-0.05', () => {
    const result = generateSuggestions({ gnomad_af: 0.03, cadd: null, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'BS1', source: 'gnomad_af' }))
  })

  it('suggests PP3 for CADD >= 25', () => {
    const result = generateSuggestions({ gnomad_af: null, cadd: 28.3, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'PP3', source: 'cadd' }))
  })

  it('suggests BP4 for CADD < 15', () => {
    const result = generateSuggestions({ gnomad_af: null, cadd: 12, clinvar: null })
    expect(result).toContainEqual(expect.objectContaining({ code: 'BP4', source: 'cadd' }))
  })

  it('does not suggest deprecated PP5 for ClinVar pathogenic', () => {
    const result = generateSuggestions({ gnomad_af: null, cadd: null, clinvar: 'Pathogenic' })
    expect(result).not.toContainEqual(expect.objectContaining({ code: 'PP5' }))
  })

  it('does not suggest deprecated BP6 for ClinVar benign', () => {
    const result = generateSuggestions({ gnomad_af: null, cadd: null, clinvar: 'Benign' })
    expect(result).not.toContainEqual(expect.objectContaining({ code: 'BP6' }))
  })

  it('suggests PP3 for REVEL >= 0.7', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      revel: 0.8
    })
    expect(result).toContainEqual(expect.objectContaining({ code: 'PP3', source: 'revel' }))
  })

  it('suggests BP4 for REVEL < 0.3', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      revel: 0.2
    })
    expect(result).toContainEqual(expect.objectContaining({ code: 'BP4', source: 'revel' }))
  })

  it('suggests PP3 for SpliceAI >= 0.5', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      spliceai_max: 0.7
    })
    expect(result).toContainEqual(expect.objectContaining({ code: 'PP3', source: 'spliceai' }))
  })

  it('produces multiple suggestions from combined data', () => {
    const result = generateSuggestions({
      gnomad_af: 0.000001,
      cadd: 30,
      clinvar: 'Pathogenic'
    })
    expect(result.length).toBe(2)
    const codes = result.map((r) => r.code)
    expect(codes).toContain('PM2')
    expect(codes).toContain('PP3')
  })

  it('all suggestions are auto_suggested and not confirmed', () => {
    const result = generateSuggestions({ gnomad_af: 0, cadd: 30, clinvar: null })
    for (const suggestion of result) {
      expect(suggestion.auto_suggested).toBe(true)
      expect(suggestion.confirmed).toBe(false)
    }
  })

  it('does not produce duplicate PP3 from CADD and REVEL', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: 30,
      clinvar: null,
      revel: 0.8
    })
    const pp3s = result.filter((r) => r.code === 'PP3')
    expect(pp3s.length).toBe(1)
  })

  it('does not produce duplicate BP4 from CADD and REVEL', () => {
    const result = generateSuggestions({
      gnomad_af: null,
      cadd: 10,
      clinvar: null,
      revel: 0.1
    })
    const bp4s = result.filter((r) => r.code === 'BP4')
    expect(bp4s.length).toBe(1)
  })
})
