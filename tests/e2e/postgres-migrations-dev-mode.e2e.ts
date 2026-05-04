import { expect, test } from '@playwright/test'
import { Client } from 'pg'

import { launchElectronApp, waitForAppShell } from './helpers/electron-app'

const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const PG_SCHEMA = process.env.VARLENS_PG_SCHEMA ?? 'public'

test('postgres migrations create schema_migrations entries', async () => {
  test.skip(
    process.env.VARLENS_RUN_POSTGRES_E2E !== '1',
    'Set VARLENS_RUN_POSTGRES_E2E=1 and start local postgres'
  )

  let launched: Awaited<ReturnType<typeof launchElectronApp>> | undefined
  const client = new Client({ connectionString: PG_URL })

  try {
    launched = await launchElectronApp({
      env: {
        VARLENS_EXPERIMENTAL_STORAGE_BACKEND: 'postgres',
        VARLENS_PG_URL: PG_URL,
        VARLENS_PG_SCHEMA: PG_SCHEMA
      }
    })
    await waitForAppShell(launched.window)

    await client.connect()
    const result = await client.query<{ version: string }>(
      `SELECT version FROM "${PG_SCHEMA}"."schema_migrations" ORDER BY version`
    )
    const versions = result.rows.map((row) => row.version)

    expect(versions).toContain('0001')
    expect(versions).toContain('0004')
  } finally {
    await client.end()
    await launched?.cleanup()
  }
})
