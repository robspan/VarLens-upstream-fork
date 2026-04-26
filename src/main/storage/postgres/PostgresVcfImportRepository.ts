import type { PoolClient } from 'pg'

import { quoteIdentifier } from './identifiers'
import { runBulkCopy } from './postgres-bulk-write'
import {
  VARIANT_CNV_COPY_COLUMNS,
  VARIANT_COLUMN_ENCODERS,
  VARIANT_COPY_COLUMNS,
  VARIANT_STR_COPY_COLUMNS,
  VARIANT_SV_COPY_COLUMNS,
  VARIANT_TRANSCRIPT_COPY_COLUMNS,
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

/**
 * Append-mode request for subsequent batches of the same file. The caller
 * already holds the resolved `caseId` (from the first batch's
 * PostgresVcfImportFileResult), so writeVcfFile skips both the case-name
 * lookup and the per-batch case_data_info upsert. Saves O(N) redundant
 * `SELECT id FROM cases` queries and `case_data_info` writes per file.
 */
export interface PostgresVcfImportAppendRequest extends PostgresVcfImportRequestBase {
  mode: 'append'
  caseId: number
}

export type PostgresVcfImportRequest =
  | PostgresVcfImportSingleFileRequest
  | PostgresVcfImportMultiFileRequest
  | PostgresVcfImportAppendRequest

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
   * Write one batch worth of VCF variants into the database.
   *
   * The caller MUST own the transaction (BEGIN/COMMIT/ROLLBACK). This method
   * issues NO transaction-lifecycle SQL. variant_frequency is also NOT updated
   * here — the worker handles that after all writeVcfFile calls complete.
   *
   * Per-mode semantics:
   *  - mode: 'single-file'             — duplicate check + case insert + provenance
   *  - mode: 'multi-file', index: 0    — duplicate check + case insert + provenance
   *  - mode: 'multi-file', index: N    — look up existing case by name + provenance
   *  - mode: 'append', caseId          — variants only; no case lookup, no provenance
   *
   * The 'append' shape is the WGS-friendly path: subsequent batches of the
   * same file pass the resolved caseId from the first batch's result and
   * skip the per-batch `SELECT id FROM cases` + `case_data_info` upsert.
   */
  async writeVcfFile(
    client: Pick<PoolClient, 'query'>,
    request: PostgresVcfImportRequest
  ): Promise<PostgresVcfImportFileResult> {
    let caseId: number
    let writeProvenance = true

    if (request.mode === 'append') {
      caseId = request.caseId
      writeProvenance = false
    } else if (
      request.mode === 'single-file' ||
      (request.mode === 'multi-file' && request.fileIndex === 0)
    ) {
      // Check for pre-existing case and create if absent.
      const dupResult = await client.query(
        `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
        [request.caseName]
      )
      if ((dupResult.rows as unknown[]).length > 0) {
        throw new Error(`case '${request.caseName}' already exists — cannot create a duplicate`)
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

    // Write per-file provenance — only on the first batch of a file.
    // Subsequent batches (`mode: 'append'`) skip this; the row is already
    // there with the correct file_name + file_type.
    if (writeProvenance) {
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
    }

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
    const N = variants.length
    if (N === 0) return 0

    // Pre-reserve N IDs with an explicit ordinal column. The ORDER BY g.ord
    // guarantees the returned rows are aligned with the variants array index,
    // which is what the extension-row ordinal lookup later depends on.
    //
    // pg_get_serial_sequence takes an unquoted bare schema.table identifier
    // (regclass-style), so we strip the quotes from this.schemaName.
    const idResult = await client.query(
      `SELECT g.ord                                              AS ordinal,
              nextval(pg_get_serial_sequence($1, 'id'))::bigint  AS id
       FROM   generate_series(0, $2 - 1) AS g(ord)
       ORDER BY g.ord`,
      [`${unquoteSchema(this.schemaName)}.variants`, N]
    )
    const idRows = idResult.rows as Array<{ ordinal: unknown; id: unknown }>
    const variantIds: bigint[] = idRows.map((r) => BigInt(r.id as string | number | bigint))

    // Build the per-row payload aligned by ordinal with the variants array.
    // pickColumns projects to exactly the COPY column list and sets nulls for
    // missing keys; we then add the pre-reserved id and the resolved case_id.
    const variantsRowsWithIds = variants.map((row, i) => {
      const picked = pickColumns(row, VARIANT_COPY_COLUMNS as readonly string[])
      if (picked.variant_type === null) picked.variant_type = 'snv'
      picked.id = variantIds[i]
      picked.case_id = caseId
      return picked as Record<string, unknown>
    })

    // COPY base variants. VARIANT_COPY_COLUMNS prepends `id` and excludes
    // both `coord_hash` (generated) and `search_document` (deferred to the
    // scoped bulk UPDATE below).
    await runBulkCopy({
      client,
      sql:
        `COPY ${this.schemaName}."variants" ` +
        `(${(VARIANT_COPY_COLUMNS as readonly string[])
          .map((c) => quoteIdentifier(c))
          .join(', ')}) ` +
        `FROM STDIN`,
      columns: (VARIANT_COPY_COLUMNS as readonly string[]).map((name) => ({
        name,
        encoder: VARIANT_COLUMN_ENCODERS[name]
      })),
      rows: variantsRowsWithIds
    })

    // COPY extension tables sequentially. Each helper resolves
    // ordinal → variant_id at iterate time and skips out-of-range ordinals.
    await this.copyExtensions(client, variantIds, transcripts, sv, cnv, str)

    // Per-batch scoped bulk UPDATEs for search_document.
    //
    // The triggers that would otherwise populate search_document on insert are
    // disabled at the worker level (Phase 16 bracket transaction); these
    // UPDATEs do NOT retrigger because the disabled state still applies.
    await client.query(
      `UPDATE ${this.schemaName}."variants"
       SET    search_document = compute_variants_search_document(variants)
       WHERE  id = ANY($1::bigint[])`,
      [variantIds]
    )

    if (sv.length > 0) {
      const svVariantIds = sv
        .filter((r) => r.ordinal >= 0 && r.ordinal < variantIds.length)
        .map((r) => variantIds[r.ordinal])
      if (svVariantIds.length > 0) {
        await client.query(
          `UPDATE ${this.schemaName}."variant_sv"
           SET    search_document = compute_variant_sv_search_document(variant_sv)
           WHERE  variant_id = ANY($1::bigint[])`,
          [svVariantIds]
        )
      }
    }

    if (str.length > 0) {
      const strVariantIds = str
        .filter((r) => r.ordinal >= 0 && r.ordinal < variantIds.length)
        .map((r) => variantIds[r.ordinal])
      if (strVariantIds.length > 0) {
        await client.query(
          `UPDATE ${this.schemaName}."variant_str"
           SET    search_document = compute_variant_str_search_document(variant_str)
           WHERE  variant_id = ANY($1::bigint[])`,
          [strVariantIds]
        )
      }
    }

    return variantIds.length
  }

  private async copyExtensions(
    client: Pick<PoolClient, 'query'>,
    variantIds: bigint[],
    transcripts: VcfTranscriptRow[],
    svRows: VcfSvRow[],
    cnvRows: VcfCnvRow[],
    strRows: VcfStrRow[]
  ): Promise<void> {
    const helper = async (
      table: string,
      columns: readonly string[],
      rows: ReadonlyArray<Record<string, unknown> & { ordinal: number }>
    ): Promise<void> => {
      if (rows.length === 0) return

      // Resolve ordinal → variant_id; drop rows whose ordinal is out of bounds
      // (negative ordinals would silently index from the end in JS arrays).
      const resolved: Array<Record<string, unknown>> = []
      for (const row of rows) {
        if (row.ordinal < 0 || row.ordinal >= variantIds.length) continue
        const picked = pickColumns(row, columns)
        picked.variant_id = variantIds[row.ordinal]
        resolved.push(picked as Record<string, unknown>)
      }
      if (resolved.length === 0) return

      const sql =
        `COPY ${this.schemaName}.${quoteIdentifier(table)} ` +
        `(${columns.map((c) => quoteIdentifier(c)).join(', ')}) FROM STDIN`

      await runBulkCopy({
        client,
        sql,
        columns: columns.map((name) => ({ name, encoder: VARIANT_COLUMN_ENCODERS[name] })),
        rows: resolved
      })
    }

    await helper(
      'variant_transcripts',
      VARIANT_TRANSCRIPT_COPY_COLUMNS as unknown as readonly string[],
      transcripts
    )
    await helper('variant_sv', VARIANT_SV_COPY_COLUMNS as unknown as readonly string[], svRows)
    await helper('variant_cnv', VARIANT_CNV_COPY_COLUMNS as unknown as readonly string[], cnvRows)
    await helper('variant_str', VARIANT_STR_COPY_COLUMNS as unknown as readonly string[], strRows)
  }
}

/**
 * Strip surrounding double-quotes from an already-quoted schema identifier so
 * it can be passed to pg_get_serial_sequence (which requires an unquoted bare
 * schema.table form). quoteIdentifier always wraps in quotes and doubles any
 * embedded quotes, so the inverse here unwraps and undoes the doubling.
 */
function unquoteSchema(quoted: string): string {
  if (quoted.startsWith('"') && quoted.endsWith('"')) {
    return quoted.slice(1, -1).replace(/""/g, '"')
  }
  return quoted
}
