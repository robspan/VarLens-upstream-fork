import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PostgresJsonImportRepository } from '../../../src/main/storage/postgres/PostgresJsonImportRepository'

type QueryReturn = { rows: unknown[]; rowCount?: number } | Error

function makeClient(rowsByCall: QueryReturn[] = []) {
  const query = vi.fn(async () => {
    const next = rowsByCall.shift()
    if (next instanceof Error) throw next
    return next ?? { rows: [], rowCount: 0 }
  })
  return { query, release: vi.fn() }
}

type ClientMock = ReturnType<typeof makeClient>

function makePool(client: ClientMock) {
  return {
    connect: vi.fn(async () => client)
  }
}

function queryCalls(client: ClientMock): Array<{ sql: string; params: unknown[] }> {
  return client.query.mock.calls.map((call) => {
    const [sql, params] = call as [unknown, unknown?]
    return {
      sql: typeof sql === 'string' ? sql : '',
      params: Array.isArray(params) ? params : []
    }
  })
}

function findCall(
  client: ClientMock,
  matcher: RegExp | ((sql: string) => boolean)
): { sql: string; params: unknown[] } | undefined {
  return queryCalls(client).find((call) => {
    if (call.sql === '') return false
    if (matcher instanceof RegExp) return matcher.test(call.sql)
    return matcher(call.sql)
  })
}

function findAllCalls(
  client: ClientMock,
  matcher: RegExp | ((sql: string) => boolean)
): Array<{ sql: string; params: unknown[] }> {
  return queryCalls(client).filter((call) => {
    if (call.sql === '') return false
    if (matcher instanceof RegExp) return matcher.test(call.sql)
    return matcher(call.sql)
  })
}

const baseRequest = {
  filePath: '/tmp/simple-format.json',
  fileName: 'simple-format.json',
  caseName: 'Imported JSON',
  fileSize: 100,
  genomeBuild: 'GRCh38',
  importFileType: 'simple' as const
}

