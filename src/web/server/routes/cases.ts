import type { StorageWriteTask } from '../../../main/storage/write-executor'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { WEB_EVENT_COHORT_SUMMARY_REBUILT } from '../web-event-types'
import type { OverrideHandler } from './types'

export function buildCasesOverrides(): Record<string, OverrideHandler> {
  return {
    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
      }
    },

    'cases:delete': {
      async handle(args, request, reply, { session, events }) {
        const [caseId] = args
        const validated = CaseIdSchema.safeParse(caseId)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case id' }
        }

        const result = await session
          .getWriteExecutor()
          .execute({ type: 'cases:delete', params: [validated.data] } as StorageWriteTask)
        const userId = request.session?.user?.id
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
        }
        return result
      }
    }
  }
}
