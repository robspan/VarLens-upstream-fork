import { describe, expect, it, vi } from 'vitest'

import { SqliteImportExecutor } from '../../../src/main/storage/sqlite/SqliteImportExecutor'

describe('SqliteImportExecutor', () => {
  it('delegates single-file import to the existing worker client shape', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => 'secret',
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            filePath: '/tmp/input.json',
            caseName: 'Imported',
            duplicateStrategy: 'skip'
          })
        ],
        dbPath: '/tmp/test.varlens',
        encryptionKey: 'secret'
      })
    )

    const callbacks = start.mock.calls[0][0]
    callbacks.onFileComplete({
      type: 'file-complete',
      fileIndex: 0,
      result: { caseId: 7, caseName: 'Imported', variantCount: 3, skipped: 0, elapsed: 5 }
    })
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: false,
        details: [
          {
            filePath: '/tmp/input.json',
            fileName: 'input.json',
            caseName: 'Imported',
            status: 'success',
            variantCount: 3
          }
        ]
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 7,
      variantCount: 3,
      skipped: 0,
      errors: [],
      elapsed: 5
    })
  })

  it('resolves with cancellation result shape when the worker reports cancelled', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    const callbacks = start.mock.calls[0][0]
    callbacks.onComplete({
      type: 'complete',
      results: {
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: true,
        details: []
      }
    })

    await expect(promise).resolves.toStrictEqual({
      caseId: 0,
      variantCount: 0,
      skipped: 0,
      errors: ['Import cancelled by user'],
      elapsed: 0
    })
  })

  it('rejects with the worker error message on fatal onError (fileIndex === -1)', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const promise = executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    const callbacks = start.mock.calls[0][0]
    callbacks.onError({
      type: 'error',
      fileIndex: -1,
      error: 'worker blew up',
      phase: 'worker'
    })

    await expect(promise).rejects.toThrow('worker blew up')
  })

  it('rejects a second concurrent import attempt while one is already running', async () => {
    let running = false
    const start = vi.fn(() => {
      running = true
    })
    const worker = {
      get isRunning() {
        return running
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    void executor.importSingleFile({
      filePath: '/tmp/input.json',
      caseName: 'Imported',
      throttleMs: 100
    })

    await expect(
      executor.importSingleFile({
        filePath: '/tmp/another.json',
        caseName: 'Second',
        throttleMs: 100
      })
    ).rejects.toThrow('An import is already in progress')
  })

  it('translates vcfOptions.selectedSample into vcfSelectedSamples and maps finalizing progress to inserting', async () => {
    const start = vi.fn()
    const worker = {
      get isRunning() {
        return false
      },
      start,
      cancel: vi.fn()
    }
    const executor = new SqliteImportExecutor({
      getDatabaseService: () =>
        ({
          getPath: () => '/tmp/test.varlens',
          getEncryptionKey: () => undefined,
          variants: { updateFrequencies: vi.fn() }
        }) as never,
      createWorkerClient: () => worker as never
    })

    const onProgress = vi.fn()
    void executor.importSingleFile({
      filePath: '/tmp/input.vcf',
      caseName: 'Imported',
      vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
      throttleMs: 100,
      onProgress
    })

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            filePath: '/tmp/input.vcf',
            caseName: 'Imported',
            duplicateStrategy: 'skip',
            vcfSelectedSamples: ['NA12878'],
            vcfGenomeBuild: 'GRCh38'
          })
        ]
      })
    )

    const callbacks = start.mock.calls[0][0]
    callbacks.onProgress({
      type: 'progress',
      fileIndex: 0,
      phase: 'finalizing',
      variantCount: 10,
      skipped: 1
    })

    expect(onProgress).toHaveBeenCalledWith({
      phase: 'inserting',
      count: 10,
      elapsed: 0,
      skipped: 1
    })
  })
})
