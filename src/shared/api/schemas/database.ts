import { z } from 'zod'

export const DatabaseInvokeBodySchemas = {
  empty: z.object({
    args: z.tuple([])
  })
} as const

export const DatabaseInfoSchema = z.object({
  path: z.string(),
  name: z.string(),
  encrypted: z.boolean()
})

export const DatabaseRecentListSchema = z.array(z.unknown())

export const DatabaseUnknownResponseSchema = z.unknown()
