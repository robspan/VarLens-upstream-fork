/**
 * Variants logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/variants-logic'

describe('variants-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.buildVariantFilter).toBe('function')
    expect(typeof logic.queryVariants).toBe('function')
    expect(typeof logic.getFilterOptions).toBe('function')
    expect(typeof logic.searchVariants).toBe('function')
    expect(typeof logic.getGeneSymbols).toBe('function')
  })
})
