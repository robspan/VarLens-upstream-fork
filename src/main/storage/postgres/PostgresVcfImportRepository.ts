import type { PoolClient } from 'pg'

import { quoteIdentifier } from './identifiers'

// ---------------------------------------------------------------------------
// Column lists — kept in sync with PostgresJsonImportRepository.
// search_document is intentionally excluded: the trigger
// `variants_search_document_tg` populates it on BEFORE INSERT.
// ---------------------------------------------------------------------------

const VARIANT_BASE_COLUMNS = [
  'case_id',
  'chr',
  'pos',
  'ref',
  'alt',
  'gene_symbol',
  'omim_mim_number',
  'consequence',
  'gnomad_af',
  'cadd',
  'clinvar',
  'gt_num',
  'func',
  'qual',
  'hpo_sim_score',
  'transcript',
  'cdna',
  'aa_change',
  'moi',
  'gq',
  'dp',
  'ad_ref',
  'ad_alt',
  'ab',
  'filter',
  'info_json',
  'source_format',
  'variant_type',
  'end_pos',
  'sv_type',
  'sv_length',
  'caller'
] as const

const VARIANT_BATCH_RECORDSET_TYPES: Record<string, string> = {
  chr: 'text',
  pos: 'bigint',
  ref: 'text',
  alt: 'text',
  gene_symbol: 'text',
  omim_mim_number: 'text',
  consequence: 'text',
  gnomad_af: 'double precision',
  cadd: 'double precision',
  clinvar: 'text',
  gt_num: 'text',
  func: 'text',
  qual: 'double precision',
  hpo_sim_score: 'double precision',
  transcript: 'text',
  cdna: 'text',
  aa_change: 'text',
  moi: 'text',
  gq: 'double precision',
  dp: 'bigint',
  ad_ref: 'bigint',
  ad_alt: 'bigint',
  ab: 'double precision',
  filter: 'text',
  info_json: 'text',
  source_format: 'text',
  variant_type: 'text',
  end_pos: 'bigint',
  sv_type: 'text',
  sv_length: 'bigint',
  caller: 'text'
}

const VARIANT_TRANSCRIPT_COLUMNS = [
  'variant_id',
  'transcript_id',
  'gene_symbol',
  'consequence',
  'cdna',
  'aa_change',
  'hpo_sim_score',
  'moi',
  'is_selected',
  'is_mane_select',
  'is_canonical'
] as const

const VARIANT_SV_COLUMNS = [
  'variant_id',
  'sv_is_precise',
  'cipos_left',
  'cipos_right',
  'ciend_left',
  'ciend_right',
  'support',
  'coverage',
  'strand',
  'stdev_len',
  'stdev_pos',
  'vaf',
  'dr',
  'dv',
  'pe_support',
  'sr_support',
  'event_id',
  'mate_id'
] as const

const VARIANT_CNV_COLUMNS = [
  'variant_id',
  'copy_number',
  'copy_number_quality',
  'homozygosity_ref',
  'homozygosity_alt',
  'sm',
  'bin_count'
] as const

const VARIANT_STR_COLUMNS = [
  'variant_id',
  'repeat_id',
  'variant_catalog_id',
  'repeat_unit',
  'display_repeat_unit',
  'ref_copies',
  'alt_copies',
  'repeat_length',
  'str_status',
  'normal_max',
  'pathologic_min',
  'disease',
  'inheritance_mode',
  'source_display',
  'rank_score',
  'locus_coverage',
  'support_type',
  'confidence_interval'
] as const

// ---------------------------------------------------------------------------
// Request / result types
// ---------------------------------------------------------------------------

/** Variant row as produced by the VCF mapper — same column names as the DB. */
export type VcfVariantRow = Record<string, unknown>

/** Extension rows carry an `ordinal` (0-based index into the variants array). */
export type VcfTranscriptRow = Record<string, unknown> & { ordinal: number }
export type VcfSvRow = Record<string, unknown> & { ordinal: number }
export type VcfCnvRow = Record<string, unknown> & { ordinal: number }
export type VcfStrRow = Record<string, unknown> & { ordinal: number }

interface WriteVcfFileRequestBase {
  caseName: string
  fileName: string
  filePath: string
  fileSize: number
  genomeBuild: string
  caller: string | null
  annotationFormat: string | null
  variantType: string
  variants: VcfVariantRow[]
  transcripts: VcfTranscriptRow[]
  sv: VcfSvRow[]
  cnv: VcfCnvRow[]
  str: VcfStrRow[]
}

export interface WriteVcfFileSingleFileRequest extends WriteVcfFileRequestBase {
  mode: 'single-file'
}

export interface WriteVcfFileMultiFileRequest extends WriteVcfFileRequestBase {
  mode: 'multi-file'
  /** 0 = first file (creates the case), >= 1 = subsequent files (looks up the case). */
  fileIndex: number
}

