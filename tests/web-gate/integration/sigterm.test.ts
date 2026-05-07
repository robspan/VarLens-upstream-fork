import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { fork } from 'child_process'
import { resolve } from 'path'

/**
 * Phase 2 gate — SIGTERM closes the server cleanly within 5 seconds:
 * in-flight requests finish, new connections are refused, exit code 0.
 *
 * Unlike the other Layer 2 tests, this one cannot use `fastify.inject()`
 * — we need a real socket and a real signal. Forks the web entrypoint
 * with `child_process.fork()`, sends SIGTERM, asserts on exit code +
 * timing.
 *
 * Gated on (a) the web build existing AND (b) VARLENS_PG_URL being
 * set. Phase 2's Postgres-only flip means the forked child needs a
 * reachable Postgres or it aborts before announcing a port.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('SIGTERM clean shutdown', () => {
  test('SIGTERM exits 0 within 5 seconds with no in-flight loss', async () => {
    const child = fork(WEB_BUILD_PATH, [], {
      env: {
        ...process.env,
        VARLENS_WEB_PORT: '0' // ephemeral; VARLENS_PG_URL inherited from parent
      },
      stdio: 'pipe'
    })

    // Wait for the child to print its bound port.
    const port = await new Promise<number>((res, rej) => {
      const timeout = setTimeout(() => rej(new Error('child did not announce port')), 10_000)
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>
            if (typeof parsed.port === 'number') {
              clearTimeout(timeout)
              res(parsed.port)
              return
            }
          } catch {
            // not a JSON line — continue
          }
        }
      })
    })

    const start = Date.now()
    // Fire and don't await — we want a real in-flight request when SIGTERM lands.
    const inFlight = fetch(`http://127.0.0.1:${port}/healthz`)

    // Tiny delay so the request has actually started.
    await new Promise((res) => setTimeout(res, 50))
    child.kill('SIGTERM')

    const exitCode = await new Promise<number | null>((res) => {
      child.once('exit', (code) => res(code))
    })
    const elapsed = Date.now() - start

    expect(exitCode).toBe(0)
    expect(elapsed).toBeLessThan(5_000)

    // The in-flight request should have completed cleanly.
    const inFlightResponse = await inFlight.catch((e) => e as Error)
    expect(
      inFlightResponse instanceof Error,
      `in-flight request was dropped: ${inFlightResponse instanceof Error ? inFlightResponse.message : 'ok'}`
    ).toBe(false)
  })
})
