/**
 * PostgreSQL-backed import executor.
 *
 * Thin worker-dispatch layer: builds a start message and spawns a
 * PostgresImportWorkerClient, then maps the worker's complete/error
 * message back to the StorageImportExecutor contract. All parsing,
 * batching, and SQL writes happen in the postgres-import-worker.
 */
import { mainLogger } from '../../services/MainLogger'
import { jobRunner } from '../../services/jobs/runner'
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
    const handle = jobRunner.enqueue<StorageImportSingleFileParams, StorageImportSingleFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        // Cancellation posts { type: 'cancel' } to the worker via the client's
        // cancel() method (PostgresImportWorkerClient.cancel), NOT terminate().
        ctx.registerCancel(() => this.currentClient?.cancel())
        return await this._performImport(p)
      }
    )
    return handle.result
  }

  private async _performImport(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
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
    params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    // INTERIM (PR4-3 → PR4-4): importSingleFile now routes through
    // jobRunner('import_single') while importMultiFile still guards on the
    // local `inProgress` flag. This is an intentional, asymmetric intermediate
    // state: cross-path mutual exclusion between single and multi imports is
    // NOT enforced at this commit. PR4-4 wires importMultiFile through the same
    // jobRunner 'import_single' kind and removes `inProgress` entirely,
    // restoring the pre-PR-4 cross-path single-flight invariant. Do not ship a
    // release/merge boundary between PR4-3 and PR4-4 — the guard is only
    // correct once both paths share the runner.
    if (this.inProgress) throw new Error('An import is already in progress')
    this.inProgress = true
    const startedAt = Date.now()
    try {
      const start: PostgresImportWorkerStartMessage = {
        type: 'start',
        client: this.options.clientConfig,
        schema: this.options.schema,
        mode: 'multi-file',
        caseName: params.caseName,
        files: params.files,
        vcfOptions: params.vcfOptions,
        throttleMs: params.throttleMs,
        filters: params.filters
          ? {
              bedFilePath: params.filters.bedFilePath ?? null,
              bedPadding: params.filters.bedPadding,
              passOnly: params.filters.passOnly,
              minQual: params.filters.minQual,
              minGq: params.filters.minGq,
              minDp: params.filters.minDp
            }
          : undefined
      }
      const result = await this.runWorker(
        start,
        params.onProgress,
        startedAt,
        params.onFileComplete
      )
      return {
        caseId: result.caseId,
        variantCount: result.variantCount,
        files: result.files ?? [],
        skipped: result.skipped,
        errors: result.errors,
        elapsed: result.elapsed
      }
    } finally {
      this.inProgress = false
      this.currentClient = null
    }
  }

  private runWorker(
    start: PostgresImportWorkerStartMessage,
    onProgress: StorageImportSingleFileParams['onProgress'],
    startedAt: number,
    onFileComplete?: StorageImportMultiFileParams['onFileComplete']
  ): Promise<{
    caseId: number
    variantCount: number
    files?: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
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
        onFileComplete: (msg) => {
          onFileComplete?.({
            filePath: msg.filePath,
            caseId: msg.caseId,
            variantCount: msg.variantCount
          })
        },
        onComplete: (msg) => {
          // Use the worker-provided elapsed when available; otherwise fall back to wall clock.
          const elapsed = msg.result.elapsed > 0 ? msg.result.elapsed : Date.now() - startedAt
          resolvePromise({
            caseId: msg.result.caseId,
            variantCount: msg.result.variantCount,
            files: msg.result.files,
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
