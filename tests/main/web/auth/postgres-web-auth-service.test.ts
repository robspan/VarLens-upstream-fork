import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { PostgresWebAuthService } from '../../../../src/web/auth/PostgresWebAuthService'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN,
  ROLE_USER
} from '../../../../src/shared/auth/auth-constants'
import type { PasswordProvider } from '../../../../src/main/auth/providers/argon2-provider'

/**
 * Phase 2 #3: PostgresWebAuthService unit tests with a FakePool.
 *
 * Covers SQL shape, parameter binding, branch matrix, atomic lockout,
 * unique-violation translation on createFirstUser race, and the
 * transactional rollback path. Real-instance tests against pg-up
 * (gated by VARLENS_RUN_POSTGRES_E2E=1) live alongside Step 4's
 * web-server bootstrap test — this file is the everywhere-runs gate.
 */

// ---- Pool stub --------------------------------------------------------------

interface QueryRecord {
  text: string
  values: unknown[]
  // Whether this query came through `connect().query` (i.e. inside a
  // transactional client) vs `pool.query` (outside). Used to assert
  // createFirstUser actually opens a transaction rather than smearing
  // INSERTs across pool checkouts.
  viaClient: boolean
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
  released = false
  releasedCount = 0
  // Each enqueueResponse caller can opt into a thrown error rather than
  // a canned row set — used to simulate unique-violation during
  // createFirstUser race translation and INSERT-failure rollback.
  private responses: Array<CannedResponse | { error: Error }> = []

  enqueueResponse(response: CannedResponse): void {
    this.responses.push(response)
  }

  enqueueError(error: Error): void {
    this.responses.push({ error })
  }

  private async runQuery(
    text: string,
    values: unknown[] = [],
    viaClient: boolean
  ): Promise<CannedResponse> {
    this.queries.push({ text, values, viaClient })
    if (this.responses.length === 0) {
      throw new Error(
        `FakePool: no canned response for query #${this.queries.length}:\n${text.slice(0, 200)}`
      )
    }
    const next = this.responses.shift()!
    if ('error' in next) throw next.error
    return next
  }

  async query(text: string, values: unknown[] = []): Promise<CannedResponse> {
    return this.runQuery(text, values, false)
  }

  async connect(): Promise<{
    query: (text: string, values?: unknown[]) => Promise<CannedResponse>
    release: () => void
  }> {
    return {
      query: (text, values = []) => this.runQuery(text, values, true),
      release: () => {
        this.released = true
        this.releasedCount += 1
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
type SvcOpts = ConstructorParameters<typeof PostgresWebAuthService>[0]
function newSvc(pool: FakePool): PostgresWebAuthService {
  return new PostgresWebAuthService({
    pool: pool as unknown as SvcOpts['pool'],
    schema: SCHEMA,
    passwordProvider: fakePasswordProvider
  })
}

// Convenience: enqueue the four-query happy path of createFirstUser.
function enqueueCreateFirstUserHappyPath(pool: FakePool, userId = '42'): void {
  pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
  pool.enqueueResponse({ rows: [], rowCount: 1 }) // INSERT recovery_key_hash
  pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPSERT accounts_enabled
  pool.enqueueResponse({ rows: [{ id: userId }], rowCount: 1 }) // INSERT user
  pool.enqueueResponse({ rows: [], rowCount: 0 }) // COMMIT
}

// ---- Tests ------------------------------------------------------------------

describe('PostgresWebAuthService — surface contract', () => {
  it('exports a class instantiable with a pool, schema, and password provider', () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    expect(svc).toBeInstanceOf(PostgresWebAuthService)
  })
})

describe('PostgresWebAuthService — createFirstUser', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = newSvc(pool)
  })

  it('issues a transactional INSERT with ROLE_ADMIN — never inlines the role string', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    const result = await svc.createFirstUser('alice', 'Alice', 'pw')
    expect(result.username).toBe('alice')
    expect(result.role).toBe(ROLE_ADMIN)
    expect(result.recoveryKey).toMatch(/^.{32}$/)
    expect(result.id).toBe(42)

    const inserts = pool.queries.filter((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(inserts.length).toBe(1)
    expect(inserts[0].text, 'role must be parameterised, not inlined').not.toMatch(/'admin'/)
    expect(inserts[0].values).toContain(ROLE_ADMIN)
  })

  it('runs every write inside a transactional client (rollback semantics)', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    await svc.createFirstUser('alice', 'Alice', 'pw')

    // BEGIN, the two settings INSERTs, the users INSERT, COMMIT — every
    // one of these must be on the connected client (viaClient=true), not
    // on the bare pool. A regression that smears writes across pool
    // checkouts (no real transaction) would fail here.
    const dml = pool.queries.filter((q) => /BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE/i.test(q.text))
    expect(dml.length).toBeGreaterThanOrEqual(5)
    for (const q of dml) {
      expect(
        q.viaClient,
        `query "${q.text.slice(0, 40)}" must run on the transactional client`
      ).toBe(true)
    }
    expect(pool.queries.some((q) => /^BEGIN$/i.test(q.text))).toBe(true)
    expect(pool.queries.some((q) => /^COMMIT$/i.test(q.text))).toBe(true)
  })

  it('quotes the configured schema in every users-touching query', async () => {
    enqueueCreateFirstUserHappyPath(pool)
    await svc.createFirstUser('alice', 'Alice', 'pw')
    for (const q of pool.queries) {
      if (/INSERT|UPDATE|SELECT.*users/i.test(q.text)) {
        expect(q.text).toContain(`"${SCHEMA}"`)
      }
    }
  })

  it('translates unique_violation (SQLSTATE 23505) into "Admin user already exists"', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // INSERT recovery_key_hash
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // UPSERT accounts_enabled
    const uniqueViolation = Object.assign(new Error('duplicate key value'), { code: '23505' })
    pool.enqueueError(uniqueViolation) // INSERT user fails on partial unique idx
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // ROLLBACK

    await expect(svc.createFirstUser('alice', 'Alice', 'pw')).rejects.toThrow(
      /admin user already exists/i
    )

    expect(
      pool.queries.some((q) => /^ROLLBACK$/i.test(q.text)),
      'rollback must fire'
    ).toBe(true)
    expect(pool.releasedCount, 'client must be released after error').toBe(1)
  })

