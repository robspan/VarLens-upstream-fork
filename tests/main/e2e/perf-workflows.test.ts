import { describe, expect, it } from 'vitest'
import {
  PERF_WORKFLOW_NAMES,
  getPerfWorkflowNames,
  getPerfOutputRoot,
  getPerfWorkflowCommand
} from '../../../tests/e2e/helpers/perf-workflows'

describe('perf-workflows helper', () => {
  it('returns all workflow names when no filter is set', () => {
    expect(getPerfWorkflowNames(undefined)).toEqual(PERF_WORKFLOW_NAMES)
  })

  it('returns only explicitly selected workflows in canonical order', () => {
    expect(getPerfWorkflowNames('filter-apply,keyboard-nav-burst')).toEqual([
      'filter-apply',
      'keyboard-nav-burst'
    ])
  })

  it('rejects unknown workflow names', () => {
    expect(() => getPerfWorkflowNames('filter-apply,nope')).toThrow(/Unknown perf workflow/)
  })

  it('builds the manifest command from the active output root', () => {
    expect(getPerfOutputRoot('/tmp/perf-debug')).toBe('/tmp/perf-debug')
    expect(getPerfWorkflowCommand('/tmp/perf-debug')).toContain(
      'VARLENS_PERF_OUTPUT=/tmp/perf-debug'
    )
  })
})
