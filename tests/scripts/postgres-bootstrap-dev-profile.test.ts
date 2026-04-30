// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT_PATH = resolve('scripts/postgres/bootstrap-dev-profile.mjs')
const FIXTURE_DIR = resolve('tests/.cache/postgres-profile')
const PASSWORD = 'super-secret-password'

async function writeTempEnv(contents: string): Promise<{ dir: string; envPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'varlens-pg-profile-'))
  const envPath = join(dir, '.env.postgres.local')
  await writeFile(envPath, contents)
  return { dir, envPath }
}

function runScript(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8'
  })
}

describe('postgres dev profile bootstrap script', () => {
  afterEach(async () => {
    await rm(FIXTURE_DIR, { recursive: true, force: true })
  })

  it('prints a redacted preview parsed from a temporary env file', async () => {
    const { dir, envPath } = await writeTempEnv(`
POSTGRES_DB=ignored_db
POSTGRES_USER=ignored_user
POSTGRES_PASSWORD=${PASSWORD}
VARLENS_PG_PORT=1111
VARLENS_PG_URL=postgres://dev_user:${PASSWORD}@db.local:6543/varlens_dev
VARLENS_PG_SCHEMA=clinical
VARLENS_PG_SSL_MODE=require
`)

    try {
      const result = runScript(['--env-file', envPath])

      expect(result.status).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).not.toContain(PASSWORD)

      const preview = JSON.parse(result.stdout)
      expect(preview).toMatchObject({
        source: envPath,
        profile: {
          name: 'Local PostgreSQL',
          host: 'db.local',
          port: 6543,
          database: 'varlens_dev',
          username: 'dev_user',
          schema: 'clinical',
          sslMode: 'require-verify'
        },
        connection: {
          passwordConfigured: true
        }
      })
      expect(preview.connection.redactedUrl).toBe('postgres://db.local:6543/varlens_dev')
      expect(preview.profile).not.toHaveProperty('secrets')
      expect(preview.connection).not.toHaveProperty('password')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to discrete env values when VARLENS_PG_URL is absent', async () => {
    const { dir, envPath } = await writeTempEnv(`
POSTGRES_DB=varlens_from_parts
POSTGRES_USER=parts_user
POSTGRES_PASSWORD=${PASSWORD}
VARLENS_PG_PORT=7654
VARLENS_PG_SCHEMA=research
`)

    try {
      const result = runScript(['--env-file', envPath])

      expect(result.status).toBe(0)
      const preview = JSON.parse(result.stdout)
      expect(preview.profile).toMatchObject({
        host: '127.0.0.1',
        port: 7654,
        database: 'varlens_from_parts',
        username: 'parts_user',
        schema: 'research',
        sslMode: 'disable'
      })
      expect(result.stdout).not.toContain(PASSWORD)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes a renderer-test fixture when requested', async () => {
    const { dir, envPath } = await writeTempEnv(`
POSTGRES_DB=fixture_db
POSTGRES_USER=fixture_user
POSTGRES_PASSWORD=${PASSWORD}
VARLENS_PG_PORT=7777
VARLENS_PG_URL=postgresql://fixture_user:${PASSWORD}@localhost:7777/fixture_db
VARLENS_PG_SCHEMA=fixture_schema
`)

    try {
      const result = runScript(['--env-file', envPath, '--write-fixture'])

      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain(PASSWORD)

      const preview = JSON.parse(result.stdout)
      expect(preview.fixturePath).toBe(join(FIXTURE_DIR, 'dev-profile.fixture.json'))

      const fixture = JSON.parse(await readFile(preview.fixturePath, 'utf8'))
      expect(fixture).toEqual({
        profile: {
          name: 'Local PostgreSQL',
          host: 'localhost',
          port: 7777,
          database: 'fixture_db',
          username: 'fixture_user',
          schema: 'fixture_schema',
          sslMode: 'disable',
          poolMax: 4,
          connectionTimeoutMillis: 5000,
          statementTimeoutMs: 30000,
          lockTimeoutMs: 5000,
          idleInTransactionSessionTimeoutMs: 10000,
          caCertificateConfigured: false
        },
        connection: {
          redactedUrl: 'postgresql://localhost:7777/fixture_db',
          passwordConfigured: true
        }
      })
      expect(JSON.stringify(fixture)).not.toContain(PASSWORD)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
