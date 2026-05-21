import { z } from 'zod'

export const AssetCohortCreateArgsSchema = z
  .tuple([z.string(), z.unknown().optional()])
  .rest(z.unknown())

export const AssetAnalysisGroupCreateArgsSchema = z
  .tuple([
    z
      .object({
        name: z.string(),
        groupType: z.unknown().optional(),
        description: z.unknown().optional()
      })
      .passthrough()
  ])
  .rest(z.unknown())

export const AssetAnalysisGroupMemberAddArgsSchema = z
  .tuple([
    z
      .object({
        groupId: z.number(),
        caseId: z.number(),
        role: z.string(),
        affectedStatus: z.unknown().optional(),
        individualId: z.unknown().optional()
      })
      .passthrough()
  ])
  .rest(z.unknown())

export const AssetRegionFileImportBedArgsSchema = z
  .tuple([z.number(), z.string()])
  .rest(z.unknown())

export const AssetGeneListSetGenesArgsSchema = z
  .tuple([z.number(), z.array(z.string())])
  .rest(z.unknown())

export const AssetInvokeBodySchemas = {
  createCohort: z.object({
    args: AssetCohortCreateArgsSchema
  }),
  createAnalysisGroup: z.object({
    args: AssetAnalysisGroupCreateArgsSchema
  }),
  addAnalysisGroupMember: z.object({
    args: AssetAnalysisGroupMemberAddArgsSchema
  }),
  importBed: z.object({
    args: AssetRegionFileImportBedArgsSchema
  }),
  setGenes: z.object({
    args: AssetGeneListSetGenesArgsSchema
  })
} as const

export const AssetUnknownResponseSchema = z.unknown()
