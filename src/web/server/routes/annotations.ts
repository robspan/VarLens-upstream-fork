import {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  VariantCoordsSchema
} from '../../../shared/api/schemas/annotations'
import type { AnnotationChangeEvent } from '../../../shared/types/api'
import { WEB_EVENT_VARIANTS_ANNOTATION_CHANGED } from '../web-event-types'
import type { OverrideHandler } from './types'

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
      async handle(args, request, reply, { session, events }) {
        const [caseId, variantId, updates] = args
        const validatedIds = CaseVariantIdSchema.safeParse({ caseId, variantId })
        const validatedUpdates = PerCaseAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedIds.success || !validatedUpdates.success) {
          reply.code(400)
          return { error: 'invalid-per-case-annotation-upsert' }
        }
        const annotationUpdates = validatedUpdates.data
        const result = await session.getWriteExecutor().execute({
          type: 'annotations:upsertPerCaseWithAudit',
          params: [validatedIds.data.caseId, validatedIds.data.variantId, annotationUpdates]
        })
        const userId = request.session?.user?.id
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_VARIANTS_ANNOTATION_CHANGED, {
            caseId: validatedIds.data.caseId,
            variantId: validatedIds.data.variantId,
            kind: detectAnnotationChangeKind(annotationUpdates)
          } satisfies AnnotationChangeEvent)
        }
        return result
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
