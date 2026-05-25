import { describe, expect, it, vi } from 'vitest'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import {
  finalizeInterruptedImportFts,
  postTerminalMessageAfterCleanup,
  type ImportFtsFinalizationState
} from '../../../src/main/workers/import-finalization'

describe('finalizeInterruptedImportFts', () => {
  it('rebuilds FTS when triggers were dropped and normal rebuild did not run', () => {
    const db = {} as DatabaseType
    const state: ImportFtsFinalizationState = {
      ftsTriggersDropped: true,
      ftsRebuilt: false
    }
    const rebuildFts = vi.fn()

    const rebuilt = finalizeInterruptedImportFts(db, state, rebuildFts)

    expect(rebuilt).toBe(true)
    expect(rebuildFts).toHaveBeenCalledExactlyOnceWith(db)
    expect(state.ftsRebuilt).toBe(true)
  })

  it('does not rebuild FTS when normal rebuild already ran', () => {
    const db = {} as DatabaseType
    const state: ImportFtsFinalizationState = {
      ftsTriggersDropped: true,
      ftsRebuilt: true
    }
    const rebuildFts = vi.fn()

    const rebuilt = finalizeInterruptedImportFts(db, state, rebuildFts)

    expect(rebuilt).toBe(false)
    expect(rebuildFts).not.toHaveBeenCalled()
  })
})

describe('postTerminalMessageAfterCleanup', () => {
  it('runs cleanup before posting a terminal message', () => {
    const events: string[] = []

    postTerminalMessageAfterCleanup(
      { type: 'error', fileIndex: -1 },
      () => {
        events.push('cleanup')
      },
      (msg) => {
        events.push(`post:${msg.type}:${msg.fileIndex}`)
      }
    )

    expect(events).toEqual(['cleanup', 'post:error:-1'])
  })

  it('runs cleanup without posting when there is no terminal message', () => {
    const cleanup = vi.fn()
    const postMessage = vi.fn()

    postTerminalMessageAfterCleanup(null, cleanup, postMessage)

    expect(cleanup).toHaveBeenCalledOnce()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
