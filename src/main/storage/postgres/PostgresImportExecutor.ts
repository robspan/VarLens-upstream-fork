/**
 * PostgreSQL-backed import executor.
 *
 * Streams a JSON input file through the shared import-pipeline mapper, batches
 * mapped variants, and hands them to {@link PostgresJsonImportRepository}
 * inside a single transactional callback. VCF imports are not yet supported on
 * PostgreSQL — requests for VCF files resolve with an explanatory error in
 * `errors` (mirroring the SQLite failure shape) rather than throwing.
 */
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import type { Readable } from 'node:stream'

import type { Pool, PoolClient } from 'pg'

import { detectFormat as defaultDetectFormat } from '../../import/format-detection'
import type { FormatInfo } from '../../import/strategies/ImportStrategy'
import { createMapperPipeline as defaultCreateMapperPipeline } from '../../workers/import-pipeline'
import { mainLogger } from '../../services/MainLogger'
import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult
} from '../import-executor'
import {
  rebuildVariantFrequencyForCase,
  type PostgresJsonImportFileType,
  type PostgresJsonImportRepository,
  type PostgresJsonImportSession
} from './PostgresJsonImportRepository'

export const POSTGRES_JSON_IMPORT_BATCH_SIZE = 1000

const VCF_REJECTION_MESSAGE = 'PostgreSQL import currently supports JSON files only'
const CANCELLATION_MESSAGE = 'Import cancelled by user'

/**
 * Sentinel thrown inside the writeVariants callback during cooperative
 * cancellation. The executor's outer catch block issues ROLLBACK and maps
 * this sentinel to the standard cancellation result shape.
 */
class PostgresImportCancelled extends Error {
  constructor() {
    super(CANCELLATION_MESSAGE)
    this.name = 'PostgresImportCancelled'
  }
}

export interface PostgresImportExecutorOptions {
  repository: PostgresJsonImportRepository
  pool: Pick<Pool, 'connect'>
  schema: string
  detectFormat?: (filePath: string) => Promise<FormatInfo>
  createMapperPipeline?: (filePath: string, formatInfo: FormatInfo) => Promise<Readable>
  statFile?: (filePath: string) => { size: number }
  now?: () => number
}

function mapFormatToImportFileType(format: FormatInfo['format']): PostgresJsonImportFileType {
  switch (format) {
    case 'simple':
      return 'simple'
    case 'object':
      return 'object'
    case 'columnar':
      return 'columnar'
    default:
      throw new Error(`Unsupported JSON format for PostgreSQL import: ${format}`)
  }
}

export class PostgresImportExecutor implements StorageImportExecutor {
  private readonly repository: PostgresJsonImportRepository
  private readonly pool: Pick<Pool, 'connect'>
  private readonly schema: string
  private readonly detectFormat: (filePath: string) => Promise<FormatInfo>
  private readonly createMapperPipeline: (
    filePath: string,
    formatInfo: FormatInfo
  ) => Promise<Readable>
  private readonly statFile: (filePath: string) => { size: number }
  private readonly now: () => number
  private cancelled = false
  private inProgress = false

  constructor(options: PostgresImportExecutorOptions) {
    this.repository = options.repository
    this.pool = options.pool
    this.schema = options.schema
    this.detectFormat = options.detectFormat ?? defaultDetectFormat
    this.createMapperPipeline = options.createMapperPipeline ?? defaultCreateMapperPipeline
    this.statFile = options.statFile ?? ((path: string) => ({ size: statSync(path).size }))
    this.now = options.now ?? (() => Date.now())
  }

