import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import { rebuildFts } from './worker-db'

export interface ImportFtsFinalizationState {
  ftsTriggersDropped: boolean
  ftsRebuilt: boolean
}

type RebuildFtsFn = (db: DatabaseType) => void
type CleanupFn = () => void
type PostMessageFn<T> = (message: T) => void

export function finalizeInterruptedImportFts(
  db: DatabaseType,
  state: ImportFtsFinalizationState,
  rebuild: RebuildFtsFn = rebuildFts
): boolean {
  if (!state.ftsTriggersDropped || state.ftsRebuilt) return false

  try {
    rebuild(db)
    state.ftsRebuilt = true
    return true
  } catch {
    return false
  }
}

export function postTerminalMessageAfterCleanup<T>(
  terminalMessage: T | null | undefined,
  cleanup: CleanupFn,
  postMessage: PostMessageFn<T>
): void {
  cleanup()

  if (terminalMessage !== null && terminalMessage !== undefined) {
    postMessage(terminalMessage)
  }
}
