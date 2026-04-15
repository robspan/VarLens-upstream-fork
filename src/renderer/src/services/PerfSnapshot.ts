import type { MainPerfSnapshot, PerfSnapshot } from '../../../shared/types/perf'
import { getTraceSnapshot, resetPerfSnapshot } from './PerfTrace'

export function buildPerfSnapshot(main: MainPerfSnapshot): PerfSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    main,
    renderer: getTraceSnapshot()
  }
}

export function resetRendererPerfSnapshot(): void {
  resetPerfSnapshot()
}
