/**
 * Database logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/database-logic'

describe('database-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.openDatabase).toBe('function')
    expect(typeof logic.createDatabase).toBe('function')
    expect(typeof logic.rekeyDatabase).toBe('function')
    expect(typeof logic.getDatabaseInfo).toBe('function')
    expect(typeof logic.getRecentDatabases).toBe('function')
    expect(typeof logic.getDatabaseOverview).toBe('function')
    expect(typeof logic.removeRecentDatabase).toBe('function')
    expect(typeof logic.deleteDbFile).toBe('function')
  })
})
