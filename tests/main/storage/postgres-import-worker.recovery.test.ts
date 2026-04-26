import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

import { recoverTriggersOnStartup } from '../../../src/main/workers/postgres-import-worker'

const RUN = process.env.VARLENS_RUN_POSTGRES_E2E === '1'
const PG_URL =
  process.env.VARLENS_PG_URL ??
  'postgres://varlens:varlens_dev_password@127.0.0.1:55432/varlens_dev'
const PG_SCHEMA = process.env.VARLENS_PG_SCHEMA ?? 'public'

const TRIGGER_NAMES = [
  'variants_search_document_tg',
  'variant_sv_search_document_tg',
  'variant_str_search_document_tg'
] as const

async function readTriggerStates(client: Client): Promise<Record<string, string>> {
  const result = await client.query<{ tgname: string; tgenabled: string }>(
    `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = ANY($1::text[])`,
    [TRIGGER_NAMES as unknown as string[]]
  )
  const out: Record<string, string> = {}
  for (const row of result.rows) out[row.tgname] = row.tgenabled
  return out
}

async function disableAllTriggers(client: Client): Promise<void> {
  await client.query('ALTER TABLE "variants"    DISABLE TRIGGER variants_search_document_tg')
  await client.query('ALTER TABLE "variant_sv"  DISABLE TRIGGER variant_sv_search_document_tg')
  await client.query('ALTER TABLE "variant_str" DISABLE TRIGGER variant_str_search_document_tg')
}

async function enableAllTriggers(client: Client): Promise<void> {
  await client.query('ALTER TABLE "variants"    ENABLE TRIGGER variants_search_document_tg')
  await client.query('ALTER TABLE "variant_sv"  ENABLE TRIGGER variant_sv_search_document_tg')
  await client.query('ALTER TABLE "variant_str" ENABLE TRIGGER variant_str_search_document_tg')
}

describe.skipIf(!RUN)('postgres-import-worker recovery shim', () => {
  let control: Client

  beforeAll(async () => {
    control = new Client({ connectionString: PG_URL })
    await control.connect()
  })

  afterAll(async () => {
    // Always leave triggers enabled so subsequent tests are not affected.
    try {
      await enableAllTriggers(control)
    } finally {
      await control.end()
    }
  })

  it('re-enables all three triggers when prior session left them disabled', async () => {
    // Simulate prior-session leak.
    await disableAllTriggers(control)

    const before = await readTriggerStates(control)
    for (const name of TRIGGER_NAMES) {
      expect(before[name], `trigger ${name} setup`).toBe('D')
    }

    // Run the recovery shim through a fresh client (matching real worker behavior).
    const worker = new Client({ connectionString: PG_URL })
    await worker.connect()
    try {
      await recoverTriggersOnStartup(worker, PG_SCHEMA)
    } finally {
      await worker.end()
    }

    const after = await readTriggerStates(control)
    for (const name of TRIGGER_NAMES) {
      expect(after[name], `trigger ${name} after recovery`).toBe('O')
    }
  })

  it('is idempotent — running the shim twice on already-enabled triggers is a no-op', async () => {
    await enableAllTriggers(control)

    const worker = new Client({ connectionString: PG_URL })
    await worker.connect()
    try {
      await recoverTriggersOnStartup(worker, PG_SCHEMA)
      await recoverTriggersOnStartup(worker, PG_SCHEMA)
    } finally {
      await worker.end()
    }

    const after = await readTriggerStates(control)
    for (const name of TRIGGER_NAMES) {
      expect(after[name]).toBe('O')
    }
  })
})
