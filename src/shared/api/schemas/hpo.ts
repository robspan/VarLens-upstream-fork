import { z } from 'zod'

export const HpoSearchArgsSchema = z.tuple([z.string(), z.unknown().optional()]).rest(z.unknown())

export const HpoInvokeBodySchemas = {
  empty: z.object({
    args: z.tuple([])
  }),
  search: z.object({
    args: HpoSearchArgsSchema
  })
} as const

export const HpoUnknownResponseSchema = z.unknown()
