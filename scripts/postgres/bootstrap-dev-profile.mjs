#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { URL } from 'node:url'

const DEFAULT_ENV_FILE = '.env.postgres.local'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 5432
const DEFAULT_SCHEMA = 'public'
const DEFAULT_PROFILE_NAME = 'Local PostgreSQL'
const DEFAULT_POOL_MAX = 4
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000
const DEFAULT_STATEMENT_TIMEOUT_MS = 30000
const DEFAULT_LOCK_TIMEOUT_MS = 5000
const DEFAULT_IDLE_IN_TX_TIMEOUT_MS = 10000
const FIXTURE_PATH = 'tests/.cache/postgres-profile/dev-profile.fixture.json'

function parseArgs(argv) {
  const options = {
    envFile: DEFAULT_ENV_FILE,
    writeFixture: false
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--write-fixture') {
      options.writeFixture = true
      continue
    }

    if (arg === '--env-file') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error('--env-file requires a path')
      }
      options.envFile = next
      i += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function stripOptionalQuotes(value) {
  if (value.length < 2) return value

  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }

  return value
}

function parseEnvFile(contents) {
  const env = {}

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex === -1) continue

    const key = normalized.slice(0, separatorIndex).trim()
    const rawValue = normalized.slice(separatorIndex + 1).trim()
    if (key === '') continue

    env[key] = stripOptionalQuotes(rawValue)
  }

  return env
}

function parsePositiveInteger(value, envName, fallback) {
  if (value === undefined || value.trim() === '') return fallback

  if (!/^\d+$/u.test(value.trim())) {
    throw new Error(`${envName} must be a positive integer`)
  }

  const parsed = Number(value.trim())
  if (parsed < 1) {
    throw new Error(`${envName} must be a positive integer`)
  }

  return parsed
}

function requireNonBlank(value, envName) {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${envName} must be set`)
  }

  return value.trim()
}

function parsePostgresUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('protocol')
    }
    return parsed
  } catch {
    throw new Error('VARLENS_PG_URL must be a valid postgres:// or postgresql:// URL')
  }
}

function deriveSslMode(env, url) {
  const raw =
    env.VARLENS_PG_SSL_MODE?.trim() || url?.searchParams.get('sslmode')?.trim() || 'disable'

  if (raw === 'require' || raw === 'verify-full' || raw === 'verify-ca') {
    return 'require-verify'
  }

  if (raw === 'disable' || raw === 'prefer') {
    return 'disable'
  }

  throw new Error(`Invalid PostgreSQL SSL mode: ${raw}`)
}

function redactUrl(url) {
  const redacted = new URL(url.toString())
  redacted.username = ''
  redacted.password = ''
  redacted.search = ''
  return redacted.toString()
}

function buildProfilePreview(env, source) {
  const rawUrl = env.VARLENS_PG_URL?.trim()
  const url = rawUrl === undefined || rawUrl === '' ? null : parsePostgresUrl(rawUrl)

  const host = url?.hostname || DEFAULT_HOST
  const port = url?.port
    ? parsePositiveInteger(url.port, 'VARLENS_PG_URL port', DEFAULT_PORT)
    : parsePositiveInteger(env.VARLENS_PG_PORT, 'VARLENS_PG_PORT', DEFAULT_PORT)
  const database =
    url === null
      ? requireNonBlank(env.POSTGRES_DB, 'POSTGRES_DB')
      : requireNonBlank(
          decodeURIComponent(url.pathname.replace(/^\//u, '')),
          'VARLENS_PG_URL database'
        )
  const username =
    url === null
      ? requireNonBlank(env.POSTGRES_USER, 'POSTGRES_USER')
      : requireNonBlank(decodeURIComponent(url.username), 'VARLENS_PG_URL username')
  const schema =
    env.VARLENS_PG_SCHEMA === undefined || env.VARLENS_PG_SCHEMA.trim() === ''
      ? DEFAULT_SCHEMA
      : env.VARLENS_PG_SCHEMA.trim()
  const passwordConfigured =
    (url?.password !== undefined && url.password !== '') ||
    (env.POSTGRES_PASSWORD !== undefined && env.POSTGRES_PASSWORD.trim() !== '')

  const profile = {
    name: DEFAULT_PROFILE_NAME,
    host,
    port,
    database,
    username,
    schema,
    sslMode: deriveSslMode(env, url),
    poolMax: parsePositiveInteger(env.VARLENS_PG_POOL_MAX, 'VARLENS_PG_POOL_MAX', DEFAULT_POOL_MAX),
    connectionTimeoutMillis: parsePositiveInteger(
      env.VARLENS_PG_CONNECTION_TIMEOUT_MS,
      'VARLENS_PG_CONNECTION_TIMEOUT_MS',
      DEFAULT_CONNECTION_TIMEOUT_MS
    ),
    statementTimeoutMs: parsePositiveInteger(
      env.VARLENS_PG_STATEMENT_TIMEOUT_MS,
      'VARLENS_PG_STATEMENT_TIMEOUT_MS',
      DEFAULT_STATEMENT_TIMEOUT_MS
    ),
    lockTimeoutMs: parsePositiveInteger(
      env.VARLENS_PG_LOCK_TIMEOUT_MS,
      'VARLENS_PG_LOCK_TIMEOUT_MS',
      DEFAULT_LOCK_TIMEOUT_MS
    ),
    idleInTransactionSessionTimeoutMs: parsePositiveInteger(
      env.VARLENS_PG_IDLE_IN_TX_TIMEOUT_MS,
      'VARLENS_PG_IDLE_IN_TX_TIMEOUT_MS',
      DEFAULT_IDLE_IN_TX_TIMEOUT_MS
    ),
    caCertificateConfigured: false
  }

  const redactedUrl =
    url === null ? `postgres://${host}:${port}/${encodeURIComponent(database)}` : redactUrl(url)

  return {
    source,
    profile,
    connection: {
      redactedUrl,
      passwordConfigured
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const envFile = resolve(options.envFile)
  const env = parseEnvFile(await readFile(envFile, 'utf8'))
  const preview = buildProfilePreview(env, envFile)

  if (options.writeFixture) {
    const fixturePath = resolve(FIXTURE_PATH)
    await mkdir(dirname(fixturePath), { recursive: true })
    await writeFile(
      fixturePath,
      `${JSON.stringify(
        {
          profile: preview.profile,
          connection: preview.connection
        },
        null,
        2
      )}\n`
    )
    preview.fixturePath = fixturePath
  }

  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
