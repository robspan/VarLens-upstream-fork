import { describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * 2026-security gate: a session that still carries
 * must_change_password=TRUE has access to exactly two methods —
 * `auth:changePassword` (the way out) and `auth:logout` (the escape
 * hatch). Every other endpoint, including reads, returns 403.
 *
 * This test exercises the dispatcher's pre-rotation gate against a
 * live buildApp instance:
 *
 *   1. Bootstrap an admin (hash path, no plaintext on disk).
 *   2. Log in — confirm cookie is set + mustChangePassword=true.
 *   3. Reach for an arbitrary read endpoint — expect 403.
 *   4. Call changePassword with the wrong old password — expect 401,
 *      gate still active.
 *   5. Call changePassword with a too-short new password — expect
 *      422 (PasswordPolicyError mapping), gate still active.
 *   6. Call changePassword with new===old — expect 422.
 *   7. Call changePassword with a valid rotation — expect 200,
 *      success, mustChangePassword cleared.
 *   8. Re-fetch the same arbitrary read endpoint — now allowed.
 *
 * Gated on the web build + Postgres availability.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

const USERNAME = 'admin'
const OLD_PASSWORD = 'concept-pilot-test-pw'
const NEW_PASSWORD = 'rotated-password-2026'

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

function extractCookies(res: InjectResult): string {
  const setCookie = res.headers['set-cookie']
  if (setCookie === undefined) return ''
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  return arr.map((c) => String(c).split(';')[0]).join('; ')
}

describe.skipIf(!isWebBuilt || !HAS_PG)('must-change-password gate', () => {
  test('full lifecycle: bootstrap → login → 403-on-other → rotate → full access', async () => {
    const { defaultPasswordProvider } = await import(
      '../../../src/main/auth/providers/argon2-provider'
    )
    const passwordHash = await defaultPasswordProvider.hashPassword(OLD_PASSWORD)
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-rot-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        admin: { username: USERNAME, passwordHash, displayName: 'Test Admin' }
      })
      try {
        // 2: login
        const loginRes = (await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [USERNAME, OLD_PASSWORD] }
        })) as unknown as InjectResult
        expect(loginRes.statusCode).toBe(200)
        const loginBody = loginRes.json() as { success: boolean; mustChangePassword?: boolean }
        expect(loginBody.success).toBe(true)
        expect(loginBody.mustChangePassword).toBe(true)
        const cookie = extractCookies(loginRes)
        expect(cookie).not.toBe('')

        // 3: reach for a read endpoint that's neither changePassword
        // nor logout. database:capabilities is the lightest available;
        // the gate fires before the override even runs.
        const readBlocked = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(readBlocked.statusCode).toBe(403)
        expect((readBlocked.json() as { error: string }).error).toBe('password-rotation-required')

        // 4: wrong old password → 401, gate still active.
        const wrongOld = (await app.inject({
          method: 'POST',
          url: '/api/auth/changePassword',
          payload: { args: ['nope', NEW_PASSWORD] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(wrongOld.statusCode).toBe(401)
        const stillGated = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(stillGated.statusCode).toBe(403)

        // 5: too short → 422 (PasswordPolicyError surface).
        const tooShort = (await app.inject({
          method: 'POST',
          url: '/api/auth/changePassword',
          payload: { args: [OLD_PASSWORD, 'short'] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(tooShort.statusCode).toBe(422)
        expect((tooShort.json() as { error: string }).error).toBe('too-short')

        // 6: new === old → 422.
        const sameAsOld = (await app.inject({
          method: 'POST',
          url: '/api/auth/changePassword',
          payload: { args: [OLD_PASSWORD, OLD_PASSWORD] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(sameAsOld.statusCode).toBe(422)
        expect((sameAsOld.json() as { error: string }).error).toBe('same-as-old')

        // 7: valid rotation.
        const rotateRes = (await app.inject({
          method: 'POST',
          url: '/api/auth/changePassword',
          payload: { args: [OLD_PASSWORD, NEW_PASSWORD] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(rotateRes.statusCode).toBe(200)
        expect((rotateRes.json() as { success: boolean }).success).toBe(true)

        // 8: same cookie now reaches the read surface.
        const readAllowed = (await app.inject({
          method: 'POST',
          url: '/api/database/capabilities',
          payload: { args: [] },
          headers: { cookie }
        })) as unknown as InjectResult
        expect(readAllowed.statusCode).toBe(200)

        // Re-login with the new password works; the new session is no
        // longer must_change_password.
        const reloginRes = (await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [USERNAME, NEW_PASSWORD] }
        })) as unknown as InjectResult
        expect(reloginRes.statusCode).toBe(200)
        const reloginBody = reloginRes.json() as { success: boolean; mustChangePassword?: boolean }
        expect(reloginBody.success).toBe(true)
        expect(reloginBody.mustChangePassword).toBe(false)
      } finally {
        await app.close()
      }
    } finally {
      delete process.env.VARLENS_RECOVERY_KEY_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('logout is reachable through the rotation gate', async () => {
    const { defaultPasswordProvider } = await import(
      '../../../src/main/auth/providers/argon2-provider'
    )
    const passwordHash = await defaultPasswordProvider.hashPassword(OLD_PASSWORD)
    const dir = mkdtempSync(join(tmpdir(), 'varlens-web-gate-rot-'))
    process.env.VARLENS_RECOVERY_KEY_DIR = dir
    try {
      const { buildApp } = await import('../../../src/web/server')
      const app = await buildApp({
        admin: { username: USERNAME, passwordHash, displayName: 'Test Admin' }
      })
      try {
        const loginRes = (await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { args: [USERNAME, OLD_PASSWORD] }
        })) as unknown as InjectResult
        const cookie = extractCookies(loginRes)
        expect(cookie).not.toBe('')

        const logoutRes = (await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          payload: { args: [] },
          headers: { cookie }
        })) as unknown as InjectResult
        // Logout returns 200 even pre-rotation — the user can always
        // drop their session.
        expect(logoutRes.statusCode).toBe(200)
      } finally {
        await app.close()
      }
    } finally {
      delete process.env.VARLENS_RECOVERY_KEY_DIR
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
