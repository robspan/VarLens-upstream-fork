import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { join, resolve } from 'path'

import { startIsolatedWebSchema } from '../helpers/web-driver'

/**
 * Web admin bootstrap — observable via /api/auth/login round-trip.
 *
 * The recovery-key plaintext file (the original v1 of this test
 * locked it in) was deleted in the 2026-security pass — the file
 * sat in /mnt/data/app/data/admin-recovery-key.txt, was plaintext
 * on disk, and no consumer code ever read it. Tests assert its
 * **absence** instead.
 *
 * The bootstrapped admin row carries must_change_password=TRUE, so
 * login returns mustChangePassword:true and the dispatcher's pre-
 * rotation gate gates every other endpoint. The dedicated
 * must-change-password.test.ts proves the gate is wired; this file
 * proves the bootstrap path itself works for both plaintext (legacy)
 * and hash (preferred).
 *
 * Gated on (a) the web build existing AND (b) VARLENS_PG_URL set.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const ADMIN_USERNAME = 'admin'
const ADMIN_PASSWORD = 'concept-pilot-test-pw'
const ADMIN_DISPLAY = 'Concept Pilot Admin'

describe.skipIf(!isWebBuilt || !HAS_PG)('admin bootstrap', () => {
  test('plaintext (deprecated) bootstrap: login succeeds with mustChangePassword=true', async () => {
    const isolated = await startIsolatedWebSchema('admin_plaintext')
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
          payload: { args: [ADMIN_USERNAME, ADMIN_PASSWORD] }
        })
        expect(res.statusCode).toBe(200)
        const body = res.json() as {
          success: boolean
          user: { username: string; role: string } | null
          mustChangePassword?: boolean
        }
        expect(body.success).toBe(true)
        expect(body.user?.username).toBe(ADMIN_USERNAME)
        expect(body.user?.role).toBe('admin')
        // 2026-security: bootstrap admin must rotate before any access.
        expect(body.mustChangePassword).toBe(true)
        // Plaintext recovery-key file is no longer written — assert absence.
        expect(existsSync(join(isolated.recoveryDir, 'admin-recovery-key.txt'))).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('hash bootstrap: login succeeds with mustChangePassword=true and no plaintext on disk', async () => {
    const { defaultPasswordProvider } =
      await import('../../../src/main/auth/providers/argon2-provider')
    const passwordHash = await defaultPasswordProvider.hashPassword(ADMIN_PASSWORD)
    const isolated = await startIsolatedWebSchema('admin_hash')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        admin: {
          username: ADMIN_USERNAME,
          passwordHash,
          displayName: ADMIN_DISPLAY
        }
      })
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [ADMIN_USERNAME, ADMIN_PASSWORD] }
        })
        expect(res.statusCode).toBe(200)
        const body = res.json() as { success: boolean; mustChangePassword?: boolean }
        expect(body.success).toBe(true)
        expect(body.mustChangePassword).toBe(true)
        expect(existsSync(join(isolated.recoveryDir, 'admin-recovery-key.txt'))).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('second boot with same env is a no-op — admin row not duplicated', async () => {
    const isolated = await startIsolatedWebSchema('admin_second_boot')
    try {
      const { buildApp } = await import('../../../src/web/server')

      const app1 = await buildApp({
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_DISPLAY }
      })
      await app1.close()

      const app2 = await buildApp({
        admin: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, displayName: ADMIN_DISPLAY }
      })
      try {
        const res = await app2.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [ADMIN_USERNAME, ADMIN_PASSWORD] }
        })
        expect(res.statusCode).toBe(200)
        expect((res.json() as { success: boolean }).success).toBe(true)
      } finally {
        await app2.close()
      }
    } finally {
      await isolated.close()
    }
  })

  test('hash with malformed shape is rejected at build time', async () => {
    const isolated = await startIsolatedWebSchema('admin_bad_hash')
    try {
      const { buildApp } = await import('../../../src/web/server')
      await expect(
        buildApp({
          admin: {
            username: ADMIN_USERNAME,
            passwordHash: 'not-a-real-argon2-hash',
            displayName: ADMIN_DISPLAY
          }
        })
      ).rejects.toThrow(/argon2id/i)
    } finally {
      await isolated.close()
    }
  })

  test('opt-in: no admin is created when admin env is absent', async () => {
    const isolated = await startIsolatedWebSchema('admin_absent')
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp()
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: ['anyone', 'whatever'] }
        })
        expect(res.statusCode).toBe(200)
        expect((res.json() as { success: boolean }).success).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      await isolated.close()
    }
  })
})
