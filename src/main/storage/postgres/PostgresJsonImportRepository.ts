import type { Pool, PoolClient } from 'pg'

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

export type PostgresJsonImportFileType = 'simple' | 'object' | 'columnar'

export interface PostgresJsonImportRequest {
  filePath: string
  fileName: string
  caseName: string
  fileSize: number
  genomeBuild: string
  importFileType: PostgresJsonImportFileType
}

export interface PostgresJsonImportBatchResult {
  caseId: number
  variantCount: number
}

export interface PostgresJsonImportSession {
  readonly caseId: number
  insertVariantBatch(variants: Array<Record<string, unknown>>): Promise<number>
}

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

function hasExtensions(row: Record<string, unknown>): boolean {
  return (
    Array.isArray(row._transcripts) ||
    row._sv !== undefined ||
    row._cnv !== undefined ||
    row._str !== undefined
  )
}

export class PostgresJsonImportRepository {
  private readonly schemaName: string

  // `_pool` is retained for API compatibility with Task 6's postgres-import-worker,
  // which constructs the repository with a stubbed pool and passes its own Client
  // through writeJsonImport(client, ...). The repository itself never opens a
  // connection; the executor (or worker) owns the transaction lifecycle.
  constructor(
    _pool: Pick<Pool, 'connect'>,
    schema: string
  ) {
    this.schemaName = quoteIdentifier(schema)
  }

  async writeJsonImport(
    client: Pick<PoolClient, 'query'>,
    request: PostgresJsonImportRequest,
    writeVariants: (session: PostgresJsonImportSession) => Promise<void>
  ): Promise<PostgresJsonImportBatchResult> {
    // Duplicate-name check (single-file mode). Multi-file callers in Phase 9
    // perform pre-existing-case rejection at file 1; subsequent files look up
    // the case and append, so they bypass this check.
    const dupResult = await client.query(
      `SELECT id FROM ${this.schemaName}."cases" WHERE name = $1`,
      [request.caseName]
    )
    if (dupResult.rows.length > 0) {
      throw new Error(`Duplicate case name: ${request.caseName}`)
    }

    const createdAt = Date.now()
    const caseInsert = await client.query(
      `INSERT INTO ${this.schemaName}."cases"
       (name, file_path, file_size, variant_count, created_at, genome_build)
       VALUES ($1, $2, $3, 0, $4, $5)
       RETURNING id`,
      [request.caseName, request.filePath, request.fileSize, createdAt, request.genomeBuild]
    )
    const caseId = toNumericId((caseInsert.rows[0] as { id: unknown } | undefined)?.id)

    let totalVariantCount = 0

    const session: PostgresJsonImportSession = {
      caseId,
      insertVariantBatch: async (variants) => {
        const inserted = await this.insertVariantBatch(client, caseId, variants)
        totalVariantCount += inserted
        return inserted
      }
    }

    await writeVariants(session)

    // case_data_info provenance.
    // IMPORTANT: use only columns from scripts/postgres/init-db/11-phase6-case-metadata.sql.
    // Do not add ad-hoc provenance columns here (e.g. import_date, imported_at).
    await client.query(
      `INSERT INTO ${this.schemaName}."case_data_info"
         (case_id, import_file_name, import_file_type, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (case_id) DO UPDATE SET
         import_file_name = EXCLUDED.import_file_name,
         import_file_type = EXCLUDED.import_file_type,
         updated_at = EXCLUDED.updated_at`,
      [caseId, request.fileName, request.importFileType, createdAt]
    )

    await client.query(
      `UPDATE ${this.schemaName}."cases" SET variant_count = $1 WHERE id = $2`,
      [totalVariantCount, caseId]
    )

    return { caseId, variantCount: totalVariantCount }
  }

  private async insertVariantBatch(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    variants: Array<Record<string, unknown>>
  ): Promise<number> {
    if (variants.length === 0) return 0

    const baseOnly: Array<Record<string, unknown>> = []
    const withExtensions: Array<Record<string, unknown>> = []
    for (const row of variants) {
      if (hasExtensions(row)) withExtensions.push(row)
      else baseOnly.push(row)
    }

    let insertedCount = 0

    // (a) Base-only rows: one batch INSERT via jsonb_to_recordset.
    if (baseOnly.length > 0) {
      await this.insertBaseOnlyBatch(client, caseId, baseOnly)
      insertedCount += baseOnly.length
    }

    // (b) Extension-bearing rows: insert one at a time to learn variant_id
    // deterministically, then do one jsonb_to_recordset call per extension
    // table.
    const transcriptPayload: Array<Record<string, unknown>> = []
    const svPayload: Array<Record<string, unknown>> = []
    const cnvPayload: Array<Record<string, unknown>> = []
    const strPayload: Array<Record<string, unknown>> = []

    for (const row of withExtensions) {
      const variantId = await this.insertBaseRowSingle(client, caseId, row)
      insertedCount += 1

      if (Array.isArray(row._transcripts)) {
        for (const t of row._transcripts as Array<Record<string, unknown>>) {
          transcriptPayload.push({ ...t, variant_id: variantId })
        }
      }
      if (row._sv !== undefined && row._sv !== null) {
        svPayload.push({ ...(row._sv as Record<string, unknown>), variant_id: variantId })
      }
      if (row._cnv !== undefined && row._cnv !== null) {
        cnvPayload.push({ ...(row._cnv as Record<string, unknown>), variant_id: variantId })
      }
      if (row._str !== undefined && row._str !== null) {
        strPayload.push({ ...(row._str as Record<string, unknown>), variant_id: variantId })
      }
    }

    if (transcriptPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_transcripts',
        VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[],
        TRANSCRIPT_RECORDSET_TYPES,
        transcriptPayload.map((row) =>
          pickColumns(row, VARIANT_TRANSCRIPT_COLUMNS as unknown as readonly string[])
        )
      )
    }

