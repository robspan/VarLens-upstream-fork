import { describe, expect, it, vi } from 'vitest'
import {
  PostgresVcfImportRepository,
  type PostgresVcfImportRequest
} from '../../../src/main/storage/postgres/PostgresVcfImportRepository'

const makeFakeClient = () => {
  const queries: Array<{ text: string; params?: unknown[] }> = []
  const client = {
    query: vi.fn(async (sql: string | { text: string }, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : sql.text
      queries.push({ text, params })
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) return { rows: [{ id: 31 }] }
      if (
        text.startsWith('INSERT INTO') &&
        text.includes('"variants"') &&
        text.includes('jsonb_to_recordset')
      ) {
        // The batch insert is `INSERT ... SELECT ... FROM jsonb_to_recordset($1::jsonb)`.
        // Tests construct a small payload and assert the SQL shape; ordinal-aware
        // RETURNING is exercised by checking the response shape.
        const payload = JSON.parse(String((params as unknown[])[0])) as unknown[]
        return { rows: payload.map((_, i) => ({ ordinal: i, id: 1000 + i })) }
      }
      return { rows: [] }
    })
  }
  return { client, queries }
}

describe('PostgresVcfImportRepository.writeVcfFile', () => {
  it('issues no transaction-lifecycle SQL', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    const req: PostgresVcfImportRequest = {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    }
    await repo.writeVcfFile(client as never, req)
    expect(queries.map((q) => q.text)).not.toContain('BEGIN')
    expect(queries.map((q) => q.text)).not.toContain('COMMIT')
    expect(queries.map((q) => q.text)).not.toContain('ROLLBACK')
    expect(queries.find((q) => q.text.includes('"variant_frequency"'))).toBeUndefined()
  })

  it('rejects pre-existing case in multi-file mode at file index 0', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementationOnce(async () => ({ rows: [{ id: 99 }] }))
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'multi-file',
        fileIndex: 0,
        caseName: 'PreExisting',
        fileName: 'a.vcf.gz',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toThrow(/case 'PreExisting' already exists/)
  })

  it('looks up case by name at fileIndex >= 1 instead of inserting', async () => {
    const { client, queries } = makeFakeClient()
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"'))
        return { rows: [{ id: 7 }] }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'multi-file',
      fileIndex: 1,
      caseName: 'Multi',
      fileName: 'b.vcf.gz',
      filePath: '/tmp/b.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    // No INSERT INTO cases for fileIndex >= 1
    expect(
      queries.find((q) => q.text.startsWith('INSERT INTO') && q.text.includes('"cases"'))
    ).toBeUndefined()
  })

  it('batches base variants and extension rows with jsonb_to_recordset', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf.gz',
      filePath: '/tmp/a.vcf.gz',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [
        { ordinal: 0, hgvs_c: 'c.1A>T', hgvs_p: null, gene_symbol: 'BRCA1', is_selected: 1 }
      ],
      sv: [],
      cnv: [],
      str: []
    })
    const variantsInsert = queries.find(
      (q) => q.text.includes('"variants"') && q.text.includes('jsonb_to_recordset')
    )
    expect(variantsInsert).toBeDefined()
    const transcriptsInsert = queries.find(
      (q) => q.text.includes('"variant_transcripts"') && q.text.includes('jsonb_to_recordset')
    )
    expect(transcriptsInsert).toBeDefined()
  })

  it('single-file mode rejects pre-existing case name', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementationOnce(async () => ({ rows: [{ id: 55 }] }))
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'single-file',
        caseName: 'Existing',
        fileName: 'a.vcf.gz',
        filePath: '/tmp/a.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toThrow(/case 'Existing' already exists/)
  })

  it('multi-file fileIndex >= 1 rejects when case does not exist', async () => {
    const { client } = makeFakeClient()
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await expect(
      repo.writeVcfFile(client as never, {
        mode: 'multi-file',
        fileIndex: 1,
        caseName: 'Missing',
        fileName: 'b.vcf.gz',
        filePath: '/tmp/b.vcf.gz',
        fileSize: 0,
        genomeBuild: 'GRCh38',
        caller: null,
        annotationFormat: null,
        variantType: 'snv-indel',
        variants: [],
        transcripts: [],
        sv: [],
        cnv: [],
        str: []
      })
    ).rejects.toThrow(/case 'Missing' not found/)
  })

  it('writes a case_data_info row per call', async () => {
    const { client, queries } = makeFakeClient()
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'CDI',
      fileName: 'test.vcf.gz',
      filePath: '/tmp/test.vcf.gz',
      fileSize: 100,
      genomeBuild: 'GRCh38',
      caller: 'gatk',
      annotationFormat: 'vep',
      variantType: 'snv-indel',
      variants: [],
      transcripts: [],
      sv: [],
      cnv: [],
      str: []
    })
    const cdiInsert = queries.find(
      (q) => q.text.includes('"case_data_info"') && q.text.startsWith('INSERT INTO')
    )
    expect(cdiInsert).toBeDefined()
  })

  it('correlates variant_id from RETURNING into extension rows by ordinal', async () => {
    const { client, queries } = makeFakeClient()
    // Make the variants insert return ids 5000, 5001 in order.
    // Must also push to `queries` so the transcript insert is visible for assertions.
    client.query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = typeof sql === 'string' ? sql : (sql as { text: string }).text
      queries.push({ text, params })
      if (text.startsWith('SELECT id FROM') && text.includes('"cases"')) return { rows: [] }
      if (text.startsWith('INSERT INTO') && text.includes('"cases"')) return { rows: [{ id: 13 }] }
      if (
        text.startsWith('INSERT INTO') &&
        text.includes('"variants"') &&
        text.includes('jsonb_to_recordset')
      ) {
        return { rows: [{ id: 5000 }, { id: 5001 }] }
      }
      return { rows: [] }
    })
    const repo = new PostgresVcfImportRepository('public')
    await repo.writeVcfFile(client as never, {
      mode: 'single-file',
      caseName: 'X',
      fileName: 'a.vcf',
      filePath: '/tmp/a.vcf',
      fileSize: 0,
      genomeBuild: 'GRCh38',
      caller: null,
      annotationFormat: null,
      variantType: 'snv-indel',
      variants: [
        { chr: '1', pos: 100, ref: 'A', alt: 'T' },
        { chr: '1', pos: 200, ref: 'G', alt: 'C' }
      ],
      transcripts: [
        { ordinal: 0, transcript_id: 'ENST1' },
        { ordinal: 1, transcript_id: 'ENST2' }
      ],
      sv: [],
      cnv: [],
      str: []
    })
    const transcriptInsert = queries.find((q) => q.text.includes('"variant_transcripts"'))
    expect(transcriptInsert).toBeDefined()
    const payload = JSON.parse(String(transcriptInsert!.params![0])) as Array<
      Record<string, unknown>
    >
    expect(payload).toHaveLength(2)
    expect(payload[0].variant_id).toBe(5000)
    expect(payload[1].variant_id).toBe(5001)
  })
})
