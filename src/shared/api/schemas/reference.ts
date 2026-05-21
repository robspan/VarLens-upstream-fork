import { z } from 'zod'

export const HpoSearchArgsSchema = z.tuple([z.string(), z.unknown().optional()]).rest(z.unknown())
export const VepFetchArgsSchema = z
  .tuple([z.string(), z.number(), z.string(), z.string()])
  .rest(z.unknown())
export const ProteinGeneArgsSchema = z.tuple([z.string()]).rest(z.unknown())
export const ProteinAccessionArgsSchema = z.tuple([z.string()]).rest(z.unknown())

export const ReferenceInvokeBodySchemas = {
  empty: z.object({
    args: z.tuple([])
  }),
  hpoSearch: z.object({
    args: HpoSearchArgsSchema
  }),
  vepFetch: z.object({
    args: VepFetchArgsSchema
  }),
  proteinGene: z.object({
    args: ProteinGeneArgsSchema
  }),
  proteinAccession: z.object({
    args: ProteinAccessionArgsSchema
  })
} as const

export const ReferenceUnknownResponseSchema = z.unknown()
