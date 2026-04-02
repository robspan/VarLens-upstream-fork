/**
 * Batch import logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/batch-import-logic'

describe('batch-import-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.checkDuplicateFiles).toBe('function')
    expect(typeof logic.startBatchImport).toBe('function')
    expect(typeof logic.cancelBatchImport).toBe('function')
    expect(typeof logic.testZipPassword).toBe('function')
    expect(typeof logic.extractZip).toBe('function')
    expect(typeof logic.cleanupZipTemp).toBe('function')
  })
})
