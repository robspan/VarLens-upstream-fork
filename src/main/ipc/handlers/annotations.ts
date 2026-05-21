import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import {
  VariantCoordsSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  CaseVariantIdSchema
} from '../../../shared/api/schemas/annotations'
import { mainLogger } from '../../services/MainLogger'
import type { AnnotationChangeEvent } from '../../../shared/types/api'
import type { AuditAppendParams } from '../../storage/audit-log-types'
import type { StorageWriteExecutor } from '../../storage/write-executor'
import {
  getGlobalAnnotation,
  upsertGlobalAnnotation,
  deleteGlobalAnnotation,
  getPerCaseAnnotation,
  upsertPerCaseAnnotation,
  deletePerCaseAnnotation,
  getAnnotationsForVariant,
  batchGetAnnotations
} from './annotations-logic'

/**
 * Broadcast a `variants:annotationChanged` event to every non-destroyed
 * renderer window. Called AFTER a successful per-case annotation upsert so
 * that dependent views (e.g. the Wave 4 Shortlist tab) can refetch.
 *
 * Handler-layer only — `annotations-logic.ts` is prohibited from touching
 * Electron APIs per its module JSDoc.
 */
function broadcastAnnotationChanged(ev: AnnotationChangeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('variants:annotationChanged', ev)
    }
  }
}

/**
 * Map the validated per-case annotation update shape to the broadcast
 * event `kind`. Priority order: star → acmg → evidence → comment.
 * Called only after Zod validation has succeeded so the fields are typed.
 */
function detectAnnotationChangeKind(updates: {
  starred?: unknown
  acmg_classification?: unknown
  acmg_evidence?: unknown
}): AnnotationChangeEvent['kind'] {
  if (updates.starred !== undefined) return 'star'
  if (updates.acmg_classification !== undefined) return 'acmg'
  if (updates.acmg_evidence !== undefined) return 'evidence'
  return 'comment'
}

async function appendAuditEntries(
  writeExecutor: StorageWriteExecutor,
  entries: AuditAppendParams[]
): Promise<void> {
  for (const entry of entries) {
    await writeExecutor.execute({ type: 'audit:append', params: [entry] })
  }
}

function globalAuditEntries(
  coords: { chr: string; pos: number; ref: string; alt: string },
  updates: {
    user_name?: string | null
    starred?: boolean
    acmg_classification?: unknown
    acmg_evidence?: unknown
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  const entityKey = `${coords.chr}:${coords.pos}:${coords.ref}:${coords.alt}`
  const entries: AuditAppendParams[] = []
  if (updates.acmg_classification !== undefined) {
    entries.push({
      action_type: 'acmg_classify',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_classification: oldAnnotation.acmg_classification }),
      new_value: JSON.stringify({ acmg_classification: updates.acmg_classification }),
      user_name: updates.user_name ?? null
    })
  }
  if (updates.acmg_evidence !== undefined) {
    entries.push({
      action_type: 'acmg_evidence_update',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value:
        oldAnnotation === null
          ? null
          : JSON.stringify({ acmg_evidence: oldAnnotation.acmg_evidence }),
      new_value: JSON.stringify({ acmg_evidence: updates.acmg_evidence }),
      user_name: updates.user_name ?? null
    })
  }
  if (updates.starred !== undefined) {
    entries.push({
      action_type: updates.starred ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation === null ? null : JSON.stringify({ starred: oldAnnotation.starred }),
      new_value: JSON.stringify({ starred: updates.starred ? 1 : 0 }),
      user_name: updates.user_name ?? null
    })
  }
  return entries
}

function perCaseAuditEntries(
  caseId: number,
  variantId: number,
  updates: {
    user_name?: string | null
    starred?: boolean
    acmg_classification?: unknown
    acmg_evidence?: unknown
  },
  oldAnnotation: Record<string, unknown> | null
): AuditAppendParams[] {
  return globalAuditEntries(
    { chr: 'case', pos: caseId, ref: 'variant', alt: String(variantId) },
    updates,
    oldAnnotation
  ).map((entry) => ({
    ...entry,
    entity_type: 'case_variant_annotation',
    entity_key: `case:${caseId}:variant:${variantId}`
  }))
}

