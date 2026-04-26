import { parentPort } from 'node:worker_threads'
import { basename } from 'node:path'
import { statSync, createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { Client, type ClientConfig, type Pool, type PoolClient } from 'pg'

import {
  POSTGRES_IMPORT_CANCELLATION_MESSAGE,
  type PostgresImportWorkerInboundMessage,
  type PostgresImportWorkerOutboundMessage,
  type PostgresImportWorkerStartMessage,
  type PostgresClientConfig
} from '../../shared/types/postgres-import-worker'
import {
  PostgresJsonImportRepository,
  rebuildVariantFrequencyForCase,
  type PostgresJsonImportSession
} from '../storage/postgres/PostgresJsonImportRepository'
import {
  PostgresVcfImportRepository,
  type PostgresVcfImportRequest
} from '../storage/postgres/PostgresVcfImportRepository'
import { quoteIdentifier } from '../storage/postgres/identifiers'
import { detectFormat as defaultDetectFormat } from '../import/format-detection'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createMapperPipeline as defaultCreateMapperPipeline } from './import-pipeline'
import { parseVcfHeaderFromLines } from '../import/vcf/vcf-header-parser'
import { parseVcfLine } from '../import/vcf/vcf-line-parser'
import { mapVcfRecord } from '../import/vcf/VcfMapper'
import { detectCaller } from '../import/vcf/caller-detector'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../import/vcf/info-field-registry'
import { isGzipped } from '../import/stream-utils'
import type { VcfHeader, VcfMappedVariant } from '../import/vcf/types'
import { BedFilter } from '../import/vcf/bed-filter'
import {
  passesPreMappingFilters,
  passesPostMappingFilters,
  type ImportFilters
} from '../import/vcf/import-filters'

const POSTGRES_JSON_IMPORT_BATCH_SIZE = 1000

let cancelled = false

// Diagnostic: surface any uncaught exception or unhandled rejection both via
// console.warn (stderr — visible during dev/E2E runs) AND, when the worker is
// running under a parent thread, as a structured `error` outbound message so
// the main process sees a real failure instead of a silently-crashing worker.
// Added to debug Phase 9 Task 15 (multi-file partial failure) where ENOENT
// was escaping the per-file try/catch — root cause was an unhandled error
// event on the readline-wrapped fs read stream.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.warn('[postgres-import-worker] uncaughtException:', err.message, err.stack)
  parentPort?.postMessage({
    type: 'error',
    message: `uncaughtException: ${err.message}`,
    cause: err.stack
  } satisfies PostgresImportWorkerOutboundMessage)
})
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  // eslint-disable-next-line no-console
  console.warn(
    '[postgres-import-worker] unhandledRejection:',
    stack !== undefined ? `${message}\n${stack}` : message
  )
  parentPort?.postMessage({
    type: 'error',
    message: `unhandledRejection: ${message}`,
    cause: stack
  } satisfies PostgresImportWorkerOutboundMessage)
})

/**
 * Async generator yielding mapped VCF variants one at a time.
 * Mirrors the streamInsertVcf parsing pipeline (header lines, parseVcfLine,
 * mapVcfRecord) but emits mapped variants instead of inserting them.
 *
 * When `filters` is provided, pre-mapping filters (FILTER column, QUAL
 * threshold, BED region) are applied before `mapVcfRecord`, and post-mapping
 * filters (GQ, DP) are applied to each emitted variant independently.
 */
