import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runImport } from '../../../src/main/workers/postgres-import-worker'
import type { PostgresImportWorkerStartMessage } from '../../../src/shared/types/postgres-import-worker'

describe('postgres-import-worker runImport', () => {
  it('drives VCF parsing and writes through PostgresVcfImportRepository', async () => {
    const queries: string[] = []
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
        if (text.startsWith('INSERT INTO') && text.includes('"cases"'))
          return { rows: [{ id: 13 }] }
        if (text.includes('"variants"') && text.includes('jsonb_to_recordset')) {
          const payload = JSON.parse(String((params as unknown[])[0])) as unknown[]
          return { rows: payload.map((_, i) => ({ id: 5000 + i })) }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const messages: unknown[] = []

    // Build a minimal mapped row matching the VcfMappedVariant shape.
    const fakeVariant = {
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gene_symbol: 'BRCA1',
      omim_mim_number: null,
      consequence: 'HIGH',
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      gt_num: '0/1',
      func: 'missense_variant',
      qual: 50,
      hpo_sim_score: null,
      transcript: 'ENST1',
      cdna: 'c.1A>T',
      aa_change: 'p.M1I',
      hpo_match: null,
      moi: null,
      gq: 99,
      dp: 30,
      ad_ref: 15,
      ad_alt: 15,
      ab: 0.5,
      filter: 'PASS',
      info_json: null,
      source_format: 'vcf',
      variant_type: 'snv',
      end_pos: null,
      sv_type: null,
      sv_length: null,
      caller: null
    }

    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from([fakeVariant]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'single-file',
        caseName: 'VCF case',
        filePath: '/tmp/a.vcf.gz',
        format: 'vcf',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' }
      },
      (m) => messages.push(m)
    )

    expect(queries[0]).toBe('BEGIN')
    expect(queries.at(-1)).toBe('COMMIT')
    expect(
      queries.find((q) => q.includes('"variants"') && q.includes('jsonb_to_recordset'))
    ).toBeDefined()
    expect(queries.find((q) => q.includes('"variant_frequency"'))).toBeDefined()
    expect(queries.find((q) => q.startsWith('UPDATE') && q.includes('variant_count'))).toBeDefined()

    const complete = messages.find(
      (m): m is { type: 'complete'; result: { variantCount: number } } =>
        (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
    expect(complete?.result.variantCount).toBe(1)
  })

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
