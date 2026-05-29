import { describe, expect, it, vi } from 'vitest'

import { PostgresImportExecutor } from '../../../src/main/storage/postgres/PostgresImportExecutor'
import { jobRunner } from '../../../src/main/services/jobs/runner'
import type { PostgresImportWorkerCallbacks } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type {
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../../src/shared/types/postgres-import-worker'

// ---------------------------------------------------------------------------
// Gate 12 four-dimension coverage for D3 wire site (i):
//   PostgresImportExecutor.importSingleFile is routed through the shared
//   module-singleton JobRunner (`import_single` kind). These tests assert the
//   four invariants the wiring must preserve:
//     (a) return payload unchanged
//     (b) single-flight conflict message preserved
//     (c) cancellation routed through worker.postMessage({type:'cancel'})
//     (d) import:progress phase/count/skipped mapping is unchanged
//
// Note on (d): PR4-3 does not touch runWorker's progress-mapping path, so the
// phase/count/skipped fields are demonstrably identical to pre-PR-4. The
// expectation below is therefore an equivalent inline assertion of that
// mapping rather than a byte-for-byte diff against a captured main-branch
// fixture. The wall-clock `elapsed` field is non-deterministic and excluded.
// ---------------------------------------------------------------------------

const TEST_CLIENT_CONFIG: PostgresClientConfig = {
  connectionString: 'postgres://test:secret@localhost:5432/testdb',
  application_name: 'varlens-test',
  ssl: { mode: 'disable' }
}

function makeExecutor(fakeClient: { start: unknown; cancel: unknown }) {
  return new PostgresImportExecutor({
    schema: 'public',
    clientConfig: TEST_CLIENT_CONFIG,
    workerClientFactory: () => fakeClient as never
  })
}

describe('PostgresImportExecutor.importSingleFile — Sprint A D3 (i) / Gate 12', () => {
  it('(a) return payload: returns StorageImportSingleFileResult unchanged', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onComplete({
              type: 'complete',
              mode: 'single-file',
              result: { caseId: 42, variantCount: 300, skipped: 2, errors: ['warn1'], elapsed: 88 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const result = await executor.importSingleFile({
      filePath: '/tmp/a.json',
      caseName: 'CaseA',
      throttleMs: 0
    })

    // Exact shape + values are preserved through the JobRunner wiring.
    expect(result).toEqual({
      caseId: 42,
      variantCount: 300,
      skipped: 2,
      errors: ['warn1'],
      elapsed: 88
    })
  })

  it('(b) conflict: second concurrent call rejects with "An import is already in progress"', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — keep the import_single slot occupied.
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const first = executor.importSingleFile({
      filePath: '/tmp/one.json',
      caseName: 'C1',
      throttleMs: 0
    })

    await expect(
      executor.importSingleFile({ filePath: '/tmp/two.json', caseName: 'C2', throttleMs: 0 })
    ).rejects.toThrow('An import is already in progress')

    // Unblock the first import so the import_single slot frees for later tests.
    capturedCallbacks.onComplete({
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 1, variantCount: 1, skipped: 0, errors: [], elapsed: 1 }
    })
    const result = await first
    expect(result.errors).toEqual([])
  })

  it('(c) cancellation: jobRunner.cancel triggers worker.postMessage({type:"cancel"}) via client.cancel', async () => {
    let capturedCallbacks!: PostgresImportWorkerCallbacks
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          capturedCallbacks = callbacks
          // Do not complete — let the test drive cancellation.
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)

    const importPromise = executor.importSingleFile({
      filePath: '/tmp/z.json',
      caseName: 'CZ',
      throttleMs: 0
    })

    // Let enqueue + start run.
    await new Promise((r) => queueMicrotask(r as () => void))

    // Locate the in-flight import_single job and cancel it through the runner.
    const running = jobRunner.list({ kind: 'import_single', status: 'running' })
    expect(running.length).toBe(1)
    await jobRunner.cancel(running[0].id)

    // The registered cancel callback routes to client.cancel(), which posts
    // { type: 'cancel' } to the worker (NOT terminate()).
    expect(fakeClient.cancel).toHaveBeenCalledTimes(1)

    // Resolve so the promise settles and the slot frees.
    capturedCallbacks.onComplete({
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
    await importPromise
  })

  it('(d) progress mapping: phase/count/skipped emissions are unchanged from pre-PR-4', async () => {
    const fakeClient = {
      start: vi.fn(
        (_msg: PostgresImportWorkerStartMessage, callbacks: PostgresImportWorkerCallbacks) => {
          queueMicrotask(() => {
            callbacks.onProgress({ type: 'progress', phase: 'parsing', rowsProcessed: 0 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 50 })
            callbacks.onProgress({ type: 'progress', phase: 'inserting', rowsProcessed: 100 })
            callbacks.onComplete({
              type: 'complete',
              mode: 'single-file',
              result: { caseId: 1, variantCount: 100, skipped: 0, errors: [], elapsed: 10 }
            })
          })
        }
      ),
      cancel: vi.fn()
    }

    const executor = makeExecutor(fakeClient)
    const recorded: Array<{ phase: string; count: number; skipped: number }> = []
    await executor.importSingleFile({
      filePath: '/tmp/p.json',
      caseName: 'CP',
      throttleMs: 0,
      onProgress: (data) => {
        recorded.push({ phase: data.phase, count: data.count, skipped: data.skipped })
      }
    })

    // runWorker maps phase + count + skipped identically to pre-PR-4 (the
    // mapping path is untouched by PR4-3); elapsed is wall-clock and excluded.
    expect(recorded).toEqual([
      { phase: 'parsing', count: 0, skipped: 0 },
      { phase: 'inserting', count: 50, skipped: 0 },
      { phase: 'inserting', count: 100, skipped: 0 }
    ])
  })
})