async function* streamMappedVcfRows(
  filePath: string,
  selectedSample: string,
  filters?: ImportFilters
): AsyncGenerator<VcfMappedVariant, void, void> {
  // Fail fast (synchronously, with a stack we can attach to the per-file
  // result) for the most common open-time error class: missing/unreadable
  // file. createReadStream defers `open(2)` to the next tick, so an ENOENT
  // would otherwise surface as an asynchronous `error` event on the raw
  // stream — and if no listener is attached when it fires, Node escalates
  // it to an `uncaughtException`, tearing the whole worker down (Phase 9
  // Task 15 root cause).
  statSync(filePath)

  const raw = createReadStream(filePath)
  const gunzip = isGzipped(filePath) ? createGunzip() : null
  const stream = gunzip !== null ? raw.pipe(gunzip) : raw
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  // Belt-and-suspenders: also capture any post-open stream errors (gzip
  // corruption mid-file, EIO, etc.) and re-throw them from the generator so
  // the caller's per-file `try/catch` handles them. Without this an
  // unhandled `error` event would still surface as `uncaughtException`.
  let streamError: Error | null = null
  const onStreamError = (err: Error): void => {
    if (streamError === null) streamError = err
    rl.close()
  }
  raw.on('error', onStreamError)
  gunzip?.on('error', onStreamError)

  const headerLines: string[] = []
  let header: VcfHeader | null = null
  let activeSample = ''
  let callerName: string | null = null

  try {
    for await (const line of rl) {
      if (streamError !== null) throw streamError
      if (line.startsWith('#')) {
        headerLines.push(line)
        continue
      }

      if (header === null) {
        header = parseVcfHeaderFromLines(headerLines)
        activeSample = selectedSample !== '' ? selectedSample : (header.samples[0] ?? '')
        if (activeSample === '') {
          // No selectable sample — drain quietly.
          break
        }
        const callerInfo = detectCaller(headerLines)
        callerName = callerInfo.name !== 'unknown' ? callerInfo.name : null
      }

      try {
        const record = parseVcfLine(line, header.samples)
        if (record === null) continue
        // Apply pre-mapping filters (FILTER column, QUAL, BED region) before
        // the expensive mapVcfRecord call — skips multi-allelic expansion too.
        if (!passesPreMappingFilters(record, filters)) continue
        const mapped = mapVcfRecord(
          record,
          header,
          activeSample,
          DEFAULT_INFO_FIELD_MAPPINGS,
          callerName
        )
        for (const variant of mapped) {
          // Apply post-mapping filters (GQ, DP) per emitted variant.
          if (!passesPostMappingFilters(variant, filters)) continue
          yield variant
        }
      } catch (e) {
        // Skip unparseable lines — same behavior as streamInsertVcf
        console.warn(
          '[postgres-import-worker] Skipping unparseable VCF line:',
          e instanceof Error ? e.message : String(e)
        )
      }
    }
    // Stream errors that fire AFTER the readline iterator drains (e.g. a
    // gunzip integrity check at end-of-stream) still need to propagate.
    if (streamError !== null) throw streamError
  } finally {
    raw.off('error', onStreamError)
    gunzip?.off('error', onStreamError)
    raw.destroy()
  }
}

export interface RunImportDeps {
  createClient: (config: ClientConfig) => Client
  detectFormat: (filePath: string) => Promise<FormatInfo>
  createMapperPipeline: (filePath: string, formatInfo: FormatInfo) => Promise<Readable>
  statFile: (filePath: string) => { size: number }
  /** VCF mapped-row producer for the PG worker's VCF branch. */
  createVcfMappedStream: (
    filePath: string,
    options: { selectedSample: string; genomeBuild: string; filters?: ImportFilters }
  ) => Promise<AsyncIterable<VcfMappedVariant>>
}

const defaultDeps: RunImportDeps = {
  createClient: (config) => new Client(config),
  detectFormat: defaultDetectFormat,
  createMapperPipeline: defaultCreateMapperPipeline,
  statFile: (path: string) => ({ size: statSync(path).size }),
  createVcfMappedStream: async (filePath, options) =>
    streamMappedVcfRows(filePath, options.selectedSample, options.filters)
}

/**
 * Idempotently re-enable the three FTS BEFORE INSERT triggers.
 *
 * Runs in auto-commit (no surrounding transaction) at the top of every
 * `runImport`, before any BEGIN. `ALTER TABLE ... ENABLE TRIGGER` is a
 * no-op when the trigger is already enabled, so this is safe to run on
 * every startup — including JSON imports, which never disable triggers
 * themselves but may inherit a DISABLED state from a prior crashed VCF
 * import.
 */
export async function recoverTriggersOnStartup(
  client: Pick<Client, 'query'>,
  schemaName: string
): Promise<void> {
  const q = quoteIdentifier
  // Auto-commit. Idempotent — ENABLE TRIGGER on an already-enabled trigger is a no-op.
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    ENABLE TRIGGER variants_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" ENABLE TRIGGER variant_str_search_document_tg`
  )
}