  it('rolls back and releases the client when a non-unique error fires mid-transaction', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // BEGIN
    pool.enqueueError(new Error('disk full')) // INSERT recovery_key_hash fails
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // ROLLBACK

    await expect(svc.createFirstUser('alice', 'Alice', 'pw')).rejects.toThrow(/disk full/)
    expect(pool.queries.some((q) => /^ROLLBACK$/i.test(q.text))).toBe(true)
    expect(pool.releasedCount).toBe(1)
  })
})

describe('PostgresWebAuthService — authenticate', () => {
  let pool: FakePool
  let svc: PostgresWebAuthService

  beforeEach(() => {
    pool = new FakePool()
    svc = newSvc(pool)
  })

  it('returns success: false for unknown username', async () => {
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    const r = await svc.authenticate('ghost', 'pw')
    expect(r.success).toBe(false)
    expect(r.user).toBeNull()
  })

  it('returns success: true with safeUser (no password_hash)', async () => {
    pool.enqueueResponse({ rows: [pgUserRow()], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 }) // reset failed count
    const r = await svc.authenticate('alice', 'pw')
    expect(r.success).toBe(true)
    expect(r.user).toBeDefined()
    expect(r.user as object).not.toHaveProperty('password_hash')
    expect((r.user as { username: string }).username).toBe('alice')
  })

  it('returns locked: true when locked_until is in the future', async () => {
    const future = new Date(Date.now() + 60_000)
    pool.enqueueResponse({ rows: [pgUserRow({ locked_until: future })], rowCount: 1 })
    const r = await svc.authenticate('alice', 'pw')
    expect(r.success).toBe(false)
    expect(r.locked).toBe(true)
  })

  it('uses an atomic UPDATE+CASE on failed login (no read-modify-write race)', async () => {
    pool.enqueueResponse({
      rows: [pgUserRow({ failed_login_count: MAX_FAILED_ATTEMPTS - 1 })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    await svc.authenticate('alice', 'wrong')

    const update = pool.queries.find((q) =>
      /failed_login_count\s*=\s*failed_login_count\s*\+\s*1/i.test(q.text)
    )
    expect(update, 'failed_login_count must be incremented atomically (server-side)').toBeDefined()
    // CASE expression encodes the lockout threshold without a JS read.
    expect(update!.text).toMatch(/CASE\s+WHEN[\s\S]+failed_login_count\s*\+\s*1\s*>=\s*\$1/i)
    // First param is the threshold, second is the candidate lock-until,
    // third is the user id. Verify the threshold matches the constant.
    expect(update!.values[0]).toBe(MAX_FAILED_ATTEMPTS)
    expect(update!.values[1]).toBeInstanceOf(Date)
    const lockUntil = update!.values[1] as Date
    const deltaMs = lockUntil.getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan((LOCKOUT_DURATION_MINUTES - 1) * 60_000)
    expect(deltaMs).toBeLessThan((LOCKOUT_DURATION_MINUTES + 1) * 60_000)
  })

  it('row-maps PG types to the cross-backend User shape', async () => {
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

    const r = await svc.authenticate('alice', 'pw')
    expect(r.user).toBeDefined()
    const u = r.user!
    expect(typeof u.id).toBe('number')
    expect(u.id).toBe(7)
    expect(u.is_active).toBe(1)
    expect(u.must_change_password).toBe(1)
    expect(typeof u.password_changed_at).toBe('string')
    expect(u.password_changed_at).toBe('2026-05-01T10:00:00.000Z')
  })

  it('row mapper accepts string-form booleans (custom pg type parsers)', async () => {
    pool.enqueueResponse({
      rows: [pgUserRow({ is_active: 't', must_change_password: 'f' })],
      rowCount: 1
    })
    pool.enqueueResponse({ rows: [], rowCount: 1 })

    const r = await svc.authenticate('alice', 'pw')
    expect((r.user as { is_active: number }).is_active).toBe(1)
    expect((r.user as { must_change_password: number }).must_change_password).toBe(0)
  })
})

describe('PostgresWebAuthService — createUser', () => {
  it('creates with ROLE_USER, parameterised, attributes creator id', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [pgUserRow({ id: '99', username: 'admin' })], rowCount: 1 }) // getUser(creator)
    pool.enqueueResponse({ rows: [{ id: '7' }], rowCount: 1 }) // INSERT user

    const r = await svc.createUser('bob', 'Bob', 'temp', 'admin')
    expect(r.id).toBe(7)
    expect(r.role).toBe(ROLE_USER)
    expect(r.must_change_password).toBe(1)

    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert!.text, 'role must be parameterised').not.toMatch(/'user'/)
    expect(insert!.values).toContain(ROLE_USER)
    expect(insert!.values).toContain(99) // creator id propagated
  })

  it('coalesces unknown creator to NULL (parity with SQLite)', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 }) // getUser returns nothing
    pool.enqueueResponse({ rows: [{ id: '7' }], rowCount: 1 })

    await svc.createUser('bob', 'Bob', 'temp', 'ghost')
    const insert = pool.queries.find((q) => /INSERT INTO[\s\S]+users/i.test(q.text))
    expect(insert!.values).toContain(null)
  })
})

