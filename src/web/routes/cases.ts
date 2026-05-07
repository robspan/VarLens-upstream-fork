/**
 * Web routes for the `cases` domain.
 *
 * Wires each method of `CasesDomainContract` (src/shared/ipc/domains/
 * cases.ts) to the corresponding pure function in
 * src/main/ipc/handlers/cases-logic.ts. The handler-seam test gates
 * the import — desktop and web call the same function.
 *
 * Body shape matches the HTTP shim's `{ args: [...] }` envelope so
 * the contract surface lines up exactly with the contextBridge
 * surface the desktop preload exposes.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  deleteAllCases,
  deleteBatchCases,
  deleteSingleCase,
  getAvailableBuilds,
  listCases,
  queryCases
} from '../../main/ipc/handlers/cases-logic'
import type { StorageSession } from '../../main/storage/session'
import type { CaseSearchParams } from '../../shared/types/database'

interface ArgsBody<A extends unknown[]> {
  args?: A
}

function args<A extends unknown[]>(req: FastifyRequest): A {
  return ((req.body as ArgsBody<A>)?.args ?? []) as A
}

export function registerCasesRoutes(app: FastifyInstance, getSession: () => StorageSession): void {
  app.post('/api/cases/list', async () => listCases(getSession))

  app.post('/api/cases/query', async (req) => {
    const [params] = args<[CaseSearchParams]>(req)
    return queryCases(getSession, params)
  })

  app.post('/api/cases/delete', async (req) => {
    const [id] = args<[number]>(req)
    return deleteSingleCase(getSession, id)
  })

  app.post('/api/cases/deleteAll', async () => deleteAllCases(getSession))

  app.post('/api/cases/deleteBatch', async (req) => {
    const [ids] = args<[number[]]>(req)
    return deleteBatchCases(getSession, ids)
  })

  app.post('/api/cases/availableBuilds', async () => getAvailableBuilds(getSession))
}
