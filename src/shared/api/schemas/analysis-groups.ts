import { z } from 'zod'

export const AnalysisGroupCreateArgsSchema = z
  .tuple([
    z.object({
      name: z.string().min(1).max(200),
      groupType: z.enum(['family', 'tumor_normal']).optional(),
      description: z.string().max(1000).nullable().optional()
    })
  ])
  .rest(z.unknown())

export const AnalysisGroupMemberAddArgsSchema = z
  .tuple([
    z.object({
      groupId: z.number().int().positive(),
      caseId: z.number().int().positive(),
      role: z.enum([
        'proband',
        'father',
        'mother',
        'sibling',
        'partner',
        'other',
        'tumor',
        'normal'
      ]),
      affectedStatus: z.enum(['affected', 'unaffected', 'unknown']).optional(),
      individualId: z.string().nullable().optional()
    })
  ])
  .rest(z.unknown())

export const AnalysisGroupInvokeBodySchemas = {
  create: z.object({
    args: AnalysisGroupCreateArgsSchema
  }),
  addMember: z.object({
    args: AnalysisGroupMemberAddArgsSchema
  })
} as const

export const AnalysisGroupUnknownResponseSchema = z.unknown()
