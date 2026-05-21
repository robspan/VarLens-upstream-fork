import type { Pool } from 'pg'

import type { StorageSession } from '../../../main/storage/session'
import { quoteIdentifier } from '../../../main/storage/postgres/identifiers'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import type { OverrideHandler } from './types'

function postgresContext(session: StorageSession): { pool: Pool; schemaName: string } {
  if (session.workspace.kind !== 'postgres') {
    throw new Error('Postgres storage session is required for web IPC parity route')
  }
  const maybePool = (session as { getPool?: () => Pool }).getPool
  if (maybePool === undefined) {
    throw new Error('Postgres storage session does not expose a pg pool')
  }
  return {
    pool: maybePool.call(session),
    schemaName: quoteIdentifier(session.workspace.schema)
  }
}

export function buildTranscriptOverrides(): Record<string, OverrideHandler> {
  return {
    'transcripts:list': {
      async handle(args, _request, reply, { session }) {
        const [variantId] = args
        if (typeof variantId !== 'number') {
          reply.code(400)
          return { error: 'invalid-transcript-variant-id' }
        }
        const { pool, schemaName } = postgresContext(session)
        const result = await pool.query(
          `SELECT id, variant_id, transcript_id, gene_symbol, consequence, cdna, aa_change,
                  hpo_sim_score, moi, is_selected, is_mane_select, is_canonical
             FROM ${schemaName}.variant_transcripts
            WHERE variant_id = $1
            ORDER BY is_selected DESC, transcript_id ASC`,
          [variantId]
        )
        return result.rows
      }
    },

    'transcripts:insertAndSwitch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcript] = args
        if (
          typeof variantId !== 'number' ||
          transcript === null ||
          typeof transcript !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-transcript-insert' }
        }
        const row = transcript as TranscriptInsertRow
        const { pool, schemaName } = postgresContext(session)
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await client.query(
            `UPDATE ${schemaName}.variant_transcripts SET is_selected = 0 WHERE variant_id = $1`,
            [variantId]
          )
          await client.query(
            `INSERT INTO ${schemaName}.variant_transcripts
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
              variantId,
              row.transcript_id,
              row.gene_symbol,
              row.consequence,
              row.cdna,
              row.aa_change,
              row.hpo_sim_score,
              row.moi
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
    }
  }
}
