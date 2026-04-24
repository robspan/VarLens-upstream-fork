import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  POSTGRES_JSON_IMPORT_BATCH_SIZE,
  PostgresImportExecutor
} from '../../../src/main/storage/postgres/PostgresImportExecutor'
import type {
  PostgresJsonImportBatchResult,
  PostgresJsonImportRepository,
  PostgresJsonImportRequest,
  PostgresJsonImportSession
} from '../../../src/main/storage/postgres/PostgresJsonImportRepository'
import type { FormatInfo } from '../../../src/main/import/strategies/ImportStrategy'

interface FakeRepoOptions {
  caseId?: number
  captureRequests?: PostgresJsonImportRequest[]
  insertVariantBatchMock?: ReturnType<typeof vi.fn>
  onBeforeWrite?: () => void | Promise<void>
  writeThrows?: Error
}

function createFakeRepository(opts: FakeRepoOptions = {}): {
  repository: PostgresJsonImportRepository
  runJsonImport: ReturnType<typeof vi.fn>
  insertVariantBatch: ReturnType<typeof vi.fn>
  requests: PostgresJsonImportRequest[]
} {
  const requests: PostgresJsonImportRequest[] = opts.captureRequests ?? []
  const insertVariantBatch = opts.insertVariantBatchMock ?? vi.fn(async () => 0)
  const runJsonImport = vi.fn(
    async (
      req: PostgresJsonImportRequest,
      writeVariants: (session: PostgresJsonImportSession) => Promise<void>
    ): Promise<PostgresJsonImportBatchResult> => {
      requests.push(req)
      let total = 0
      const session: PostgresJsonImportSession = {
        caseId: opts.caseId ?? 4,
        insertVariantBatch: async (variants) => {
          const result = await insertVariantBatch(variants)
          total += variants.length
          return typeof result === 'number' ? result : variants.length
        }
      }
      if (opts.onBeforeWrite) await opts.onBeforeWrite()
      await writeVariants(session)
      return { caseId: opts.caseId ?? 4, variantCount: total }
    }
  )
  return {
    repository: { runJsonImport } as unknown as PostgresJsonImportRepository,
    runJsonImport,
    insertVariantBatch,
    requests
  }
}

function makeReadable(items: Array<Record<string, unknown>>): Readable {
  return Readable.from(items)
}

