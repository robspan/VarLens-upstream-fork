import type { Pool, PoolClient } from 'pg'

import type {
  AcmgClassification,
  CaseVariantAnnotation,
  VariantAnnotation
} from '../../../shared/types/database'
import { globalAnnotationAuditEntries, perCaseAnnotationAuditEntries } from '../annotation-audit'
import { quoteIdentifier } from './identifiers'
import { PostgresAuditLogRepository } from './PostgresAuditLogRepository'

type QueryablePool = Pick<Pool, 'query'>
type TransactionCapablePool = QueryablePool & { connect: () => Promise<PoolClient> }

type GlobalAnnotationUpdates = Partial<
  Omit<
    Pick<VariantAnnotation, 'global_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'>,
    'starred'
  > & { starred: number | boolean }
>

type PerCaseAnnotationUpdates = Partial<
  Omit<
    Pick<
      CaseVariantAnnotation,
      'per_case_comment' | 'starred' | 'acmg_classification' | 'acmg_evidence'
    >,
    'starred'
  > & { starred: number | boolean }
>

type VariantKey = { chr: string; pos: number; ref: string; alt: string }

const nowExpression = '(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint'

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') return Number(value)
  return 0
}

function toStarredNumber(value: unknown): number {
  return toNumber(value) === 0 ? 0 : 1
}

