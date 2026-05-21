import { z } from 'zod'

import { CohortSearchParamsSchema } from '../../../shared/types/ipc-schemas'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

const CohortCarriersParamsSchema = z.object({
  chr: z.string().min(1),
  pos: z.number().int().positive(),
  ref: z.string().min(1),
  alt: z.string().min(1)
})

export function buildCohortOverrides(): Record<string, OverrideHandler> {
  return {
    'cohort:getVariants': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-cohort-params', message: 'Invalid cohort search parameters' }
        }

        return await session.getReadExecutor().execute({
          type: 'cohort:query',
          params: [validated.data]
        })
      }
    },

    'cohort:getColumnMeta': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:columnMeta',
          params: []
        })
      }
    },

    'cohort:getSummary': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:summary',
          params: []
        })
      }
    },

    'cohort:getSummaryStatus': {
      handle() {
        return { is_stale: false, last_rebuilt_at: 0 }
      }
    },

    'cohort:rebuildSummary': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.rebuildSummary')
      }
    },

    'cohort:runAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.runAssociation')
      }
    },

    'cohort:cancelAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.cancelAssociation')
      }
    },

    'cohort:getCarriers': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = CohortCarriersParamsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-carrier-params', message: 'Invalid carrier query parameters' }
        }

        return await session.getReadExecutor().execute({
          type: 'cohort:carriers',
          params: [validated.data.chr, validated.data.pos, validated.data.ref, validated.data.alt]
        })
      }
    },

    'cohort:getGeneBurden': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'cohort:geneBurden',
          params: []
        })
      }
    }
  }
}
