import { z } from 'zod'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import {
  VariantCoordsSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  CaseVariantIdSchema,
  CaseIdSchema
} from '../../../shared/types/ipc-schemas'
import { mainLogger } from '../../services/MainLogger'
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
 * Annotations IPC handlers
 * Channels: annotations:getGlobal, annotations:upsertGlobal, annotations:getPerCase,
 *           annotations:upsertPerCase, annotations:deleteGlobal, annotations:deletePerCase,
 *           annotations:getForVariant
 */
export function registerAnnotationHandlers({
  ipcMain,
  getDb,
  getDbPool
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

        return upsertPerCaseAnnotation(
          validatedIds.data.caseId,
          validatedIds.data.variantId,
          validatedUpdates.data,
          getDb
        )
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

      return batchGetAnnotations(validatedCaseId.data, validatedKeys.data, getDb, getDbPool)
    })
  })
}
