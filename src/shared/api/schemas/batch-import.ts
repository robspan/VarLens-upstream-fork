import { z } from 'zod'

export const BatchImportInvokeBodySchemas = {
  extractZip: z.object({
    args: z.tuple([z.string().min(1), z.string().optional()])
  }),
  testZipPassword: z.object({
    args: z.tuple([z.string().min(1), z.string()])
  }),
  cleanupZipTemp: z.object({
    args: z.tuple([])
  })
} as const

export const BatchImportUnknownResponseSchema = z.unknown()
