import { describe, expect, test } from 'vitest'

import { isAllowedApiOrigin } from '../../src/web/server/auth'

describe('web auth origin gate', () => {
  test('rejects missing Origin for unsafe API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: undefined,
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })

  test('allows same-origin API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: 'https://varlens.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(true)
  })

  test('rejects cross-origin and protocol-downgrade API requests', () => {
    expect(
      isAllowedApiOrigin({
        origin: 'https://evil.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
    expect(
      isAllowedApiOrigin({
        origin: 'http://varlens.example',
        host: 'varlens.example',
        protocol: 'https'
      })
    ).toBe(false)
  })
})
