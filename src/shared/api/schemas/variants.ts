import { z } from 'zod'

import {
  CaseIdSchema,
  LimitSchema,
  OffsetSchema,
  SortItemSchema,
  VariantFilterPartialSchema
} from '../../types/ipc-schemas'

export { CaseIdSchema, LimitSchema, OffsetSchema, SortItemSchema, VariantFilterPartialSchema }

export const VariantSortBySchema = z.array(SortItemSchema)

export const VariantSearchArgsSchema = z.tuple([z.number(), z.string(), z.number().optional()])

export const VariantColumnMetaPayloadSchema = z.union([
  z.object({
    caseId: z.number(),
    columnKey: z.string()
  }),
  z.object({
    caseId: z.unknown().optional(),
    caseIds: z.array(z.number()),
    columnKey: z.string()
  })
])

const VariantFilterOpenApiSchema = z.record(z.string(), z.unknown())

export const VariantInvokeBodySchemas = {
  search: z.object({
    args: z.tuple([z.number(), z.string(), z.number().optional()])
  }),
  columnMeta: z.object({
    args: z.tuple([VariantColumnMetaPayloadSchema])
  }),
  query: z.object({
    args: z.tuple([
      CaseIdSchema,
      VariantFilterOpenApiSchema,
      OffsetSchema.nullish().optional(),
      LimitSchema.nullish().optional(),
      z.array(SortItemSchema).nullish().optional(),
      z.boolean().optional(),
      z.boolean().optional()
    ])
  }),
  getFilterOptions: z.object({
    args: z.tuple([CaseIdSchema])
  })
} as const

export const VariantUnknownResponseSchema = z.unknown()

export type VariantSearchArgs = z.infer<typeof VariantSearchArgsSchema>
export type VariantColumnMetaPayload = z.infer<typeof VariantColumnMetaPayloadSchema>
