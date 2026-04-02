/**
 * Export logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/export-logic'

describe('export-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.prepareVariantExport).toBe('function')
    expect(typeof logic.buildFilterSummary).toBe('function')
    expect(typeof logic.exportVariants).toBe('function')
    expect(typeof logic.exportCohort).toBe('function')
  })
})
