/**
 * Web routes for the `cases` domain.
 *
 * Imports the same `listCases` function the Electron IPC layer uses
 * (`src/main/ipc/handlers/cases-logic.ts`) — no parallel implementation.
 * The `handler-seam` web-gate test enforces this.
 */
import type { FastifyInstance } from 'fastify'

import { listCases } from '../../main/ipc/handlers/cases-logic'
import type { StorageSession } from '../../main/storage/session'

export function registerCasesRoutes(app: FastifyInstance, getSession: () => StorageSession): void {
  app.get('/api/cases', async () => {
    return await listCases(getSession)
  })
}
