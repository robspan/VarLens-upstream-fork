/**
 * Tests for the `debug` IPC domain (Sprint A PR-2 B3, Gate 10c).
 *
 * The handlers are ALWAYS registered so the preload contract stays stable
 * across env configs; the runtime check on VARLENS_DEBUG_QUERY_COUNTERS
 * lives inside each handler body. These tests verify:
 *   - Both channels register.
 *   - Unset (or non-"1") env → safe-empty / disabled results; the
 *     query-counters module is NOT touched.
 *   - env="1" → live counter values flow through and reset is wired.
 *
 * Strategy: mock `electron.ipcMain.handle` to capture the registered
 * callbacks and invoke them directly (mirrors the shortlist handler test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

const getCounters = vi.fn()
const resetCounters = vi.fn()
vi.mock('../../../../src/main/storage/postgres/query-counters', () => ({
  getCounters: (...args: unknown[]) => getCounters(...args),
  resetCounters: (...args: unknown[]) => resetCounters(...args)
}))

import { ipcMain } from 'electron'
import { registerDebugHandlers } from '../../../../src/main/ipc/domains/debug'
import { DEBUG_CHANNELS } from '../../../../src/shared/ipc/domains/debug'

type HandlerCallback = (event: unknown, ...args: unknown[]) => Promise<unknown>

function getHandler(channel: string): HandlerCallback {
  const mockedHandle = ipcMain.handle as unknown as {
    mock: { calls: Array<[string, HandlerCallback]> }
  }
  const call = mockedHandle.mock.calls.find(([c]) => c === channel)
  if (!call) throw new Error(`No handler registered for channel: ${channel}`)
  return call[1]
}

const ENV_KEY = 'VARLENS_DEBUG_QUERY_COUNTERS'

describe('debug IPC domain', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY]
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = originalEnv
  })

  it('registers both query-counter channels', () => {
    registerDebugHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith(
      DEBUG_CHANNELS.queryCountersGet,
      expect.any(Function)
    )
    expect(ipcMain.handle).toHaveBeenCalledWith(
      DEBUG_CHANNELS.queryCountersReset,
      expect.any(Function)
    )
  })

  it('returns safe-empty disabled result when env is unset and never reads counters', async () => {
    delete process.env[ENV_KEY]
    registerDebugHandlers()

    const get = getHandler(DEBUG_CHANNELS.queryCountersGet)
    await expect(get({})).resolves.toEqual({ named: {}, unnamed: 0, enabled: false })
    expect(getCounters).not.toHaveBeenCalled()
  })

  it('returns disabled reset result when env is unset and never resets counters', async () => {
    delete process.env[ENV_KEY]
    registerDebugHandlers()

    const reset = getHandler(DEBUG_CHANNELS.queryCountersReset)
    await expect(reset({})).resolves.toEqual({ enabled: false })
    expect(resetCounters).not.toHaveBeenCalled()
  })

  it('returns disabled result for any value other than "1"', async () => {
    process.env[ENV_KEY] = 'true'
    registerDebugHandlers()

    const get = getHandler(DEBUG_CHANNELS.queryCountersGet)
    await expect(get({})).resolves.toEqual({ named: {}, unnamed: 0, enabled: false })
    expect(getCounters).not.toHaveBeenCalled()
  })

  it('returns live counters with enabled:true when env="1"', async () => {
    process.env[ENV_KEY] = '1'
    getCounters.mockReturnValue({ named: { stmt_a: 3 }, unnamed: 1 })
    registerDebugHandlers()

    const get = getHandler(DEBUG_CHANNELS.queryCountersGet)
    await expect(get({})).resolves.toEqual({
      named: { stmt_a: 3 },
      unnamed: 1,
      enabled: true
    })
    expect(getCounters).toHaveBeenCalledTimes(1)
  })

  it('resets counters with enabled:true when env="1"', async () => {
    process.env[ENV_KEY] = '1'
    registerDebugHandlers()

    const reset = getHandler(DEBUG_CHANNELS.queryCountersReset)
    await expect(reset({})).resolves.toEqual({ enabled: true })
    expect(resetCounters).toHaveBeenCalledTimes(1)
  })
})
