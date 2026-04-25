import { describe, expect, it, vi } from 'vitest'
import { runImport } from '../../../src/main/workers/postgres-import-worker'
import type { PostgresImportWorkerStartMessage } from '../../../src/shared/types/postgres-import-worker'

describe('postgres-import-worker runImport', () => {
  it('opens client, runs BEGIN/COMMIT for single-file JSON, posts complete', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] }
        if (typeof sql === 'string' && sql.startsWith('SELECT id FROM')) return { rows: [] }
        if (typeof sql === 'string' && sql.includes('"cases"') && sql.startsWith('INSERT')) {
          return { rows: [{ id: 11 }] }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []
    const post = (m: unknown) => messages.push(m)

    const start: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: { connectionString: 'postgres://x' },
      schema: 'public',
      mode: 'single-file',
      caseName: 'JSON case',
      filePath: '/tmp/a.json',
      format: 'json'
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'simple', caseKey: '' }) as never,
        createMapperPipeline: async () => {
          const { Readable } = await import('node:stream')
          return Readable.from([{ chr: '1', pos: 1, ref: 'A', alt: 'T' }])
        },
        statFile: () => ({ size: 100 })
      },
      start,
      post
    )

    expect(queries[0]).toBe('BEGIN')
    expect(queries.some((q) => q.startsWith('SELECT id FROM'))).toBe(true)
    expect(queries.some((q) => q.includes('"cases"') && q.startsWith('INSERT'))).toBe(true)
    expect(queries.some((q) => q.includes('"variant_frequency"'))).toBe(true)
    expect(queries.at(-1)).toBe('COMMIT')

    const complete = messages.find(
      (m): m is { type: 'complete' } => (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
  })
})
