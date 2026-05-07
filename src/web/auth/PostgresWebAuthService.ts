/**
 * PostgresWebAuthService — Postgres-backed user authentication for the
 * web variant.
 *
 * Phase 2 deliverable #3. Mirrors the desktop SQLite AuthService surface
 * (src/main/services/auth/AuthService.ts) one method for one method.
 * Same behaviours (Argon2id hashing via PasswordProvider, lockout after
 * MAX_FAILED_ATTEMPTS, accounts_enabled flag in database_settings,
 * password rotation), different storage transport.
 *
 * Web-only — never imported by main process. Lives under src/web/ so
 * the desktop AuthService stays a pure SQLite surface and can't be
 * regressed by web-specific concerns.
 *
 * Cross-backend policy values (USER_ROLES, MAX_FAILED_ATTEMPTS,
 * LOCKOUT_DURATION_MINUTES) come from src/shared/auth/auth-constants —
 * the constants module is process-agnostic and the only thing the two
 * implementations share.
 */
import { nanoid } from 'nanoid'
import type { Pool } from 'pg'

import {
  defaultPasswordProvider,
  type PasswordProvider
} from '../../main/auth/providers/argon2-provider'
import {
  LOCKOUT_DURATION_MINUTES,
  MAX_FAILED_ATTEMPTS,
  ROLE_ADMIN,
  ROLE_USER,
  type UserRole
} from '../../shared/auth/auth-constants'

/**
 * Cross-backend User shape. Storage representation differs (Postgres
 * stores boolean / timestamptz / bigint natively), but the row mapper
 * normalises everything to the same shape the SQLite AuthService
 * returns so handlers don't need to branch on backend.
 */
export interface User {
  id: number
  username: string
  display_name: string | null
  password_hash: string
  role: UserRole
  is_active: number
  must_change_password: number
  failed_login_count: number
  locked_until: string | null
  password_changed_at: string | null
  created_at: string
  created_by: number | null
  updated_at: string | null
}

export interface AuthResult {
  success: boolean
  user: Omit<User, 'password_hash'> | null
  locked?: boolean
  mustChangePassword?: boolean
}

export interface PostgresWebAuthServiceOptions {
  pool: Pool
  schema: string
  passwordProvider?: PasswordProvider
}

/**
 * Convert a Postgres row (BOOLEAN / TIMESTAMPTZ / BIGINT-as-string) to
 * the cross-backend User shape (number / ISO string / number).
 *
 * Why number for booleans: the desktop AuthService returns 0/1 because
 * SQLite stores them that way. Renderer code already handles 0/1; the
 * web path keeps the same shape so the handler-seam guarantee holds.
 */
function mapPgRowToUser(raw: Record<string, unknown>): User {
  const toIso = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    if (v instanceof Date) return v.toISOString()
    // The migration declares TIMESTAMPTZ; node-postgres returns Date by
    // default. If we get a non-Date, non-null value here, a custom type
    // parser was installed and it's emitting raw PG strings — the User
    // contract advertises ISO 8601, so refuse rather than silently
    // pass through a non-ISO format.
    if (typeof v === 'string') {
      const parsed = new Date(v)
      if (isNaN(parsed.getTime())) {
        throw new Error(`mapPgRowToUser: cannot parse timestamp value: ${v}`)
      }
      return parsed.toISOString()
    }
    throw new Error(
      `mapPgRowToUser: unexpected timestamp type ${typeof v} (${String(v).slice(0, 40)})`
    )
  }
  const toBoolNumber = (v: unknown): number => {
    if (typeof v === 'boolean') return v ? 1 : 0
    if (typeof v === 'number') return v === 0 ? 0 : 1
    // Postgres BOOLEAN under custom type parsers can arrive as 't'/'f'
    // or 'true'/'false'. Whitelist the known truthy strings; treat
    // anything else as false (parity with SQLite which stores 0/1 INT).
    if (v === 't' || v === 'true' || v === '1') return 1
    return 0
  }
  const toNumberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined) return null
    return Number(v)
  }
  return {
    id: Number(raw.id),
    username: String(raw.username),
    display_name: raw.display_name === null ? null : String(raw.display_name),
    password_hash: String(raw.password_hash),
    role: String(raw.role) as UserRole,
    is_active: toBoolNumber(raw.is_active),
    must_change_password: toBoolNumber(raw.must_change_password),
    failed_login_count: Number(raw.failed_login_count ?? 0),
    locked_until: toIso(raw.locked_until),
    password_changed_at: toIso(raw.password_changed_at),
    created_at: toIso(raw.created_at) ?? '',
    created_by: toNumberOrNull(raw.created_by),
    updated_at: toIso(raw.updated_at)
  }
}

