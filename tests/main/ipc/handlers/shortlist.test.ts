/**
 * Tests for the `variants:shortlist` IPC handler.
 *
 * Wave 3, Task 3 — validates:
 *   - Handler registers on the correct channel.
 *   - Valid params pass through to `ShortlistService.getShortlist`.
 *   - Invalid params fail at the Zod boundary (→ SerializableError via
 *     `wrapHandler`, carrying `ErrorCode.DB_ERROR` because Wave 2 maps
 *     validation failures to `DatabaseError` — no `ValidationError` class
 *     exists in this codebase).
 *   - Unknown tieBreaker sort keys are rejected by the service-layer
 *     allowlist check (spec §7, prevents SQL-injection via sort key).
 *   - Service errors propagate through `wrapHandler`.
 *
 * Strategy: mock `electron.ipcMain.handle` so we can invoke the registered
 * callback directly and assert both success (`ShortlistResult`) and failure
 * (`SerializableError`) shapes — the existing `wrapHandler` convention
 * catches thrown errors and returns a serialized error object rather than
 * re-throwing, so we test both shapes explicitly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

import { ipcMain } from 'electron'
import { registerShortlistHandlers } from '../../../../src/main/ipc/handlers/shortlist'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function makeMockService(overrides: Record<string, unknown> = {}): {
  getShortlist: ReturnType<typeof vi.fn>
} {
  return {
    getShortlist: vi.fn().mockReturnValue({
      rows: [],
      totalCandidates: 0,
      presetUsed: null,
      elapsedMs: 12
    }),
    ...overrides
  }
}

function makeDeps(service: { getShortlist: ReturnType<typeof vi.fn> }): {
  ipcMain: typeof ipcMain
  getDb: () => unknown
  getDbManager: () => unknown
} {
  const getDb = vi.fn().mockReturnValue({ shortlistService: service })
  const getDbManager = vi.fn().mockReturnValue({})
  return { ipcMain, getDb, getDbManager }
}

function getHandler(channel: string): HandlerCallback {
  const mockedHandle = ipcMain.handle as unknown as {
    mock: { calls: Array<[string, HandlerCallback]> }
  }
  const call = mockedHandle.mock.calls.find(([c]) => c === channel)
  if (!call) throw new Error(`Handler for ${channel} not registered`)
  return call[1]
}

async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = getHandler(channel)
  return handler({}, ...args)
}

describe('variants:shortlist handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the variants:shortlist channel', () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)
    expect(ipcMain.handle).toHaveBeenCalledWith('variants:shortlist', expect.any(Function))
  })

  it('passes presetId params through to service', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const result = await invokeHandler('variants:shortlist', { caseId: 1, presetId: 7 })

    expect(service.getShortlist).toHaveBeenCalledWith({ caseId: 1, presetId: 7 })
    expect(isIpcError(result)).toBe(false)
    expect(result).toMatchObject({
      rows: [],
      totalCandidates: 0,
      presetUsed: null
    })
  })

  it('passes adHocConfig params through to service', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const ok = {
      caseId: 2,
      adHocConfig: {
        baseFilters: {},
        topN: 25,
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }

    await invokeHandler('variants:shortlist', ok)

    expect(service.getShortlist).toHaveBeenCalledTimes(1)
    expect(service.getShortlist).toHaveBeenCalledWith(expect.objectContaining({ caseId: 2 }))
  })

  it('rejects topN > 500 at the Zod boundary', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const bad = {
      caseId: 1,
      adHocConfig: {
        baseFilters: {},
        topN: 999,
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }

    const result = await invokeHandler('variants:shortlist', bad)

    expect(isIpcError(result)).toBe(true)
    expect((result as { code: ErrorCode }).code).toBe(ErrorCode.DB_ERROR)
    expect((result as { message: string }).message).toMatch(/shortlist/i)
    expect(service.getShortlist).not.toHaveBeenCalled()
  })

  it('rejects caseId = 0', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const result = await invokeHandler('variants:shortlist', { caseId: 0, presetId: 1 })

    expect(isIpcError(result)).toBe(true)
    expect((result as { code: ErrorCode }).code).toBe(ErrorCode.DB_ERROR)
    expect(service.getShortlist).not.toHaveBeenCalled()
  })

  it('rejects unknown tieBreaker key (sort-key allowlist)', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const bad = {
      caseId: 1,
      adHocConfig: {
        baseFilters: {},
        topN: 10,
        tieBreakers: [{ key: 'bogus_field', order: 'desc' }],
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }

    const result = await invokeHandler('variants:shortlist', bad)

    expect(isIpcError(result)).toBe(true)
    expect((result as { message: string }).message).toMatch(/tiebreaker|bogus_field/i)
    expect(service.getShortlist).not.toHaveBeenCalled()
  })

  it('accepts a known tieBreaker key from the sort-column allowlist', async () => {
    const service = makeMockService()
    registerShortlistHandlers(makeDeps(service) as never)

    const ok = {
      caseId: 1,
      adHocConfig: {
        baseFilters: {},
        topN: 10,
        tieBreakers: [{ key: 'cadd', order: 'desc' }],
        rankConfig: {
          weights: { impact: 1, pathogenicity: 1, rarity: 1, clinvar: 1, phenotype: 0 }
        }
      }
    }

    const result = await invokeHandler('variants:shortlist', ok)

    expect(isIpcError(result)).toBe(false)
    expect(service.getShortlist).toHaveBeenCalledTimes(1)
  })

  it('propagates service errors through wrapHandler', async () => {
    const service = makeMockService({
      getShortlist: vi.fn().mockImplementation(() => {
        throw new Error('boom')
      })
    })
    registerShortlistHandlers(makeDeps(service) as never)

    const result = await invokeHandler('variants:shortlist', { caseId: 1, presetId: 1 })

    expect(isIpcError(result)).toBe(true)
    expect((result as { message: string }).message).toMatch(/boom/)
  })
})
