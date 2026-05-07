import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  USER_ROLES
} from '../../../src/shared/auth/auth-constants'

/**
 * Phase 2 deliverable #6: structural parity assertions.
 *
 * Phase 1 left these scenarios as `describe.skip` placeholders pending
 * the auth provider abstraction. With Phase 2 they become **structural
 * parity** assertions: the desktop SQLite AuthService and the web-only
 * PostgresWebAuthService must share policy (auth-constants module),
 * mirror surface (method-for-method), and be co-tested in their own
 * unit suites. True behavioural parity (boot both runtimes, drive both
 * transports, compare outputs) lives behind VARLENS_RUN_WEB_GATE_PARITY
 * and requires Electron — that's Layer 3 work documented in
 * `.planning/web/testing/desktop-to-web-parity.md`.
 *
 * The structural gate has caught real divergence (Step 1's BOOLEAN-vs-
 * INTEGER row mapping, Step 2's role-enum drift, Step 3's regex-coupled
 * AdminAlreadyExistsError) — it is the right resolution for Phase 2.
 * Stage 3 will re-enable runtime parity once the Electron-in-CI
 * harness exists.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const SQLITE_AUTH_SERVICE = resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts')
const POSTGRES_AUTH_SERVICE = resolve(REPO_ROOT, 'src/web/auth/PostgresWebAuthService.ts')
const POSTGRES_AUTH_TEST = resolve(
  REPO_ROOT,
  'tests/main/web/auth/postgres-web-auth-service.test.ts'
)
const SHARED_CONSTANTS = resolve(REPO_ROOT, 'src/shared/auth/auth-constants.ts')

function readSrc(path: string): string {
  if (!existsSync(path)) throw new Error(`Required file missing: ${path}`)
  return readFileSync(path, 'utf8')
}

const sqliteSrc = readSrc(SQLITE_AUTH_SERVICE)
const pgSrc = readSrc(POSTGRES_AUTH_SERVICE)
const pgTestSrc = readSrc(POSTGRES_AUTH_TEST)
const sharedSrc = readSrc(SHARED_CONSTANTS)

describe('parity (auth): password login creates a session and returns user identity', () => {
  test('both backends implement authenticate() with matching return shape', () => {
    expect(sqliteSrc).toMatch(/async authenticate\(/)
    expect(pgSrc).toMatch(/async authenticate\(/)
    // Both return { success, user, locked?, mustChangePassword? }.
    for (const src of [sqliteSrc, pgSrc]) {
      expect(src).toMatch(/success:\s*(true|false|boolean)/)
      expect(src).toMatch(/locked\?:\s*boolean/)
      expect(src).toMatch(/mustChangePassword\?:\s*boolean/)
    }
  })

  test('PostgresWebAuthService unit tests cover the happy path', () => {
    expect(pgTestSrc).toMatch(/returns success: true with safeUser/i)
    expect(pgTestSrc).toMatch(/returns success: false for unknown username/i)
  })

  test('password_hash never appears in the safeUser projection', () => {
    expect(pgSrc).toMatch(/password_hash:\s*_hash/)
    expect(sqliteSrc).toMatch(/password_hash:\s*_hash/)
  })
})

describe('parity (auth): repeated bad passwords trigger lockout consistently', () => {
  test('both backends source MAX_FAILED_ATTEMPTS from the shared constants module', () => {
    for (const src of [sqliteSrc, pgSrc]) {
      expect(src).toMatch(/MAX_FAILED_ATTEMPTS/)
      expect(src).toMatch(/from\s+['"][^'"]*auth-constants['"]/)
    }
    // Concrete numeric value pinned in shared module.
    expect(MAX_FAILED_ATTEMPTS).toBe(5)
    expect(LOCKOUT_DURATION_MINUTES).toBe(15)
    expect(sharedSrc).toMatch(/MAX_FAILED_ATTEMPTS\s*=\s*5/)
    expect(sharedSrc).toMatch(/LOCKOUT_DURATION_MINUTES\s*=\s*15/)
  })

  test('PostgresWebAuthService uses atomic UPDATE+CASE (no race window)', () => {
    // Step 3 QA fix: read-modify-write pattern was racy under pg.Pool
    // concurrency. Locking SQL must increment server-side via
    // `failed_login_count + 1` and compute lockout via CASE.
    expect(pgSrc).toMatch(/failed_login_count\s*=\s*failed_login_count\s*\+\s*1/)
    expect(pgSrc).toMatch(/CASE\s+WHEN[\s\S]+failed_login_count\s*\+\s*1\s*>=/i)
  })

  test('PostgresWebAuthService unit tests cover lockout', () => {
    expect(pgTestSrc).toMatch(/atomic UPDATE\+CASE on failed login/i)
    expect(pgTestSrc).toMatch(/locked: true when locked_until is in the future/i)
  })
})

describe('parity (auth): multi-user isolation — user A cannot see user B data', () => {
  // Per ADR-0003 + the user-id-schema web-gate sentinel, multi-user
  // isolation is Stage 3 work (per-tenant schema, every domain table
  // gains user_id NOT NULL DEFAULT 1). Phase 2 ships single-tenant
  // Postgres; the auth surface itself is multi-user-ready (createUser,
  // role enum, password rotation), but data-row scoping isn't.
  //
  // The structural assertion here: USER_ROLES must enumerate exactly
  // the roles that the migrations CHECK constraints know about. The
  // auth-constants test gates this end-to-end; we re-state it here so
  // a reader of this file sees the contract without chasing.
  test('USER_ROLES is shared, two-element enum (admin, user)', () => {
    expect(new Set(USER_ROLES)).toEqual(new Set(['admin', 'user']))
  })

  test.skip('Stage 3: row-level isolation against per-tenant schemas (deferred to user-id-schema gate)', () => {
    // Activate when tests/web-gate/user-id-schema.test.ts flips green.
  })
})

describe('parity (auth): session expiry / refresh token behavior', () => {
  // Sessions are not implemented in Phase 2. The web /api/auth/login
  // endpoint returns the user identity payload but does not issue a
  // server-side session cookie or token. Cookie/session lifecycle is
  // explicitly Stage 3 / OIDC retrofit per phase2-execution-plan.md
  // §"Out of scope".
  test('login response shape contains no session/token fields (sessions are Stage 3)', () => {
    // Both AuthService and PostgresWebAuthService return { success,
    // user, mustChangePassword? }; neither carries session_id, token,
    // exp, etc. If a future commit accidentally adds these without
    // also wiring the storage + expiry path, this assertion catches it.
    for (const src of [sqliteSrc, pgSrc]) {
      expect(src, 'AuthResult must not declare session_id').not.toMatch(/session_id/i)
      expect(src, 'AuthResult must not declare token field').not.toMatch(/^\s+token:/im)
      expect(src, 'AuthResult must not declare exp/expires field').not.toMatch(
        /^\s+(exp|expires):/im
      )
    }
  })

  test.skip('Stage 3: session expiry behaviour parity (deferred until sessions ship)', () => {
    // Activate when the session/cookie layer lands. The Credential
    // discriminated-union ({kind:'password'} | {kind:'token'}) at
    // src/main/auth/types.ts is the seam this will hook into.
  })
})
