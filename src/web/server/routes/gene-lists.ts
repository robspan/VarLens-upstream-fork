import { GeneListSetGenesArgsSchema } from '../../../shared/api/schemas/gene-lists'
import type { OverrideHandler } from './types'

export function buildGeneListOverrides(): Record<string, OverrideHandler> {
  return {
    'gene-lists:setGenes': {
      async handle(args, _request, reply, { session }) {
        const parsed = GeneListSetGenesArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-gene-list-genes' }
        }
        const [listId, genes] = parsed.data
        await session.getWriteExecutor().execute({
          type: 'gene-lists:setGenes',
          params: [listId, genes]
        })
        return await session.getReadExecutor().execute({
          type: 'gene-lists:getGenes',
          params: [listId]
        })
      }
    }
  }
}
