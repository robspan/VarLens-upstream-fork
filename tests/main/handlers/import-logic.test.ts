/**
 * Import logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/import-logic'

describe('import-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.startImport).toBe('function')
    expect(typeof logic.cancelImport).toBe('function')
    expect(typeof logic.getVcfPreview).toBe('function')
  })
})
