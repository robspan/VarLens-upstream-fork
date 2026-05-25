import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgresImportWorkerClient } from '../../../src/main/storage/postgres/PostgresImportWorkerClient'
import type { PostgresImportWorkerStartMessage } from '../../../src/shared/types/postgres-import-worker'

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn(async () => 0)
}

describe('PostgresImportWorkerClient', () => {
  it('relays progress, file-complete, complete, and error messages', async () => {
    const fake = new FakeWorker()
    const client = new PostgresImportWorkerClient({
      workerFactory: () => fake as unknown as Worker
    })

    const onProgress = vi.fn()
    const onFileComplete = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()

    const startMessage: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'X',
      filePath: '/tmp/a.json',
      format: 'json'
    }
    client.start(startMessage, { onProgress, onFileComplete, onComplete, onError })

    fake.emit('message', { type: 'progress', phase: 'inserting', rowsProcessed: 100 })
    fake.emit('message', {
      type: 'file-complete',
      filePath: '/tmp/a.json',
      caseId: 7,
      variantCount: 100
    })
    fake.emit('message', {
      type: 'complete',
      mode: 'single-file',
      result: { caseId: 7, variantCount: 100, skipped: 0, errors: [], elapsed: 0 }
    })

    expect(fake.postMessage).toHaveBeenCalledWith(startMessage)
    expect(onProgress).toHaveBeenCalled()
    expect(onFileComplete).toHaveBeenCalledWith({
      type: 'file-complete',
      filePath: '/tmp/a.json',
      caseId: 7,
      variantCount: 100
    })
    expect(onComplete).toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('forwards cancel as a worker message', async () => {
    const fake = new FakeWorker()
    const c = new PostgresImportWorkerClient({ workerFactory: () => fake as unknown as Worker })
    c.start(
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'X',
        filePath: '/tmp/a.json'
      },
      { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
    )
    c.cancel()
    expect(fake.postMessage).toHaveBeenLastCalledWith({ type: 'cancel' })
  })

  it('treats a non-zero exit as an error', async () => {
    const fake = new FakeWorker()
    const onError = vi.fn()
    const c = new PostgresImportWorkerClient({ workerFactory: () => fake as unknown as Worker })
    c.start(
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'X',
        filePath: '/tmp/a.json'
      },
      { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError }
    )
    fake.emit('exit', 1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('exit') })
    )
  })

  it('cancel before start is a no-op (does not throw)', () => {
    const fake = new FakeWorker()
    const c = new PostgresImportWorkerClient({ workerFactory: () => fake as unknown as Worker })
    expect(() => c.cancel()).not.toThrow()
    expect(fake.postMessage).not.toHaveBeenCalled()
  })

  it('throws a clear error when the worker bundle cannot be found', () => {
    const c = new PostgresImportWorkerClient({
      workerPathCandidates: ['/tmp/varlens-missing-postgres-import-worker.js']
    })

    expect(() =>
      c.start(
        {
          type: 'start',
          client: { connectionString: 'postgres://x' },
          schema: 'public',
          mode: 'single-file',
          caseName: 'X',
          filePath: '/tmp/a.json'
        },
        { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
      )
    ).toThrow(/Postgres import worker bundle not found/)
  })

  it('loads the web-built worker bundle when only out/web is shipped', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'varlens-web-worker-'))
    const previousCwd = process.cwd()
    try {
      const webOut = join(tmp, 'out', 'web')
      mkdirSync(webOut, { recursive: true })
      writeFileSync(
        join(webOut, 'postgres-import-worker.cjs'),
        "const { parentPort } = require('node:worker_threads'); parentPort.on('message', () => {});\n"
      )
      process.chdir(tmp)

      const c = new PostgresImportWorkerClient()
      c.start(
        {
          type: 'start',
          client: { connectionString: 'postgres://x' },
          schema: 'public',
          mode: 'single-file',
          caseName: 'X',
          filePath: '/tmp/a.json'
        },
        { onProgress: vi.fn(), onFileComplete: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
      )
      await c.terminate()
    } finally {
      process.chdir(previousCwd)
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