    if (svPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_sv',
        VARIANT_SV_COLUMNS as unknown as readonly string[],
        SV_RECORDSET_TYPES,
        svPayload.map((row) => pickColumns(row, VARIANT_SV_COLUMNS as unknown as readonly string[]))
      )
    }

    if (cnvPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_cnv',
        VARIANT_CNV_COLUMNS as unknown as readonly string[],
        CNV_RECORDSET_TYPES,
        cnvPayload.map((row) =>
          pickColumns(row, VARIANT_CNV_COLUMNS as unknown as readonly string[])
        )
      )
    }

    if (strPayload.length > 0) {
      await this.insertExtensionBatch(
        client,
        'variant_str',
        VARIANT_STR_COLUMNS as unknown as readonly string[],
        STR_RECORDSET_TYPES,
        strPayload.map((row) =>
          pickColumns(row, VARIANT_STR_COLUMNS as unknown as readonly string[])
        )
      )
    }

    return insertedCount
  }

  private async insertBaseOnlyBatch(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    const batchCols = Object.keys(VARIANT_BATCH_RECORDSET_TYPES)
    const recordsetSignature = batchCols
      .map((col) => `"${col}" ${VARIANT_BATCH_RECORDSET_TYPES[col]}`)
      .join(', ')

    const payload = rows.map((row) => {
      const picked = pickColumns(row, batchCols as readonly string[])
      // Default variant_type to 'snv' when not provided.
      if (picked.variant_type === null) {
        picked.variant_type = 'snv'
      }
      return picked
    })

    // Embed case_id into the JSON payload so the batch INSERT has exactly one
    // bound parameter (the JSON), dodging PostgreSQL's 65,535 parameter cap.
    const payloadWithCaseId = payload.map((row) => ({ case_id: caseId, ...row }))

    const sql = `INSERT INTO ${this.schemaName}."variants"
      (${VARIANT_BASE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      SELECT ${VARIANT_BASE_COLUMNS.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(
        "case_id" bigint,
        ${recordsetSignature}
      )`

    await client.query(sql, [JSON.stringify(payloadWithCaseId)])
  }

  private async insertBaseRowSingle(
    client: Pick<PoolClient, 'query'>,
    caseId: number,
    row: Record<string, unknown>
  ): Promise<number> {
    const batchCols = Object.keys(VARIANT_BATCH_RECORDSET_TYPES)
    const recordsetSignature = batchCols
      .map((col) => `"${col}" ${VARIANT_BATCH_RECORDSET_TYPES[col]}`)
      .join(', ')

    const picked = pickColumns(row, batchCols as readonly string[])
    if (picked.variant_type === null) picked.variant_type = 'snv'
    const payload = [{ case_id: caseId, ...picked }]

    const sql = `INSERT INTO ${this.schemaName}."variants"
      (${VARIANT_BASE_COLUMNS.map((c) => `"${c}"`).join(', ')})
      SELECT ${VARIANT_BASE_COLUMNS.map((c) => `v."${c}"`).join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS v(
        "case_id" bigint,
        ${recordsetSignature}
      )
      RETURNING id`

    const result = await client.query(sql, [JSON.stringify(payload)])
    return toNumericId((result.rows[0] as { id: unknown } | undefined)?.id)
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

export async function rebuildVariantFrequencyForCase(
  client: Pick<PoolClient, 'query'>,
  schema: string,
  caseId: number
): Promise<void> {
  const schemaName = quoteIdentifier(schema)
  await client.query(
    `INSERT INTO ${schemaName}."variant_frequency" (chr, pos, ref, alt, case_count)
     SELECT chr, pos, ref, alt, 1
     FROM ${schemaName}."variants"
     WHERE case_id = $1
     GROUP BY chr, pos, ref, alt
     ON CONFLICT (chr, pos, ref, alt)
     DO UPDATE SET case_count = ${schemaName}."variant_frequency".case_count + 1`,
    [caseId]
  )
}