function toGlobalAnnotation(row: Record<string, unknown>): VariantAnnotation {
  return {
    id: toNumber(row.id),
    chr: String(row.chr),
    pos: toNumber(row.pos),
    ref: String(row.ref),
    alt: String(row.alt),
    global_comment: row.global_comment === null ? null : String(row.global_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

function toPerCaseAnnotation(row: Record<string, unknown>): CaseVariantAnnotation {
  return {
    id: toNumber(row.id),
    case_id: toNumber(row.case_id),
    variant_id: toNumber(row.variant_id),
    per_case_comment: row.per_case_comment === null ? null : String(row.per_case_comment),
    starred: toStarredNumber(row.starred),
    acmg_classification: (row.acmg_classification ?? null) as AcmgClassification | null,
    acmg_evidence: row.acmg_evidence === null ? null : String(row.acmg_evidence),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at)
  }
}

function variantKey(key: VariantKey): string {
  return `${key.chr}:${key.pos}:${key.ref}:${key.alt}`
}

function valuesListForVariantKeys(keys: VariantKey[], params: unknown[]): string {
  return keys
    .map((key) => {
      params.push(key.chr, key.pos, key.ref, key.alt)
      const base = params.length - 3
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3})`
    })
    .join(', ')
}

export class PostgresAnnotationsRepository {
  constructor(
    private readonly pool: QueryablePool,
    private readonly schema: string
  ) {}

  async getGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<VariantAnnotation | null> {
    const schemaName = quoteIdentifier(this.schema)
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${schemaName}."variant_annotations"
        WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4
        LIMIT 1
      `,
      [chr, pos, ref, alt]
    )

    const row = result.rows[0]
    return row === undefined ? null : toGlobalAnnotation(row)
  }

  async upsertGlobalAnnotation(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ): Promise<VariantAnnotation> {
    const schemaName = quoteIdentifier(this.schema)
    const commentProvided = 'global_comment' in updates
    const starredProvided = updates.starred !== undefined
    const acmgClassProvided = 'acmg_classification' in updates
    const acmgEvidenceProvided = 'acmg_evidence' in updates
    const params = [
      chr,
      pos,
      ref,
      alt,
      updates.global_comment ?? null,
      starredProvided ? toStarredNumber(updates.starred) : 0,
      updates.acmg_classification ?? null,
      updates.acmg_evidence ?? null,
      commentProvided,
      starredProvided,
      acmgClassProvided,
      acmgEvidenceProvided
    ]

    const result = await this.pool.query(
      `
        INSERT INTO ${schemaName}."variant_annotations" (
          chr,
          pos,
          ref,
          alt,
          global_comment,
          starred,
          acmg_classification,
          acmg_evidence,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${nowExpression}, ${nowExpression})
        ON CONFLICT (chr, pos, ref, alt) DO UPDATE SET
          global_comment = CASE
            WHEN $9 THEN EXCLUDED.global_comment
            ELSE variant_annotations.global_comment
          END,
          starred = CASE
            WHEN $10 THEN EXCLUDED.starred
            ELSE variant_annotations.starred
          END,
          acmg_classification = CASE
            WHEN $11 THEN EXCLUDED.acmg_classification
            ELSE variant_annotations.acmg_classification
          END,
          acmg_evidence = CASE
            WHEN $12 THEN EXCLUDED.acmg_evidence
            ELSE variant_annotations.acmg_evidence
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      params
    )

    return toGlobalAnnotation(result.rows[0])
  }

  async upsertGlobalAnnotationWithAudit(
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates & { user_name?: string | null }
  ): Promise<VariantAnnotation> {
    const client = await this.connect()
    try {
      await client.query('BEGIN')
      const annotations = new PostgresAnnotationsRepository(client, this.schema)
      const audit = new PostgresAuditLogRepository(client, this.schema)
      const oldAnnotation = await annotations.getGlobalAnnotation(chr, pos, ref, alt)
      const result = await annotations.upsertGlobalAnnotation(chr, pos, ref, alt, updates)
      for (const entry of globalAnnotationAuditEntries(
        { chr, pos, ref, alt },
        updates,
        oldAnnotation as Record<string, unknown> | null
      )) {
        await audit.append(entry)
      }
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deleteGlobalAnnotation(chr: string, pos: number, ref: string, alt: string): Promise<void> {
    const schemaName = quoteIdentifier(this.schema)
    await this.pool.query(
      `
        DELETE FROM ${schemaName}."variant_annotations"
        WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4
      `,
      [chr, pos, ref, alt]
    )
  }

  async getPerCaseAnnotation(
    caseId: number,
    variantId: number
  ): Promise<CaseVariantAnnotation | null> {
    const schemaName = quoteIdentifier(this.schema)
    const result = await this.pool.query(
      `
        SELECT *
        FROM ${schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND variant_id = $2
        LIMIT 1
      `,
      [caseId, variantId]
    )

    const row = result.rows[0]
    return row === undefined ? null : toPerCaseAnnotation(row)
  }

  async upsertPerCaseAnnotation(
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ): Promise<CaseVariantAnnotation> {
    const schemaName = quoteIdentifier(this.schema)
    const commentProvided = 'per_case_comment' in updates
    const starredProvided = updates.starred !== undefined
    const acmgClassProvided = 'acmg_classification' in updates
    const acmgEvidenceProvided = 'acmg_evidence' in updates
    const params = [
      caseId,
      variantId,
      updates.per_case_comment ?? null,
      starredProvided ? toStarredNumber(updates.starred) : 0,
      updates.acmg_classification ?? null,
      updates.acmg_evidence ?? null,
      commentProvided,
      starredProvided,
      acmgClassProvided,
      acmgEvidenceProvided
    ]

    const result = await this.pool.query(
      `
        INSERT INTO ${schemaName}."case_variant_annotations" (
          case_id,
          variant_id,
          per_case_comment,
          starred,
          acmg_classification,
          acmg_evidence,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, ${nowExpression}, ${nowExpression})
        ON CONFLICT (case_id, variant_id) DO UPDATE SET
          per_case_comment = CASE
            WHEN $7 THEN EXCLUDED.per_case_comment
            ELSE case_variant_annotations.per_case_comment
          END,
          starred = CASE
            WHEN $8 THEN EXCLUDED.starred
            ELSE case_variant_annotations.starred
          END,
          acmg_classification = CASE
            WHEN $9 THEN EXCLUDED.acmg_classification
            ELSE case_variant_annotations.acmg_classification
          END,
          acmg_evidence = CASE
            WHEN $10 THEN EXCLUDED.acmg_evidence
            ELSE case_variant_annotations.acmg_evidence
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      params
    )

    return toPerCaseAnnotation(result.rows[0])
  }

  async upsertPerCaseAnnotationWithAudit(
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates & { user_name?: string | null }
  ): Promise<CaseVariantAnnotation> {
    const client = await this.connect()
    try {
      await client.query('BEGIN')
      const annotations = new PostgresAnnotationsRepository(client, this.schema)
      const audit = new PostgresAuditLogRepository(client, this.schema)
      const oldAnnotation = await annotations.getPerCaseAnnotation(caseId, variantId)
      const result = await annotations.upsertPerCaseAnnotation(caseId, variantId, updates)
      for (const entry of perCaseAnnotationAuditEntries(
        caseId,
        variantId,
        updates,
        oldAnnotation as Record<string, unknown> | null
      )) {
        await audit.append(entry)
      }
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deletePerCaseAnnotation(caseId: number, variantId: number): Promise<void> {
    const schemaName = quoteIdentifier(this.schema)
    await this.pool.query(
      `
        DELETE FROM ${schemaName}."case_variant_annotations"
        WHERE case_id = $1 AND variant_id = $2
      `,
      [caseId, variantId]
    )
  }

  async getAnnotationsForVariant(
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ): Promise<{ global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }> {
    const schemaName = quoteIdentifier(this.schema)
    const variantResult = await this.pool.query(
      `
        SELECT id
        FROM ${schemaName}."variants"
        WHERE case_id = $1 AND chr = $2 AND pos = $3 AND ref = $4 AND alt = $5
        LIMIT 1
      `,
      [caseId, chr, pos, ref, alt]
    )

    const global = await this.getGlobalAnnotation(chr, pos, ref, alt)
    const variantId = variantResult.rows[0]?.id
    const perCase =
      variantId === undefined || variantId === null
        ? null
        : await this.getPerCaseAnnotation(caseId, toNumber(variantId))

    return { global, perCase }
  }

  private async connect(): Promise<PoolClient> {
    const pool = this.pool as Partial<TransactionCapablePool>
    if (pool.connect === undefined) {
      throw new Error('Postgres annotation audit writes require a transaction-capable pool')
    }
    return await pool.connect()
  }

  async getBatch(
    caseId: number | null,
    variantKeys: VariantKey[]
  ): Promise<
    Record<string, { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }>
  > {
    const annotations: Record<
      string,
      { global: VariantAnnotation | null; perCase: CaseVariantAnnotation | null }
    > = {}
    for (const key of variantKeys) {
      annotations[variantKey(key)] = { global: null, perCase: null }
    }
    if (variantKeys.length === 0) return annotations

    const schemaName = quoteIdentifier(this.schema)
    const globalParams: unknown[] = []
    const globalValues = valuesListForVariantKeys(variantKeys, globalParams)
    const globalResult = await this.pool.query(
      `
        WITH input(chr, pos, ref, alt) AS (
          VALUES ${globalValues}
        )
        SELECT va.*
        FROM input i
        INNER JOIN ${schemaName}."variant_annotations" va
          ON va.chr = i.chr
         AND va.pos = i.pos::bigint
         AND va.ref = i.ref
         AND va.alt = i.alt
      `,
      globalParams
    )
    for (const row of globalResult.rows) {
      const global = toGlobalAnnotation(row)
      annotations[variantKey(global)].global = global
    }

    if (caseId === null) return annotations

    const perCaseParams: unknown[] = [caseId]
    const perCaseValues = valuesListForVariantKeys(variantKeys, perCaseParams)
    const perCaseResult = await this.pool.query(
      `
        WITH input(chr, pos, ref, alt) AS (
          VALUES ${perCaseValues}
        ),
        matched_variants AS (
          SELECT
            i.chr AS key_chr,
            i.pos::bigint AS key_pos,
            i.ref AS key_ref,
            i.alt AS key_alt,
            v.id AS variant_id
          FROM input i
          INNER JOIN ${schemaName}."variants" v
            ON v.case_id = $1
           AND v.chr = i.chr
           AND v.pos = i.pos::bigint
           AND v.ref = i.ref
           AND v.alt = i.alt
        )
        SELECT
          mv.key_chr,
          mv.key_pos,
          mv.key_ref,
          mv.key_alt,
          cva.*
        FROM matched_variants mv
        INNER JOIN ${schemaName}."case_variant_annotations" cva
          ON cva.case_id = $1
         AND cva.variant_id = mv.variant_id
      `,
      perCaseParams
    )
    for (const row of perCaseResult.rows) {
      const key = variantKey({
        chr: String(row.key_chr),
        pos: toNumber(row.key_pos),
        ref: String(row.key_ref),
        alt: String(row.key_alt)
      })
      annotations[key].perCase = toPerCaseAnnotation(row)
    }

    return annotations
  }
}