describe('PostgresJsonImportRepository', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates case, inserts variants, stores provenance, refreshes frequency, commits', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate check SELECT
      { rows: [{ id: '4' }] }, // INSERT cases RETURNING id
      { rows: [{ id: '10' }, { id: '11' }] }, // variants batch INSERT
      { rows: [] }, // case_data_info upsert
      { rows: [] }, // UPDATE cases variant_count
      { rows: [] }, // variant_frequency refresh
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    const result = await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 12345, ref: 'A', alt: 'G', gene_symbol: 'BRCA1', consequence: 'HIGH' },
        { chr: '7', pos: 67890, ref: 'C', alt: 'T', gene_symbol: 'CFTR', consequence: 'MODERATE' }
      ])
    })

    expect(result).toStrictEqual({ caseId: 4, variantCount: 2 })

    // Transaction shape
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledWith()

    // Duplicate check
    const dupCheck = findCall(
      client,
      /SELECT\s+id\s+FROM\s+"public"\."cases"\s+WHERE\s+name\s*=\s*\$1/i
    )
    expect(dupCheck).toBeDefined()
    expect(dupCheck?.params).toStrictEqual(['Imported JSON'])

    // Case insert RETURNING id
    const caseInsert = findCall(client, /INSERT INTO\s+"public"\."cases"[\s\S]+RETURNING\s+id/i)
    expect(caseInsert).toBeDefined()

    // Variant batch uses jsonb_to_recordset
    const variantBatch = findCall(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(variantBatch).toBeDefined()

    // case_data_info upsert
    const caseDataInfo = findCall(
      client,
      /INSERT INTO\s+"public"\."case_data_info"[\s\S]+ON CONFLICT\s*\(\s*case_id\s*\)\s+DO UPDATE/i
    )
    expect(caseDataInfo).toBeDefined()

    // UPDATE variant_count
    const updateCount = findCall(
      client,
      /UPDATE\s+"public"\."cases"\s+SET\s+variant_count\s*=\s*\$1\s+WHERE\s+id\s*=\s*\$2/i
    )
    expect(updateCount).toBeDefined()
    expect(updateCount?.params).toStrictEqual([2, 4])

    // Frequency refresh at the end
    const freqCall = findCall(
      client,
      /INSERT INTO\s+"public"\."variant_frequency"[\s\S]+SELECT chr, pos, ref, alt, 1[\s\S]+FROM\s+"public"\."variants"[\s\S]+WHERE case_id = \$1[\s\S]+GROUP BY chr, pos, ref, alt[\s\S]+ON CONFLICT/i
    )
    expect(freqCall).toBeDefined()
    expect(freqCall?.params).toStrictEqual([4])
  })

  it('throws Duplicate case name when case exists', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: '99' }] } // duplicate check SELECT returns existing row
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await expect(
      repository.runJsonImport(baseRequest, async () => {
        /* not invoked */
      })
    ).rejects.toThrow(/Duplicate case name/)

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
    const releaseArg = client.release.mock.calls[0]?.[0]
    expect(releaseArg).toBeInstanceOf(Error)
  })

  it('rolls back and releases with error on insert failure', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      new Error('boom') // variant batch blows up
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await expect(
      repository.runJsonImport(baseRequest, async (session) => {
        await session.insertVariantBatch([
          { chr: '1', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'X', consequence: 'LOW' }
        ])
      })
    ).rejects.toThrow(/boom/)

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.query).not.toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
    const releaseArg = client.release.mock.calls[0]?.[0]
    expect(releaseArg).toBeInstanceOf(Error)
  })

  it('base variant batch uses jsonb_to_recordset with single JSON parameter', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // variant batch insert
      { rows: [] }, // case_data_info
      { rows: [] }, // update variant_count
      { rows: [] }, // frequency refresh
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G' },
        { chr: '2', pos: 2, ref: 'C', alt: 'T' }
      ])
    })

    const variantBatch = findCall(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(variantBatch).toBeDefined()
    // Exactly one bound parameter (the JSON payload)
    expect(variantBatch?.params).toHaveLength(1)
    // Parameter is a JSON string
    const payload = variantBatch?.params[0]
    expect(typeof payload).toBe('string')
    const parsed = JSON.parse(payload as string)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
  })

  it('includes import_ordinal in batch payloads for extension-bearing rows OR inserts them one at a time', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      // Row 1 has extension -> expected single-row INSERT ... RETURNING id
      { rows: [{ id: '10' }] },
      // variant_transcripts insert
      { rows: [] },
      { rows: [] }, // case_data_info
      { rows: [] }, // update variant_count
      { rows: [] }, // frequency refresh
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          _transcripts: [{ transcript_id: 'ENST00000001', gene_symbol: 'BRCA1', is_selected: 1 }]
        }
      ])
    })

    const baseInserts = findAllCalls(client, /INSERT INTO\s+"public"\."variants"/i)
    expect(baseInserts.length).toBeGreaterThan(0)

    const allVariantInserts = baseInserts
    // Strategy A: batched with import_ordinal OR Strategy B: one-at-a-time RETURNING id
    const hasOrdinalStrategy = allVariantInserts.some((call) => {
      if (call.params.length !== 1) return false
      try {
        const parsed = JSON.parse(String(call.params[0])) as Array<Record<string, unknown>>
        return parsed.every((row) => typeof row.import_ordinal === 'number')
      } catch {
        return false
      }
    })
    const hasOneAtATimeStrategy = allVariantInserts.some(
      (call) => /RETURNING\s+id/i.test(call.sql) && call.params.length === 1
    )

    expect(hasOrdinalStrategy || hasOneAtATimeStrategy).toBe(true)
  })

  it('extension table inserts use jsonb_to_recordset with variant_id populated', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate check
      { rows: [{ id: '4' }] }, // case insert
      // extension-bearing variant inserted one-at-a-time
      { rows: [{ id: '10' }] },
      { rows: [] }, // variant_transcripts jsonb_to_recordset
      { rows: [] }, // case_data_info
      { rows: [] }, // update variant_count
      { rows: [] }, // frequency refresh
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        {
          chr: '1',
          pos: 100,
          ref: 'A',
          alt: 'G',
          _transcripts: [
            { transcript_id: 'ENST00000001', gene_symbol: 'BRCA1', is_selected: 1 },
            { transcript_id: 'ENST00000002', gene_symbol: 'BRCA1', is_selected: 0 }
          ]
        }
      ])
    })

    const transcriptInsert = findCall(
      client,
      /INSERT INTO\s+"public"\."variant_transcripts"[\s\S]+jsonb_to_recordset\(\$1::jsonb\)/i
    )
    expect(transcriptInsert).toBeDefined()
    expect(transcriptInsert?.params).toHaveLength(1)
    const parsed = JSON.parse(String(transcriptInsert?.params[0])) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(2)
    for (const row of parsed) {
      expect(row.variant_id).toBe(10)
      expect(typeof row.transcript_id).toBe('string')
    }
  })

  it('case_data_info only uses Phase 6 columns', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // duplicate
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }] }, // variant batch
      { rows: [] }, // case_data_info
      { rows: [] }, // update variant_count
      { rows: [] }, // frequency
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([{ chr: '1', pos: 1, ref: 'A', alt: 'G' }])
    })

    const caseDataInfoInsert = findCall(client, /INSERT INTO\s+"public"\."case_data_info"/i)
    expect(caseDataInfoInsert).toBeDefined()
    const sql = caseDataInfoInsert?.sql ?? ''

    // Forbid columns that aren't in 11-phase6-case-metadata.sql
    expect(sql).not.toMatch(/\bimport_date\b/i)
    expect(sql).not.toMatch(/\bimported_at\b/i)

    // Whitelist: must only reference known Phase 6 columns + created_at/updated_at
    const phase6Columns = [
      'case_id',
      'import_file_name',
      'import_file_type',
      'platform',
      'platform_details',
      'af_filter',
      'gene_list_filter',
      'region_filter',
      'quality_filter',
      'data_notes',
      'created_at',
      'updated_at',
      'gene_list_id',
      'region_file_id'
    ]

    // Extract INSERT column list: "(col, col, col)"
    const colListMatch = sql.match(/INSERT INTO\s+"public"\."case_data_info"\s*\(([^)]+)\)/i)
    expect(colListMatch).not.toBeNull()
    const columns = (colListMatch?.[1] ?? '')
      .split(',')
      .map((c) => c.trim().replace(/"/g, ''))
      .filter((c) => c !== '')
    for (const col of columns) {
      expect(phase6Columns).toContain(col)
    }
    // Must at minimum include case_id, import_file_name, import_file_type, created_at, updated_at
    for (const required of [
      'case_id',
      'import_file_name',
      'import_file_type',
      'created_at',
      'updated_at'
    ]) {
      expect(columns).toContain(required)
    }
  })

  it('variant_frequency refreshed once at the end, driven from variants WHERE case_id', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // batch 1
      { rows: [{ id: '12' }] }, // batch 2
      { rows: [] }, // case_data_info
      { rows: [] }, // update count
      { rows: [] }, // frequency
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G' },
        { chr: '1', pos: 1, ref: 'A', alt: 'G' } // duplicate within one case
      ])
      await session.insertVariantBatch([{ chr: '2', pos: 2, ref: 'C', alt: 'T' }])
    })

    const freqCalls = findAllCalls(client, /INSERT INTO\s+"public"\."variant_frequency"/i)
    expect(freqCalls).toHaveLength(1)
    const freqCall = freqCalls[0]

    // Must match spec-defined SQL shape
    expect(freqCall?.sql).toMatch(
      /INSERT INTO\s+"public"\."variant_frequency"[\s\S]+SELECT chr, pos, ref, alt, 1[\s\S]+FROM\s+"public"\."variants"[\s\S]+WHERE case_id = \$1[\s\S]+GROUP BY chr, pos, ref, alt[\s\S]+ON CONFLICT/i
    )
    expect(freqCall?.params).toStrictEqual([4])

    // Frequency refresh must occur AFTER all variant batches
    const calls = queryCalls(client)
    const freqIndex = calls.findIndex((call) =>
      /INSERT INTO\s+"public"\."variant_frequency"/i.test(call.sql)
    )
    const variantBatchIndices = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => /INSERT INTO\s+"public"\."variants"/i.test(call.sql))
      .map(({ index }) => index)
    expect(variantBatchIndices.length).toBeGreaterThan(0)
    for (const idx of variantBatchIndices) {
      expect(freqIndex).toBeGreaterThan(idx)
    }
  })

  it('duplicate coordinates within one import do not double-count frequency (GROUP BY)', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // variant batch
      { rows: [] }, // case_data_info
      { rows: [] }, // update count
      { rows: [] }, // frequency
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G' },
        { chr: '1', pos: 1, ref: 'A', alt: 'G' }
      ])
    })

    const freqCall = findCall(client, /INSERT INTO\s+"public"\."variant_frequency"/i)
    expect(freqCall).toBeDefined()
    expect(freqCall?.sql).toMatch(/GROUP BY\s+chr,\s*pos,\s*ref,\s*alt/i)
  })

  it('search_document is populated by trigger (not in INSERT column list)', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }] }, // variant batch
      { rows: [] }, // case_data_info
      { rows: [] }, // update count
      { rows: [] }, // frequency
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch([
        { chr: '1', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'BRCA1' }
      ])
    })

    const variantInsert = findCall(client, /INSERT INTO\s+"public"\."variants"/i)
    expect(variantInsert).toBeDefined()
    // Extract INSERT column list
    const colListMatch = variantInsert?.sql.match(
      /INSERT INTO\s+"public"\."variants"\s*\(([^)]+)\)/i
    )
    expect(colListMatch).not.toBeNull()
    const columns = (colListMatch?.[1] ?? '').split(',').map((c) => c.trim().replace(/"/g, ''))
    expect(columns).not.toContain('search_document')
  })

  it('two batches stream through same transaction without accumulating entire file', async () => {
    const client = makeClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // dup
      { rows: [{ id: '4' }] }, // case insert
      { rows: [{ id: '10' }, { id: '11' }] }, // batch 1
      { rows: [{ id: '12' }, { id: '13' }] }, // batch 2
      { rows: [] }, // case_data_info
      { rows: [] }, // update count
      { rows: [] }, // frequency
      { rows: [] } // COMMIT
    ])
    const pool = makePool(client)
    const repository = new PostgresJsonImportRepository(pool as never, 'public')

    // Large fake batches to demonstrate that the repo does not accumulate the file
    const batchA = Array.from({ length: 2 }, (_, i) => ({
      chr: '1',
      pos: i + 1,
      ref: 'A',
      alt: 'G'
    }))
    const batchB = Array.from({ length: 2 }, (_, i) => ({
      chr: '2',
      pos: i + 1,
      ref: 'C',
      alt: 'T'
    }))

    await repository.runJsonImport(baseRequest, async (session) => {
      await session.insertVariantBatch(batchA)
      await session.insertVariantBatch(batchB)
    })

    // Only one client ever checked out
    expect(pool.connect).toHaveBeenCalledTimes(1)

    // Two separate variant batch INSERTs (no coalescing)
    const variantBatches = findAllCalls(
      client,
      /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset/i
    )
    expect(variantBatches).toHaveLength(2)

    const calls = queryCalls(client)
    const beginIndex = calls.findIndex((c) => c.sql === 'BEGIN')
    const commitIndex = calls.findIndex((c) => c.sql === 'COMMIT')
    expect(beginIndex).toBeGreaterThanOrEqual(0)
    expect(commitIndex).toBeGreaterThan(beginIndex)
    // Both batches between BEGIN and COMMIT
    const variantBatchIndices = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => /INSERT INTO\s+"public"\."variants"[\s\S]+jsonb_to_recordset/i.test(c.sql))
      .map(({ i }) => i)
    for (const idx of variantBatchIndices) {
      expect(idx).toBeGreaterThan(beginIndex)
      expect(idx).toBeLessThan(commitIndex)
    }
  })
})
