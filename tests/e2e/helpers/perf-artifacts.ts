import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'

export interface WorkflowRunArtifact {
  runIndex: number
  warmup: boolean
  durationMs: number
  longTaskCount: number
  maxSingleLongTaskMs: number
}

export function getPerfOutputRoot(): string {
  return resolve(process.env.VARLENS_PERF_OUTPUT ?? '.planning/artifacts/perf/phase1/baseline')
}

export function writeJsonArtifact(relativePath: string, data: unknown): string {
  const targetPath = resolve(getPerfOutputRoot(), relativePath)
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return targetPath
}

export function ensureArtifactDir(relativePath: string): string {
  const targetPath = resolve(getPerfOutputRoot(), relativePath)
  mkdirSync(targetPath, { recursive: true })
  return targetPath
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1)
  return sortedValues[index]
}

function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0
  const mid = Math.floor(sortedValues.length / 2)
  if (sortedValues.length % 2 === 0) {
    return (sortedValues[mid - 1] + sortedValues[mid]) / 2
  }
  return sortedValues[mid]
}

export function summarizeWorkflowRuns(runs: WorkflowRunArtifact[]): {
  p50Ms: number
  p95Ms: number
  medianLongTaskCount: number
  maxSingleLongTaskMs: number
  measuredRuns: number
} {
  const measuredRuns = runs.filter((run) => !run.warmup)
  const durations = measuredRuns.map((run) => run.durationMs).sort((a, b) => a - b)
  const longTaskCounts = measuredRuns.map((run) => run.longTaskCount).sort((a, b) => a - b)

  return {
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    medianLongTaskCount: median(longTaskCounts),
    maxSingleLongTaskMs: measuredRuns.reduce(
      (maxValue, run) => Math.max(maxValue, run.maxSingleLongTaskMs),
      0
    ),
    measuredRuns: measuredRuns.length
  }
}
