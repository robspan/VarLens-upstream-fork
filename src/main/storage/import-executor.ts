import type { MultiFileImportSpec } from '../../shared/types/api'

export interface StorageImportVcfOptions {
  selectedSample?: string
  genomeBuild?: string
}

export interface StorageImportProgress {
  phase: string
  count: number
  elapsed: number
  skipped: number
}

export interface StorageImportSingleFileParams {
  filePath: string
  caseName: string
  vcfOptions?: StorageImportVcfOptions
  throttleMs: number
  onProgress?: (data: StorageImportProgress) => void
}

export interface StorageImportSingleFileResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
}

/**
 * Storage-layer filter knobs for multi-file import. The IPC layer
 * (`ImportFiltersIpcPayload` in `src/main/ipc/handlers/import.ts`) uses
 * `bedFile`; Task 13's import-logic.ts translates that into `bedFilePath`
 * here. Naming differs because the IPC payload reflects the UI's "selected
 * file" semantic while the storage/worker layer always works with absolute
 * filesystem paths.
 */
export interface StorageImportFileFilters {
  bedFilePath?: string | null
  bedPadding?: number
  passOnly?: boolean
  minQual?: number | null
  minGq?: number | null
  minDp?: number | null
}

export interface ImportFileCompleteEvent {
  filePath: string
  caseId: number
  variantCount: number
}

export interface StorageImportMultiFileParams {
  caseName: string
  files: MultiFileImportSpec[]
  vcfOptions?: StorageImportVcfOptions
  filters?: StorageImportFileFilters
  throttleMs?: number
  onProgress?: (data: StorageImportProgress) => void
  onFileComplete?: (event: ImportFileCompleteEvent) => void
}

export interface StorageImportMultiFileResult {
  caseId: number
  variantCount: number
  files: Array<{
    filePath: string
    variantType: string
    variantCount: number
    error?: string
  }>
  skipped: number
  errors: string[]
  elapsed: number
}

export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  importMultiFile(params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult>
  cancel(): void
}
