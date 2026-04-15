import { describe, it, expect, beforeEach } from 'vitest'
import {
  traceStart,
  traceEnd,
  traceAsync,
  getRecentTraces,
  clearTraces,
  getTraceSnapshot,
  setLongTaskSummary,
  resetPerfSnapshot
} from '../../../src/renderer/src/services/PerfTrace'

describe('PerfTrace', () => {
  beforeEach(() => {
    clearTraces()
  })

  it('records a trace with start/end', () => {
    const id = traceStart('test-op')
    const entry = traceEnd(id)
    expect(entry).not.toBeNull()
    expect(entry!.name).toBe('test-op')
    expect(entry!.duration).toBeGreaterThanOrEqual(0)
    expect(entry!.overBudget).toBe(false)
  })

  it('checks budget when provided', () => {
    const id = traceStart('fast-op')
    const entry = traceEnd(id, 'ANNOTATION_HYDRATE')
    expect(entry).not.toBeNull()
    expect(entry!.budget).toBe('ANNOTATION_HYDRATE')
    expect(entry!.overBudget).toBe(false)
  })

  it('returns null for unknown trace ID', () => {
    const entry = traceEnd('nonexistent-123-abcd')
    expect(entry).toBeNull()
  })

  it('traceAsync wraps an async function', async () => {
    const result = await traceAsync('async-op', async () => 42)
    expect(result).toBe(42)
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('async-op')
  })

  it('traceAsync records even if function throws', async () => {
    await expect(
      traceAsync('failing-op', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    const traces = getRecentTraces()
    expect(traces.length).toBe(1)
    expect(traces[0].name).toBe('failing-op')
  })

  it('getRecentTraces returns most recent first', () => {
    const id1 = traceStart('first')
    traceEnd(id1)
    const id2 = traceStart('second')
    traceEnd(id2)
    const traces = getRecentTraces()
    expect(traces[0].name).toBe('second')
    expect(traces[1].name).toBe('first')
  })

  it('clearTraces empties the buffer', () => {
    const id = traceStart('to-clear')
    traceEnd(id)
    expect(getRecentTraces().length).toBe(1)
    clearTraces()
    expect(getRecentTraces().length).toBe(0)
  })

  it('caps entries at MAX_ENTRIES (100)', () => {
    for (let i = 0; i < 120; i++) {
      const id = traceStart(`op-${i}`)
      traceEnd(id)
    }
    expect(getRecentTraces(200).length).toBe(100)
  })

  it('builds a trace snapshot with long-task summary', () => {
    const id = traceStart('snapshot-op')
    traceEnd(id)
    setLongTaskSummary({
      count: 3,
      totalDurationMs: 180,
      maxDurationMs: 72
    })

    const snapshot = getTraceSnapshot()

    expect(snapshot.traces).toHaveLength(1)
    expect(snapshot.traces[0].name).toBe('snapshot-op')
    expect(snapshot.longTasks.count).toBe(3)
    expect(snapshot.longTasks.totalDurationMs).toBe(180)
    expect(snapshot.longTasks.maxDurationMs).toBe(72)
  })

  it('resetPerfSnapshot clears traces and long-task state', () => {
    const id = traceStart('reset-op')
    traceEnd(id)
    setLongTaskSummary({
      count: 1,
      totalDurationMs: 55,
      maxDurationMs: 55
    })

    resetPerfSnapshot()

    const snapshot = getTraceSnapshot()
    expect(snapshot.traces).toHaveLength(0)
    expect(snapshot.longTasks.count).toBe(0)
    expect(snapshot.longTasks.totalDurationMs).toBe(0)
    expect(snapshot.longTasks.maxDurationMs).toBe(0)
  })
})
