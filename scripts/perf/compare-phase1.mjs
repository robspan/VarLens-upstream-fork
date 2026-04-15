import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

export const WORKFLOWS = [
  'startup-shell',
  'case-select-visible-rows',
  'filter-apply',
  'page-next-prev',
  'cohort-toggle',
  'keyboard-nav-burst'
]

const SUMMARY_KEYS = [
  'p50Ms',
  'p95Ms',
  'medianLongTaskCount',
  'maxSingleLongTaskMs',
  'measuredRuns'
]

function roundToHundredths(value) {
  return Math.round(value * 100) / 100
}

function formatNumber(value) {
  return value.toFixed(2)
}

function formatDelta(value) {
  const rounded = roundToHundredths(value)
  return rounded >= 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2)
}

function classifyP50(deltaMs) {
  if (deltaMs < 0) return 'improved'
  if (deltaMs > 0) return 'regressed'
  return 'unchanged'
}

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validateSummary(path, summary) {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error(`Expected summary object at ${path}`)
  }

  const keys = Object.keys(summary).sort()
  const expectedKeys = [...SUMMARY_KEYS].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      `Unexpected summary schema at ${path}. Expected keys ${expectedKeys.join(', ')} but found ${keys.join(', ')}`
    )
  }

  for (const key of SUMMARY_KEYS) {
    if (typeof summary[key] !== 'number' || Number.isNaN(summary[key])) {
      throw new Error(`Expected numeric ${key} in ${path}`)
    }
  }

  return summary
}

function readWorkflowSummary(root, workflow) {
  const path = resolve(root, 'workflows', workflow, 'summary.json')
  return validateSummary(path, parseJsonFile(path))
}

function readManifest(root) {
  return parseJsonFile(resolve(root, 'run-manifest.json'))
}

function buildWorkflowComparison(workflow, baseline, postChange) {
  const deltas = {
    p50Ms: roundToHundredths(postChange.p50Ms - baseline.p50Ms),
    p95Ms: roundToHundredths(postChange.p95Ms - baseline.p95Ms),
    medianLongTaskCount: roundToHundredths(
      postChange.medianLongTaskCount - baseline.medianLongTaskCount
    ),
    maxSingleLongTaskMs: roundToHundredths(
      postChange.maxSingleLongTaskMs - baseline.maxSingleLongTaskMs
    ),
    measuredRuns: roundToHundredths(postChange.measuredRuns - baseline.measuredRuns)
  }

  return {
    workflow,
    classification: classifyP50(deltas.p50Ms),
    baseline,
    postChange,
    deltas
  }
}

function buildSummary(workflows) {
  const improvements = workflows
    .filter((entry) => entry.classification === 'improved')
    .map((entry) => entry.workflow)
  const regressions = workflows
    .filter((entry) => entry.classification === 'regressed')
    .map((entry) => entry.workflow)
  const unchanged = workflows
    .filter((entry) => entry.classification === 'unchanged')
    .map((entry) => entry.workflow)

  return {
    improvements,
    regressions,
    unchanged
  }
}

export function comparePhase1(baselineRoot, postChangeRoot) {
  const baselinePath = resolve(baselineRoot)
  const postChangePath = resolve(postChangeRoot)
  const baselineManifest = readManifest(baselinePath)
  const postChangeManifest = readManifest(postChangePath)

  const workflows = WORKFLOWS.map((workflow) => {
    return buildWorkflowComparison(
      workflow,
      readWorkflowSummary(baselinePath, workflow),
      readWorkflowSummary(postChangePath, workflow)
    )
  })

  return {
    generatedAt: new Date().toISOString(),
    baselineRoot: baselinePath,
    postChangeRoot: postChangePath,
    baselineManifest,
    postChangeManifest,
    workflows,
    summary: buildSummary(workflows)
  }
}

function renderCommandList(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return '_No commands recorded._'
  }

  return commands.map((command) => `- \`${command}\``).join('\n')
}

function renderWorkflowRow(entry) {
  return `| ${entry.workflow} | ${formatNumber(entry.baseline.p50Ms)} | ${formatNumber(entry.postChange.p50Ms)} | ${formatDelta(entry.deltas.p50Ms)} | ${formatNumber(entry.baseline.p95Ms)} | ${formatNumber(entry.postChange.p95Ms)} | ${formatDelta(entry.deltas.p95Ms)} | ${formatNumber(entry.baseline.medianLongTaskCount)} | ${formatNumber(entry.postChange.medianLongTaskCount)} | ${formatDelta(entry.deltas.medianLongTaskCount)} | ${formatNumber(entry.baseline.maxSingleLongTaskMs)} | ${formatNumber(entry.postChange.maxSingleLongTaskMs)} | ${formatDelta(entry.deltas.maxSingleLongTaskMs)} | ${entry.baseline.measuredRuns} | ${entry.postChange.measuredRuns} |`
}

export function renderMarkdownReport(result) {
  const regressionText =
    result.summary.regressions.length > 0 ? result.summary.regressions.join(', ') : 'none'
  const improvementText =
    result.summary.improvements.length > 0 ? result.summary.improvements.join(', ') : 'none'
  const unchangedText =
    result.summary.unchanged.length > 0 ? result.summary.unchanged.join(', ') : 'none'

  return `# Phase 1 Performance Comparison

Baseline artifacts: \`${result.baselineRoot}\`
Post-change artifacts: \`${result.postChangeRoot}\`
Machine-readable diff: \`comparison/summary.json\`

## Run Context

Baseline git SHA: \`${result.baselineManifest.gitSha ?? 'unknown'}\`
Post-change git SHA: \`${result.postChangeManifest.gitSha ?? 'unknown'}\`

Baseline commands:
${renderCommandList(result.baselineManifest.commands)}

Post-change commands:
${renderCommandList(result.postChangeManifest.commands)}

## Workflow Summary

| Workflow | Baseline p50 | Post-change p50 | Delta p50 | Baseline p95 | Post-change p95 | Delta p95 | Baseline median LT count | Post-change median LT count | Delta median LT count | Baseline max LT | Post-change max LT | Delta max LT | Baseline runs | Post-change runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${result.workflows.map(renderWorkflowRow).join('\n')}

## Readout

- Regressions by p50: ${regressionText}
- Improvements by p50: ${improvementText}
- Unchanged by p50: ${unchangedText}
- Manual read remains important for mixed cases where p50 and p95 move in opposite directions.
`
}

function inferComparisonJsonPath(baselineRoot, postChangeRoot) {
  const baselineParent = dirname(resolve(baselineRoot))
  const postChangeParent = dirname(resolve(postChangeRoot))
  const comparisonParent = baselineParent === postChangeParent ? baselineParent : process.cwd()

  return join(comparisonParent, 'comparison', 'summary.json')
}

export function writeComparisonJson(result, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return targetPath
}

function main(argv) {
  if (argv.length !== 2) {
    globalThis.console.error(
      'Usage: node scripts/perf/compare-phase1.mjs <baseline-dir> <post-change-dir>'
    )
    process.exitCode = 1
    return
  }

  const [baselineRoot, postChangeRoot] = argv
  const result = comparePhase1(baselineRoot, postChangeRoot)
  writeComparisonJson(result, inferComparisonJsonPath(baselineRoot, postChangeRoot))
  process.stdout.write(renderMarkdownReport(result))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}
