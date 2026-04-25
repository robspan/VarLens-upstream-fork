import type { PoolClient } from 'pg'

import { quoteIdentifier } from './identifiers'
import {
  CNV_RECORDSET_TYPES,
  STR_RECORDSET_TYPES,
  SV_RECORDSET_TYPES,
  TRANSCRIPT_RECORDSET_TYPES,
  VARIANT_BASE_COLUMNS,
  VARIANT_BATCH_RECORDSET_TYPES,
  VARIANT_CNV_COLUMNS,
  VARIANT_STR_COLUMNS,
  VARIANT_SV_COLUMNS,
  VARIANT_TRANSCRIPT_COLUMNS,
  toNumericId
} from './postgres-import-columns'

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

interface PostgresVcfImportRequestBase {
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

export interface PostgresVcfImportSingleFileRequest extends PostgresVcfImportRequestBase {
  mode: 'single-file'
}

export interface PostgresVcfImportMultiFileRequest extends PostgresVcfImportRequestBase {
  mode: 'multi-file'
  /** 0 = first file (creates the case), >= 1 = subsequent files (looks up the case). */
  fileIndex: number
}

export type PostgresVcfImportRequest =
  | PostgresVcfImportSingleFileRequest
  | PostgresVcfImportMultiFileRequest

export interface PostgresVcfImportFileResult {
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
    request: PostgresVcfImportRequest
  ): Promise<PostgresVcfImportFileResult> {
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
    request: PostgresVcfImportRequest
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
    // Guard both bounds: negative ordinals index from the end in JS arrays and
    // would silently produce undefined, causing a FK violation downstream.
    const resolveExtension = (
      rows: Array<Record<string, unknown> & { ordinal: number }>,
      columns: readonly string[]
    ): Array<Record<string, unknown>> =>
      rows
        .filter((r) => r.ordinal >= 0 && r.ordinal < variantIds.length)
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
        TRANSCRIPT_RECORDSET_TYPES,
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
        SV_RECORDSET_TYPES,
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
        CNV_RECORDSET_TYPES,
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
        STR_RECORDSET_TYPES,
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
