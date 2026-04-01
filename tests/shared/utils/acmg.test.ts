import { describe, it, expect } from 'vitest'
import { normalizeAcmgClassification } from '../../../src/shared/utils/acmg'

describe('normalizeAcmgClassification', () => {
  // Canonical values pass through unchanged
  it('passes through Pathogenic', () => {
    expect(normalizeAcmgClassification('Pathogenic')).toBe('Pathogenic')
  })

  it('passes through Likely pathogenic', () => {
    expect(normalizeAcmgClassification('Likely pathogenic')).toBe('Likely pathogenic')
  })

  it('passes through Uncertain significance', () => {
    expect(normalizeAcmgClassification('Uncertain significance')).toBe('Uncertain significance')
  })

  it('passes through Likely benign', () => {
    expect(normalizeAcmgClassification('Likely benign')).toBe('Likely benign')
  })

  it('passes through Benign', () => {
    expect(normalizeAcmgClassification('Benign')).toBe('Benign')
  })

  // Title case variants normalize to canonical
  it('normalizes Likely Pathogenic to Likely pathogenic', () => {
    expect(normalizeAcmgClassification('Likely Pathogenic')).toBe('Likely pathogenic')
  })

  it('normalizes Uncertain Significance to Uncertain significance', () => {
    expect(normalizeAcmgClassification('Uncertain Significance')).toBe('Uncertain significance')
  })

  it('normalizes Likely Benign to Likely benign', () => {
    expect(normalizeAcmgClassification('Likely Benign')).toBe('Likely benign')
  })

  // Abbreviations normalize
  it('normalizes LP to Likely pathogenic', () => {
    expect(normalizeAcmgClassification('LP')).toBe('Likely pathogenic')
  })

  it('normalizes VUS to Uncertain significance', () => {
    expect(normalizeAcmgClassification('VUS')).toBe('Uncertain significance')
  })

  it('normalizes LB to Likely benign', () => {
    expect(normalizeAcmgClassification('LB')).toBe('Likely benign')
  })

  it('normalizes P to Pathogenic', () => {
    expect(normalizeAcmgClassification('P')).toBe('Pathogenic')
  })

  it('normalizes B to Benign', () => {
    expect(normalizeAcmgClassification('B')).toBe('Benign')
  })

  // Unknown values return null
  it('returns null for unknown value', () => {
    expect(normalizeAcmgClassification('garbage')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeAcmgClassification('')).toBeNull()
  })
})
