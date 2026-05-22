import { z } from 'zod'

import {
  CaseIdSchema,
  CohortSearchParamsSchema,
  VariantFilterPartialSchema
} from '../../types/ipc-schemas'

export { CaseIdSchema, CohortSearchParamsSchema, VariantFilterPartialSchema }

export const VariantExportParamsSchema = z.object({
  caseId: CaseIdSchema,
  filters: VariantFilterPartialSchema,
  caseName: z.string().min(1).max(500)
})

const ExportVariantFilterOpenApiSchema = z.record(z.string(), z.unknown())
const ExportCohortSearchOpenApiSchema = z.record(z.string(), z.unknown())

export const ExportInvokeBodySchemas = {
  variants: z.object({
    args: z.tuple([CaseIdSchema, ExportVariantFilterOpenApiSchema, z.string().min(1).max(500)])
  }),
  cohort: z.object({
    args: z.tuple([ExportCohortSearchOpenApiSchema])
  })
} as const

export const ExportUnknownResponseSchema = z.unknown()

export type VariantExportParams = z.infer<typeof VariantExportParamsSchema>
