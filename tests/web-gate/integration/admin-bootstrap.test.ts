import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * §app2.1 Phase 1 gate — admin bootstrap parity.
 *
 * The desktop AuthService.createFirstUser() already produces an Argon2 admin
 * on first run. The web server reuses that exact function — the only delta
 * is that creds come from env (`VARLENS_ADMIN_USERNAME` / `_PASSWORD` /
 * `_DISPLAY_NAME`) instead of a renderer dialog.
 *
 * This test locks in:
 *   1. desk→web parity: env-bootstrapped admin authenticates successfully
 *      via POST /api/auth/login (same Argon2 path as desktop).
 *   2. idempotent: a second boot with the same env doesn't create a second
 *      admin and doesn't error.
 *   3. opt-in: an empty env triple does NOT create an implicit admin —
 *      the operator stays in control of the bootstrap moment.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'concept-pilot-test-pw'
const ADMIN_DISPLAY = 'Concept Pilot Admin'

describe.skipIf(!isWebBuilt)('admin bootstrap parity', () => {
  test('env-driven admin authenticates via /api/auth/login on first boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    const dbPath = join(dir, 'gate.db')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        db: dbPath,
        admin: {
          username: ADMIN_USERNAME,
          password: ADMIN_PASSWORD,
          displayName: ADMIN_DISPLAY
        }
      })
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
        })
        expect(res.statusCode).toBe(200)
        const body = res.json() as {
          success: boolean
          user: { username: string; role: string } | null
        }
        expect(body.success).toBe(true)
        expect(body.user?.username).toBe(ADMIN_USERNAME)
        expect(body.user?.role).toBe('admin')
      } finally {
        await app.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('second boot with same env is a no-op (no duplicate admin, no error, recovery key untouched)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    const dbPath = join(dir, 'gate.db')
    const recoveryKeyPath = join(dir, 'admin-recovery-key.txt')
    try {
      const { buildApp } = await import('../../../src/web/server')

      const app1 = await buildApp({
        db: dbPath,
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_DISPLAY }
      })
      await app1.close()

      // Capture the recovery-key file contents written by the first boot.
      // The whole point of the round-3 hardening was that this file is the
      // sole recovery path; an idempotent second boot must NOT touch it.
      expect(existsSync(recoveryKeyPath)).toBe(true)
      const recoveryKeyBefore = readFileSync(recoveryKeyPath, 'utf8')

      // Second boot must not throw and must leave exactly one admin.
      const app2 = await buildApp({
        db: dbPath,
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_DISPLAY }
      })
      try {
        const res = await app2.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
        })
        expect(res.statusCode).toBe(200)
        expect((res.json() as { success: boolean }).success).toBe(true)
      } finally {
        await app2.close()
      }

      // Verify admin count is still 1.
      const Database = (await import('better-sqlite3-multiple-ciphers')).default
      const db = new Database(dbPath, { readonly: true })
      const row = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as {
        n: number
      }
      db.close()
      expect(row.n).toBe(1)

      // The recovery-key file must be byte-identical — second boot is a
      // no-op all the way down to the FS, not just the DB row count.
      expect(readFileSync(recoveryKeyPath, 'utf8')).toBe(recoveryKeyBefore)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('opt-in: no admin is created when admin env triple is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    const dbPath = join(dir, 'gate.db')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({ db: dbPath })
      try {
        const Database = (await import('better-sqlite3-multiple-ciphers')).default
        const db = new Database(dbPath, { readonly: true })
        const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
        db.close()
        expect(row.n).toBe(0)
      } finally {
        await app.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
