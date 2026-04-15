import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

const WORKFLOWS = [
  'startup-shell',
  'case-select-visible-rows',
  'filter-apply',
  'page-next-prev',
  'cohort-toggle',
  'keyboard-nav-burst'
] as const

type WorkflowName = (typeof WORKFLOWS)[number]

type WorkflowSummary = {
  p50Ms: number
  p95Ms: number
  medianLongTaskCount: number
  maxSingleLongTaskMs: number
  measuredRuns: number
}

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'compare-phase1-'))
  tempDirs.push(dir)
  return dir
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function seedArtifactRoot(
  root: string,
  summaries: Record<WorkflowName, WorkflowSummary>,
  commandLabel: string
): void {
  writeJson(join(root, 'run-manifest.json'), {
    gitSha: `${commandLabel}-sha`,
    commands: [commandLabel]
  })

  for (const workflow of WORKFLOWS) {
    writeJson(join(root, 'workflows', workflow, 'summary.json'), summaries[workflow])
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('compare-phase1', () => {
  it('compares baseline and post-change summaries without changing workflow order or schema', async () => {
    const baselineRoot = join(makeTempDir(), 'baseline')
    const postChangeRoot = join(makeTempDir(), 'post-change')

    seedArtifactRoot(
      baselineRoot,
      {
        'startup-shell': {
          p50Ms: 877.8,
          p95Ms: 997.74,
          medianLongTaskCount: 1,
          maxSingleLongTaskMs: 93,
          measuredRuns: 10
        },
        'case-select-visible-rows': {
          p50Ms: 947.11,
          p95Ms: 968.4,
          medianLongTaskCount: 2,
          maxSingleLongTaskMs: 78,
          measuredRuns: 10
        },
        'filter-apply': {
          p50Ms: 812.26,
          p95Ms: 840.52,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 61,
          measuredRuns: 10
        },
        'page-next-prev': {
          p50Ms: 639.49,
          p95Ms: 739.75,
          medianLongTaskCount: 1,
          maxSingleLongTaskMs: 195,
          measuredRuns: 10
        },
        'cohort-toggle': {
          p50Ms: 202.24,
          p95Ms: 243.18,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 0,
          measuredRuns: 10
        },
        'keyboard-nav-burst': {
          p50Ms: 73.76,
          p95Ms: 83.05,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 0,
          measuredRuns: 10
        }
      },
      'baseline-command'
    )

    seedArtifactRoot(
      postChangeRoot,
      {
        'startup-shell': {
          p50Ms: 815.38,
          p95Ms: 1145.55,
          medianLongTaskCount: 1,
          maxSingleLongTaskMs: 89,
          measuredRuns: 10
        },
        'case-select-visible-rows': {
          p50Ms: 964.51,
          p95Ms: 1010.43,
          medianLongTaskCount: 2,
          maxSingleLongTaskMs: 93,
          measuredRuns: 10
        },
        'filter-apply': {
          p50Ms: 824.22,
          p95Ms: 907.81,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 59,
          measuredRuns: 10
        },
        'page-next-prev': {
          p50Ms: 612.04,
          p95Ms: 685.02,
          medianLongTaskCount: 1,
          maxSingleLongTaskMs: 174,
          measuredRuns: 10
        },
        'cohort-toggle': {
          p50Ms: 212.88,
          p95Ms: 240.44,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 0,
          measuredRuns: 10
        },
        'keyboard-nav-burst': {
          p50Ms: 71.37,
          p95Ms: 79.07,
          medianLongTaskCount: 0,
          maxSingleLongTaskMs: 0,
          measuredRuns: 10
        }
      },
      'post-change-command'
    )

    const { comparePhase1, renderMarkdownReport } =
      await import('../../../scripts/perf/compare-phase1.mjs')
    const result = comparePhase1(baselineRoot, postChangeRoot)
    const markdown = renderMarkdownReport(result)

    expect(result.workflows.map((entry: { workflow: string }) => entry.workflow)).toEqual(WORKFLOWS)
    expect(result.workflows[0]).toMatchObject({
      workflow: 'startup-shell',
      baseline: {
        p50Ms: 877.8,
        p95Ms: 997.74,
        medianLongTaskCount: 1,
        maxSingleLongTaskMs: 93,
        measuredRuns: 10
      },
      postChange: {
        p50Ms: 815.38,
        p95Ms: 1145.55,
        medianLongTaskCount: 1,
        maxSingleLongTaskMs: 89,
        measuredRuns: 10
      }
    })
    expect(result.workflows[3].deltas).toEqual({
      p50Ms: -27.45,
      p95Ms: -54.73,
      medianLongTaskCount: 0,
      maxSingleLongTaskMs: -21,
      measuredRuns: 0
    })
    expect(result.summary.regressions).toEqual([
      'case-select-visible-rows',
      'filter-apply',
      'cohort-toggle'
    ])
    expect(result.summary.improvements).toEqual([
      'startup-shell',
      'page-next-prev',
      'keyboard-nav-burst'
    ])
    expect(markdown).toContain('# Phase 1 Performance Comparison')
    expect(markdown).toContain('| startup-shell | 877.80 | 815.38 | -62.42 |')
    expect(markdown).toContain('case-select-visible-rows, filter-apply, cohort-toggle')
    expect(markdown).toContain('page-next-prev, keyboard-nav-burst')
    expect(markdown).toContain('summary.json')
  })
})
