import { describe, it, expect } from 'vitest'
import {
  serializeEvidence,
  deserializeEvidence
} from '../../../../src/renderer/src/utils/acmg/acmg-serialization'
import type { AcmgEvidenceState } from '../../../../src/renderer/src/utils/acmg/types'

describe('serializeEvidence', () => {
  it('serializes evidence state to JSON string', () => {
    const state: AcmgEvidenceState = {
      pathogenic: [
        { code: 'PVS1', strength: 'very_strong', auto_suggested: false, confirmed: true }
      ],
      benign: [],
      notes: 'test note',
      classification_date: 1234567890,
      calculated_classification: 'Likely Pathogenic',
      is_override: false
    }
    const json = serializeEvidence(state)
    const parsed = JSON.parse(json)
    expect(parsed.pathogenic).toHaveLength(1)
    expect(parsed.pathogenic[0].code).toBe('PVS1')
    expect(parsed.notes).toBe('test note')
    expect(parsed.calculated_classification).toBe('Likely Pathogenic')
  })
})

describe('deserializeEvidence', () => {
  it('returns null for null input', () => {
    expect(deserializeEvidence(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(deserializeEvidence('')).toBeNull()
  })

  it('deserializes new format correctly', () => {
    const state: AcmgEvidenceState = {
      pathogenic: [
        { code: 'PVS1', strength: 'very_strong', auto_suggested: false, confirmed: true }
      ],
      benign: [
        {
          code: 'BP4',
          strength: 'supporting',
          auto_suggested: true,
          confirmed: true,
          source: 'cadd'
        }
      ],
      notes: 'test',
      classification_date: 1234567890,
      calculated_classification: 'Likely Pathogenic',
      is_override: false
    }
    const json = JSON.stringify(state)
    const result = deserializeEvidence(json)
    expect(result).not.toBeNull()
    expect(result!.pathogenic).toHaveLength(1)
    expect(result!.pathogenic[0].code).toBe('PVS1')
    expect(result!.benign[0].source).toBe('cadd')
    expect(result!.is_override).toBe(false)
  })

  it('migrates old string[] format to new AcmgEvidenceCode[] format', () => {
    const oldFormat = JSON.stringify({
      pathogenic: ['PVS1', 'PM2'],
      benign: ['BP4'],
      notes: 'old note',
      classification_date: 1234567890
    })
    const result = deserializeEvidence(oldFormat)
    expect(result).not.toBeNull()
    expect(result!.pathogenic).toHaveLength(2)
    expect(result!.pathogenic[0].code).toBe('PVS1')
    expect(result!.pathogenic[0].strength).toBe('very_strong')
    expect(result!.pathogenic[0].confirmed).toBe(true)
    expect(result!.pathogenic[1].code).toBe('PM2')
    // PM2 defaults to supporting per ClinGen SVI recommendation
    expect(result!.pathogenic[1].strength).toBe('supporting')
    expect(result!.benign[0].code).toBe('BP4')
    expect(result!.benign[0].strength).toBe('supporting')
    expect(result!.notes).toBe('old note')
    expect(result!.is_override).toBe(false)
    expect(result!.calculated_classification).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(deserializeEvidence('not-json')).toBeNull()
  })
})
