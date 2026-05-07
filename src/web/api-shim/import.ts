import type { ImportDomainContract } from '../../shared/ipc/domains/import'
import { httpInvoke } from './http-invoke'

export const createImportApi = (): ImportDomainContract => ({
  selectFile: () => httpInvoke('/api/import/selectFile', []),
  selectFiles: () => httpInvoke('/api/import/selectFiles', []),
  selectBedFile: () => httpInvoke('/api/import/selectBedFile', []),
  start: (filePath, caseName, vcfOptions) =>
    httpInvoke('/api/import/start', [filePath, caseName, vcfOptions]),
  startMultiFile: (caseName, files, vcfOptions, filters) =>
    httpInvoke('/api/import/startMultiFile', [caseName, files, vcfOptions, filters]),
  vcfPreview: (filePath) => httpInvoke('/api/import/vcfPreview', [filePath]),
  vcfMultiPreview: (filePaths) => httpInvoke('/api/import/vcfMultiPreview', [filePaths]),
  cancel: () => httpInvoke('/api/import/cancel', [])
})
