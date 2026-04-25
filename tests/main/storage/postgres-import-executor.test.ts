import { describe, expect, it, vi } from 'vitest'

import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import type { PostgresImportWorkerCallbacks } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type {
  PostgresImportWorkerCompleteMessage,
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../../src/shared/types/postgres-import-worker'

// ---------------------------------------------------------------------------
// Fake worker client
// ---------------------------------------------------------------------------

/**
 * FakeWorkerClient drives the executor synchronously via queueMicrotask so
 * tests can await importSingleFile without involving real worker threads.
 */
class FakeWorkerClient {
  start = vi.fn(
    (_message: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
      queueMicrotask(() => {
        callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 1 })
        const complete: PostgresImportWorkerCompleteMessage = {
          type: 'complete',
          mode: 'single-file',
          result: { caseId: 99, variantCount: 1, skipped: 0, errors: [], elapsed: 5 }
        }
        callbacks.onComplete(complete)
      })
    }
  )
  cancel = vi.fn()
}

const TEST_CLIENT_CONFIG: PostgresClientConfig = {
  connectionString: 'postgres://test:secret@localhost:5432/testdb',
  application_name: 'varlens-test',
  ssl: { mode: 'disable' }
}

function makeExecutor(fakeClient: FakeWorkerClient) {
  return new PostgresImportExecutor({
    schema: 'public',
    clientConfig: TEST_CLIENT_CONFIG,
    workerClientFactory: () => fakeClient as never
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PostgresImportExecutor (worker-dispatch)', () => {
  it('builds the correct start message and passes it to the worker client', async () => {
    const fakeClient = new FakeWorkerClient()
    const executor = makeExecutor(fakeClient)

    await executor.importSingleFile({
      filePath: '/tmp/test.json',
      caseName: 'MyCase',
      vcfOptions: { genomeBuild: 'GRCh38' },
      throttleMs: 0
    })

    expect(fakeClient.start).toHaveBeenCalledTimes(1)
    const [startMsg] = fakeClient.start.mock.calls[0] as [PostgresImportWorkerStartMessage, unknown]
    expect(startMsg.type).toBe('start')
    expect(startMsg.mode).toBe('single-file')
    expect(startMsg.schema).toBe('public')
    expect(startMsg.client).toEqual(TEST_CLIENT_CONFIG)
    expect(startMsg.filePath).toBe('/tmp/test.json')
    expect(startMsg.caseName).toBe('MyCase')
    expect(startMsg.vcfOptions).toEqual({ genomeBuild: 'GRCh38' })
  })

  it('converts worker progress messages to StorageImportProgress and forwards to onProgress', async () => {
    const progressCalls: Array<{ phase: string; count: number }> = []
    let resolveFn!: () => void
    const gate = new Promise<void>((r) => {
      resolveFn = r
    })

    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(async () => {
            callbacks.onProgress({ type: 'progress', phase: 'parsing', rowsProcessed: 0 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 50 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 100 })
            callbacks.onComplete({
              type: 'complete',
              mode: 'single-file',
              result: { caseId: 1, variantCount: 100, skipped: 0, errors: [], elapsed: 10 }
            })
            resolveFn()
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: TEST_CLIENT_CONFIG,
      workerClientFactory: () => fakeClient as never
    })

    const onProgress = vi.fn((data: { phase: string; count: number }) => {
      progressCalls.push(data)
    })

    await Promise.all([
      executor.importSingleFile({
        filePath: '/tmp/x.json',
        caseName: 'C',
        throttleMs: 0,
        onProgress
      }),
      gate
    ])

    expect(progressCalls.length).toBeGreaterThanOrEqual(3)
    expect(progressCalls[0].phase).toBe('parsing')
    expect(progressCalls[0].count).toBe(0)
    expect(progressCalls[1].phase).toBe('inserting')
    expect(progressCalls[1].count).toBe(50)
    expect(progressCalls[2].phase).toBe('inserting')
    expect(progressCalls[2].count).toBe(100)
  })

  it('worker complete message resolves the promise with the correct result shape', async () => {
    const fakeClient = new FakeWorkerClient()
    // Override to produce a specific complete payload
    fakeClient.start = vi.fn(
      (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
        queueMicrotask(() => {
          callbacks.onComplete({
            type: 'complete',
            mode: 'single-file',
            result: { caseId: 42, variantCount: 300, skipped: 2, errors: ['warn1'], elapsed: 88 }
          })
        })
      }
    )

    const executor = makeExecutor(fakeClient)
    const result = await executor.importSingleFile({
      filePath: '/tmp/y.json',
      caseName: 'CaseY',
      throttleMs: 0
    })

    expect(result.caseId).toBe(42)
    expect(result.variantCount).toBe(300)
    expect(result.skipped).toBe(2)
    expect(result.errors).toEqual(['warn1'])
    expect(result.elapsed).toBe(88)
  })

  it('worker error message rejects the promise', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onError({ type: 'error', message: 'worker blew up' })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: TEST_CLIENT_CONFIG,
      workerClientFactory: () => fakeClient as never
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/bad.json', caseName: 'Bad', throttleMs: 0 })
    ).rejects.toThrow('worker blew up')
  })

  it('cancel() forwards to the worker client', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — let the test drive it
        }
      ),
      cancel: vi.fn()
    }

    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: TEST_CLIENT_CONFIG,
      workerClientFactory: () => fakeClient as never
    })

    // Start the import but don't await yet
    const importPromise = executor.importSingleFile({
      filePath: '/tmp/z.json',
      caseName: 'CZ',
      throttleMs: 0
    })

    // Wait a tick for start to be called
    await new Promise((r) => queueMicrotask(r as () => void))

    executor.cancel()
    expect(fakeClient.cancel).toHaveBeenCalledTimes(1)

    // Resolve the promise so the test doesn't hang
    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 0, variantCount: 0, skipped: 0, errors: ['Import cancelled by user'], elapsed: 0 }
    })
    await importPromise
  })

  it('rejects a second concurrent importSingleFile while one is in flight', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
        }
      ),
      cancel: vi.fn()
    }

    const executor = new PostgresImportExecutor({
      schema: 'public',
      clientConfig: TEST_CLIENT_CONFIG,
      workerClientFactory: () => fakeClient as never
    })

    const first = executor.importSingleFile({
      filePath: '/tmp/one.json',
      caseName: 'C1',
      throttleMs: 0
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/two.json', caseName: 'C2', throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    // Unblock the first import
    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 1, variantCount: 1, skipped: 0, errors: [], elapsed: 1 }
    })
    const result = await first
    expect(result.errors).toEqual([])
  })

  it('rejects filters payload on importSingleFile', async () => {
    const fakeClient = new FakeWorkerClient()
    const executor = makeExecutor(fakeClient)

    await expect(
      executor.importSingleFile({
        filePath: '/tmp/x.json',
        caseName: 'F',
        throttleMs: 0,
        // Inject filters as if it were passed through
        ...{ filters: { passOnly: true } }
      })
    ).rejects.toThrow('Filters are only supported on import:startMultiFile')
  })

  it('passes cancellation result through onComplete (not onError)', async () => {
    const fakeClient = new FakeWorkerClient()
    fakeClient.start = vi.fn(
      (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
        queueMicrotask(() => {
          callbacks.onComplete({
            type: 'complete',
            mode: 'single-file',
            result: {
              caseId: 0,
              variantCount: 0,
              skipped: 0,
              errors: ['Import cancelled by user'],
              elapsed: 0
            }
          })
        })
      }
    )

    const executor = makeExecutor(fakeClient)
    const result = await executor.importSingleFile({
      filePath: '/tmp/cancel.json',
      caseName: 'CX',
      throttleMs: 0
    })

    expect(result.caseId).toBe(0)
    expect(result.variantCount).toBe(0)
    expect(result.errors).toContain('Import cancelled by user')
  })

  it('importMultiFile throws not-yet-implemented', async () => {
    const fakeClient = new FakeWorkerClient()
    const executor = makeExecutor(fakeClient)

    await expect(
      executor.importMultiFile({
        caseName: 'M',
        files: [],
        throttleMs: 0
      })
    ).rejects.toThrow('not yet implemented (Phase 9 Task 11)')
  })

  it('allows a new import after the previous one completes', async () => {
    const fakeClient = new FakeWorkerClient()
    const executor = makeExecutor(fakeClient)

    await executor.importSingleFile({ filePath: '/tmp/a.json', caseName: 'A', throttleMs: 0 })
    await executor.importSingleFile({ filePath: '/tmp/b.json', caseName: 'B', throttleMs: 0 })

    expect(fakeClient.start).toHaveBeenCalledTimes(2)
  })

  it('uses elapsed from worker result when > 0, falls back to wall clock otherwise', async () => {
    const fakeClient = new FakeWorkerClient()
    // Worker reports elapsed = 0
    fakeClient.start = vi.fn(
      (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
        queueMicrotask(() => {
          callbacks.onComplete({
            type: 'complete',
            mode: 'single-file',
            result: { caseId: 1, variantCount: 1, skipped: 0, errors: [], elapsed: 0 }
          })
        })
      }
    )
    const executor = makeExecutor(fakeClient)
    const result = await executor.importSingleFile({
      filePath: '/tmp/c.json',
      caseName: 'C',
      throttleMs: 0
    })
    // Wall-clock fallback: elapsed should be >= 0
    expect(result.elapsed).toBeGreaterThanOrEqual(0)

    // Worker reports elapsed = 123
    fakeClient.start = vi.fn(
      (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
        queueMicrotask(() => {
          callbacks.onComplete({
            type: 'complete',
            mode: 'single-file',
            result: { caseId: 2, variantCount: 2, skipped: 0, errors: [], elapsed: 123 }
          })
        })
      }
    )
    const result2 = await executor.importSingleFile({
      filePath: '/tmp/d.json',
      caseName: 'D',
      throttleMs: 0
    })
    expect(result2.elapsed).toBe(123)
  })
})
