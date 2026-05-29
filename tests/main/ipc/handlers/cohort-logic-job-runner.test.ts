import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Gate 12 four-dimension coverage for D3 wire site (iv):
//   runGeneBurdenCompare is routed through the shared module-singleton
//   JobRunner (kind 'association'). These tests assert the four invariants the
//   wiring must preserve:
//     (a) return payload unchanged (deep-cloned AssociationResults)
//     (b) single-flight conflict message preserved
//         ('An association analysis is already running')
//     (c) cancellation routed through engine.abort() (Pass-9 #9 — NOT
//         terminate()), via both jobRunner.cancel() and the existing
//         cohort:cancelAssociation IPC path (cancelGeneBurdenCompare)
//     (d) onProgress { completed, total } mapping unchanged from pre-PR-4
//
// AssociationEngine is mocked so the wiring is exercised without a real DB.
// Each fake engine's run() returns a deferred the test resolves explicitly,
// matching the long-running nature of the real engine — this lets the handler
// occupy the single-flight slot until the test drives completion/cancellation.
// ---------------------------------------------------------------------------

interface FakeEngine {
  run: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  onProgress?: (completed: number, total: number) => void
  resolveRun: (value: unknown) => void
  emitProgress: (completed: number, total: number) => void
}

const engines: FakeEngine[] = []

vi.mock('../../../../src/main/statistics/AssociationEngine', () => ({
  AssociationEngine: class {
    abort = vi.fn()
    onProgress?: (completed: number, total: number) => void
    resolveRun!: (value: unknown) => void
    run: ReturnType<typeof vi.fn>

    constructor(_db: unknown, onProgress?: (completed: number, total: number) => void) {
      this.onProgress = onProgress
      const deferred = new Promise((resolve) => {
        this.resolveRun = resolve
      })
      this.run = vi.fn(() => deferred)
      engines.push(this as unknown as FakeEngine)
    }

    emitProgress(completed: number, total: number): void {
      this.onProgress?.(completed, total)
    }
  }
}))

import {
  runGeneBurdenCompare,
  cancelGeneBurdenCompare
} from '../../../../src/main/ipc/handlers/cohort-logic'
import { jobRunner } from '../../../../src/main/services/jobs/runner'
import type { AssociationConfig } from '../../../../src/main/statistics/types'

const BASE_CONFIG = {
  groupA_ids: [1, 2],
  groupB_ids: [3, 4],
  primary_test: 'fisher',
  weight_scheme: 'uniform',
  filters: {},
  covariates: []
} as unknown as AssociationConfig

// getDb returns the minimal { database } surface the engine constructor reads.
const getDb = () => ({ database: {} }) as never
const getDbPool = () => null

const RESULTS = {
  results: [{ gene: 'BRCA1', p_value: 0.01 }],
  primary_test: 'fisher',
  config: BASE_CONFIG,
  warnings: [],
  elapsed_ms: 12
}

// Yield long enough for enqueue → handler kickoff → engine construction.
async function flush(): Promise<void> {
  await new Promise((r) => queueMicrotask(r as () => void))
}

afterEach(() => {
  engines.length = 0
  vi.clearAllMocks()
})

describe('runGeneBurdenCompare — Sprint A D3 (iv) / Gate 12', () => {
  it('(a) return payload: returns the deep-cloned AssociationResults unchanged', async () => {
    const promise = runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool)
    await flush()

    expect(engines.length).toBe(1)
    engines[0].resolveRun(RESULTS)

    const returned = await promise
    expect(returned).toEqual(RESULTS)
    // Deep clone — not the same reference.
    expect(returned).not.toBe(RESULTS)
  })

  it('(b) conflict: a second concurrent call rejects with the preserved message', async () => {
    const first = runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool)
    await flush()

    await expect(runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool)).rejects.toThrow(
      'An association analysis is already running'
    )

    // Unblock the first run so the 'association' slot frees for later tests.
    engines[0].resolveRun(RESULTS)
    await first
  })

  it('(b) validation: overlapping groups reject before occupying the single-flight slot', async () => {
    const overlapping = {
      ...BASE_CONFIG,
      groupA_ids: [1, 2],
      groupB_ids: [2, 3]
    } as unknown as AssociationConfig

    await expect(runGeneBurdenCompare(overlapping, getDb, getDbPool)).rejects.toThrow(
      'Groups overlap: case IDs 2 appear in both groups'
    )
    // No engine constructed, no slot occupied — a subsequent valid run starts.
    expect(engines.length).toBe(0)
    expect(jobRunner.list({ kind: 'association', status: 'running' }).length).toBe(0)
  })

  it('(c) cancellation: jobRunner.cancel triggers engine.abort() (NOT terminate)', async () => {
    const promise = runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool)
    await flush()

    const running = jobRunner.list({ kind: 'association', status: 'running' })
    expect(running.length).toBe(1)
    await jobRunner.cancel(running[0].id)

    expect(engines[0].abort).toHaveBeenCalledTimes(1)

    // Settle the run so the slot frees.
    engines[0].resolveRun(RESULTS)
    await promise
  })

  it('(c) cancellation: cohort:cancelAssociation path still calls activeEngine.abort()', async () => {
    const promise = runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool)
    await flush()

    // The existing IPC channel path — unchanged by PR-4.
    cancelGeneBurdenCompare()
    expect(engines[0].abort).toHaveBeenCalledTimes(1)

    engines[0].resolveRun(RESULTS)
    await promise
  })

  it('(d) progress mapping: onProgress { completed, total } is unchanged from pre-PR-4', async () => {
    const recorded: Array<{ completed: number; total: number }> = []
    const promise = runGeneBurdenCompare(BASE_CONFIG, getDb, getDbPool, (data) => {
      recorded.push(data)
    })
    await flush()

    // The engine reports progress via the constructor-supplied callback.
    engines[0].emitProgress(1, 3)
    engines[0].emitProgress(3, 3)
    engines[0].resolveRun(RESULTS)
    await promise

    expect(recorded).toEqual([
      { completed: 1, total: 3 },
      { completed: 3, total: 3 }
    ])
  })
})
