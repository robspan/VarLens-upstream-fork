import { PanelIdSchema, PanelUpdateSchema } from '../../../shared/types/ipc-schemas'
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
        const panel = await session
          .getReadExecutor()
          .execute({ type: 'panels:get', params: [validated.data] })
        const genes = await session
          .getReadExecutor()
          .execute({ type: 'panels:getGenes', params: [validated.data] })
        return panel === null ? null : { ...(panel as object), genes }
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
