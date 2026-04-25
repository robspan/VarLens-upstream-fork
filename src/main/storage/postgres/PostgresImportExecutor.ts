/**
 * PostgreSQL-backed import executor.
 *
 * Thin worker-dispatch layer: builds a start message and spawns a
 * PostgresImportWorkerClient, then maps the worker's complete/error
 * message back to the StorageImportExecutor contract. All parsing,
 * batching, and SQL writes happen in the postgres-import-worker.
 */
import { mainLogger } from '../../services/MainLogger'
import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult
} from '../import-executor'
import { PostgresImportWorkerClient } from './PostgresImportWorkerClient'
import type { PostgresImportWorkerCallbacks } from './PostgresImportWorkerClient'
import type {
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../../shared/types/postgres-import-worker'

export interface PostgresImportExecutorOptions {
  schema: string
  clientConfig: PostgresClientConfig
  workerClientFactory?: () => PostgresImportWorkerClient
}

export class PostgresImportExecutor implements StorageImportExecutor {
  private currentClient: PostgresImportWorkerClient | null = null
  private inProgress = false

  constructor(private readonly options: PostgresImportExecutorOptions) {}

  cancel(): void {
    this.currentClient?.cancel()
  }

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    if ('filters' in (params as object)) {
      throw new Error('Filters are only supported on import:startMultiFile')
    }
    if (this.inProgress) {
      throw new Error('An import is already in progress')
    }
    this.inProgress = true
    const startedAt = Date.now()
    try {
      const start: PostgresImportWorkerStartMessage = {
        type: 'start',
        client: this.options.clientConfig,
        schema: this.options.schema,
        mode: 'single-file',
        caseName: params.caseName,
        vcfOptions: params.vcfOptions,
        filePath: params.filePath,
        throttleMs: params.throttleMs
      }
      const result = await this.runWorker(start, params.onProgress, startedAt)
      return {
        caseId: result.caseId,
        variantCount: result.variantCount,
        skipped: result.skipped,
        errors: result.errors,
        elapsed: result.elapsed
      }
    } finally {
      this.inProgress = false
      this.currentClient = null
    }
  }

  async importMultiFile(
    _params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    throw new Error('PostgresImportExecutor.importMultiFile not yet implemented (Phase 9 Task 11)')
  }

  private runWorker(
    start: PostgresImportWorkerStartMessage,
    onProgress: StorageImportSingleFileParams['onProgress'],
    startedAt: number
  ): Promise<{
    caseId: number
    variantCount: number
    skipped: number
    errors: string[]
    elapsed: number
  }> {
    const factory = this.options.workerClientFactory ?? (() => new PostgresImportWorkerClient())
    const client = factory()
    this.currentClient = client
    return new Promise((resolvePromise, reject) => {
      const callbacks: PostgresImportWorkerCallbacks = {
        onProgress: (msg) => {
          onProgress?.({
            phase: msg.phase,
            count: msg.rowsProcessed,
            elapsed: Date.now() - startedAt,
            skipped: 0
          })
        },
        onFileComplete: () => {
          // Single-file ignores per-file completions; multi-file (Task 11) will use this.
        },
        onComplete: (msg) => {
          // Use the worker-provided elapsed when available; otherwise fall back to wall clock.
          const elapsed = msg.result.elapsed > 0 ? msg.result.elapsed : Date.now() - startedAt
          resolvePromise({
            caseId: msg.result.caseId,
            variantCount: msg.result.variantCount,
            skipped: msg.result.skipped,
            errors: msg.result.errors,
            elapsed
          })
        },
        onError: (msg) => {
          mainLogger.error(
            `PostgresImportExecutor worker error: ${msg.message}`,
            'PostgresImportExecutor'
          )
          reject(new Error(msg.message))
        }
      }
      client.start(start, callbacks)
    })
  }
}
