// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkerMessage } from '../../../src/shared/types/import-worker'

vi.mock('worker_threads', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')

  class MockWorker extends EventEmitter {
    postMessage = (...args: unknown[]): void => {
      ;(MockWorker.calls.postMessage as unknown[][]).push(args)
    }
    terminate = (): Promise<void> => {
      MockWorker.calls.terminated = true
      return Promise.resolve()
    }
    static lastInstance: MockWorker | null = null
    static calls = { postMessage: [] as unknown[][], terminated: false }

    constructor() {
      super()
      MockWorker.lastInstance = this
      MockWorker.calls = { postMessage: [], terminated: false }
    }
  }

  return {
    Worker: MockWorker,
    __getMockWorker: () => MockWorker.lastInstance,
    __getCalls: () => MockWorker.calls
  }
})

vi.mock('../../../src/main/services/MainLogger', () => ({
  mainLogger: { error: () => {}, warn: () => {}, info: () => {} }
}))

import { ImportWorkerClient } from '../../../src/main/workers/import-worker-client'
import * as workerThreadsMock from 'worker_threads'

const getMockWorker = (workerThreadsMock as unknown as { __getMockWorker: () => unknown })
  .__getMockWorker
const getCalls = (
  workerThreadsMock as unknown as {
    __getCalls: () => { postMessage: unknown[][]; terminated: boolean }
  }
).__getCalls

describe('ImportWorkerClient', () => {
  let client: ImportWorkerClient

  beforeEach(() => {
    client = new ImportWorkerClient()
  })

  it('sends start message to worker', () => {
    client.start({
      files: [
        {
          filePath: '/test.json.gz',
          caseName: 'test',
          isDuplicate: false,
          duplicateStrategy: 'skip'
        }
      ],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress: () => {},
      onFileComplete: () => {},
      onComplete: () => {},
      onError: () => {}
    })

    const calls = getCalls()
    expect(calls.postMessage).toHaveLength(1)
    const startMsg = calls.postMessage[0][0] as Record<string, unknown>
    expect(startMsg.type).toBe('start')
    expect(startMsg.dbPath).toBe('/test.db')
    expect(startMsg.throttleMs).toBe(100)
  })

  it('relays progress messages to callback', () => {
    const onProgress = vi.fn()

    client.start({
      files: [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress,
      onFileComplete: () => {},
      onComplete: () => {},
      onError: () => {}
    })

    const worker = getMockWorker() as import('events').EventEmitter
    const progressMsg: WorkerMessage = {
      type: 'progress',
      fileIndex: 0,
      totalFiles: 1,
      fileName: 'test.json.gz',
      overallPercent: 50,
      phase: 'inserting',
      variantCount: 100,
      skipped: 2
    }

    worker.emit('message', progressMsg)
    expect(onProgress).toHaveBeenCalledWith(progressMsg)
  })

  it('cancel sends cancel message', () => {
    client.start({
      files: [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress: () => {},
      onFileComplete: () => {},
      onComplete: () => {},
      onError: () => {}
    })

    client.cancel()
    const calls = getCalls()
    // Second postMessage call is the cancel
    expect(calls.postMessage).toHaveLength(2)
    const cancelMsg = calls.postMessage[1][0] as Record<string, unknown>
    expect(cancelMsg.type).toBe('cancel')
  })

  it('cleans up worker on complete message', () => {
    const onComplete = vi.fn()

    client.start({
      files: [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress: () => {},
      onFileComplete: () => {},
      onComplete,
      onError: () => {}
    })

    expect(client.isRunning).toBe(true)

    const worker = getMockWorker() as import('events').EventEmitter
    const msg: WorkerMessage = {
      type: 'complete',
      results: { succeeded: 1, failed: 0, skipped: 0, cancelled: false, details: [] }
    }

    worker.emit('message', msg)
    expect(onComplete).toHaveBeenCalledWith(msg)
    expect(getCalls().terminated).toBe(true)
  })

  it('throws if start called while already running', () => {
    const callbacks = {
      files: [] as [],
      dbPath: '/test.db',
      throttleMs: 100,
      onProgress: () => {},
      onFileComplete: () => {},
      onComplete: () => {},
      onError: () => {}
    }

    client.start(callbacks)
    expect(() => client.start(callbacks)).toThrow('Import worker is already running')
  })
})
