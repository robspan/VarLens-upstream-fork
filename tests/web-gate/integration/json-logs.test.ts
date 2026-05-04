import { describe, expect, test } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Phase 1 gate — every log line emitted by the web container is valid
 * JSON with at minimum `level`, `time`, and `msg` fields. Concretely,
 * the Pino logger must be the only writer to stdout. Console.log calls
 * in the request path are a regression.
 *
 * SKIPPED until the web build target lands.
 */

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)

describe.skipIf(!isWebBuilt)('JSON logs to stdout', () => {
  test('every log line during a normal request is valid JSON with level/time/msg', async () => {
    const { buildApp } = await import('../../../src/web/server')

    const captured: string[] = []
    const originalWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      captured.push(text)
      // Suppress real output; we're just measuring.
      const cb = rest.find((r) => typeof r === 'function') as ((err?: Error) => void) | undefined
      cb?.()
      return true
    }) as typeof process.stdout.write

    try {
      const app = await buildApp({ db: ':memory:' })
      await app.inject({ method: 'GET', url: '/healthz' })
      await app.close()
    } finally {
      process.stdout.write = originalWrite
    }

    const lines = captured
      .join('')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new Error(`stdout line is not valid JSON: ${JSON.stringify(line)}`)
      }
      expect(parsed, `line missing required fields: ${line}`).toMatchObject({
        level: expect.anything(),
        time: expect.anything(),
        msg: expect.anything()
      })
    }
  })
})
