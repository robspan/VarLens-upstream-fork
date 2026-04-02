/**
 * Cases logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/cases-logic'

describe('cases-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.acquireDeleteLock).toBe('function')
    expect(typeof logic.releaseDeleteLock).toBe('function')
    expect(typeof logic.runDeleteWorker).toBe('function')
    expect(typeof logic.listCases).toBe('function')
    expect(typeof logic.queryCases).toBe('function')
    expect(typeof logic.deleteSingleCase).toBe('function')
    expect(typeof logic.deleteAllCases).toBe('function')
    expect(typeof logic.deleteBatchCases).toBe('function')
  })
})
