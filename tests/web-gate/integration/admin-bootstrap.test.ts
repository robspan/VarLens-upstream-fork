import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * Phase 2: admin bootstrap parity against Postgres.
 *
 * Phase 1 used SQLite; the v1 of this test poked sqlite_master directly.
 * The web variant is now Postgres-only — tests use /api/auth/login as
 * the observable behaviour gate (round-trip auth proves the admin row
 * was committed) plus the recovery-key file presence/contents to lock
 * the FS side.
 *
 * Gated on (a) the web build existing AND (b) VARLENS_PG_URL set.
 * Without the latter the new postgres-required.test.ts already covers
 * the abort-without-pg behaviour.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'concept-pilot-test-pw'
const ADMIN_DISPLAY = 'Concept Pilot Admin'

describe.skipIf(!isWebBuilt || !HAS_PG)('admin bootstrap parity', () => {
  test('env-driven admin authenticates via /api/auth/login on first boot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
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

        // Recovery key file must land in VARLENS_RECOVERY_KEY_DIR (not
        // dirname(VARLENS_DB_PATH) — that was Phase 1's SQLite-derived
        // location and is the breaking change Phase 2 documents).
        expect(existsSync(join(dir, 'admin-recovery-key.txt'))).toBe(true)
      } finally {
        await app.close()
      }
    } finally {
      delete process.env.VARLENS_RECOVERY_KEY_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('second boot with same env is a no-op — recovery key file untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    const recoveryKeyPath = join(dir, 'admin-recovery-key.txt')
    process.env.VARLENS_RECOVERY_KEY_DIR = dir
    try {
      const { buildApp } = await import('../../../src/web/server')

      const app1 = await buildApp({
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_DISPLAY }
      })
      await app1.close()

      expect(existsSync(recoveryKeyPath)).toBe(true)
      const recoveryKeyBefore = readFileSync(recoveryKeyPath, 'utf8')

      // Second boot must not throw, must not duplicate admin, must not
      // overwrite the recovery key.
      const app2 = await buildApp({
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

      expect(readFileSync(recoveryKeyPath, 'utf8')).toBe(recoveryKeyBefore)
    } finally {
      delete process.env.VARLENS_RECOVERY_KEY_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('opt-in: no admin is created when admin env triple is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-admin-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        // Without the admin option the first user is not bootstrapped —
        // a login attempt must return success: false (no user).
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'anyone', password: 'whatever' }
        })
        expect(res.statusCode).toBe(200)
        expect((res.json() as { success: boolean }).success).toBe(false)
        expect(existsSync(join(dir, 'admin-recovery-key.txt'))).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      delete process.env.VARLENS_RECOVERY_KEY_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
