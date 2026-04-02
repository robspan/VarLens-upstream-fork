/**
 * Case metadata logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/case-metadata-logic'

describe('case-metadata-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.getMetadata).toBe('function')
    expect(typeof logic.upsertMetadata).toBe('function')
    expect(typeof logic.listCohorts).toBe('function')
    expect(typeof logic.createCohort).toBe('function')
    expect(typeof logic.updateCohort).toBe('function')
    expect(typeof logic.deleteCohort).toBe('function')
    expect(typeof logic.getCohortByName).toBe('function')
    expect(typeof logic.getCaseCohorts).toBe('function')
    expect(typeof logic.assignCohort).toBe('function')
    expect(typeof logic.removeCohort).toBe('function')
    expect(typeof logic.setCohorts).toBe('function')
    expect(typeof logic.getHpoTerms).toBe('function')
    expect(typeof logic.assignHpoTerm).toBe('function')
    expect(typeof logic.removeHpoTerm).toBe('function')
    expect(typeof logic.getDataInfo).toBe('function')
    expect(typeof logic.upsertDataInfo).toBe('function')
  })
})