/**
 * Annotations IPC handlers
 * Channels: annotations:getGlobal, annotations:upsertGlobal, annotations:getPerCase,
 *           annotations:upsertPerCase, annotations:deleteGlobal, annotations:deletePerCase,
 *           annotations:getForVariant
 */
export function registerAnnotationHandlers({
  ipcMain,
  getDb,
  getDbPool,
  getDbManager
}: HandlerDependencies): void {
  /**
   * Get global annotation for a variant
   */
  ipcMain.handle(
    'annotations:getGlobal',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:getGlobal coords: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          return await session
            .getReadExecutor()
            .execute({ type: 'annotations:getGlobal', params: [validated.data] })
        }
        return getGlobalAnnotation(validated.data, getDb, getDbPool)
      })
    }
  )

  /**
   * Upsert global annotation for a variant
   */
  ipcMain.handle(
    'annotations:upsertGlobal',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedCoords.success) {
          mainLogger.error(
            `Invalid annotations:upsertGlobal coords: ${validatedCoords.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const validatedUpdates = GlobalAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid annotations:upsertGlobal updates: ${validatedUpdates.error.message}`,
            'annotations'
          )
          throw new Error('Invalid annotation updates')
        }

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          const readExecutor = session.getReadExecutor()
          const writeExecutor = session.getWriteExecutor()
          const oldAnnotation = (await readExecutor.execute({
            type: 'annotations:getGlobal',
            params: [validatedCoords.data]
          })) as Record<string, unknown> | null
          const result = await writeExecutor.execute({
            type: 'annotations:upsertGlobal',
            params: [validatedCoords.data, validatedUpdates.data]
          })
          await appendAuditEntries(
            writeExecutor,
            globalAuditEntries(validatedCoords.data, validatedUpdates.data, oldAnnotation)
          )
          return result
        }
        return upsertGlobalAnnotation(validatedCoords.data, validatedUpdates.data, getDb)
      })
    }
  )

  /**
   * Delete global annotation for a variant
   */
  ipcMain.handle(
    'annotations:deleteGlobal',
    async (_event, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:deleteGlobal coords: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          await session
            .getWriteExecutor()
            .execute({ type: 'annotations:deleteGlobal', params: [validated.data] })
          return undefined
        }
        deleteGlobalAnnotation(validated.data, getDb)
        return undefined
      })
    }
  )

  /**
   * Get per-case annotation for a variant
   */
  ipcMain.handle('annotations:getPerCase', async (_event, caseId: unknown, variantId: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
      if (!validated.success) {
        mainLogger.error(
          `Invalid annotations:getPerCase params: ${validated.error.message}`,
          'annotations'
        )
        throw new Error('Invalid case/variant ID')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'annotations:getPerCase',
          params: [validated.data.caseId, validated.data.variantId]
        })
      }
      return getPerCaseAnnotation(validated.data.caseId, validated.data.variantId, getDb, getDbPool)
    })
  })

  /**
   * Upsert per-case annotation for a variant
   * Handles per_case_comment, starred, acmg_classification, acmg_evidence
   */
  ipcMain.handle(
    'annotations:upsertPerCase',
    async (_event, caseId: unknown, variantId: unknown, updates: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedIds = CaseVariantIdSchema.safeParse({ caseId, variantId })
        if (!validatedIds.success) {
          mainLogger.error(
            `Invalid annotations:upsertPerCase ids: ${validatedIds.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case/variant ID')
        }

        const validatedUpdates = PerCaseAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedUpdates.success) {
          mainLogger.error(
            `Invalid annotations:upsertPerCase updates: ${validatedUpdates.error.message}`,
            'annotations'
          )
          throw new Error('Invalid annotation updates')
        }

        const session = getDbManager().getCurrentSession()
        let result: unknown
        if (session.capabilities.backend === 'postgres') {
          const readExecutor = session.getReadExecutor()
          const writeExecutor = session.getWriteExecutor()
          const oldAnnotation = (await readExecutor.execute({
            type: 'annotations:getPerCase',
            params: [validatedIds.data.caseId, validatedIds.data.variantId]
          })) as Record<string, unknown> | null
          result = await writeExecutor.execute({
            type: 'annotations:upsertPerCase',
            params: [validatedIds.data.caseId, validatedIds.data.variantId, validatedUpdates.data]
          })
          await appendAuditEntries(
            writeExecutor,
            perCaseAuditEntries(
              validatedIds.data.caseId,
              validatedIds.data.variantId,
              validatedUpdates.data,
              oldAnnotation
            )
          )
        } else {
          result = upsertPerCaseAnnotation(
            validatedIds.data.caseId,
            validatedIds.data.variantId,
            validatedUpdates.data,
            getDb
          )
        }

        // Broadcast AFTER the logic-layer write succeeds. If the call above
        // throws, `wrapHandler` catches it and this line never runs — the
        // error path must not emit the event (Wave 1.E spec §6).
        broadcastAnnotationChanged({
          caseId: validatedIds.data.caseId,
          variantId: validatedIds.data.variantId,
          kind: detectAnnotationChangeKind(validatedUpdates.data)
        })

        return result
      })
    }
  )

  /**
   * Delete per-case annotation for a variant
   */
  ipcMain.handle(
    'annotations:deletePerCase',
    async (_event, caseId: unknown, variantId: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validated = CaseVariantIdSchema.safeParse({ caseId, variantId })
        if (!validated.success) {
          mainLogger.error(
            `Invalid annotations:deletePerCase params: ${validated.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case/variant ID')
        }

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          await session.getWriteExecutor().execute({
            type: 'annotations:deletePerCase',
            params: [validated.data.caseId, validated.data.variantId]
          })
          return undefined
        }
        deletePerCaseAnnotation(validated.data.caseId, validated.data.variantId, getDb)
        return undefined
      })
    }
  )

  /**
   * Get all annotations for a variant (global + per-case)
   */
  ipcMain.handle(
    'annotations:getForVariant',
    async (_event, caseId: unknown, chr: unknown, pos: unknown, ref: unknown, alt: unknown) => {
      return wrapHandler(async () => {
        // ANTI-07: Runtime validation at IPC boundary
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          mainLogger.error(
            `Invalid annotations:getForVariant caseId: ${validatedCaseId.error.message}`,
            'annotations'
          )
          throw new Error('Invalid case ID')
        }

        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedCoords.success) {
          mainLogger.error(
            `Invalid annotations:getForVariant coords: ${validatedCoords.error.message}`,
            'annotations'
          )
          throw new Error('Invalid variant coordinates')
        }

        const session = getDbManager().getCurrentSession()
        if (session.capabilities.backend === 'postgres') {
          return await session.getReadExecutor().execute({
            type: 'annotations:getForVariant',
            params: [validatedCaseId.data, validatedCoords.data]
          })
        }
        return getAnnotationsForVariant(
          validatedCaseId.data,
          validatedCoords.data,
          getDb,
          getDbPool
        )
      })
    }
  )

  // Zod schema for batch annotation variant keys (hoisted to avoid re-creation per call)
  const VariantKeysSchema = z.array(
    z.object({
      chr: z.string().min(1),
      pos: z.number().int().positive(),
      ref: z.string().min(1),
      alt: z.string().min(1)
    })
  )

  // Batch read -- single round-trip for N variants (pool-dispatched)
  ipcMain.handle('annotations:batchGet', async (_event, caseId: unknown, variantKeys: unknown) => {
    return wrapHandler(async () => {
      const validatedCaseId = z.number().int().positive().nullable().safeParse(caseId)
      if (!validatedCaseId.success) {
        throw new Error('Invalid caseId parameter')
      }

      const validatedKeys = VariantKeysSchema.safeParse(variantKeys)
      if (!validatedKeys.success) {
        throw new Error('Invalid variantKeys parameter')
      }

      const session = getDbManager().getCurrentSession()
      if (session.capabilities.backend === 'postgres') {
        return await session.getReadExecutor().execute({
          type: 'annotations:batchGet',
          params: [validatedCaseId.data, validatedKeys.data]
        })
      }
      return batchGetAnnotations(validatedCaseId.data, validatedKeys.data, getDb, getDbPool)
    })
  })
}