export type WriteVcfFileRequest = WriteVcfFileSingleFileRequest | WriteVcfFileMultiFileRequest

export interface WriteVcfFileResult {
  caseId: number
  variantCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickColumns<T extends string>(
  row: Record<string, unknown>,
  columns: readonly T[]
): Record<T, unknown> {
  const out = {} as Record<T, unknown>
  for (const col of columns) {
    out[col] = row[col] ?? null
  }
  return out
}

function toNumericId(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  throw new Error(`Expected numeric id, received: ${String(value)}`)
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresVcfImportRepository {
  private readonly schemaName: string

  constructor(schema: string) {
    this.schemaName = quoteIdentifier(schema)
  }

  /**
   * Write one VCF file worth of variants into the database.
   *
   * The caller MUST own the transaction (BEGIN/COMMIT/ROLLBACK). This method
   * issues NO transaction-lifecycle SQL. variant_frequency is also NOT updated
   * here — the worker handles that after all writeVcfFile calls complete.
   *
   * Multi-file semantics:
   *  - mode: 'single-file'           — duplicate check + case insert
   *  - mode: 'multi-file', index: 0  — duplicate check + case insert
   *  - mode: 'multi-file', index: N  — look up existing case by name (reject if missing)
   */
  async writeVcfFile(
    client: Pick<PoolClient, 'query'>,
    request: WriteVcfFileRequest
  ): Promise<WriteVcfFileResult> {
    const isFirstFile =
      request.mode === 'single-file' ||
      (request.mode === 'multi-file' && request.fileIndex === 0)

    let caseId: number

    if (isFirstFile) {
      // Check for pre-existing case and create if absent.
      const dupResult = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if ((dupResult.rows as unknown[]).length > 0) {
        throw new Error(
          `case '${request.caseName}' already exists — cannot create a duplicate`
        )
      }

      const createdAt = Date.now()
      const caseInsert = await client.query(
        `INSERT INTO ${this.schemaName}."cases"
         (name, file_path, file_size, variant_count, created_at, genome_build)
         VALUES ($1, $2, $3, 0, $4, $5)
         RETURNING id`,
        [request.caseName, request.filePath, request.fileSize, createdAt, request.genomeBuild]
      )
      caseId = toNumericId((caseInsert.rows[0] as { id: unknown } | undefined)?.id)
    } else {
      // Subsequent file in a multi-file import: look up by name.
      const lookupResult = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if ((lookupResult.rows as unknown[]).length === 0) {
        throw new Error(
          `case '${request.caseName}' not found — subsequent file must reference an existing case`
        )
      }
      caseId = toNumericId((lookupResult.rows[0] as { id: unknown }).id)
    }

    // Insert variants and their extension rows.
    const variantCount = await this.insertVariants(client, caseId, request)

    // Write per-file provenance.
    const createdAt = Date.now()
    await client.query(
      `INSERT INTO ${this.schemaName}."case_data_info"
         (case_id, import_file_name, import_file_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (case_id) DO UPDATE SET
         import_file_name = EXCLUDED.import_file_name,
         import_file_type = EXCLUDED.import_file_type,
         updated_at = EXCLUDED.updated_at`,
      [caseId, request.fileName, 'vcf', createdAt]
    )

    return { caseId, variantCount }
  }

  // ---------------------------------------------------------------------------
  // Private — variant insertion
  // ---------------------------------------------------------------------------

  private async insertVariants(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    request: WriteVcfFileRequest
  ): Promise<number> {
    const { variants, transcripts, sv, cnv, str } = request
    if (variants.length === 0) return 0

    // Build the base-column portion of the recordset signature (excludes case_id).
    const batchCols = Object.keys(VARIANT_BATCH_RECORDSET_TYPES)
    const recordsetSignature = batchCols
      .map((col) => `"${col}" ${VARIANT_BATCH_RECORDSET_TYPES[col]}`)
      .join(', ')

    // Embed case_id and a 0-based ordinal (n) into each payload row.
    // Embedding n into the JSON and using jsonb_to_recordset lets us ORDER BY n
    // in the SELECT. PostgreSQL guarantees that INSERT ... SELECT ... ORDER BY n
    // returns RETURNING rows in the same order as the SELECT, so the i-th returned
    // id corresponds to ordinal i.
    const payload = variants.map((row, i) => {
      const picked = pickColumns(row, batchCols as readonly string[])
      if (picked.variant_type === null) picked.variant_type = 'snv'
      return { n: i, case_id: caseId, ...picked }
    })

    const sql = `INSERT INTO ${this.schemaName}."variants"
        (${VARIANT_BASE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      SELECT ${VARIANT_BASE_COLUMNS.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(
        "n" integer,
        "case_id" bigint,
        ${recordsetSignature}
      )
      ORDER BY v."n"
      RETURNING id`

    const result = await client.query(sql, [JSON.stringify(payload)])
    const returnedRows = result.rows as Array<{ id: unknown }>

    // Build a mapping: ordinal (array index) → variant_id
    const variantIds: number[] = returnedRows.map((r) => toNumericId(r.id))

    // Insert extension rows, replacing ordinal with the resolved variant_id.
    await this.insertExtensionRows(client, variantIds, transcripts, sv, cnv, str)

    return variantIds.length
  }

  private async insertExtensionRows(
    client: Pick<PoolClient, 'query'>,
    variantIds: number[],
    transcripts: VcfTranscriptRow[],
    svRows: VcfSvRow[],
    cnvRows: VcfCnvRow[],
    strRows: VcfStrRow[]
  ): Promise<void> {
    // Helper: resolve ordinal → variant_id and build the payload for a table.
    const resolveExtension = (
      rows: Array<Record<string, unknown> & { ordinal: number }>,
      columns: readonly string[]
    ): Array<Record<string, unknown>> =>
      rows
        .filter((r) => r.ordinal < variantIds.length)
        .map((r) => {
          const variantId = variantIds[r.ordinal]
          const picked = pickColumns(r, columns)
          picked['variant_id'] = variantId
          return picked
        })

    if (transcripts.length > 0) {
      const payload = resolveExtension(
        transcripts,
        VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[]
      )
      await this.insertExtensionBatch(
        client,
        'variant_transcripts',
        VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[],
        {
          variant_id: 'bigint',
          transcript_id: 'text',
          gene_symbol: 'text',
          consequence: 'text',
          cdna: 'text',
          aa_change: 'text',
          hpo_sim_score: 'double precision',
          moi: 'text',
          is_selected: 'integer',
          is_mane_select: 'integer',
          is_canonical: 'integer'
        },
        payload
      )
    }

    if (svRows.length > 0) {
      const payload = resolveExtension(
        svRows,
        VARIANT_SV_COLUMNS as unknown as readonly string[]
      )
      await this.insertExtensionBatch(
        client,
        'variant_sv',
        VARIANT_SV_COLUMNS as unknown as readonly string[],
        {
          variant_id: 'bigint',
          sv_is_precise: 'integer',
          cipos_left: 'bigint',
          cipos_right: 'bigint',
          ciend_left: 'bigint',
          ciend_right: 'bigint',
          support: 'bigint',
          coverage: 'text',
          strand: 'text',
          stdev_len: 'double precision',
          stdev_pos: 'double precision',
          vaf: 'double precision',
          dr: 'bigint',
          dv: 'bigint',
          pe_support: 'bigint',
          sr_support: 'bigint',
          event_id: 'text',
          mate_id: 'text'
        },
        payload
      )
    }

    if (cnvRows.length > 0) {
      const payload = resolveExtension(
        cnvRows,
        VARIANT_CNV_COLUMNS as unknown as readonly string[]
      )
      await this.insertExtensionBatch(
        client,
        'variant_cnv',
        VARIANT_CNV_COLUMNS as unknown as readonly string[],
        {
          variant_id: 'bigint',
          copy_number: 'bigint',
          copy_number_quality: 'bigint',
          homozygosity_ref: 'double precision',
          homozygosity_alt: 'double precision',
          sm: 'double precision',
          bin_count: 'bigint'
        },
        payload
      )
    }

    if (strRows.length > 0) {
      const payload = resolveExtension(
        strRows,
        VARIANT_STR_COLUMNS as unknown as readonly string[]
      )
      await this.insertExtensionBatch(
        client,
        'variant_str',
        VARIANT_STR_COLUMNS as unknown as readonly string[],
        {
          variant_id: 'bigint',
          repeat_id: 'text',
          variant_catalog_id: 'text',
          repeat_unit: 'text',
          display_repeat_unit: 'text',
          ref_copies: 'double precision',
          alt_copies: 'text',
          repeat_length: 'bigint',
          str_status: 'text',
          normal_max: 'bigint',
          pathologic_min: 'bigint',
          disease: 'text',
          inheritance_mode: 'text',
          source_display: 'text',
          rank_score: 'text',
          locus_coverage: 'double precision',
          support_type: 'text',
          confidence_interval: 'text'
        },
        payload
      )
    }
  }

  private async insertExtensionBatch(
    client: Pick<PoolClient, 'query'>,
    table: string,
    columns: readonly string[],
    recordsetTypes: Record<string, string>,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (rows.length === 0) return
    const recordsetSignature = columns
      .map((col) => `"${col}" ${recordsetTypes[col] ?? 'text'}`)
      .join(', ')

    const sql = `INSERT INTO ${this.schemaName}.${quoteIdentifier(table)}
      (${columns.map((c) => `"${c}"`).join(', ')})
      SELECT ${columns.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(${recordsetSignature})`

    await client.query(sql, [JSON.stringify(rows)])
  }
}
