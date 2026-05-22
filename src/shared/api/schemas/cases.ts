import { z } from 'zod'

export const CaseInvokeBodySchemas = {
  list: z.object({
    args: z.tuple([])
  })
} as const

export const CaseUnknownResponseSchema = z.unknown()
