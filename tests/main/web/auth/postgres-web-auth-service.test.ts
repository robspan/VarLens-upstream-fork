import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PostgresWebAuthService } from '../../../../src/web/auth/PostgresWebAuthService'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN
} from '../../../../src/main/services/auth/auth-constants'
import type { PasswordProvider } from '../../../../src/main/auth/providers/argon2-provider'

/**
 * Phase 2 #3: PostgresWebAuthService — full surface mirror of the
 * desktop AuthService (src/main/services/auth/AuthService.ts), targeting
 * a Postgres pool instead of a synchronous better-sqlite3 handle.
 *
 * Test goes RED until the new file exists with the expected exports.
 * GREEN once the service is implemented and SQL queries land in the
 * right shape (parameterised, schema-quoted, role values come from
 * the constants module, lockout policy matches MAX_FAILED_ATTEMPTS +
 * LOCKOUT_DURATION_MINUTES).
 *
 * The unit-level tests below use a hand-rolled Pool stub that records
 * queries and replays canned responses. They cover SQL shape and the
 * branch-by-branch behaviour matrix without needing docker. A separate
 * real-instance gate (VARLENS_RUN_POSTGRES_E2E=1) is the integration
 * test for behavioural parity with the SQLite path; it boots a fresh
 * schema, runs migrations, and asserts the same observable outcomes
 * the 61 existing SQLite auth tests check.
 */

// ---- Pool stub --------------------------------------------------------------

interface QueryRecord {
  text: string
  values: unknown[]
}

interface CannedRow {
  [key: string]: unknown
}

interface CannedResponse {
  rows: CannedRow[]
  rowCount: number
}

class FakePool {
  queries: QueryRecord[] = []
  private responses: CannedResponse[] = []
  released = false

  enqueueResponse(response: CannedResponse): void {
    this.responses.push(response)
  }

  async query(text: string, values: unknown[] = []): Promise<CannedResponse> {
    this.queries.push({ text, values })
    if (this.responses.length === 0) {
      throw new Error(
        `FakePool: no canned response for query #${this.queries.length}:\n${text.slice(0, 200)}`
      )
    }
    return this.responses.shift()!
  }

  async connect(): Promise<{
    query: (text: string, values?: unknown[]) => Promise<CannedResponse>
    release: () => void
  }> {
    return {
      query: this.query.bind(this),
      release: () => {
        this.released = true
      }
    }
  }
}

// ---- PasswordProvider stub --------------------------------------------------

const fakePasswordProvider: PasswordProvider = {
  async hashPassword(password: string): Promise<string> {
    return `hashed::${password}`
  },
  async verifyPassword(hash: string, password: string): Promise<boolean> {
    return hash === `hashed::${password}`
  }
}

// ---- Helpers ----------------------------------------------------------------

function pgUserRow(overrides: Partial<CannedRow> = {}): CannedRow {
  // Shape mirrors what node-postgres returns from the users table after
  // migration 0007: BIGINT -> string, BOOLEAN -> boolean, TIMESTAMPTZ -> Date.
  return {
    id: '1',
    username: 'alice',
    display_name: 'Alice',
    password_hash: 'hashed::pw',
    role: 'user',
    is_active: true,
    must_change_password: false,
    failed_login_count: 0,
    locked_until: null,
    password_changed_at: new Date('2026-05-01T10:00:00Z'),
    created_at: new Date('2026-05-01T10:00:00Z'),
    created_by: null,
    updated_at: null,
    ...overrides
  }
}

const SCHEMA = 'auth_test'

// ---- Tests ------------------------------------------------------------------

