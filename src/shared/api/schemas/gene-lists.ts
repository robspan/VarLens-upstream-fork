import { z } from 'zod'

export const GeneListSetGenesArgsSchema = z
  .tuple([z.number(), z.array(z.string())])
  .rest(z.unknown())

export const GeneListInvokeBodySchemas = {
  setGenes: z.object({
    args: GeneListSetGenesArgsSchema
  })
} as const

export const GeneListUnknownResponseSchema = z.unknown()