/**
 * Leading bracket transaction: disable the three FTS triggers in a durable
 * commit before a VCF import begins. Runs only for VCF imports — JSON
 * imports rely on the trigger to populate `search_document`.
 *
 * Durability matters here: this commit must survive a worker crash so the
 * recovery shim on the next startup can detect the DISABLED state and
 * re-enable the triggers. Do NOT use `SET LOCAL synchronous_commit = OFF`
 * inside this transaction.
 */
export async function disableTriggersBeforeVcfImport(
  client: Pick<Client, 'query'>,
  schemaName: string
): Promise<void> {
  const q = quoteIdentifier
  await client.query('BEGIN')
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    DISABLE TRIGGER variants_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  DISABLE TRIGGER variant_sv_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" DISABLE TRIGGER variant_str_search_document_tg`
  )
  await client.query('COMMIT')
}

/**
 * Trailing bracket transaction: re-enable the three FTS triggers in a
 * durable commit after a VCF import finishes. Runs in `finally`, so it
 * fires on success, cancellation, and error paths alike.
 *
 * Like the leading bracket, this commit must be durable. Do NOT use
 * `SET LOCAL synchronous_commit = OFF` inside this transaction.
 */
export async function enableTriggersAfterVcfImport(
  client: Pick<Client, 'query'>,
  schemaName: string
): Promise<void> {
  const q = quoteIdentifier
  await client.query('BEGIN')
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variants"    ENABLE TRIGGER variants_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg`
  )
  await client.query(
    `ALTER TABLE ${q(schemaName)}."variant_str" ENABLE TRIGGER variant_str_search_document_tg`
  )
  await client.query('COMMIT')
}

function clientConfigFromMessage(message: PostgresClientConfig): ClientConfig {
  return {
    connectionString: message.connectionString,
    application_name: message.application_name,
    connectionTimeoutMillis: message.connectionTimeoutMillis,
    statement_timeout: message.statement_timeout,
    query_timeout: message.query_timeout,
    lock_timeout: message.lock_timeout,
    idle_in_transaction_session_timeout: message.idle_in_transaction_session_timeout,
    keepAlive: message.keepAlive,
    ssl:
      message.ssl?.mode === 'require'
        ? { rejectUnauthorized: message.ssl.rejectUnauthorized }
        : undefined
  }
}

