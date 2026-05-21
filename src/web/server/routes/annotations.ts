import type { AuditAppendParams } from '../../../main/storage/audit-log-types'
import type { StorageSession } from '../../../main/storage/session'
import type { OverrideHandler } from './types'

function globalAuditEntries(
  coords: { chr: string; pos: number; ref: string; alt: string },
  updates: Record<string, unknown>,
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
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
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
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
    })
  }
  if (updates.starred !== undefined) {
    entries.push({
      action_type: updates.starred === true ? 'star' : 'unstar',
      entity_type: 'variant_annotation',
      entity_key: entityKey,
      old_value: oldAnnotation === null ? null : JSON.stringify({ starred: oldAnnotation.starred }),
      new_value: JSON.stringify({ starred: updates.starred === true ? 1 : 0 }),
      user_name: typeof updates.user_name === 'string' ? updates.user_name : null
    })
  }
  return entries
}

function perCaseAuditEntries(
  caseId: number,
  variantId: number,
  updates: Record<string, unknown>,
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

async function appendAuditEntries(
  session: StorageSession,
  entries: AuditAppendParams[]
): Promise<void> {
  for (const entry of entries) {
    await session.getWriteExecutor().execute({ type: 'audit:append', params: [entry] })
  }
}

export function buildAnnotationOverrides(): Record<string, OverrideHandler> {
  return {
    'annotations:getGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        if (
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-coordinates' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [{ chr, pos, ref, alt }]
        })
      }
    },

    'annotations:upsertGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt, updates] = args
        if (
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string' ||
          updates === null ||
          typeof updates !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-upsert' }
        }
        const coords = { chr, pos, ref, alt }
        const oldAnnotation = (await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [coords]
        })) as Record<string, unknown> | null
        const result = await session.getWriteExecutor().execute({
          type: 'annotations:upsertGlobal',
          params: [coords, updates as never]
        })
        await appendAuditEntries(
          session,
          globalAuditEntries(coords, updates as Record<string, unknown>, oldAnnotation)
        )
        return result
      }
    },

    'annotations:upsertPerCase': {
      async handle(args, _request, reply, { session }) {
        const [caseId, variantId, updates] = args
        if (
          typeof caseId !== 'number' ||
          typeof variantId !== 'number' ||
          updates === null ||
          typeof updates !== 'object'
        ) {
          reply.code(400)
          return { error: 'invalid-per-case-annotation-upsert' }
        }
        const oldAnnotation = (await session.getReadExecutor().execute({
          type: 'annotations:getPerCase',
          params: [caseId, variantId]
        })) as Record<string, unknown> | null
        const result = await session.getWriteExecutor().execute({
          type: 'annotations:upsertPerCase',
          params: [caseId, variantId, updates as never]
        })
        await appendAuditEntries(
          session,
          perCaseAuditEntries(caseId, variantId, updates as Record<string, unknown>, oldAnnotation)
        )
        return result
      }
    },

    'annotations:getForVariant': {
      async handle(args, _request, reply, { session }) {
        const [caseId, chr, pos, ref, alt] = args
        if (
          typeof caseId !== 'number' ||
          typeof chr !== 'string' ||
          typeof pos !== 'number' ||
          typeof ref !== 'string' ||
          typeof alt !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-annotation-query' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getForVariant',
          params: [caseId, { chr, pos, ref, alt }]
        })
      }
    }
  }
}
