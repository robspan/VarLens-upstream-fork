import { z } from 'zod'

export const ProteinGeneArgsSchema = z.tuple([z.string()]).rest(z.unknown())
export const ProteinAccessionArgsSchema = z.tuple([z.string()]).rest(z.unknown())

export const ProteinInvokeBodySchemas = {
  gene: z.object({
    args: ProteinGeneArgsSchema
  }),
  accession: z.object({
    args: ProteinAccessionArgsSchema
  })
} as const

export const ProteinUnknownResponseSchema = z.unknown()