  cancel(): void {
    this.cancelled = true
  }

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    // Mirror SqliteImportExecutor: reject concurrent imports. The shared
    // `cancelled` flag is scoped per-run, so overlapping runs would interleave
    // cancel state and progress callbacks.
    if (this.inProgress) {
      throw new Error('An import is already in progress')
    }
    this.inProgress = true
    const started = this.now()
    try {
      // Honor a pre-flight cancel() call.
      if (this.cancelled) {
        return this.cancellationResult()
      }

      const formatInfo = await this.detectFormat(params.filePath)

      if (formatInfo.format === 'vcf') {
        return {
          caseId: 0,
          variantCount: 0,
          skipped: 0,
          errors: [VCF_REJECTION_MESSAGE],
          elapsed: 0
        }
      }

      const importFileType = mapFormatToImportFileType(formatInfo.format)
      const fileName = basename(params.filePath)
      let fileSize = 0
      try {
        fileSize = this.statFile(params.filePath).size
      } catch (err) {
        mainLogger.warn(
          `Postgres import could not stat ${params.filePath}: ${err instanceof Error ? err.message : String(err)}`,
          'storage'
        )
      }

      params.onProgress?.({ phase: 'parsing', count: 0, elapsed: 0, skipped: 0 })

      if (this.cancelled) {
        return this.cancellationResult()
      }

      let totalInserted = 0

      const client = (await this.pool.connect()) as PoolClient
      let transactionBegan = false
      let commitSucceeded = false
      try {
        await client.query('BEGIN')
        transactionBegan = true

        const { caseId, variantCount } = await this.repository.writeJsonImport(
          client,
          {
            filePath: params.filePath,
            fileName,
            caseName: params.caseName,
            fileSize,
            genomeBuild: params.vcfOptions?.genomeBuild ?? 'GRCh38',
            importFileType
          },
          async (session: PostgresJsonImportSession) => {
            if (this.cancelled) throw new PostgresImportCancelled()

            const stream = await this.createMapperPipeline(params.filePath, formatInfo)
            let batch: Array<Record<string, unknown>> = []

            const flush = async (): Promise<void> => {
              if (batch.length === 0) return
              await session.insertVariantBatch(batch)
              totalInserted += batch.length
              batch = []
              params.onProgress?.({
                phase: 'inserting',
                count: totalInserted,
                elapsed: this.now() - started,
                skipped: 0
              })
            }

            try {
              for await (const chunk of stream) {
                if (this.cancelled) {
                  stream.destroy()
                  throw new PostgresImportCancelled()
                }
                if (chunk === null || chunk === undefined) continue
                batch.push(chunk as Record<string, unknown>)
                if (batch.length >= POSTGRES_JSON_IMPORT_BATCH_SIZE) {
                  await flush()
                  if (this.cancelled) {
                    throw new PostgresImportCancelled()
                  }
                }
              }
              // Final flush — skip if cancelled, the transaction is about to
              // roll back.
              if (!this.cancelled) {
                await flush()
              } else {
                throw new PostgresImportCancelled()
              }
            } catch (err) {
              // Ensure the stream is released on any error path.
              stream.destroy()
              throw err
            }
          }
        )

        await rebuildVariantFrequencyForCase(client, this.schema, caseId)
        await client.query('COMMIT')
        commitSucceeded = true
        // Success: release with no argument so pg keeps the client in the pool.
        client.release()

        return {
          caseId,
          variantCount,
          skipped: 0,
          errors: [],
          elapsed: this.now() - started
        }
      } catch (err) {
        if (transactionBegan && !commitSucceeded) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // swallow rollback failure so the original error reaches the caller
          }
        }
        // Release with the error object so pg discards a dirty connection
        // rather than returning it to the pool.
        client.release(err instanceof Error ? err : new Error(String(err)))
        if (err instanceof PostgresImportCancelled) {
          return this.cancellationResult()
        }
        throw err
      }
    } finally {
      this.cancelled = false
      this.inProgress = false
    }
  }

  async importMultiFile(_params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult> {
    throw new Error('PostgresImportExecutor.importMultiFile not yet implemented (Phase 9 Task 11)')
  }

  private cancellationResult(): StorageImportSingleFileResult {
    return {
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: [CANCELLATION_MESSAGE],
      elapsed: 0
    }
  }
}
