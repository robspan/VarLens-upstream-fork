/**
 * Web routes for the `variants` domain.
 *
 * Imports `queryVariants` from src/main/ipc/handlers/variants-logic.ts —
 * same function the Electron IPC layer uses. The logic accepts either a
 * StorageSession factory or a (DatabaseService, DbPool) tuple; the web
 * side passes the StorageSession factory.
 *
 * Phase 1 ships a minimal POST /api/variants/query that accepts the
 * full filter object as JSON body. Pagination + sort are passthrough.
 */
import type { FastifyInstance } from 'fastify'

import { queryVariants } from '../../main/ipc/handlers/variants-logic'
import type { StorageSession } from '../../main/storage/session'
import type { VariantFilter, SortItem } from '../../main/database/types'

interface VariantsQueryBody {
  filter?: VariantFilter
  limit?: number
  offset?: number
  sortBy?: SortItem[]
  skipCount?: boolean
  includeUnfilteredCount?: boolean
}

export function registerVariantsRoutes(
  app: FastifyInstance,
  getSession: () => StorageSession
): void {
  app.post<{ Body: VariantsQueryBody }>('/api/variants/query', async (request, reply) => {
    const body = request.body ?? {}
    if (!body.filter) {
      reply.code(400)
      return { error: 'filter is required' }
    }

    return await queryVariants(
      body.filter,
      body.limit ?? 100,
      body.offset ?? 0,
      body.sortBy,
      body.skipCount ?? false,
      body.includeUnfilteredCount ?? false,
      getSession
    )
  })
}
