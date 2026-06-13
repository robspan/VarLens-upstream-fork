import { PanelIdSchema, PanelUpdateSchema } from '../../../shared/types/ipc-schemas'
import { getPanelWithGenes } from '../../../main/ipc/handlers/panels-logic'
import type { OverrideHandler } from './types'

export function buildPanelOverrides(): Record<string, OverrideHandler> {
  return {
    'panels:get': {
      async handle(args, _request, reply, { session }) {
        const [id] = args
        const validated = PanelIdSchema.safeParse(id)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-panel-id' }
        }
        return await getPanelWithGenes(validated.data, () => session)
      }
    },

    'panels:update': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        const validated = PanelUpdateSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-panel-update' }
        }
        return await session.getWriteExecutor().execute({
          type: 'panels:update',
          params: [
            validated.data.id,
            {
              name: validated.data.name,
              description: validated.data.description,
              version: validated.data.version
            }
          ]
        })
      }
    }
  }
}
