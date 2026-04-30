import { describe, expect, it, vi } from 'vitest'

const geneReferenceMocks = vi.hoisted(() => ({
  getCoordinatesForGenes: vi.fn()
}))

vi.mock('../../../src/main/database/geneReferenceLoader', () => ({
  getGeneReferenceDb: () => ({
    getCoordinatesForGenes: geneReferenceMocks.getCoordinatesForGenes
  })
}))

import { PostgresCohortRepository } from '../../../src/main/storage/postgres/PostgresCohortRepository'

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

describe('PostgresCohortRepository', () => {
  it('queries total cases, grouped variant count, then rows and maps numeric strings', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '4' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            chr: '1',
            pos: '123',
            ref: 'A',
            alt: 'G',
            gene_symbol: 'BRCA1',
            cdna: 'c.1A>G',
            aa_change: 'p.Lys1Arg',
            carrier_count: '2',
            total_cases: '4',
            cohort_frequency: '0.5',
            het_count: '1',
            hom_count: '1',
            consequence: 'HIGH',
            func: 'stop_gained',
            clinvar: 'Pathogenic',
            gnomad_af: '0.001',
            cadd_phred: '32.5',
            transcript: 'NM_007294',
            omim_id: '113705'
          }
        ]
      })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const result = await repository.queryVariants({ limit: 25, offset: 50 })

    expect(query).toHaveBeenCalledTimes(3)
    expect(normalizeSql(query.mock.calls[0][0] as string)).toBe(
      'SELECT COUNT(*)::bigint AS total_cases FROM "public"."cases"'
    )
    expect(result).toEqual({
      total_count: 2,
      data: [
        {
          chr: '1',
          pos: 123,
          ref: 'A',
          alt: 'G',
          gene_symbol: 'BRCA1',
          cdna: 'c.1A>G',
          aa_change: 'p.Lys1Arg',
          carrier_count: 2,
          total_cases: 4,
          cohort_frequency: 0.5,
          het_count: 1,
          hom_count: 1,
          variant_key: '1:123:A:G',
          consequence: 'HIGH',
          func: 'stop_gained',
          clinvar: 'Pathogenic',
          gnomad_af: 0.001,
          cadd_phred: 32.5,
          transcript: 'NM_007294',
          omim_id: '113705'
        }
      ]
    })
  })

  it('builds grouped cohort SQL with parameterized base filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'tenant"schema')

    await repository.queryVariants({
      gene_symbol: `BRCA1'; DROP TABLE variants; --`,
      consequences: ['HIGH', 'MODERATE'],
      clinvars: ['Pathogenic'],
      gnomad_af_max: 0.01,
      cadd_min: 20,
      carrier_count_min: 2,
      panel_intervals: [{ chr: '1', start: 100, end: 200 }],
      search_term: `TP53%' OR TRUE --`,
      limit: 10,
      offset: 0
    })

    const countSql = normalizeSql(query.mock.calls[1][0] as string)
    const countParams = query.mock.calls[1][1] as unknown[]
    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    const dataParams = query.mock.calls[2][1] as unknown[]

    expect(dataSql).toContain('FROM "tenant""schema"."variants" v')
    expect(dataSql).toContain('GROUP BY v.chr, v.pos, v.ref, v.alt')
    expect(dataSql).toContain('COUNT(DISTINCT v.case_id)::bigint AS carrier_count')
    expect(dataSql).toContain('HAVING COUNT(DISTINCT v.case_id) >= $')
    expect(countSql).toContain('SELECT COUNT(*)::bigint AS total_count FROM (')
    expect(countSql).toContain('GROUP BY v.chr, v.pos, v.ref, v.alt')
    expect(dataSql).toContain('(v.chr = $')
    expect(dataSql).toContain('v.pos <= $')
    expect(dataSql).toContain('COALESCE(v.end_pos, v.pos) >= $')
    expect(dataSql).toContain('v.gene_symbol = $')
    expect(dataSql).toContain('v.consequence IN ($')
    expect(dataSql).toContain('v.clinvar IN ($')
    expect(dataSql).toContain('(v.gnomad_af IS NULL OR v.gnomad_af <= $')
    expect(dataSql).toContain('(v.cadd IS NULL OR v.cadd >= $')
    expect(dataSql).toContain('ILIKE $')
    expect(dataSql).not.toContain('DROP TABLE')
    expect(dataSql).not.toContain('OR TRUE')
    expect(countSql).not.toContain('DROP TABLE')
    expect(countParams).toEqual([
      `%TP53%' OR TRUE --%`,
      `%TP53%' OR TRUE --%`,
      `%TP53%' OR TRUE --%`,
      '1',
      200,
      100,
      `BRCA1'; DROP TABLE variants; --`,
      'HIGH',
      'MODERATE',
      'Pathogenic',
      0.01,
      20,
      2
    ])
    expect(dataParams).toEqual([...countParams, 10, 0])
  })

  it('resolves active panels to padded genomic intervals across the cohort', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chr: '1' }] })
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const resolveIntervals = vi.fn().mockResolvedValue([{ chr: '1', start: 100, end: 200 }])
    const repository = new PostgresCohortRepository({ query } as never, 'public', resolveIntervals)

    await repository.queryVariants({
      active_panel_ids: [3, 4],
      panel_padding_bp: 7500,
      genome_build: 'GRCh37',
      limit: 10,
      offset: 0
    })

    const dataSql = normalizeSql(query.mock.calls[3][0] as string)
    const dataParams = query.mock.calls[3][1] as unknown[]

    expect(resolveIntervals).toHaveBeenCalledWith([3, 4], 'GRCh37', 7500, false)
    expect(dataSql).toContain('(v.chr = $')
    expect(dataSql).toContain('v.pos <= $')
    expect(dataSql).toContain('COALESCE(v.end_pos, v.pos) >= $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['1', 200, 100, 'GRCh37', 10, 0])
  })

  it('resolves active panels from PostgreSQL panel genes through gene reference coordinates', async () => {
    geneReferenceMocks.getCoordinatesForGenes.mockReturnValue(
      new Map([
        [
          'HGNC:1100',
          {
            hgncId: 'HGNC:1100',
            assembly: 'GRCh38',
            chromosome: '1',
            start_pos: 1000,
            end_pos: 2000,
            strand: '+'
          }
        ]
      ])
    )
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ chr: 'chr1' }] })
      .mockResolvedValueOnce({ rows: [{ hgnc_id: 'HGNC:1100' }] })
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      active_panel_ids: [3],
      limit: 10,
      offset: 0
    })

    const panelSql = normalizeSql(query.mock.calls[1][0] as string)
    const panelParams = query.mock.calls[1][1] as unknown[]
    const dataSql = normalizeSql(query.mock.calls[4][0] as string)
    const dataParams = query.mock.calls[4][1] as unknown[]

    expect(panelSql).toContain('FROM "public"."panel_genes"')
    expect(panelParams).toEqual([[3]])
    expect(geneReferenceMocks.getCoordinatesForGenes).toHaveBeenCalledWith(['HGNC:1100'], 'GRCh38')
    expect(dataSql).toContain('(v.chr = $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['chr1', 7000, 1, 10, 0])
  })

  it('uses resolved panel intervals instead of active panel IDs when both are present', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const resolveIntervals = vi.fn()
    const repository = new PostgresCohortRepository({ query } as never, 'public', resolveIntervals)

    await repository.queryVariants({
      active_panel_ids: [3],
      panel_intervals: [{ chr: '1', start: 100, end: 200 }],
      limit: 10,
      offset: 0
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    const dataParams = query.mock.calls[2][1] as unknown[]

    expect(resolveIntervals).not.toHaveBeenCalled()
    expect(dataSql).toContain('(v.chr = $')
    expect(dataSql).toContain('v.pos <= $')
    expect(dataSql).toContain('COALESCE(v.end_pos, v.pos) >= $')
    expect(dataSql).not.toContain('panel_genes')
    expect(dataSql).not.toContain('case_active_panels')
    expect(dataParams).toEqual(['1', 200, 100, 10, 0])
  })

  it('supports whitelisted parameterized cohort column filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        gene_symbol: { operator: 'like', value: `BRCA%' OR TRUE --` },
        carrier_count: { operator: '>=', value: 2 },
        cohort_frequency: { operator: '<=', value: 0.5 },
        cadd_phred: { operator: '>', value: 20 },
        gnomad_af: { operator: '<=', value: 0.01, includeEmpty: false },
        clinvar: { operator: 'in', value: ['Pathogenic', 'Likely pathogenic'] }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    const dataParams = query.mock.calls[2][1] as unknown[]

    expect(dataSql).toContain('v.gene_symbol ILIKE $')
    expect(dataSql).toContain('COUNT(DISTINCT v.case_id) >= $')
    expect(dataSql).toContain('COUNT(DISTINCT v.case_id)::double precision / NULLIF(10, 0) <= $')
    expect(dataSql).toContain('(v.cadd IS NULL OR v.cadd > $')
    expect(dataSql).toContain('v.gnomad_af <= $')
    expect(dataSql).toContain('v.clinvar IN ($')
    expect(dataSql).not.toContain('OR TRUE')
    expect(dataParams).toEqual([
      `%BRCA%' OR TRUE --%`,
      'Pathogenic',
      'Likely pathogenic',
      0.01,
      20,
      2,
      0.5,
      50,
      0
    ])
  })

  it('throws for unsupported cohort column filter keys before querying', async () => {
    const query = vi.fn()
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(
      repository.queryVariants({
        column_filters: {
          'sv.support': { operator: '>', value: 5 },
          unknown: { operator: '=', value: 'x' }
        }
      })
    ).rejects.toThrow('Unsupported PostgreSQL cohort column filter(s): unknown')
    expect(query).not.toHaveBeenCalled()
  })

  it('supports dotted extension cohort column filters with extension joins', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        'sv.support': { operator: '>', value: 5 },
        'cnv.copy_number': { operator: '>=', value: 3, includeEmpty: false },
        'str.repeat_id': { operator: 'like', value: 'HTT' }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    const dataParams = query.mock.calls[2][1] as unknown[]

    expect(dataSql).toContain('JOIN "public"."variant_sv" sv ON sv.variant_id = ext_v.id')
    expect(dataSql).toContain('JOIN "public"."variant_cnv" cnv ON cnv.variant_id = ext_v.id')
    expect(dataSql).toContain(
      'JOIN "public"."variant_str" str_ext ON str_ext.variant_id = ext_v.id'
    )
    expect(dataSql).toContain('ext_v.chr = v.chr')
    expect(dataSql).toContain('sv.support > $')
    expect(dataSql).toContain('cnv.copy_number >= $')
    expect(dataSql).toContain('str_ext.repeat_id ILIKE $')
    expect(dataParams).toEqual([3, '%HTT%', 5, 50, 0])
  })

  it('combines same-extension cohort column filters in one exists predicate', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        'cnv.copy_number': { operator: '>=', value: 3 },
        'cnv.copy_number_quality': { operator: '>=', value: 20 }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql.match(/JOIN "public"."variant_cnv" cnv/g)).toHaveLength(1)
    expect(dataSql).toContain('cnv.copy_number >= $')
    expect(dataSql).toContain('cnv.copy_number_quality >= $')
  })

  it('skips blank cohort column like filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      column_filters: {
        gene_symbol: { operator: 'like', value: '   ' },
        'str.repeat_id': { operator: 'like', value: '' }
      }
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql).not.toContain('ILIKE')
    expect(dataSql).not.toContain('variant_str')
    expect(query.mock.calls[2][1]).toEqual([50, 0])
  })

  it('uses genome-build scoped total cases for cohort frequency filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '6' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({ genome_build: 'GRCh38', max_internal_af: 0.5 })

    expect(normalizeSql(query.mock.calls[0][0] as string)).toContain('WHERE genome_build = $1')
    expect(query.mock.calls[0][1]).toEqual(['GRCh38'])
    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql).toContain('COUNT(DISTINCT v.case_id)::double precision / NULLIF(6, 0) <= $')
  })

  it('checks global and per-case annotations for cohort annotation filters', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({
      starred_only: true,
      has_comment: true,
      acmg_classifications: ['Pathogenic']
    })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql).toContain('case_variant_annotations')
    expect(dataSql).toContain('variant_annotations')
    expect(dataSql).toContain('cva.starred')
    expect(dataSql).toContain('va.starred')
    expect(dataSql).toContain('cva.per_case_comment')
    expect(dataSql).toContain('va.global_comment')
    expect(dataSql).toContain('cva.acmg_classification IN')
    expect(dataSql).toContain('va.acmg_classification IN')
  })

  it("treats variant_type 'snv' as snv plus indel", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [{ total_count: '1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await repository.queryVariants({ variant_type: 'snv' })

    const dataSql = normalizeSql(query.mock.calls[2][0] as string)
    expect(dataSql).toContain("v.variant_type IN ('snv', 'indel')")
    expect(query.mock.calls[2][1]).toEqual([50, 0])
  })

  it('maps cohort summary statistics and ACMG counts from numeric strings', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_cases: '3',
          total_variants: '9',
          unique_variants: '5',
          avg_variants_per_case: '3',
          genes_with_variants: '4',
          starred_variants: '2',
          pathogenic: '1',
          likely_pathogenic: '2',
          vus: '3',
          likely_benign: '4',
          benign: '5'
        }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(repository.getSummary()).resolves.toEqual({
      total_cases: 3,
      total_variants: 9,
      unique_variants: 5,
      avg_variants_per_case: 3,
      genes_with_variants: 4,
      starred_variants: 2,
      acmg_counts: {
        pathogenic: 1,
        likely_pathogenic: 2,
        vus: 3,
        likely_benign: 4,
        benign: 5
      }
    })
  })

  it('maps carriers with numeric case IDs and preserves gq and dp when present', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { case_id: '7', case_name: 'Case B', gt_num: '0/1', gq: '99.5', dp: '42' },
        { case_id: 8, case_name: 'Case C', gt_num: '1/1', gq: null, dp: null }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const carriers = await repository.getCarriers('1', 123, 'A', 'G')

    expect(query.mock.calls[0][1]).toEqual(['1', 123, 'A', 'G'])
    expect(carriers).toEqual([
      { case_id: 7, case_name: 'Case B', gt_num: '0/1', gq: 99.5, dp: 42 },
      { case_id: 8, case_name: 'Case C', gt_num: '1/1', gq: null, dp: null }
    ])
  })

  it('maps gene burden rows to shared GeneBurden fields', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          gene_symbol: 'BRCA1',
          variant_count: '4',
          unique_variant_count: '3',
          affected_case_count: '2',
          total_cases: '10'
        }
      ]
    })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    await expect(repository.getGeneBurden()).resolves.toEqual([
      {
        gene_symbol: 'BRCA1',
        variant_count: 4,
        unique_variant_count: 3,
        affected_case_count: 2,
        total_cases: 10
      }
    ])
    expect(normalizeSql(query.mock.calls[0][0] as string)).toContain(
      "WHERE v.gene_symbol IS NOT NULL AND v.gene_symbol <> ''"
    )
  })

  it('returns usable cohort column metadata', async () => {
    const aggregateRow = {
      cnt_chr: '2',
      cnt_pos: '2',
      min_pos: '1',
      max_pos: '10',
      cnt_gene_symbol: '2',
      cnt_carrier_count: '2',
      min_carrier_count: '1',
      max_carrier_count: '10',
      cnt_cohort_frequency: '2',
      min_cohort_frequency: '1',
      max_cohort_frequency: '10',
      cnt_het_count: '2',
      min_het_count: '1',
      max_het_count: '10',
      cnt_hom_count: '2',
      min_hom_count: '1',
      max_hom_count: '10',
      cnt_consequence: '2',
      cnt_func: '2',
      cnt_clinvar: '2',
      cnt_gnomad_af: '2',
      min_gnomad_af: '1',
      max_gnomad_af: '10',
      cnt_cadd_phred: '2',
      min_cadd_phred: '1',
      max_cadd_phred: '10',
      cnt_transcript: '2'
    }
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total_cases: '10' }] })
      .mockResolvedValueOnce({ rows: [aggregateRow] })
      .mockResolvedValueOnce({
        rows: [
          { col_key: 'chr', value: '1' },
          { col_key: 'gene_symbol', value: 'BRCA1' }
        ]
      })
    const repository = new PostgresCohortRepository({ query } as never, 'public')

    const meta = await repository.getColumnMeta()

    const byKey = new Map(meta.map((entry) => [entry.key, entry]))
    for (const key of [
      'chr',
      'pos',
      'gene_symbol',
      'carrier_count',
      'cohort_frequency',
      'het_count',
      'hom_count',
      'consequence',
      'func',
      'clinvar',
      'gnomad_af',
      'cadd_phred',
      'transcript'
    ]) {
      expect(byKey.has(key)).toBe(true)
      expect(byKey.get(key)?.distinctCount).toBe(2)
    }
    expect(byKey.get('pos')?.dataType).toBe('numeric')
    expect(byKey.get('pos')?.min).toBe(1)
    expect(byKey.get('pos')?.max).toBe(10)
    expect(byKey.get('gene_symbol')?.dataType).toBe('text')
    expect(byKey.get('chr')?.distinctValues).toEqual(['1'])
    expect(query).toHaveBeenCalledTimes(3)
    expect(normalizeSql(query.mock.calls[1][0] as string)).toContain('COUNT(DISTINCT chr)')
    expect(normalizeSql(query.mock.calls[1][0] as string)).not.toContain('ARRAY_AGG')
    expect(normalizeSql(query.mock.calls[2][0] as string)).toContain(
      'WITH cohort_columns AS MATERIALIZED'
    )
    expect(normalizeSql(query.mock.calls[2][0] as string)).toContain('UNION ALL')
    expect(normalizeSql(query.mock.calls[2][0] as string)).not.toContain('FROM (SELECT')
  })

  it('streams cohort rows through pg-query-stream and releases the client', async () => {
    const release = vi.fn()
    const query = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { chr: '2', pos: '456', ref: 'C', alt: 'T', carrier_count: '1' }
      }
    }))
    const poolQuery = vi.fn().mockResolvedValue({ rows: [{ total_cases: '2' }] })
    const connect = vi.fn(async () => ({ query, release }))
    const repository = new PostgresCohortRepository(
      { query: poolQuery, connect } as never,
      'public'
    )

    const rows = []
    for await (const row of repository.streamCohortRows({ gene_symbol: 'MYH7' })) {
      rows.push(row)
    }

    expect(connect).toHaveBeenCalledTimes(1)
    expect(poolQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*)::bigint AS total_cases FROM "public"."cases"'
    )
    const streamArg = query.mock.calls[0][0] as { cursor?: { text?: string; values?: unknown[] } }
    expect(streamArg.cursor?.text).toContain('FROM "public"."variants" v')
    expect(streamArg.cursor?.text).toContain('GROUP BY v.chr, v.pos, v.ref, v.alt')
    expect(streamArg.cursor?.text).not.toContain('LIMIT')
    expect(streamArg.cursor?.text).not.toContain('OFFSET')
    expect(streamArg.cursor?.values).toEqual(['MYH7'])
    expect(rows).toEqual([{ chr: '2', pos: '456', ref: 'C', alt: 'T', carrier_count: '1' }])
    expect(release).toHaveBeenCalledTimes(1)
  })
})
