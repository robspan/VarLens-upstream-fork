import { z } from 'zod'

export const RegionFileImportBedArgsSchema = z.tuple([z.number(), z.string()]).rest(z.unknown())

export const RegionFileInvokeBodySchemas = {
  importBed: z.object({
    args: RegionFileImportBedArgsSchema
  })
} as const

export const RegionFileUnknownResponseSchema = z.unknown()
