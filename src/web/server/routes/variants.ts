import { z } from 'zod'

import type { SortItem, VariantFilter } from '../../../shared/types/database'
import {
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../../shared/types/ipc-schemas'
import type { OverrideHandler } from './types'

export function buildVariantOverrides(): Record<string, OverrideHandler> {
  return {
    'variants:search': {
      async handle(args, _request, reply, { session }) {
        const [caseId, query, limit] = args
        if (typeof caseId !== 'number' || typeof query !== 'string') {
          reply.code(400)
          return { error: 'invalid-variant-search' }
        }
        return await session.getReadExecutor().execute({
          type: 'variants:query',
          params: [
            { case_id: caseId, gene_symbol: query },
            typeof limit === 'number' ? limit : 20,
            0,
            undefined,
            true,
            false
          ]
        })
      }
    },

    'variants:columnMeta': {
      async handle(args, _request, reply, { session }) {
        const [payload] = args
        if (payload === null || typeof payload !== 'object') {
          reply.code(400)
          return { error: 'invalid-column-meta-payload' }
        }
        const value = payload as { caseId?: unknown; caseIds?: unknown; columnKey?: unknown }
        if (
          typeof value.columnKey !== 'string' ||
          (typeof value.caseId !== 'number' &&
            (!Array.isArray(value.caseIds) ||
              !value.caseIds.every((caseId) => typeof caseId === 'number')))
        ) {
          reply.code(400)
          return { error: 'invalid-column-meta-payload' }
        }
        const scope =
          typeof value.caseId === 'number'
            ? { caseId: value.caseId }
            : { caseIds: value.caseIds as number[] }
        return await session.getReadExecutor().execute({
          type: 'variants:columnMeta',
          params: [scope, value.columnKey]
        })
      }
    },

    'variants:query': {
      async handle(args, _request, reply, { session }) {
        const [caseId, filters, offset, limit, sortBy, skipCount, includeUnfilteredCount] = args

        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        const validatedFilters = VariantFilterPartialSchema.safeParse(filters)
        if (!validatedFilters.success) {
          reply.code(400)
          return { error: 'invalid-filters', message: 'Invalid filter parameters' }
        }

        const offsetResult =
          offset === undefined || offset === null ? { data: 0 } : OffsetSchema.safeParse(offset)
        if ('success' in offsetResult && !offsetResult.success) {
          reply.code(400)
          return { error: 'invalid-offset', message: 'Invalid offset parameter' }
        }

        const limitResult =
          limit === undefined || limit === null ? { data: 50 } : LimitSchema.safeParse(limit)
        if ('success' in limitResult && !limitResult.success) {
          reply.code(400)
          return { error: 'invalid-limit', message: 'Invalid limit parameter' }
        }

        let validatedSortBy: SortItem[] | undefined
        if (sortBy !== undefined && sortBy !== null) {
          const sortByResult = z.array(SortItemSchema).safeParse(sortBy)
          if (!sortByResult.success) {
            reply.code(400)
            return { error: 'invalid-sort', message: 'Invalid sort parameters' }
          }
          validatedSortBy = sortByResult.data
        }

        const fullFilter: VariantFilter = {
          case_id: validatedCaseId.data,
          ...validatedFilters.data
        }

        return await session.getReadExecutor().execute({
          type: 'variants:query',
          params: [
            fullFilter,
            limitResult.data,
            offsetResult.data,
            validatedSortBy,
            skipCount === true,
            includeUnfilteredCount === true
          ]
        })
      }
    },

    'variants:getFilterOptions': {
      async handle(args, _request, reply, { session }) {
        const [caseId] = args
        const validatedCaseId = CaseIdSchema.safeParse(caseId)
        if (!validatedCaseId.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case ID' }
        }

        return await session.getReadExecutor().execute({
          type: 'variants:filterOptions',
          params: [validatedCaseId.data]
        })
      }
    }
  }
}
