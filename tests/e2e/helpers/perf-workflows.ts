export const PERF_WORKFLOW_NAMES = [
  'startup-shell',
  'case-select-visible-rows',
  'filter-apply',
  'page-next-prev',
  'cohort-toggle',
  'keyboard-nav-burst'
] as const

export type PerfWorkflowName = (typeof PERF_WORKFLOW_NAMES)[number]

export function getPerfWorkflowNames(
  selectedValue = process.env.VARLENS_PERF_WORKFLOWS
): PerfWorkflowName[] {
  if (!selectedValue || selectedValue.trim() === '') {
    return [...PERF_WORKFLOW_NAMES]
  }

  const requested = selectedValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const unknown = requested.filter(
    (entry): entry is string => !PERF_WORKFLOW_NAMES.includes(entry as PerfWorkflowName)
  )
  if (unknown.length > 0) {
    throw new Error(
      `Unknown perf workflow(s): ${unknown.join(', ')}. Expected one of: ${PERF_WORKFLOW_NAMES.join(', ')}`
    )
  }

  return PERF_WORKFLOW_NAMES.filter((workflow) => requested.includes(workflow))
}

export function getPerfOutputRoot(
  outputRoot = process.env.VARLENS_PERF_OUTPUT ?? '.planning/artifacts/perf/phase1/baseline'
): string {
  return outputRoot
}

export function getPerfWorkflowCommand(outputRoot = getPerfOutputRoot()): string {
  const workflowSelection = process.env.VARLENS_PERF_WORKFLOWS?.trim()
  const workflowEnv = workflowSelection
    ? `VARLENS_PERF_WORKFLOWS=${workflowSelection} `
    : ''

  return `VARLENS_PERF_OUTPUT=${outputRoot} ${workflowEnv}npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts --workers=1`
}
