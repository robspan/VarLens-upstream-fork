import { z } from 'zod'
import type { Pool } from 'pg'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import { mainLogger } from '../../services/MainLogger'
import { quoteIdentifier } from '../../storage/postgres/identifiers'
import type { StorageSession } from '../../storage/session'

// Schema for variant ID validation
const VariantIdSchema = z.number().int().positive()

// Schema for transcript ID validation
const TranscriptIdSchema = z.string().min(1)

// Schema for transcript insert row validation
const TranscriptInsertRowSchema = z.object({
  transcript_id: z.string().min(1),
  gene_symbol: z.string().nullable(),
  consequence: z.string().nullable(),
  cdna: z.string().nullable(),
  aa_change: z.string().nullable(),
  hpo_sim_score: z.number().nullable(),
  moi: z.string().nullable(),
  is_selected: z.number().int().min(0).max(1)
})

function postgresContext(session: StorageSession): {
  pool: Pool
  schemaName: string
} | null {
  if (session.workspace.kind !== 'postgres') return null
  const maybePool = (session as { getPool?: () => Pool }).getPool
  if (maybePool === undefined) return null
  return {
    pool: maybePool.call(session),
    schemaName: quoteIdentifier(session.workspace.schema)
  }
}

/**
 * Transcript IPC handlers
 *
 * Channels: transcripts:list, transcripts:switch, transcripts:insertAndSwitch
 */
export function registerTranscriptHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  /**
   * List all transcripts for a variant
   */
  ipcMain.handle('transcripts:list', async (_event, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = VariantIdSchema.safeParse(variantId)
      if (!validated.success) {
        mainLogger.error(
          `Invalid transcripts:list params: ${validated.error.message}`,
          'transcripts'
        )
        throw new Error('Invalid parameters')
      }

      const session = getDbManager().getCurrentSession()
      const pg = postgresContext(session)
      if (pg !== null) {
        const result = await pg.pool.query(
          `SELECT id, variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change,
                  hpo_sim_score, moi, is_selected, is_mane_select, is_canonical
             FROM ${pg.schemaName}.variant_transcripts
            WHERE variant_id = $1
            ORDER BY is_selected DESC, transcript_id ASC`,
          [validated.data]
        )
        return result.rows
      }

      const pool = getDbPool?.()
      if (pool !== undefined && pool !== null) {
        return await pool.run({ type: 'transcripts:list' as const, params: [validated.data] })
      }
      const db = getDb()
      return db.transcripts.getVariantTranscripts(validated.data)
    })
  })

  /**
   * Switch the selected transcript for a variant
   */
  ipcMain.handle(
    'transcripts:switch',
    async (_event, variantId: unknown, transcriptId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedVariantId = VariantIdSchema.safeParse(variantId)
        if (!validatedVariantId.success) {
          mainLogger.error(
            `Invalid transcripts:switch variantId: ${validatedVariantId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const validatedTranscriptId = TranscriptIdSchema.safeParse(transcriptId)
        if (!validatedTranscriptId.success) {
          mainLogger.error(
            `Invalid transcripts:switch transcriptId: ${validatedTranscriptId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        const pg = postgresContext(session)
        if (pg !== null) {
          await pg.pool.query(
            `UPDATE ${pg.schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
            [validatedVariantId.data]
          )
          await pg.pool.query(
            `UPDATE ${pg.schemaName}.variant_transcripts
                SET is_selected = 1
              WHERE variant_id = $1 AND transcript_id = $2`,
            [validatedVariantId.data, validatedTranscriptId.data]
          )
          return { success: true }
        }

        const db = getDb()
        db.transcripts.switchSelectedTranscript(validatedVariantId.data, validatedTranscriptId.data)
        return { success: true }
      })
    }
  )

  /**
   * Insert a transcript (if not present) and switch to it.
   * Used when selecting a VEP-only transcript that isn't in the DB yet.
   */
  ipcMain.handle(
    'transcripts:insertAndSwitch',
    async (_event, variantId: unknown, transcript: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedVariantId = VariantIdSchema.safeParse(variantId)
        if (!validatedVariantId.success) {
          mainLogger.error(
            `Invalid transcripts:insertAndSwitch variantId: ${validatedVariantId.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const validatedTranscript = TranscriptInsertRowSchema.safeParse(transcript)
        if (!validatedTranscript.success) {
          mainLogger.error(
            `Invalid transcripts:insertAndSwitch transcript: ${validatedTranscript.error.message}`,
            'transcripts'
          )
          throw new Error('Invalid parameters')
        }

        const session = getDbManager().getCurrentSession()
        const pg = postgresContext(session)
        if (pg !== null) {
          const client = await pg.pool.connect()
          try {
            await client.query('BEGIN')
            await client.query(
              `UPDATE ${pg.schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
              [validatedVariantId.data]
            )
            await client.query(
              `INSERT INTO ${pg.schemaName}.variant_transcripts
                 (variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change,
                  hpo_sim_score, moi, is_selected, is_mane_select, is_canonical)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, NULL, NULL)
               ON CONFLICT (variant_id, transcript_id)
               DO UPDATE SET
                 gene_symbol = EXCLUDED.gene_symbol,
                 consequence = EXCLUDED.consequence,
                 cdna = EXCLUDED.cdna,
                 aa_change = EXCLUDED.aa_change,
                 hpo_sim_score = EXCLUDED.hpo_sim_score,
                 moi = EXCLUDED.moi,
                 is_selected = 1`,
              [
                validatedVariantId.data,
                validatedTranscript.data.transcript_id,
                validatedTranscript.data.gene_symbol,
                validatedTranscript.data.consequence,
                validatedTranscript.data.cdna,
                validatedTranscript.data.aa_change,
                validatedTranscript.data.hpo_sim_score,
                validatedTranscript.data.moi
              ]
            )
            await client.query('COMMIT')
            return { success: true }
          } catch (error) {
            await client.query('ROLLBACK')
            throw error
          } finally {
            client.release()
          }
        }

        const db = getDb()
        db.transcripts.insertTranscriptAndSwitch(
          validatedVariantId.data,
          validatedTranscript.data as TranscriptInsertRow
        )
        return { success: true }
      })
    }
  )
}