export async function runImport(
  deps: RunImportDeps,
  start: PostgresImportWorkerStartMessage,
  post: (msg: PostgresImportWorkerOutboundMessage) => void
): Promise<void> {
  cancelled = false // reset at entry; the parentPort handler also resets, this covers test/direct paths
  const startedAt = Date.now()
  const batchSize =
    start.batchSize !== undefined && start.batchSize > 0
      ? start.batchSize
      : POSTGRES_JSON_IMPORT_BATCH_SIZE
  const client = deps.createClient(clientConfigFromMessage(start.client))
  let beganTransaction = false
  let committed = false

  try {
    await client.connect()
    // Phase 16 recovery shim: re-enable the three FTS triggers idempotently
    // before any transaction is opened. ENABLE TRIGGER on an already-enabled
    // trigger is a no-op, so this is safe to run for both VCF and JSON
    // imports — and necessary, because a prior crashed VCF import may have
    // left the triggers DISABLED (the trailing bracket transaction never
    // ran). Auto-commit by design: must complete before any BEGIN.
    await recoverTriggersOnStartup(client, start.schema)

    if (start.mode === 'single-file') {
      const filePath = start.filePath
      if (filePath === undefined || filePath === '')
        throw new Error('postgres-import-worker: single-file mode requires filePath')

      // Always detect the concrete JSON sub-format (simple/object/columnar) regardless
      // of the hint — the hint isn't strong enough to skip detection because we need
      // caseKey/wrapped to select the correct mapper pipeline. Detection runs OUTSIDE
      // any transaction (it's a file-format sniffer; no DB work required), which lets
      // us decide whether to wrap the import in the VCF bracket transactions.
      const formatInfo = await deps.detectFormat(filePath)

      if (formatInfo.format === 'vcf') {
        // Phase 16 bracket-transaction defer: disable the three FTS triggers
        // in a durable, auto-commit-style transaction BEFORE the per-batch
        // VCF import begins. The trailing bracket runs in `finally` so the
        // triggers are re-enabled on success, cancellation, and error paths
        // alike. The `try` opens the first per-batch transaction itself —
        // we deliberately do NOT issue an outer BEGIN before this point.
        await disableTriggersBeforeVcfImport(client, start.schema)
        try {
          // Empty string lets streamMappedVcfRows auto-pick the first header
          // sample, matching the SQLite path; the generator throws cleanly if
          // the VCF has no selectable sample at all.
          const selectedSample = start.vcfOptions?.selectedSample ?? ''
          const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'
          const vcfFileName = basename(filePath)
          let vcfFileSize = 0
          try {
            vcfFileSize = deps.statFile(filePath).size
          } catch {
            // ignore — used only for provenance
          }

          // Open the first per-batch transaction (formerly the outer BEGIN at
          // the top of runImport). `SET LOCAL synchronous_commit = OFF` makes
          // each per-batch COMMIT release the WAL fsync; durability is
          // bounded by the surrounding bracket commits, which DO fsync.
          await client.query('BEGIN')
          beganTransaction = true
          await client.query('SET LOCAL synchronous_commit = OFF')

          const repo = new PostgresVcfImportRepository(start.schema)
          // Single-file imports reject filters at the executor level, but pass
          // undefined defensively to keep the contract consistent.
          const stream = await deps.createVcfMappedStream(filePath, {
            selectedSample,
            genomeBuild,
            filters: undefined
          })

          let variants: Array<Record<string, unknown>> = []
          let transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
          let sv: Array<Record<string, unknown> & { ordinal: number }> = []
          let cnv: Array<Record<string, unknown> & { ordinal: number }> = []
          let str: Array<Record<string, unknown> & { ordinal: number }> = []
          let ordinal = 0
          let totalInserted = 0
          let caseId = 0
          let firstWritten = false

          const flush = async (): Promise<void> => {
            if (variants.length === 0) return
            // First batch creates the case + writes provenance; subsequent
            // batches use 'append' mode with the already-resolved caseId so we
            // skip the per-batch `SELECT id FROM cases` lookup AND the
            // per-batch case_data_info upsert (the row is already correct
            // after the first batch). Saves O(N) redundant queries on WGS
            // imports.
            const request: PostgresVcfImportRequest = firstWritten
              ? {
                  mode: 'append',
                  caseId,
                  caseName: start.caseName,
                  fileName: vcfFileName,
                  filePath,
                  fileSize: vcfFileSize,
                  genomeBuild,
                  caller: null,
                  annotationFormat: null,
                  variantType: 'snv-indel',
                  variants,
                  transcripts,
                  sv,
                  cnv,
                  str
                }
              : {
                  mode: 'single-file',
                  caseName: start.caseName,
                  fileName: vcfFileName,
                  filePath,
                  fileSize: vcfFileSize,
                  genomeBuild,
                  caller: null,
                  annotationFormat: null,
                  variantType: 'snv-indel',
                  variants,
                  transcripts,
                  sv,
                  cnv,
                  str
                }
            const result = await repo.writeVcfFile(
              client as unknown as Pick<PoolClient, 'query'>,
              request
            )
            if (!firstWritten) caseId = result.caseId
            totalInserted += result.variantCount
            firstWritten = true
            post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
            variants = []
            transcripts = []
            sv = []
            cnv = []
            str = []
            ordinal = 0
            // Commit per-batch so postgres releases per-tuple bookkeeping and
            // the pg-node client releases its query/result references. Without
            // this the worker's working set scales linearly with file size on
            // large WGS imports — the original single-transaction shape OOMed
            // multi-GB Node heaps on the GIAB HG002 fixture.
            await client.query('COMMIT')
            await client.query('BEGIN')
            // Re-apply per-batch synchronous_commit lever — SET LOCAL is
            // transaction-scoped and must be re-issued after every BEGIN.
            await client.query('SET LOCAL synchronous_commit = OFF')
            if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
              ;(globalThis as { gc?: () => void }).gc?.()
            }
          }

          for await (const row of stream) {
            if (cancelled) {
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
            const { _transcripts, _sv, _cnv, _str, ...base } = row
            variants.push(base as unknown as Record<string, unknown>)
            if (Array.isArray(_transcripts)) {
              for (const t of _transcripts as unknown as Array<Record<string, unknown>>) {
                transcripts.push({ ordinal, ...t })
              }
            }
            if (_sv !== undefined && _sv !== null) {
              sv.push({ ordinal, ...(_sv as unknown as Record<string, unknown>) })
            }
            if (_cnv !== undefined && _cnv !== null) {
              cnv.push({ ordinal, ...(_cnv as unknown as Record<string, unknown>) })
            }
            if (_str !== undefined && _str !== null) {
              str.push({ ordinal, ...(_str as unknown as Record<string, unknown>) })
            }
            ordinal += 1

            if (variants.length >= batchSize) {
              await flush()
            }
          }
          await flush()

          if (caseId !== 0) {
            await client.query(
              `UPDATE ${quoteIdentifier(start.schema)}."cases" SET variant_count = $1 WHERE id = $2`,
              [totalInserted, caseId]
            )
            await rebuildVariantFrequencyForCase(
              client as unknown as Pick<PoolClient, 'query'>,
              start.schema,
              caseId
            )
          }
          await client.query('COMMIT')
          committed = true

          post({
            type: 'complete',
            mode: 'single-file',
            result: {
              caseId,
              variantCount: totalInserted,
              skipped: 0,
              errors: [],
              elapsed: Date.now() - startedAt
            }
          })
          return
        } finally {
          // Trailing bracket transaction: re-enable the three FTS triggers
          // in a durable commit. Runs on success, cancellation, and error
          // paths alike — bracket-wrap preserves cancellation semantics by
          // unwinding through this `finally` before the outer error handler.
          await enableTriggersAfterVcfImport(client, start.schema)
        }
      }

      // -------------------------------------------------------------------
      // Single-file JSON branch — no bracket transactions, no SET LOCAL.
      // JSON imports rely on the FTS triggers to populate `search_document`
      // (Phase 16 left the JSON path unchanged), so triggers must remain
      // ENABLED throughout this branch. The recovery shim above guarantees
      // they ARE enabled at this point.
      // -------------------------------------------------------------------
      await client.query('BEGIN')
      beganTransaction = true

      const fileName = basename(filePath)
      let fileSize = 0
      try {
        fileSize = deps.statFile(filePath).size
      } catch {
        // ignore — used only for provenance
      }

      // `_pool` is ignored by PostgresJsonImportRepository — the repo accepts a
      // stubbed pool and the caller passes the actual client through writeJsonImport.
      const repo = new PostgresJsonImportRepository(
        { connect: async () => client as unknown as PoolClient } as Pick<Pool, 'connect'>,
        start.schema
      )

      let totalInserted = 0
      const writeVariants = async (session: PostgresJsonImportSession): Promise<void> => {
        if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
        const stream = await deps.createMapperPipeline(filePath, formatInfo)
        let batch: Array<Record<string, unknown>> = []
        const flush = async (): Promise<void> => {
          if (batch.length === 0) return
          await session.insertVariantBatch(batch)
          totalInserted += batch.length
          batch = []
          post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
          // Commit per-batch — same rationale as the VCF branch above.
          await client.query('COMMIT')
          await client.query('BEGIN')
          if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
            ;(globalThis as { gc?: () => void }).gc?.()
          }
        }
        try {
          for await (const chunk of stream) {
            if (cancelled) {
              stream.destroy()
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
            if (chunk === null || chunk === undefined) continue
            batch.push(chunk as Record<string, unknown>)
            if (batch.length >= batchSize) {
              await flush()
              if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
          }
          if (!cancelled) {
            await flush()
          } else {
            throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
          }
        } catch (err) {
          stream.destroy()
          throw err
        }
      }

      const importFileType =
        formatInfo.format === 'simple'
          ? 'simple'
          : formatInfo.format === 'object'
            ? 'object'
            : formatInfo.format === 'columnar'
              ? 'columnar'
              : (() => {
                  throw new Error(`Unsupported JSON format: ${formatInfo.format}`)
                })()

      const { caseId, variantCount } = await repo.writeJsonImport(
        client as unknown as Pick<PoolClient, 'query'>,
        {
          filePath,
          fileName,
          caseName: start.caseName,
          fileSize,
          genomeBuild: start.vcfOptions?.genomeBuild ?? 'GRCh38',
          importFileType
        },
        writeVariants
      )

      await rebuildVariantFrequencyForCase(
        client as unknown as Pick<PoolClient, 'query'>,
        start.schema,
        caseId
      )
      await client.query('COMMIT')
      committed = true

      post({
        type: 'complete',
        mode: 'single-file',
        result: {
          caseId,
          variantCount,
          skipped: 0,
          errors: [],
          elapsed: Date.now() - startedAt
        }
      })
      return
    }

    // -------------------------------------------------------------------------
    // Multi-file branch
    // -------------------------------------------------------------------------
    if (start.mode === 'multi-file') {
      if (!start.files || start.files.length === 0) {
        throw new Error('postgres-import-worker: multi-file mode requires non-empty files[]')
      }
      // Phase 16 bracket-transaction defer: multi-file is always VCF, so
      // we wrap the entire per-file loop + post-loop bookkeeping in the
      // bracket transactions. The leading bracket is the FIRST transaction
      // this worker opens after the recovery shim — there is NO outer
      // BEGIN at runImport-entry to roll back.
      await disableTriggersBeforeVcfImport(client, start.schema)
      try {
        const fileResults: Array<{
          filePath: string
          variantType: string
          variantCount: number
          error?: string
        }> = []
        let caseId = 0
        let totalVariantCount = 0
        const repo = new PostgresVcfImportRepository(start.schema)
        const selectedSample = start.vcfOptions?.selectedSample ?? ''
        const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'

        // Build ImportFilters once before the per-file loop so that
        // BedFilter.fromFile (a sync file read) runs in the worker, not main.
        let importFilters: ImportFilters | undefined
        if (start.filters !== undefined) {
          let bedFilter: BedFilter | undefined
          if (
            start.filters.bedFilePath !== null &&
            start.filters.bedFilePath !== undefined &&
            start.filters.bedFilePath !== ''
          ) {
            try {
              bedFilter = BedFilter.fromFile(
                start.filters.bedFilePath,
                start.filters.bedPadding ?? 0
              )
            } catch (err) {
              // Worker can't use mainLogger; console.warn is the documented
              // worker exception (see AGENTS.md). Continue without BED filtering
              // rather than fail the whole import.
              console.warn(
                '[postgres-import-worker] BedFilter.fromFile failed:',
                err instanceof Error ? err.message : String(err)
              )
            }
          }
          importFilters = {
            bedFilter,
            // Match the SQLite-side IPC default (`payload.bedPadding ?? 0`) so the
            // same UI inputs include the same variants on both backends.
            bedPadding: start.filters.bedPadding ?? 0,
            passOnly: start.filters.passOnly ?? false,
            minQual: start.filters.minQual ?? null,
            minGq: start.filters.minGq ?? null,
            minDp: start.filters.minDp ?? null
          }
        }

        for (let i = 0; i < start.files.length; i += 1) {
          if (cancelled) break
          const fileSpec = start.files[i]
          let fileVariantCount = 0
          try {
            await client.query('BEGIN')
            beganTransaction = true
            // Per-file transaction: bound failure semantics ("file N failed"
            // rolls back any in-flight batch) while the bracket transactions
            // ABOVE keep the trigger DISABLE durable. SET LOCAL is
            // transaction-scoped, so re-issue it on every per-file BEGIN.
            await client.query('SET LOCAL synchronous_commit = OFF')
            const fileName = basename(fileSpec.filePath)
            let fileSize = 0
            try {
              fileSize = deps.statFile(fileSpec.filePath).size
            } catch {
              // ignore — used only for provenance
            }

            const stream = await deps.createVcfMappedStream(fileSpec.filePath, {
              selectedSample,
              genomeBuild,
              filters: importFilters
            })

            let variants: Array<Record<string, unknown>> = []
            let transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
            let sv: Array<Record<string, unknown> & { ordinal: number }> = []
            let cnv: Array<Record<string, unknown> & { ordinal: number }> = []
            let str: Array<Record<string, unknown> & { ordinal: number }> = []
            let ordinal = 0
            let firstBatch = true

            const flushBatch = async (): Promise<void> => {
              if (variants.length === 0) return
              // Per-batch shape:
              //   - file 0, batch 0:  mode: 'multi-file', fileIndex: 0
              //                       (creates case + writes provenance)
              //   - file N, batch 0:  mode: 'multi-file', fileIndex: 1
              //                       (looks up case + writes per-file provenance)
              //   - any file, batch >0: mode: 'append', caseId
              //                       (no lookup, no provenance — saves O(N) queries)
              const isFirstFileFirstBatch = i === 0 && firstBatch
              const isAppend = !firstBatch && caseId !== 0
              const request: PostgresVcfImportRequest = isAppend
                ? {
                    mode: 'append',
                    caseId,
                    caseName: start.caseName,
                    fileName,
                    filePath: fileSpec.filePath,
                    fileSize,
                    genomeBuild,
                    caller: fileSpec.caller ?? null,
                    annotationFormat: fileSpec.annotationFormat ?? null,
                    variantType: fileSpec.variantType,
                    variants,
                    transcripts,
                    sv,
                    cnv,
                    str
                  }
                : isFirstFileFirstBatch
                  ? {
                      mode: 'multi-file',
                      fileIndex: 0,
                      caseName: start.caseName,
                      fileName,
                      filePath: fileSpec.filePath,
                      fileSize,
                      genomeBuild,
                      caller: fileSpec.caller ?? null,
                      annotationFormat: fileSpec.annotationFormat ?? null,
                      variantType: fileSpec.variantType,
                      variants,
                      transcripts,
                      sv,
                      cnv,
                      str
                    }
                  : {
                      mode: 'multi-file',
                      fileIndex: 1,
                      caseName: start.caseName,
                      fileName,
                      filePath: fileSpec.filePath,
                      fileSize,
                      genomeBuild,
                      caller: fileSpec.caller ?? null,
                      annotationFormat: fileSpec.annotationFormat ?? null,
                      variantType: fileSpec.variantType,
                      variants,
                      transcripts,
                      sv,
                      cnv,
                      str
                    }
              const result = await repo.writeVcfFile(
                client as unknown as Pick<PoolClient, 'query'>,
                request
              )
              if (caseId === 0) caseId = result.caseId
              fileVariantCount += result.variantCount
              firstBatch = false
              post({
                type: 'progress',
                phase: 'inserting',
                rowsProcessed: totalVariantCount + fileVariantCount,
                filePath: fileSpec.filePath
              })
              variants = []
              transcripts = []
              sv = []
              cnv = []
              str = []
              ordinal = 0
              // Commit per-batch — same rationale as the single-file branch.
              // The per-file BEGIN/COMMIT around this loop still bounds the
              // failure semantics ("file N failed" rolls back any in-flight
              // batch), but each successful batch is now durable immediately.
              await client.query('COMMIT')
              await client.query('BEGIN')
              // Re-apply per-batch synchronous_commit lever — SET LOCAL is
              // transaction-scoped and must be re-issued after every BEGIN.
              await client.query('SET LOCAL synchronous_commit = OFF')
              if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
                ;(globalThis as { gc?: () => void }).gc?.()
              }
            }

            for await (const row of stream) {
              if (cancelled) break
              const { _transcripts, _sv, _cnv, _str, ...base } = row
              variants.push(base as unknown as Record<string, unknown>)
              if (Array.isArray(_transcripts)) {
                for (const t of _transcripts as unknown as Array<Record<string, unknown>>) {
                  transcripts.push({ ordinal, ...t })
                }
              }
              if (_sv !== undefined && _sv !== null) {
                sv.push({ ordinal, ...(_sv as unknown as Record<string, unknown>) })
              }
              if (_cnv !== undefined && _cnv !== null) {
                cnv.push({ ordinal, ...(_cnv as unknown as Record<string, unknown>) })
              }
              if (_str !== undefined && _str !== null) {
                str.push({ ordinal, ...(_str as unknown as Record<string, unknown>) })
              }
              ordinal += 1
              if (variants.length >= batchSize) await flushBatch()
            }

            if (cancelled) {
              // Flush whatever was buffered before cancellation was detected
              // then commit and break — partial state is left committed.
              await flushBatch()
              await client.query('COMMIT')
              beganTransaction = false
              committed = true
              totalVariantCount += fileVariantCount
              fileResults.push({
                filePath: fileSpec.filePath,
                variantType: fileSpec.variantType,
                variantCount: fileVariantCount
              })
              post({
                type: 'file-complete',
                filePath: fileSpec.filePath,
                caseId,
                variantCount: fileVariantCount
              })
              break
            }

            await flushBatch()
            await client.query('COMMIT')
            beganTransaction = false
            committed = true
            totalVariantCount += fileVariantCount
            fileResults.push({
              filePath: fileSpec.filePath,
              variantType: fileSpec.variantType,
              variantCount: fileVariantCount
            })
            post({
              type: 'file-complete',
              filePath: fileSpec.filePath,
              caseId,
              variantCount: fileVariantCount
            })
          } catch (err) {
            beganTransaction = false
            // eslint-disable-next-line no-console
            console.warn(
              `[postgres-import-worker] file ${i} (${fileSpec.filePath}) failed:`,
              err instanceof Error ? err.message : String(err)
            )
            try {
              await client.query('ROLLBACK')
            } catch (rollbackErr) {
              // eslint-disable-next-line no-console
              console.warn(
                `[postgres-import-worker] file ${i} ROLLBACK after error failed:`,
                rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
              )
            }
            const message = err instanceof Error ? err.message : String(err)
            fileResults.push({
              filePath: fileSpec.filePath,
              variantType: fileSpec.variantType,
              variantCount: 0,
              error: message
            })
          }
        }

        // Post-loop bookkeeping — only if at least one file committed.
        if (caseId !== 0) {
          await client.query('BEGIN')
          beganTransaction = true
          // Bookkeeping is still under the bracket-disabled triggers, so we
          // keep the per-batch synchronous_commit lever for parity with the
          // per-file/per-batch transactions above.
          await client.query('SET LOCAL synchronous_commit = OFF')
          try {
            await client.query(
              `UPDATE ${quoteIdentifier(start.schema)}."cases" SET variant_count = $1 WHERE id = $2`,
              [totalVariantCount, caseId]
            )
            await rebuildVariantFrequencyForCase(
              client as unknown as Pick<PoolClient, 'query'>,
              start.schema,
              caseId
            )
            await client.query('COMMIT')
            beganTransaction = false
            committed = true
          } catch (err) {
            beganTransaction = false
            try {
              await client.query('ROLLBACK')
            } catch {
              // swallow
            }
            throw err
          }
        }

        post({
          type: 'complete',
          mode: 'multi-file',
          result: {
            caseId,
            variantCount: totalVariantCount,
            files: fileResults,
            skipped: 0,
            errors: cancelled ? [POSTGRES_IMPORT_CANCELLATION_MESSAGE] : [],
            elapsed: Date.now() - startedAt
          }
        })
        return
      } finally {
        // Trailing bracket transaction: re-enable the three FTS triggers in
        // a durable commit. Runs on success, cancellation (the inner break
        // out of the file loop falls through here), and any thrown error
        // alike — the post-loop ROLLBACK above re-throws into this finally.
        await enableTriggersAfterVcfImport(client, start.schema)
      }
    }

    throw new Error(
      `postgres-import-worker: unknown mode: ${String((start as { mode: string }).mode)}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (beganTransaction && !committed) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackErr) {
        // Worker has no mainLogger access; console.warn is the documented
        // worker exception (see AGENTS.md). Swallow but preserve diagnostics.
        console.warn(
          '[postgres-import-worker] ROLLBACK failed:',
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        )
      }
    }
    if (message === POSTGRES_IMPORT_CANCELLATION_MESSAGE) {
      post({
        type: 'complete',
        mode: start.mode,
        result: {
          caseId: 0,
          variantCount: 0,
          skipped: 0,
          errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE],
          elapsed: 0
        }
      })
    } else {
      post({ type: 'error', message })
    }
  } finally {
    try {
      await client.end()
    } catch {
      // swallow
    }
  }
}

if (parentPort) {
  const port = parentPort
  port.on('message', (msg: PostgresImportWorkerInboundMessage) => {
    if (msg.type === 'cancel') {
      cancelled = true
      return
    }
    if (msg.type === 'start') {
      cancelled = false
      void runImport(defaultDeps, msg, (out) => port.postMessage(out))
    }
  })
}
