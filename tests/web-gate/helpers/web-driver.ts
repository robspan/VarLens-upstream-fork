import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { Pool } from 'pg'
import type { FastifyInstance } from 'fastify'

import type { buildApp as buildAppType, BuildAppOptions } from '../../../src/web/server'

const BOOTSTRAP_PASSWORD = 'web-gate-bootstrap-password-2026'
const ACTIVE_PASSWORD = 'web-gate-active-password-2026'
export const SAME_ORIGIN_HEADERS = {
  host: 'varlens.test',
  origin: 'http://varlens.test',
  'x-forwarded-proto': 'http'
} as const

interface InjectResult {
  statusCode: number
  body: string
  headers: Record<string, string | string[] | undefined>
  json: () => unknown
}

export interface IsolatedWebSchema {
  schema: string
  recoveryDir: string
  close: () => Promise<void>
}

export interface WebDriver {
  app: FastifyInstance
  schema: string
  cookie: string
  api: (domain: string, method: string, ...args: unknown[]) => Promise<InjectResult>
  close: () => Promise<void>
}

function extractCookies(res: InjectResult): string {
  const setCookie = res.headers['set-cookie']
  if (setCookie === undefined) return ''
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie]
  return arr.map((c) => String(c).split(';')[0]).join('; ')
}

function makeSchemaName(prefix = 'web_gate'): string {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${prefix}_${suffix.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

async function dropSchema(url: string, schema: string): Promise<void> {
  const pool = new Pool({ connectionString: url })
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  } finally {
    await pool.end()
  }
}

export async function startIsolatedWebSchema(prefix?: string): Promise<IsolatedWebSchema> {
  const pgUrl = process.env.VARLENS_PG_URL
  if (pgUrl === undefined || pgUrl.trim() === '') {
    throw new Error('startIsolatedWebSchema requires VARLENS_PG_URL')
  }

  const previousRecoveryDir = process.env.VARLENS_RECOVERY_KEY_DIR
  const previousNodeEnv = process.env.NODE_ENV
  const previousSchema = process.env.VARLENS_PG_SCHEMA

  const recoveryDir = mkdtempSync(join(tmpdir(), 'varlens-web-driver-'))
  const schema = makeSchemaName(prefix)

  process.env.VARLENS_RECOVERY_KEY_DIR = recoveryDir
  process.env.NODE_ENV = 'test'
  process.env.VARLENS_PG_SCHEMA = schema

  let closed = false

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    if (previousRecoveryDir === undefined) delete process.env.VARLENS_RECOVERY_KEY_DIR
    else process.env.VARLENS_RECOVERY_KEY_DIR = previousRecoveryDir

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv

    if (previousSchema === undefined) delete process.env.VARLENS_PG_SCHEMA
    else process.env.VARLENS_PG_SCHEMA = previousSchema

    rmSync(recoveryDir, { recursive: true, force: true })
    await dropSchema(pgUrl, schema)
  }

  return { schema, recoveryDir, close }
}

export async function startWebDriver(
  options: Pick<BuildAppOptions, 'metrics'> = {}
): Promise<WebDriver> {
  const isolated = await startIsolatedWebSchema('web_driver')

  let app: FastifyInstance | undefined
  let closed = false

  async function close(): Promise<void> {
    if (closed) return
    closed = true
    try {
      await app?.close()
    } finally {
      await isolated.close()
    }
  }

  try {
    const { defaultPasswordProvider } =
      await import('../../../src/main/auth/providers/argon2-provider')
    const passwordHash = await defaultPasswordProvider.hashPassword(BOOTSTRAP_PASSWORD)
    const { buildApp } = (await import('../../../src/web/server')) as {
      buildApp: typeof buildAppType
    }

    app = await buildApp({
      admin: {
        username: 'web-gate-admin',
        passwordHash,
        displayName: 'Web Gate Admin'
      },
      metrics: options.metrics
    })

    const loginRes = (await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { args: ['web-gate-admin', BOOTSTRAP_PASSWORD] },
      headers: SAME_ORIGIN_HEADERS
    })) as unknown as InjectResult
    if (loginRes.statusCode !== 200) {
      throw new Error(`web driver login failed: ${loginRes.statusCode} ${loginRes.body}`)
    }

    let cookie = extractCookies(loginRes)
    if (cookie === '') {
      throw new Error('web driver login did not set a session cookie')
    }

    const rotateRes = (await app.inject({
      method: 'POST',
      url: '/api/auth/changePassword',
      payload: { args: [BOOTSTRAP_PASSWORD, ACTIVE_PASSWORD] },
      headers: { ...SAME_ORIGIN_HEADERS, cookie }
    })) as unknown as InjectResult
    if (rotateRes.statusCode !== 200) {
      throw new Error(
        `web driver password rotation failed: ${rotateRes.statusCode} ${rotateRes.body}`
      )
    }
    cookie = extractCookies(rotateRes) || cookie

    return {
      app,
      schema: isolated.schema,
      cookie,
      api: async (domain, method, ...args) =>
        (await app!.inject({
          method: 'POST',
          url: `/api/${domain}/${method}`,
          payload: { args },
          headers: { ...SAME_ORIGIN_HEADERS, cookie }
        })) as unknown as InjectResult,
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}
