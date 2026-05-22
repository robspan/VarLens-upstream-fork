import { CaseMetadataCohortCreateArgsSchema } from '../../../shared/api/schemas/case-metadata'
import type { OverrideHandler } from './types'

export function buildCaseMetadataOverrides(): Record<string, OverrideHandler> {
  return {
    'case-metadata:createCohort': {
      async handle(args, _request, reply, { session }) {
        const parsed = CaseMetadataCohortCreateArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-cohort-name' }
        }
        const [name, description] = parsed.data
        return await session.getWriteExecutor().execute({
          type: 'case-metadata:createCohort',
          params: [{ name, description: typeof description === 'string' ? description : null }]
        })
      }
    }
  }
}
