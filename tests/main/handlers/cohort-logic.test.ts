/**
 * Cohort logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/cohort-logic'

describe('cohort-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.spawnRebuildWorker).toBe('function')
    expect(typeof logic.queryCohortVariants).toBe('function')
    expect(typeof logic.getColumnMeta).toBe('function')
    expect(typeof logic.getCohortSummary).toBe('function')
    expect(typeof logic.getCarriers).toBe('function')
    expect(typeof logic.getGeneBurden).toBe('function')
    expect(typeof logic.runGeneBurdenCompare).toBe('function')
    expect(typeof logic.cancelGeneBurdenCompare).toBe('function')
    expect(typeof logic.getSummaryStatus).toBe('function')
    expect(typeof logic.rebuildSummary).toBe('function')
    expect(typeof logic.triggerStartupRebuildIfNeeded).toBe('function')
  })
})
