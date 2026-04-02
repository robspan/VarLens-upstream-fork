/**
 * Panels logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/panels-logic'

describe('panels-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.listPanels).toBe('function')
    expect(typeof logic.getPanel).toBe('function')
    expect(typeof logic.createPanel).toBe('function')
    expect(typeof logic.updatePanel).toBe('function')
    expect(typeof logic.deletePanel).toBe('function')
    expect(typeof logic.duplicatePanel).toBe('function')
    expect(typeof logic.setGenes).toBe('function')
    expect(typeof logic.getGenes).toBe('function')
    expect(typeof logic.activatePanel).toBe('function')
    expect(typeof logic.deactivatePanel).toBe('function')
    expect(typeof logic.getActivePanelsForCase).toBe('function')
    expect(typeof logic.validateSymbols).toBe('function')
    expect(typeof logic.autocomplete).toBe('function')
    expect(typeof logic.searchPanelApp).toBe('function')
    expect(typeof logic.importPanelApp).toBe('function')
    expect(typeof logic.generateStringDb).toBe('function')
    expect(typeof logic.generateBedContent).toBe('function')
  })
})
