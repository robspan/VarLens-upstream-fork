import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { fork } from 'child_process'
import { resolve } from 'path'

/**
 * Phase 2 gate — boot must fail loudly, not start a half-server.
 *
 * Phase 1 asserted on VARLENS_DB_PATH; Phase 2 flipped to Postgres-only,
 * so the contract now is: if VARLENS_PG_URL is missing or the configured
 * Postgres is unreachable, the binary exits non-zero and emits a JSON
 * error line on stderr. No half-states.
 *
 * Real socket / real exit code, so this uses fork() like sigterm.test.ts.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

describe.skipIf(!isWebBuilt)('fail-loud boot', () => {
  test('exits non-zero with structured stderr JSON when VARLENS_PG_URL is unset', async () => {
    // Filter VARLENS_* off the parent env so admin / log / port vars from a
    // developer shell can't influence the failure path being tested.
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('VARLENS_'))
    )

    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...cleanEnv,
        VARLENS_WEB_PORT: '0'
        // VARLENS_PG_URL deliberately unset — Phase 2 must abort.
      },
      stdio: 'pipe'
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const exitCode = await new Promise<number | null>((res, rej) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        rej(new Error('child did not exit within 10s'))
      }, 10_000)
      child.once('exit', (code) => {
        clearTimeout(timeout)
        res(code)
      })
    })

    expect(exitCode).not.toBe(0)
    expect(exitCode).not.toBeNull()

    const lines = stderr.split('\n').filter((line) => line.trim() !== '')
    const fatalLine = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return undefined
        }
      })
      .find((parsed) => parsed !== undefined && parsed.level === 50)

    expect(fatalLine, `no fatal JSON line found in stderr:\n${stderr}`).toBeDefined()
    // Phase 2 specifically references VARLENS_PG_URL — verify we hit the
    // right failure path rather than some unrelated crash.
    const errPayload = fatalLine?.err as { message?: string } | undefined
    expect(errPayload?.message ?? '').toMatch(/VARLENS_PG_URL/i)
  })

  test('exits non-zero when VARLENS_PG_URL points at an unreachable Postgres', async () => {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('VARLENS_'))
    )

    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...cleanEnv,
        VARLENS_WEB_PORT: '0',
        // 127.0.0.1:1 is "discard" / TCP RST under POSIX; pg should fail
        // to connect promptly with no port-listener confusion.
        VARLENS_PG_URL: 'postgres://noone:nopw@127.0.0.1:1/none',
        VARLENS_PG_CONNECTION_TIMEOUT_MS: '1500'
      },
      stdio: 'pipe'
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const exitCode = await new Promise<number | null>((res, rej) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        rej(new Error('child did not exit within 15s'))
      }, 15_000)
      child.once('exit', (code) => {
        clearTimeout(timeout)
        res(code)
      })
    })

    expect(exitCode).not.toBe(0)
    expect(exitCode).not.toBeNull()

    const lines = stderr.split('\n').filter((line) => line.trim() !== '')
    const fatalLine = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return undefined
        }
      })
      .find((parsed) => parsed !== undefined && parsed.level === 50)

    expect(fatalLine, `no fatal JSON line found in stderr:\n${stderr}`).toBeDefined()
    expect(fatalLine?.msg).toMatch(/fatal|web server/i)
  })
})
