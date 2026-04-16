import { ipcRenderer } from 'electron'
import type { ImportDomainContract } from '../../shared/ipc/domains/import'

export function createImportApi(): ImportDomainContract {
  return {
    selectFile: () => ipcRenderer.invoke('import:selectFile'),
    selectFiles: () => ipcRenderer.invoke('import:selectFiles'),
    selectBedFile: () => ipcRenderer.invoke('import:selectBedFile'),
    start: (filePath, caseName, vcfOptions) =>
      ipcRenderer.invoke('import:start', filePath, caseName, vcfOptions),
    startMultiFile: (caseName, files, vcfOptions, filters) =>
      ipcRenderer.invoke('import:startMultiFile', caseName, files, vcfOptions, filters),
    vcfPreview: (filePath) => ipcRenderer.invoke('import:vcfPreview', filePath),
    vcfMultiPreview: (filePaths) => ipcRenderer.invoke('import:vcfMultiPreview', filePaths),
    cancel: () => ipcRenderer.invoke('import:cancel')
  }
}
