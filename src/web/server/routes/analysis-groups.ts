import {
  AnalysisGroupCreateArgsSchema,
  AnalysisGroupMemberAddArgsSchema
} from '../../../shared/api/schemas/analysis-groups'
import type { OverrideHandler } from './types'

export function buildAnalysisGroupOverrides(): Record<string, OverrideHandler> {
  return {
    'analysis-groups:create': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        if (params === null || typeof params !== 'object') {
          reply.code(400)
          return { error: 'invalid-analysis-group' }
        }
        const parsed = AnalysisGroupCreateArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-analysis-group-name' }
        }
        const [raw] = parsed.data
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:create',
          params: [raw.name, raw.groupType ?? 'family', raw.description ?? undefined]
        })
      }
    },

    'analysis-groups:addMember': {
      async handle(args, _request, reply, { session }) {
        const parsed = AnalysisGroupMemberAddArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-analysis-group-member' }
        }
        const [raw] = parsed.data
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:addMember',
          params: [
            raw.groupId,
            raw.caseId,
            raw.role as never,
            (raw.affectedStatus ?? 'unknown') as never,
            raw.individualId ?? undefined
          ]
        })
      }
    }
  }
}
