/**
 * SQLite-backed import executor.
 *
 * Wraps the existing worker-thread based single-file import pipeline behind
 * the cross-backend `StorageImportExecutor` contract. Behavior mirrors
 * `startImport` in `src/main/ipc/handlers/import-logic.ts` — this adapter
 * does not introduce new semantics, it only moves the orchestration behind
 * the storage-session abstraction so backends (SQLite, Postgres) can expose
 * the same surface to IPC handlers.
 */
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { mainLogger } from '../../services/MainLogger'
import type { DatabaseService } from '../../database/DatabaseService'
import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult
} from '../import-executor'

export interface SqliteImportExecutorOptions {
  getDatabaseService: () => DatabaseService
  createWorkerClient?: () => ImportWorkerClient
}

export class SqliteImportExecutor implements StorageImportExecutor {
  private readonly getDatabaseService: () => DatabaseService
  private readonly createWorkerClient: () => ImportWorkerClient
  private workerClient: ImportWorkerClient | null = null

  constructor(options: SqliteImportExecutorOptions) {
    this.getDatabaseService = options.getDatabaseService
    this.createWorkerClient = options.createWorkerClient ?? (() => new ImportWorkerClient())
  }

  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult> {
    if (this.workerClient !== null && this.workerClient.isRunning) {
      return Promise.reject(new Error('An import is already in progress'))
    }

    const db = this.getDatabaseService()
    const worker = this.createWorkerClient()
    this.workerClient = worker

    const { filePath, caseName, vcfOptions, throttleMs, onProgress } = params

    return new Promise<StorageImportSingleFileResult>((resolve, reject) => {
      let capturedCaseId = 0
      let capturedElapsed = 0

      try {
        worker.start({
          files: [
            {
              filePath,
              caseName,
              isDuplicate: false,
              duplicateStrategy: 'skip',
              vcfSelectedSamples:
                vcfOptions?.selectedSample != null && vcfOptions.selectedSample !== ''
                  ? [vcfOptions.selectedSample]
                  : undefined,
              vcfGenomeBuild: vcfOptions?.genomeBuild
            }
          ],
          dbPath: db.getPath(),
          encryptionKey: db.getEncryptionKey(),
          throttleMs,
          onProgress: (msg) => {
            onProgress?.({
              phase: msg.phase === 'finalizing' ? 'inserting' : msg.phase,
              count: msg.variantCount,
              elapsed: 0,
              skipped: msg.skipped
            })
          },
          onFileComplete: (msg) => {
            capturedCaseId = msg.result.caseId
            capturedElapsed = msg.result.elapsed
          },
          onComplete: (msg) => {
            this.workerClient = null

            if (msg.results.cancelled === true) {
              resolve({
                caseId: 0,
                variantCount: 0,
                skipped: 0,
                errors: ['Import cancelled by user'],
                elapsed: 0
              })
              return
            }

            const detail = msg.results.details[0]
            if (detail !== undefined && detail.status === 'success') {
              onProgress?.({
                phase: 'inserting',
                count: detail.variantCount ?? 0,
                elapsed: 0,
                skipped: 0
              })

              try {
                db.variants.updateFrequencies(capturedCaseId)
              } catch (freqError) {
                mainLogger.warn(
                  `Failed to update variant frequencies: ${freqError instanceof Error ? freqError.message : String(freqError)}`,
                  'SqliteImportExecutor'
                )
              }

              resolve({
                caseId: capturedCaseId,
                variantCount: detail.variantCount ?? 0,
                skipped: 0,
                errors: [],
                elapsed: capturedElapsed
              })
            } else {
              reject(new Error(detail?.error ?? 'Import failed'))
            }
          },
          onError: (msg) => {
            if (msg.fileIndex === -1) {
              this.workerClient = null
              reject(new Error(msg.error))
            }
          }
        })
      } catch (err) {
        // A synchronous throw from worker.start() (or an earlier construction
        // step) must not leave `this.workerClient` referencing a broken worker,
        // otherwise future imports hit the "already in progress" guard or
        // cancel() targets a stale client.
        this.workerClient = null
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  cancel(): void {
    if (this.workerClient !== null) {
      this.workerClient.cancel()
    }
  }
}
