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

  it('runs one transaction per file in multi-file mode and surfaces per-file errors', async () => {
    const queries: string[] = []
    // Track how many times a variant batch insert has been attempted so we can
    // inject a failure on the second file's insert (file 1 succeeds, file 2 fails).
    let variantInsertCount = 0
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
        const text = typeof sql === 'string' ? sql : sql.text
        queries.push(text)
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
        // For the duplicate check (fileIndex 0) return empty; for the case-lookup
        // (fileIndex >= 1) return the case that file 1 created.
        if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) {
          // File 1 duplicate check fires before INSERT — return empty.
          // File 2 case lookup fires after file 1 committed — return the case.
          const alreadyInserted = queries.filter(
            (q) => q.startsWith('INSERT INTO') && q.includes('"cases"')
          ).length
          return alreadyInserted > 0 ? { rows: [{ id: 21 }] } : { rows: [] }
        }
        if (text.startsWith('INSERT INTO') && text.includes('"cases"')) {
          return { rows: [{ id: 21 }] }
        }
        if (text.includes('"variants"') && text.includes('jsonb_to_recordset')) {
          variantInsertCount += 1
          if (variantInsertCount === 2) throw new Error('inject failure on file 2 variant insert')
          const payload = JSON.parse(String((params as unknown[])[0])) as unknown[]
          return { rows: payload.map((_, i) => ({ id: 5000 + i })) }
        }
        return { rows: [] }
      }),
      end: vi.fn(async () => undefined)
    }
    const { Readable } = await import('node:stream')
    const fakeRow = {
      chr: '1',
      pos: 100,
      ref: 'A',
      alt: 'T',
      gene_symbol: null,
      omim_mim_number: null,
      consequence: null,
      gnomad_af: null,
      cadd: null,
      clinvar: null,
      gt_num: null,
      func: null,
      qual: null,
      hpo_sim_score: null,
      transcript: null,
      cdna: null,
      aa_change: null,
      hpo_match: null,
      moi: null,
      gq: null,
      dp: null,
      ad_ref: null,
      ad_alt: null,
      ab: null,
      filter: null,
      info_json: null,
      source_format: 'vcf',
      variant_type: 'snv',
      end_pos: null,
      sv_type: null,
      sv_length: null,
      caller: null
    }
    const messages: unknown[] = []
    await runImport(
      {
        createClient: () => client as never,
        detectFormat: async () => ({ format: 'vcf', caseKey: '' }) as never,
        createVcfMappedStream: async () => Readable.from([fakeRow]) as never,
        createMapperPipeline: async () => Readable.from([]),
        statFile: () => ({ size: 0 })
      },
      {
        type: 'start',
        client: { connectionString: 'postgres://x' },
        schema: 'public',
        mode: 'multi-file',
        caseName: 'Multi',
        vcfOptions: { selectedSample: 'NA12878', genomeBuild: 'GRCh38' },
        files: [
          {
            filePath: '/tmp/a.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          },
          {
            filePath: '/tmp/b.vcf.gz',
            variantType: 'snv-indel',
            annotationFormat: null,
            caller: null
          }
        ]
      },
      (m) => messages.push(m)
    )

    // outer BEGIN + ROLLBACK, file-1 BEGIN + COMMIT, file-2 BEGIN + ROLLBACK, post-loop BEGIN + COMMIT
    const beginCount = queries.filter((q) => q === 'BEGIN').length
    expect(beginCount).toBe(4)
    expect(queries.includes('ROLLBACK')).toBe(true)
    expect(queries.includes('COMMIT')).toBe(true)

    const complete = messages.find(
      (m): m is { type: 'complete'; result: { files: Array<{ error?: string }> } } =>
        (m as { type: string }).type === 'complete'
    )
    expect(complete).toBeDefined()
    const result = complete!.result
    expect(result.files[0].error).toBeUndefined()
    expect(result.files[1].error).toMatch(/inject failure on file 2/)
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
