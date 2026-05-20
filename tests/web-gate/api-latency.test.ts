import { describe, expect, test } from 'vitest'

import { resolveDevApiLatencyMs } from '../../src/web/server/dispatcher'

describe('web dev API latency knob', () => {
  test('is disabled outside development even when configured', () => {
    expect(
      resolveDevApiLatencyMs({
        NODE_ENV: 'production',
        VARLENS_WEB_API_LATENCY_MS: '75'
      } as NodeJS.ProcessEnv)
    ).toBe(0)
    expect(
      resolveDevApiLatencyMs({
        NODE_ENV: 'test',
        VARLENS_WEB_API_LATENCY_MS: '75'
      } as NodeJS.ProcessEnv)
    ).toBe(0)
  })

  test('uses the configured delay in development', () => {
    expect(
      resolveDevApiLatencyMs({
        NODE_ENV: 'development',
        VARLENS_WEB_API_LATENCY_MS: '75'
      } as NodeJS.ProcessEnv)
    ).toBe(75)
  })

  test('fails loud on invalid development values', () => {
    expect(() =>
      resolveDevApiLatencyMs({
        NODE_ENV: 'development',
        VARLENS_WEB_API_LATENCY_MS: '-1'
      } as NodeJS.ProcessEnv)
    ).toThrow(/VARLENS_WEB_API_LATENCY_MS/)
  })
})
