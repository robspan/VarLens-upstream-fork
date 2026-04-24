import type { StorageImportExecutor } from './import-executor'

export const unsupportedImportExecutor: StorageImportExecutor = {
  async importSingleFile() {
    throw new Error('Storage import executor is not implemented for this backend yet')
  },
  cancel() {
    // no-op
  }
}
