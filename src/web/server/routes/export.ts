import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  exportPostgresCohort,
  exportPostgresVariants
} from '../../../main/ipc/handlers/export-logic'
import {
  CohortSearchParamsSchema,
  VariantExportParamsSchema
} from '../../../shared/api/schemas/export'
import { webParityFixturesEnabled } from '../api-fixture-responses'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildExportOverrides(): Record<string, OverrideHandler> {
  return {
    'export:variants': {
      async handle(args, _request, reply, { session }) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'export.variants')
        const [caseId, filters, caseName] = args
        const validated = VariantExportParamsSchema.safeParse({ caseId, filters, caseName })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-export-variants-params' }
        }

        const rows = (await session.getReadExecutor().execute({
          type: 'export:variants',
          params: [{ ...validated.data.filters, case_id: validated.data.caseId }]
        })) as AsyncIterable<Record<string, unknown>>
        const filePath = join(
          tmpdir(),
          `${validated.data.caseName.replace(/[^a-z0-9]/gi, '_')}_web_${randomUUID()}.csv`
        )
        return await exportPostgresVariants(rows, filePath, {})
      }
    },

    'export:cohort': {
      async handle(args, _request, reply, { session }) {
        if (!webParityFixturesEnabled()) return unsupportedWebCapability(reply, 'export.cohort')
        const [params] = args
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-export-cohort-params' }
        }

        const rows = (await session.getReadExecutor().execute({
          type: 'export:cohort',
          params: [validated.data]
        })) as AsyncIterable<Record<string, unknown>>
        const filePath = join(tmpdir(), `cohort_variants_web_${randomUUID()}.csv`)
        return await exportPostgresCohort(rows, filePath, {})
      }
    }
  }
}
