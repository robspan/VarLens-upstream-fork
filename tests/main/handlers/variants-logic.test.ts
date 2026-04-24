/**
 * Variants logic smoke tests — verifies module exports are intact after extraction.
 */

import { describe, it, expect, vi } from 'vitest'
import * as logic from '../../../src/main/ipc/handlers/variants-logic'
import {
  buildVariantFilter,
  getVariantTypeCounts,
  queryVariants,
  searchVariants
} from '../../../src/main/ipc/handlers/variants-logic'

describe('variants-logic exports', () => {
  it('exports expected functions', () => {
    expect(typeof logic.buildVariantFilter).toBe('function')
    expect(typeof logic.queryVariants).toBe('function')
    expect(typeof logic.getFilterOptions).toBe('function')
    expect(typeof logic.searchVariants).toBe('function')
    expect(typeof logic.getGeneSymbols).toBe('function')
  })

  it('routes typeCounts through the active storage session read executor', async () => {
    const execute = vi.fn().mockResolvedValue({ snv: 2 })
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await expect(getVariantTypeCounts(1, getSession)).resolves.toStrictEqual({ snv: 2 })
    expect(execute).toHaveBeenCalledWith({ type: 'variants:typeCounts', params: [1] })
  })

  it('routes query through the active storage session read executor', async () => {
    const execute = vi.fn().mockResolvedValue({ data: [], total_count: 0 })
    const getSession = () => ({ getReadExecutor: () => ({ execute }) }) as never

    await queryVariants({ case_id: 1 }, 25, 0, undefined, false, false, getSession)

    expect(execute).toHaveBeenCalledWith({
      type: 'variants:query',
      params: [{ case_id: 1 }, 25, 0, undefined, false, false]
    })
  })

  it('does not call getDb while preparing postgres active panel filters', () => {
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called for postgres panel rejection')
    })
    const getSession = () =>
      ({
        capabilities: { backend: 'postgres' }
      }) as never

    expect(
      buildVariantFilter(
        1,
        { active_panel_ids: [1], panel_padding_bp: 50 },
        getDb,
        undefined,
        getSession
      )
    ).toMatchObject({
      case_id: 1,
      active_panel_ids: [1],
      panel_padding_bp: 50
    })
    expect(getDb).not.toHaveBeenCalled()
  })

  it('fails variants:search clearly on postgres instead of calling getDb', async () => {
    const getDb = vi.fn(() => {
      throw new Error('getDb should not be called for postgres search rejection')
    })
    const getSession = () =>
      ({
        capabilities: { backend: 'postgres' }
      }) as never

    await expect(searchVariants(1, 'BRCA1', 20, getSession, getDb)).rejects.toThrow(
      'PostgreSQL variants:search is deferred from Phase 7'
    )
    expect(getDb).not.toHaveBeenCalled()
  })
})