describe('PostgresImportExecutor', () => {
  it('streams simple JSON fixture and calls repository with 3 variants', async () => {
    const { repository, runJsonImport, insertVariantBatch, requests } = createFakeRepository({
      caseId: 7
    })
    const variants = [
      { chr: '1', pos: 1, ref: 'A', alt: 'G' },
      { chr: '1', pos: 2, ref: 'A', alt: 'C' },
      { chr: '1', pos: 3, ref: 'T', alt: 'G' }
    ]

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 123 }),
      now: () => 1_000_000
    })

    const result = await executor.importSingleFile({
      filePath: '/tmp/simple-format.json',
      caseName: 'CaseS',
      throttleMs: 0
    })

    expect(runJsonImport).toHaveBeenCalledTimes(1)
    expect(requests[0].importFileType).toBe('simple')
    expect(requests[0].caseName).toBe('CaseS')
    expect(requests[0].fileName).toBe('simple-format.json')
    expect(requests[0].fileSize).toBe(123)
    expect(insertVariantBatch).toHaveBeenCalledTimes(1)
    expect(insertVariantBatch).toHaveBeenCalledWith(variants)
    expect(result).toMatchObject({
      caseId: 7,
      variantCount: 3,
      skipped: 0,
      errors: []
    })
    expect(result.elapsed).toBeGreaterThanOrEqual(0)
  })

  it('detects object format and calls repository with mapped variants', async () => {
    const { repository, requests, insertVariantBatch } = createFakeRepository()
    const variants = [
      { chr: '2', pos: 10, ref: 'A', alt: 'G' },
      { chr: '2', pos: 20, ref: 'C', alt: 'T' }
    ]

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'object', caseKey: 'case1' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 50 }),
      now: () => 1_000_000
    })

    const result = await executor.importSingleFile({
      filePath: '/tmp/object-format.json',
      caseName: 'CaseO',
      throttleMs: 0
    })

    expect(requests[0].importFileType).toBe('object')
    expect(insertVariantBatch).toHaveBeenCalledWith(variants)
    expect(result.variantCount).toBe(2)
  })

  it('detects columnar format and calls repository', async () => {
    const { repository, requests, insertVariantBatch } = createFakeRepository()
    const variants = [{ chr: '3', pos: 100, ref: 'G', alt: 'A' }]

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'columnar', caseKey: 'case1', wrapped: true }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 75 }),
      now: () => 1_000_000
    })

    const result = await executor.importSingleFile({
      filePath: '/tmp/columnar-format.json',
      caseName: 'CaseC',
      throttleMs: 0
    })

    expect(requests[0].importFileType).toBe('columnar')
    expect(insertVariantBatch).toHaveBeenCalledWith(variants)
    expect(result.variantCount).toBe(1)
  })

  it('rejects VCF with a clear message and does not call repository', async () => {
    const { repository, runJsonImport } = createFakeRepository()

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () => ({ format: 'vcf', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable([]),
      statFile: () => ({ size: 10 }),
      now: () => 1_000_000
    })

    const result = await executor.importSingleFile({
      filePath: '/tmp/something.vcf',
      caseName: 'V',
      throttleMs: 0
    })

    expect(runJsonImport).not.toHaveBeenCalled()
    expect(result.errors).toContain('PostgreSQL import currently supports JSON files only')
    expect(result.caseId).toBe(0)
    expect(result.variantCount).toBe(0)
  })

  it('cancellation before first batch resolves with cancellation result', async () => {
    const { repository, insertVariantBatch } = createFakeRepository()

    const variants = [{ chr: '1', pos: 1, ref: 'A', alt: 'G' }]
    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 100 }),
      now: () => 1_714_060_810_000
    })

    executor.cancel()

    const result = await executor.importSingleFile({
      filePath: '/tmp/simple-format.json',
      caseName: 'C',
      throttleMs: 0
    })

    expect(result).toStrictEqual({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 0
    })
    expect(insertVariantBatch).not.toHaveBeenCalled()
  })

  it('cancellation between batches rolls back via repository', async () => {
    // Repository-shape fake: this time emulate a repository that lets the write
    // callback throw so the transaction would roll back. We track whether commit
    // happened via a flag.
    let committed = false
    const insertVariantBatch = vi.fn(async () => 0)
    const runJsonImport = vi.fn(
      async (
        _req: PostgresJsonImportRequest,
        writeVariants: (session: PostgresJsonImportSession) => Promise<void>
      ): Promise<PostgresJsonImportBatchResult> => {
        try {
          await writeVariants({
            caseId: 9,
            insertVariantBatch: async (variants) => {
              await insertVariantBatch(variants)
              return variants.length
            }
          })
          committed = true
          return { caseId: 9, variantCount: 0 }
        } catch (e) {
          // simulate rollback path: rethrow so executor sees it
          throw e
        }
      }
    )
    const repository = { runJsonImport } as unknown as PostgresJsonImportRepository

    // Generate > batch-size worth of items so cancel-between-batches is exercised.
    const variants: Array<Record<string, unknown>> = []
    for (let i = 0; i < POSTGRES_JSON_IMPORT_BATCH_SIZE + 5; i++) {
      variants.push({ chr: '1', pos: i, ref: 'A', alt: 'G' })
    }

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 1 }),
      now: () => 1_714_060_810_000
    })

    // Cancel after first batch call
    insertVariantBatch.mockImplementationOnce(async () => {
      executor.cancel()
      return 0
    })

    const result = await executor.importSingleFile({
      filePath: '/tmp/x.json',
      caseName: 'C',
      throttleMs: 0
    })

    expect(result.errors).toContain('Import cancelled by user')
    expect(committed).toBe(false)
  })

  it('progress callback receives parsing and inserting phases', async () => {
    const { repository } = createFakeRepository({
      insertVariantBatchMock: vi.fn(async () => 0)
    })

    const variants: Array<Record<string, unknown>> = []
    for (let i = 0; i < POSTGRES_JSON_IMPORT_BATCH_SIZE + 3; i++) {
      variants.push({ chr: '1', pos: i, ref: 'A', alt: 'G' })
    }

    const onProgress = vi.fn()
    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 1 }),
      now: () => 0
    })

    await executor.importSingleFile({
      filePath: '/tmp/x.json',
      caseName: 'P',
      throttleMs: 0,
      onProgress
    })

    const phases = onProgress.mock.calls.map(([p]) => p.phase)
    expect(phases[0]).toBe('parsing')
    expect(phases).toContain('inserting')
    // Inserting counts are non-decreasing.
    const insertingCounts = onProgress.mock.calls
      .filter(([p]) => p.phase === 'inserting')
      .map(([p]) => p.count)
    for (let i = 1; i < insertingCounts.length; i++) {
      expect(insertingCounts[i]).toBeGreaterThanOrEqual(insertingCounts[i - 1])
    }
  })

  it('splits a large stream into bounded batches', async () => {
    const insertVariantBatch = vi.fn(async () => 0)
    const { repository } = createFakeRepository({ insertVariantBatchMock: insertVariantBatch })

    const total = 2500
    const variants: Array<Record<string, unknown>> = []
    for (let i = 0; i < total; i++) {
      variants.push({ chr: '1', pos: i, ref: 'A', alt: 'G' })
    }

    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () => makeReadable(variants),
      statFile: () => ({ size: 1 }),
      now: () => 0
    })

    await executor.importSingleFile({
      filePath: '/tmp/x.json',
      caseName: 'L',
      throttleMs: 0
    })

    expect(insertVariantBatch.mock.calls.length).toBeGreaterThanOrEqual(3)
    for (const call of insertVariantBatch.mock.calls) {
      const batch = call[0] as unknown[]
      expect(batch.length).toBeLessThanOrEqual(POSTGRES_JSON_IMPORT_BATCH_SIZE)
    }
  })

  it('resets cancellation state after completion', async () => {
    const { repository } = createFakeRepository()
    const executor = new PostgresImportExecutor({
      repository,
      detectFormat: async () =>
        ({ format: 'simple', caseKey: '' }) satisfies FormatInfo,
      createMapperPipeline: async () =>
        makeReadable([{ chr: '1', pos: 1, ref: 'A', alt: 'G' }]),
      statFile: () => ({ size: 1 }),
      now: () => 0
    })

    executor.cancel()
    const first = await executor.importSingleFile({
      filePath: '/tmp/x.json',
      caseName: 'R1',
      throttleMs: 0
    })
    expect(first.errors).toContain('Import cancelled by user')

    const second = await executor.importSingleFile({
      filePath: '/tmp/x.json',
      caseName: 'R2',
      throttleMs: 0
    })
    expect(second.errors).toEqual([])
    expect(second.variantCount).toBe(1)
  })
})
