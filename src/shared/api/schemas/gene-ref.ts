import { z } from 'zod'

export const GeneRefInvokeBodySchemas = {
  empty: z.object({
    args: z.tuple([])
  })
} as const

export const GeneRefUnknownResponseSchema = z.unknown()