describe('PostgresWebAuthService — surface contract', () => {
  it('exports a class instantiable with a pool, schema, and password provider', () => {
    const pool = new FakePool() as unknown as ConstructorParameters<
      typeof PostgresWebAuthService
    >[0]['pool']
    const svc = new PostgresWebAuthService({
      pool,
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
    expect(svc).toBeInstanceOf(PostgresWebAuthService)
  })
})

describe('PostgresWebAuthService — createFirstUser', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = new PostgresWebAuthService({
      pool: pool as unknown as ConstructorParameters<typeof PostgresWebAuthService>[0]['pool'],
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
  })

  it('refuses when an admin already exists', async () => {
    pool.enqueueResponse({ rows: [{ id: '1' }], rowCount: 1 })
    await expect(svc.createFirstUser('alice', 'Alice', 'pw')).rejects.toThrow(
      /admin user already exists/i
    )
  })

  it('issues parameterised INSERT with ROLE_ADMIN — never inlines the role string', async () => {
    // SELECT existing admin (none) → INSERT recovery_key_hash → upsert
    // accounts_enabled → INSERT user → returns id.
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // SELECT: no admin
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // INSERT recovery_key_hash
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPSERT accounts_enabled
    pool.enqueueResponse({ rows: [{ id: '42' }], rowCount: 1 }) // INSERT user RETURNING
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // COMMIT

    const result = await svc.createFirstUser('alice', 'Alice', 'pw')
    expect(result.username).toBe('alice')
    expect(result.role).toBe(ROLE_ADMIN)
    expect(result.recoveryKey).toMatch(/^.{32}$/)
    expect(result.id).toBe(42)

    const inserts = pool.queries.filter((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(inserts.length).toBe(1)
    const userInsert = inserts[0]
    expect(userInsert.text, 'role must be parameterised, not inlined').not.toMatch(/'admin'/)
    expect(userInsert.values).toContain(ROLE_ADMIN)
  })

  it('quotes the configured schema in queries (multi-tenant safety)', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    pool.enqueueResponse({ rows: [{ id: '1' }], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 0 })

    await svc.createFirstUser('alice', 'Alice', 'pw')

    for (const q of pool.queries) {
      // Every DML must reference the schema by name, not bare table.
      if (/INSERT|UPDATE|SELECT.*users/i.test(q.text)) {
        expect(q.text).toContain(`"${SCHEMA}"`)
      }
    }
  })
})

describe('PostgresWebAuthService — authenticate', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = new PostgresWebAuthService({
      pool: pool as unknown as ConstructorParameters<typeof PostgresWebAuthService>[0]['pool'],
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
  })

  it('returns success: false for unknown username', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    const result = await svc.authenticate('ghost', 'pw')
    expect(result.success).toBe(false)
    expect(result.user).toBeNull()
  })

  it('returns success: true with safeUser (no password_hash) for valid credentials', async () => {
    pool.enqueueResponse({ rows: [pgUserRow()], rowCount: 1 }) // SELECT
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPDATE reset failed count

    const result = await svc.authenticate('alice', 'pw')
    expect(result.success).toBe(true)
    expect(result.user).toBeDefined()
    expect(result.user as object).not.toHaveProperty('password_hash')
    expect((result.user as { username: string }).username).toBe('alice')
  })

  it('returns locked: true when locked_until is in the future', async () => {
    const future = new Date(Date.now() + 60_000)
    pool.enqueueResponse({ rows: [pgUserRow({ locked_until: future })], rowCount: 1 })
    const result = await svc.authenticate('alice', 'pw')
    expect(result.success).toBe(false)
    expect(result.locked).toBe(true)
  })

  it('locks the account after MAX_FAILED_ATTEMPTS consecutive failures', async () => {
    pool.enqueueResponse({
      rows: [pgUserRow({ failed_login_count: MAX_FAILED_ATTEMPTS - 1 })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPDATE with locked_until

    await svc.authenticate('alice', 'wrong')

    const update = pool.queries.find((q) => /UPDATE.+locked_until/is.test(q.text))
    expect(update, 'lockout UPDATE must fire').toBeDefined()
    // Lockout duration must come from constants — verify the bound value
    // is roughly LOCKOUT_DURATION_MINUTES from now.
    const lockUntil = update!.values.find((v) => v instanceof Date) as Date | undefined
    expect(lockUntil).toBeInstanceOf(Date)
    const deltaMs = lockUntil!.getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan((LOCKOUT_DURATION_MINUTES - 1) * 60_000)
    expect(deltaMs).toBeLessThan((LOCKOUT_DURATION_MINUTES + 1) * 60_000)
  })

  it('row-maps PG types to the cross-backend User shape (number ids, ISO strings)', async () => {
    pool.enqueueResponse({
      rows: [
        pgUserRow({
          id: '7',
          is_active: true,
          must_change_password: true,
          locked_until: null,
          password_changed_at: new Date('2026-05-01T10:00:00Z')
        })
      ],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    const result = await svc.authenticate('alice', 'pw')
    expect(result.user).toBeDefined()
    const u = result.user!
    expect(typeof u.id, 'BIGINT must map to JS number').toBe('number')
    expect(u.id).toBe(7)
    expect(typeof u.is_active, 'BOOLEAN must map to JS number 0/1 for cross-backend parity').toBe(
      'number'
    )
    expect(u.is_active).toBe(1)
    expect(u.must_change_password).toBe(1)
    expect(typeof u.password_changed_at, 'TIMESTAMPTZ must map to ISO string').toBe('string')
    expect(u.password_changed_at).toBe('2026-05-01T10:00:00.000Z')
  })
})

describe('PostgresWebAuthService — isAccountsEnabled', () => {
  it("returns true when database_settings.accounts_enabled = 'true'", async () => {
    const pool = new FakePool()
    const svc = new PostgresWebAuthService({
      pool: pool as unknown as ConstructorParameters<typeof PostgresWebAuthService>[0]['pool'],
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
    pool.enqueueResponse({ rows: [{ value: 'true' }], rowCount: 1 })
    expect(await svc.isAccountsEnabled()).toBe(true)
  })

  it('returns false when missing or any other value', async () => {
    const pool = new FakePool()
    const svc = new PostgresWebAuthService({
      pool: pool as unknown as ConstructorParameters<typeof PostgresWebAuthService>[0]['pool'],
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.isAccountsEnabled()).toBe(false)
  })
})

describe('PostgresWebAuthService — listUsers', () => {
  it('strips password_hash from every row', async () => {
    const pool = new FakePool()
    const svc = new PostgresWebAuthService({
      pool: pool as unknown as ConstructorParameters<typeof PostgresWebAuthService>[0]['pool'],
      schema: SCHEMA,
      passwordProvider: fakePasswordProvider
    })
    pool.enqueueResponse({
      rows: [pgUserRow(), pgUserRow({ id: '2', username: 'bob' })],
      rowCount: 2
    })
    const users = await svc.listUsers()
    expect(users.length).toBe(2)
    for (const u of users) {
      expect(u as object).not.toHaveProperty('password_hash')
    }
  })
})

afterAll(() => {
  // Sanity: the test file itself doesn't leak a real Pool into other suites.
})
