import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mainLogger } from '../../services/MainLogger'
import type {
  PostgresImportWorkerStartMessage,
  PostgresImportWorkerOutboundMessage,
  PostgresImportWorkerProgressMessage,
  PostgresImportWorkerFileCompleteMessage,
  PostgresImportWorkerCompleteMessage,
  PostgresImportWorkerErrorMessage
} from '../../../shared/types/postgres-import-worker'

export interface PostgresImportWorkerCallbacks {
  onProgress: (message: PostgresImportWorkerProgressMessage) => void
  onFileComplete: (message: PostgresImportWorkerFileCompleteMessage) => void
  onComplete: (message: PostgresImportWorkerCompleteMessage) => void
  onError: (message: PostgresImportWorkerErrorMessage) => void
}

export interface PostgresImportWorkerClientOptions {
  /** Override worker construction. Default loads the built worker bundle. */
  workerFactory?: () => Worker
  /** Override path lookup for tests. */
  workerPathCandidates?: readonly string[]
}

export class PostgresImportWorkerClient {
  private worker: Worker | null = null
  private readonly workerPath: string | null
  private readonly workerPathCandidates: readonly string[]
  private readonly workerFactory?: () => Worker

  constructor(options: PostgresImportWorkerClientOptions = {}) {
    this.workerPathCandidates = options.workerPathCandidates ?? [
      resolve(__dirname, 'postgres-import-worker.cjs'),
      resolve(__dirname, 'postgres-import-worker.js'),
      resolve(process.cwd(), 'out/web/postgres-import-worker.cjs'),
      resolve(process.cwd(), 'out/main/postgres-import-worker.js')
    ]
    this.workerPath = this.workerPathCandidates.find((candidate) => existsSync(candidate)) ?? null
    this.workerFactory = options.workerFactory
  }

  start(message: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks): void {
    if (this.worker) {
      throw new Error('PostgresImportWorkerClient already started')
    }
    if (this.workerFactory) {
      this.worker = this.workerFactory()
    } else {
      if (this.workerPath === null) {
        throw new Error(
          `Postgres import worker bundle not found. Checked: ${this.workerPathCandidates.join(', ')}`
        )
      }
      this.worker = new Worker(this.workerPath)
    }

    this.worker.on('message', (msg: PostgresImportWorkerOutboundMessage) => {
      switch (msg.type) {
        case 'progress':
          callbacks.onProgress(msg)
          break
        case 'file-complete':
          callbacks.onFileComplete(msg)
          break
        case 'complete':
          callbacks.onComplete(msg)
          // Terminate the worker on success so we don't leak idle threads
          // across imports — a fresh client+worker is created per import by
          // PostgresImportExecutor. Errors are intentionally not awaited:
          // termination cleanup is best-effort.
          void this.terminate()
          break
        case 'error':
          callbacks.onError(msg)
          // Same rationale as 'complete' — release the worker once an error
          // has been surfaced. Without this an unrecoverable error path
          // would leave a zombie worker thread alive until app exit.
          void this.terminate()
          break
      }
    })

    this.worker.on('error', (err: Error) => {
      mainLogger.error(`Postgres import worker error: ${err.message}`, 'PostgresImportWorkerClient')
      callbacks.onError({ type: 'error', message: err.message })
      this.worker = null
    })

    this.worker.on('exit', (code: number) => {
      if (code !== 0 && this.worker !== null) {
        const message = `Postgres import worker exited with code ${code}`
        mainLogger.error(message, 'PostgresImportWorkerClient')
        callbacks.onError({ type: 'error', message })
      }
      this.worker = null
    })

    this.worker.postMessage(message)
  }

  cancel(): void {
    if (!this.worker) return
    this.worker.postMessage({ type: 'cancel' })
  }

  async terminate(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    try {
      await worker.terminate()
    } catch (e) {
      mainLogger.warn(
        `Postgres import worker termination failed: ${e instanceof Error ? e.message : String(e)}`,
        'PostgresImportWorkerClient'
      )
    }
  }
}