function quoteSchema(schema: string): string {
  // Defence against unsanitised schema names. Postgres identifiers
  // can be arbitrary unicode; the only safe quoting is doubling
  // embedded `"`. A schema with `"` in its name is pathological but
  // valid SQL — we handle it instead of refusing.
  return `"${schema.replace(/"/g, '""')}"`
}

export class PostgresWebAuthService {
  private readonly pool: Pool
  private readonly schemaQuoted: string
  private readonly passwordProvider: PasswordProvider

  constructor(options: PostgresWebAuthServiceOptions) {
    this.pool = options.pool
    this.schemaQuoted = quoteSchema(options.schema)
    this.passwordProvider = options.passwordProvider ?? defaultPasswordProvider
  }

  // ---------- bootstrap ----------

  async createFirstUser(
    username: string,
    displayName: string,
    password: string
  ): Promise<{ id: number; username: string; role: UserRole; recoveryKey: string }> {
    const sch = this.schemaQuoted
    const passwordHash = await this.passwordProvider.hashPassword(password)
    const recoveryKey = nanoid(32)
    const recoveryKeyHash = await this.passwordProvider.hashPassword(recoveryKey)

    // Race-safety: the SELECT-outside-transaction pattern in earlier
    // revisions of this method allowed two concurrent first-user calls
    // to both observe "no admin" and both proceed. The partial unique
    // index `users_only_one_admin` (migration 0007) guarantees at most
    // one admin row per schema; the second concurrent INSERT trips
    // unique_violation (SQLSTATE 23505) and we translate it into the
    // same friendly error a serial caller would see.
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`INSERT INTO ${sch}."database_settings" (key, value) VALUES ($1, $2)`, [
        'recovery_key_hash',
        recoveryKeyHash
      ])
      await client.query(
        `INSERT INTO ${sch}."database_settings" (key, value) VALUES ('accounts_enabled', 'true')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
      )
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ${sch}."users" (username, display_name, password_hash, role, password_changed_at)
         VALUES ($1, $2, $3, $4, now())
         RETURNING id`,
        [username, displayName, passwordHash, ROLE_ADMIN]
      )
      await client.query('COMMIT')
      return {
        id: Number(inserted.rows[0].id),
        username,
        role: ROLE_ADMIN,
        recoveryKey
      }
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // ignore rollback failures; original error wins
      }
      // Translate unique-violation on the partial admin index into the
      // same error the SQLite-parity SELECT-then-throw path emits.
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
        throw new Error('Admin user already exists', { cause: err })
      }
      throw err
    } finally {
      client.release()
    }
  }

  // ---------- authenticate ----------

  async authenticate(username: string, password: string): Promise<AuthResult> {
    const sch = this.schemaQuoted
    const sel = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1 AND is_active = TRUE`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) {
      return { success: false, user: null }
    }
    const user = mapPgRowToUser(sel.rows[0])

    if (user.locked_until !== null && user.locked_until !== '') {
      if (new Date(user.locked_until).getTime() > Date.now()) {
        return { success: false, user: null, locked: true }
      }
    }

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, password)

    if (!valid) {
      // Atomic increment + conditional lockout, single round trip. The
      // previous SELECT-then-UPDATE pattern was racy under pg's
      // concurrency model: two concurrent failed logins could both read
      // failed_login_count = N-1 and both write N, defeating the
      // MAX_FAILED_ATTEMPTS gate. SQLite's single-writer model hid the
      // race on desktop; the web path needs DB-level atomicity.
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000)
      await this.pool.query(
        `UPDATE ${sch}."users"
            SET failed_login_count = failed_login_count + 1,
                locked_until = CASE
                  WHEN failed_login_count + 1 >= $1 THEN $2
                  ELSE locked_until
                END
          WHERE id = $3`,
        [MAX_FAILED_ATTEMPTS, lockUntil, user.id]
      )
      return { success: false, user: null }
    }

    await this.pool.query(
      `UPDATE ${sch}."users" SET failed_login_count = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    )

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash: _hash, ...safeUser } = user
    return {
      success: true,
      user: safeUser,
      mustChangePassword: user.must_change_password === 1
    }
  }

  // ---------- user management ----------

  async createUser(
    username: string,
    displayName: string,
    tempPassword: string,
    createdByUsername: string
  ): Promise<{ id: number; username: string; role: UserRole; must_change_password: number }> {
    const sch = this.schemaQuoted
    const creator = await this.getUser(createdByUsername)
    const passwordHash = await this.passwordProvider.hashPassword(tempPassword)

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO ${sch}."users"
        (username, display_name, password_hash, role, must_change_password, created_by, password_changed_at)
       VALUES ($1, $2, $3, $4, TRUE, $5, now())
       RETURNING id`,
      [username, displayName, passwordHash, ROLE_USER, creator?.id ?? null]
    )

    return {
      id: Number(inserted.rows[0].id),
      username,
      role: ROLE_USER,
      must_change_password: 1
    }
  }

  async getUser(username: string): Promise<User | undefined> {
    const sch = this.schemaQuoted
    const sel = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) return undefined
    return mapPgRowToUser(sel.rows[0])
  }

  async listUsers(): Promise<Omit<User, 'password_hash'>[]> {
    const sch = this.schemaQuoted
    const sel = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" ORDER BY created_at`
    )
    return sel.rows.map((row) => {
      const u = mapPgRowToUser(row)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password_hash: _hash, ...rest } = u
      return rest
    })
  }

  async deactivateUser(username: string): Promise<void> {
    const sch = this.schemaQuoted
    const result = await this.pool.query(
      `UPDATE ${sch}."users" SET is_active = FALSE, updated_at = now() WHERE username = $1`,
      [username]
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`User not found: ${username}`)
    }
  }

  async resetPassword(username: string, newPassword: string): Promise<void> {
    const sch = this.schemaQuoted
    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.pool.query(
      `UPDATE ${sch}."users"
         SET password_hash = $1, must_change_password = TRUE,
             failed_login_count = 0, locked_until = NULL,
             password_changed_at = now(), updated_at = now()
       WHERE username = $2`,
      [passwordHash, username]
    )
  }

  async changePassword(
    username: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const sch = this.schemaQuoted
    const sel = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM ${sch}."users" WHERE username = $1`,
      [username]
    )
    if ((sel.rowCount ?? 0) === 0) return false
    const user = mapPgRowToUser(sel.rows[0])

    const valid = await this.passwordProvider.verifyPassword(user.password_hash, oldPassword)
    if (!valid) return false

    const passwordHash = await this.passwordProvider.hashPassword(newPassword)
    await this.pool.query(
      `UPDATE ${sch}."users"
         SET password_hash = $1, must_change_password = FALSE,
             password_changed_at = now(), updated_at = now()
       WHERE username = $2`,
      [passwordHash, username]
    )
    return true
  }

  // ---------- settings ----------

  async isAccountsEnabled(): Promise<boolean> {
    const sch = this.schemaQuoted
    const sel = await this.pool.query<{ value: string }>(
      `SELECT value FROM ${sch}."database_settings" WHERE key = 'accounts_enabled'`
    )
    return sel.rows[0]?.value === 'true'
  }
}
