import { describe, expect, test } from 'vitest'

/**
 * Phase 1 gate — auth parity placeholders.
 *
 * Auth scenarios are deferred per `.planning/web/testing/desktop-to-web-parity.md`:
 * the §app2.1 plan calls for parity coverage of password login, lockout,
 * multi-user isolation, and session expiry, but these depend on the auth
 * abstraction (`tests/web-gate/auth-isolation.test.ts` is red until the
 * argon2 migration lands behind `src/main/auth/providers/`).
 *
 * Until then this file holds visible placeholders so the deferred work is
 * discoverable inside the suite, not just inside a planning doc. Each
 * placeholder documents the scenario it will eventually run; flipping
 * `describe.skip` → `describe` is the trigger to wire each up.
 *
 * Trigger to activate: the auth provider interface lands and
 * `auth-isolation.test.ts` flips green.
 */

describe.skip('parity (auth): password login creates a session and returns user identity', () => {
  test('Electron + web paths return the same normalized session shape', () => {
    expect(true).toBe(true)
  })
})

describe.skip('parity (auth): repeated bad passwords trigger lockout consistently', () => {
  test('Both transports lock the account after the same number of attempts', () => {
    expect(true).toBe(true)
  })
})

describe.skip('parity (auth): multi-user isolation — user A cannot see user B data', () => {
  test('listCases / variants.query scoped by user_id on both transports', () => {
    expect(true).toBe(true)
  })
})

describe.skip('parity (auth): session expiry / refresh token behavior', () => {
  test('Same expiry semantics on Electron IPC and web HTTP transports', () => {
    expect(true).toBe(true)
  })
})
