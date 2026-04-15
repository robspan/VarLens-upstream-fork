import type { PerfLongTaskSummary } from '../../../shared/types/perf'
import { setLongTaskSummary } from './PerfTrace'

let observer: PerformanceObserver | null = null
let summary: PerfLongTaskSummary = {
  count: 0,
  totalDurationMs: 0,
  maxDurationMs: 0
}

function publishSummary(): void {
  setLongTaskSummary(summary)
}

export function isRendererLongTaskObserverSupported(): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  )
}

export function getRendererLongTaskSummary(): PerfLongTaskSummary {
  return { ...summary }
}

export function resetRendererLongTaskObserver(): void {
  summary = {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0
  }
  publishSummary()
}

export function startRendererLongTaskObserver(): boolean {
  if (!isRendererLongTaskObserverSupported()) {
    resetRendererLongTaskObserver()
    return false
  }

  if (observer !== null) return true

  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      summary.count += 1
      summary.totalDurationMs += entry.duration
      summary.maxDurationMs = Math.max(summary.maxDurationMs, entry.duration)
    }
    publishSummary()
  })

  observer.observe({ type: 'longtask', buffered: true })
  publishSummary()
  return true
}

export function stopRendererLongTaskObserver(): void {
  observer?.disconnect()
  observer = null
}
