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

export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  cancel(): void
}