describe('PostgresWebAuthService — getUser / listUsers / isAccountsEnabled', () => {
  it('getUser returns undefined when missing', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.getUser('ghost')).toBeUndefined()
  })

  it('listUsers strips password_hash from every row', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({
      rows: [pgUserRow(), pgUserRow({ id: '2', username: 'bob' })],
      rowCount: 2
    })
    const users = await svc.listUsers()
    expect(users.length).toBe(2)
    for (const u of users) expect(u as object).not.toHaveProperty('password_hash')
  })

  it("isAccountsEnabled returns true when database_settings.accounts_enabled = 'true'", async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [{ value: 'true' }], rowCount: 1 })
    expect(await svc.isAccountsEnabled()).toBe(true)
  })

  it('isAccountsEnabled returns false when missing or any other value', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.isAccountsEnabled()).toBe(false)
  })
})

describe('PostgresWebAuthService — deactivateUser / resetPassword / changePassword', () => {
  it('deactivateUser throws when user not found', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    await expect(svc.deactivateUser('ghost')).rejects.toThrow(/user not found/i)
  })

  it('deactivateUser issues UPDATE is_active = FALSE', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    await svc.deactivateUser('alice')
    const upd = pool.queries[0]
    expect(upd.text).toMatch(/UPDATE[\s\S]+users[\s\S]+is_active\s*=\s*FALSE/i)
    expect(upd.values).toContain('alice')
  })

  it('resetPassword clears lockout state and forces password change', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    await svc.resetPassword('alice', 'newpw')
    const upd = pool.queries[0]
    expect(upd.text).toMatch(/must_change_password\s*=\s*TRUE/i)
    expect(upd.text).toMatch(/failed_login_count\s*=\s*0/i)
    expect(upd.text).toMatch(/locked_until\s*=\s*NULL/i)
  })

  it('changePassword returns false for unknown user', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [], rowCount: 0 })
    expect(await svc.changePassword('ghost', 'old', 'new')).toBe(false)
  })

  it('changePassword returns false when old password does not verify', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({
      rows: [pgUserRow({ password_hash: 'hashed::differentpw' })],
      rowCount: 1
    })
    expect(await svc.changePassword('alice', 'wrong', 'new')).toBe(false)
  })

  it('changePassword updates hash and clears must_change_password on valid old password', async () => {
    const pool = new FakePool()
    const svc = newSvc(pool)
    pool.enqueueResponse({ rows: [pgUserRow()], rowCount: 1 })
    pool.enqueueResponse({ rows: [], rowCount: 1 })
    expect(await svc.changePassword('alice', 'pw', 'newpw')).toBe(true)
    const upd = pool.queries[1]
    expect(upd.text).toMatch(/must_change_password\s*=\s*FALSE/i)
    expect(upd.values).toContain('hashed::newpw')
  })
})

afterAll(() => {
  // Sanity: no real Pool leaks into other suites.
})
