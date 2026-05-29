import type { IpcResult } from '../../types/errors'

export interface QueryCountersResult {
  /** Per effective prepared-statement name → execution count. */
  named: Record<string, number>
  /** Total executions that went through the unnamed code path. */
  unnamed: number
  /**
   * True when VARLENS_DEBUG_QUERY_COUNTERS=1. False means the handler
   * intentionally returned safe-empty values; the channel is always wired
   * so the preload contract is stable.
   */
  enabled: boolean
}

export interface DebugApi {
  /** `debug:queryCounters:get` — returns the current named/unnamed counts. */
  queryCountersGet: () => Promise<IpcResult<QueryCountersResult>>
  /** `debug:queryCounters:reset` — zeroes the counters. */
  queryCountersReset: () => Promise<IpcResult<{ enabled: boolean }>>
}

export const DEBUG_CHANNELS = {
  queryCountersGet: 'debug:queryCounters:get',
  queryCountersReset: 'debug:queryCounters:reset'
} as const
