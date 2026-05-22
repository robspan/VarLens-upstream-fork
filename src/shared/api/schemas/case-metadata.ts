import { z } from 'zod'

export const CaseMetadataCohortCreateArgsSchema = z
  .tuple([z.string(), z.unknown().optional()])
  .rest(z.unknown())

export const CaseMetadataInvokeBodySchemas = {
  createCohort: z.object({
    args: CaseMetadataCohortCreateArgsSchema
  })
} as const

export const CaseMetadataUnknownResponseSchema = z.unknown()
