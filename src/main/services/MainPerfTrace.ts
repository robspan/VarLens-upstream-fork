import { is } from '@electron-toolkit/utils'
import { mainLogger } from './MainLogger'
import type { MainPerfSnapshot } from '../../shared/types/perf'

const marks = new Map<string, number>()
const appStartTime = performance.now()

/** Record a named milestone relative to process start. Dev-only. */
export function markMilestone(name: string): void {
  if (!is.dev) return
  const elapsed = Math.round((performance.now() - appStartTime) * 100) / 100
  marks.set(name, elapsed)
  mainLogger.info(`[perf] ${name}: ${elapsed}ms from start`, 'perf')
}

/** Get time elapsed since process start. */
export function getElapsedMs(): number {
  return Math.round((performance.now() - appStartTime) * 100) / 100
}

/** Get all recorded milestones. */
export function getMilestones(): ReadonlyMap<string, number> {
  return marks
}

export function getMainPerfSnapshot(): MainPerfSnapshot {
  return {
    elapsedMs: getElapsedMs(),
    milestones: Object.fromEntries(marks.entries())
  }
}
