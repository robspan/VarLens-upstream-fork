import {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  VariantCoordsSchema
} from '../../../shared/api/schemas/annotations'
import type { OverrideHandler } from './types'

export function buildAnnotationOverrides(): Record<string, OverrideHandler> {
  return {
    'annotations:getGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-annotation-coordinates' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [validated.data]
        })
      }
    },

    'annotations:upsertGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt, updates] = args
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        const validatedUpdates = GlobalAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedCoords.success || !validatedUpdates.success) {
          reply.code(400)
          return { error: 'invalid-annotation-upsert' }
        }
        const coords = validatedCoords.data
        const annotationUpdates = validatedUpdates.data
        return await session.getWriteExecutor().execute({
          type: 'annotations:upsertGlobalWithAudit',
          params: [coords, annotationUpdates]
        })
      }
    },

    'annotations:upsertPerCase': {
      async handle(args, _request, reply, { session }) {
        const [caseId, variantId, updates] = args
        const validatedIds = CaseVariantIdSchema.safeParse({ caseId, variantId })
        const validatedUpdates = PerCaseAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedIds.success || !validatedUpdates.success) {
          reply.code(400)
          return { error: 'invalid-per-case-annotation-upsert' }
        }
        const annotationUpdates = validatedUpdates.data
        return await session.getWriteExecutor().execute({
          type: 'annotations:upsertPerCaseWithAudit',
          params: [validatedIds.data.caseId, validatedIds.data.variantId, annotationUpdates]
        })
      }
    },

    'annotations:getForVariant': {
      async handle(args, _request, reply, { session }) {
        const [caseId, chr, pos, ref, alt] = args
        const validatedIds = CaseVariantIdSchema.shape.caseId.safeParse(caseId)
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedIds.success || !validatedCoords.success) {
          reply.code(400)
          return { error: 'invalid-annotation-query' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getForVariant',
          params: [validatedIds.data, validatedCoords.data]
        })
      }
    }
  }
}
