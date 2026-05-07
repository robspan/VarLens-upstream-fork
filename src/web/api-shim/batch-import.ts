import type { BatchImportDomainContract } from '../../shared/ipc/domains/batch-import'
import { httpInvoke } from './http-invoke'

// `selectFiles`/`selectFolder`/`selectZip` open native file pickers in
// Electron; in the browser they're driven by a UI <input type=file>.
// The web routes return the uploaded paths the server stages on disk;
// the renderer treats them like Electron-side paths.
export const createBatchImportApi = (): BatchImportDomainContract => ({
  selectFiles: () => httpInvoke('/api/batch-import/selectFiles', []),
  selectFolder: () => httpInvoke('/api/batch-import/selectFolder', []),
  checkDuplicates: (filePaths, stripText) =>
    httpInvoke('/api/batch-import/checkDuplicates', [filePaths, stripText]),
  start: (filePaths, duplicateStrategy, stripText) =>
    httpInvoke('/api/batch-import/start', [filePaths, duplicateStrategy, stripText]),
  cancel: () => httpInvoke('/api/batch-import/cancel', []),
  selectZip: () => httpInvoke('/api/batch-import/selectZip', []),
  testZipPassword: (zipPath, password) =>
    httpInvoke('/api/batch-import/testZipPassword', [zipPath, password]),
  extractZip: (zipPath, password) =>
    httpInvoke('/api/batch-import/extractZip', [zipPath, password]),
  cleanupZipTemp: () => httpInvoke('/api/batch-import/cleanupZipTemp', [])
})
