import type {
  ImportResult,
  MultiFileImportResult,
  MultiFileImportSpec
} from '../../../main/ipc/handlers/import-logic'
import type {
  VcfPreviewResult,
  VcfMultiPreviewResult
} from '../../types/import'
import type { IpcResult } from '../../types/errors'

export interface ImportDomainContract {
  selectFile: () => Promise<string | null>
  selectFiles: () => Promise<string[]>
  selectBedFile: () => Promise<string | null>
  start: (
    filePath: string,
    caseName: string,
    vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  ) => Promise<IpcResult<ImportResult>>
  startMultiFile: (
    caseName: string,
    files: MultiFileImportSpec[],
    vcfOptions?: { selectedSample?: string; genomeBuild?: string },
    filters?: {
      bedFile?: string | null
      bedPadding?: number
      passOnly?: boolean
      minQual?: number | null
      minGq?: number | null
      minDp?: number | null
    }
  ) => Promise<IpcResult<MultiFileImportResult>>
  vcfPreview: (filePath: string) => Promise<VcfPreviewResult>
  vcfMultiPreview: (filePaths: string[]) => Promise<IpcResult<VcfMultiPreviewResult>>
  cancel: () => Promise<IpcResult<void>>
}
