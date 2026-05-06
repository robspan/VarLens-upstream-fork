import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { fork } from 'child_process'
import { resolve } from 'path'

/**
 * §app2.1 Phase 1 gate — boot must fail loudly, not start a half-server.
 *
 * Earlier behavior silently swallowed DatabaseService init errors and
 * started Fastify with no routes registered, leaving operators with a
 * server that returns 404 for every domain endpoint. The contract is now:
 * if the configured database is unreachable, the binary exits non-zero
 * and emits a JSON error line to stderr. No half-states.
 *
 * Real socket / real exit code, so this uses fork() like sigterm.test.ts.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

describe.skipIf(!isWebBuilt)('fail-loud boot', () => {
  test('exits non-zero with structured stderr JSON when VARLENS_DB_PATH is unreachable', async () => {
    // Filter VARLENS_* off the parent env so admin / log / port vars from a
    // developer shell can't influence the failure path being tested.
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('VARLENS_'))
    )

    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...cleanEnv,
        VARLENS_WEB_PORT: '0',
        VARLENS_DB_PATH: '/nonexistent/path/that/cannot/be/created/varlens.db'
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

    // The contract: exit non-zero AND emit a structured JSON line on stderr.
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

  test('exits non-zero with structured stderr JSON when VARLENS_DB_PATH is unset', async () => {
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('VARLENS_'))
    )

    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...cleanEnv,
        VARLENS_WEB_PORT: '0'
        // VARLENS_DB_PATH deliberately unset
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
    // The error message should specifically reference VARLENS_DB_PATH so we
    // know we hit the right failure path, not some unrelated crash.
    const errPayload = fatalLine?.err as { message?: string } | undefined
    expect(errPayload?.message ?? '').toMatch(/VARLENS_DB_PATH/i)
  })
})
