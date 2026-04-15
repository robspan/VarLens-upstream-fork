import { PERF_BUDGETS, type PerfBudgetKey } from '../../../shared/config/perf-budgets'
import type {
  PerfLongTaskSummary,
  PerfTraceEntry,
  RendererPerfSnapshot
} from '../../../shared/types/perf'
import { logService } from './LogService'

export type PerfEntry = PerfTraceEntry

const MAX_ENTRIES = 100
const entries: PerfEntry[] = []
const activeTraces = new Map<string, number>()
let longTaskSummary: PerfLongTaskSummary = {
  count: 0,
  totalDurationMs: 0,
  maxDurationMs: 0
}

/** Start a named trace. Returns the trace ID for passing to traceEnd. */
export function traceStart(name: string): string {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  activeTraces.set(id, performance.now())
  return id
}

/** End a trace and record the entry. Returns the entry or null if ID unknown. */
export function traceEnd(id: string, budget?: PerfBudgetKey): PerfEntry | null {
  const start = activeTraces.get(id)
  if (start === undefined) return null
  activeTraces.delete(id)

  const duration = performance.now() - start
  const budgetMs = budget !== undefined ? PERF_BUDGETS[budget] : undefined
  const overBudget = budgetMs !== undefined && duration > budgetMs

  const entry: PerfEntry = {
    name: id.replace(/-\d+-[a-z0-9]+$/, ''),
    duration: Math.round(duration * 100) / 100,
    budget,
    overBudget,
    timestamp: new Date().toISOString()
  }

  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()

  if (import.meta.env.DEV) {
    if (overBudget) {
      logService.warn(
        `[perf] ${entry.name} took ${entry.duration}ms (budget: ${budgetMs}ms)`,
        'perf'
      )
    } else if (duration > 50) {
      logService.debug(`[perf] ${entry.name}: ${entry.duration}ms`, 'perf')
    }
  }

  return entry
}

/**
 * Trace an async function from start to completion.
 * For multi-step user flows (where annotation hydration follows data fetch),
 * use traceStart/traceEnd manually to span the full flow.
 */
export async function traceAsync<T>(
  name: string,
  fn: () => Promise<T>,
  budget?: PerfBudgetKey
): Promise<T> {
  const id = traceStart(name)
  try {
    return await fn()
  } finally {
    traceEnd(id, budget)
  }
}

/** Get recent entries (most recent first). */
export function getRecentTraces(limit = 20): readonly PerfEntry[] {
  return entries.slice(-limit).reverse()
}

export function setLongTaskSummary(summary: PerfLongTaskSummary): void {
  longTaskSummary = {
    count: summary.count,
    totalDurationMs: Math.round(summary.totalDurationMs * 100) / 100,
    maxDurationMs: Math.round(summary.maxDurationMs * 100) / 100
  }
}

export function getTraceSnapshot(limit = MAX_ENTRIES): RendererPerfSnapshot {
  return {
    traces: [...getRecentTraces(limit)],
    longTasks: { ...longTaskSummary }
  }
}

/** Clear all traces (for testing). */
export function clearTraces(): void {
  entries.length = 0
  activeTraces.clear()
}

export function resetPerfSnapshot(): void {
  clearTraces()
  setLongTaskSummary({
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0
  })
}
