import { z } from 'zod'

export const VepFetchArgsSchema = z
  .tuple([z.string(), z.number(), z.string(), z.string()])
  .rest(z.unknown())

export const VepInvokeBodySchemas = {
  empty: z.object({
    args: z.tuple([])
  }),
  fetch: z.object({
    args: VepFetchArgsSchema
  })
} as const

export const VepUnknownResponseSchema = z.unknown()
