import type { PerfBudgetKey } from '../config/perf-budgets'

export interface PerfTraceEntry {
  name: string
  duration: number
  budget?: PerfBudgetKey
  overBudget: boolean
  timestamp: string
}

export interface PerfLongTaskSummary {
  count: number
  totalDurationMs: number
  maxDurationMs: number
}

export interface MainPerfSnapshot {
  elapsedMs: number
  milestones: Record<string, number>
}

export interface RendererPerfSnapshot {
  traces: PerfTraceEntry[]
  longTasks: PerfLongTaskSummary
}

export interface PerfSnapshot {
  capturedAt: string
  main: MainPerfSnapshot
  renderer: RendererPerfSnapshot
}
