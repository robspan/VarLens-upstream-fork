import { z } from 'zod'

export const CaseCommentIdSchema = z.number().int().positive()
export const CaseCommentCaseIdSchema = z.number().int().positive()

export const CommentCategorySchema = z.enum([
  'Clinical Note',
  'Lab Result',
  'Interpretation',
  'Follow-up',
  'Family History',
  'Treatment'
])

export const CommentCreateSchema = z.object({
  caseId: CaseCommentCaseIdSchema,
  category: CommentCategorySchema,
  content: z.string().min(1)
})

export const CommentUpdateSchema = z.object({
  commentId: CaseCommentIdSchema,
  content: z.string().min(1)
})

export const CaseCommentSchema = z.object({
  id: CaseCommentIdSchema,
  case_id: CaseCommentCaseIdSchema,
  category: CommentCategorySchema,
  content: z.string(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative().nullable()
})

export const CaseCommentInvokeBodySchemas = {
  list: z.object({ args: z.tuple([CaseCommentCaseIdSchema]) }),
  create: z.object({
    args: z.tuple([
      CommentCreateSchema.shape.caseId,
      CommentCreateSchema.shape.category,
      CommentCreateSchema.shape.content
    ])
  }),
  update: z.object({
    args: z.tuple([CommentUpdateSchema.shape.commentId, CommentUpdateSchema.shape.content])
  }),
  delete: z.object({ args: z.tuple([CaseCommentIdSchema]) })
} as const

export const CaseCommentListResponseSchema = z.array(CaseCommentSchema)

export type CommentCategory = z.infer<typeof CommentCategorySchema>
export type CommentCreate = z.infer<typeof CommentCreateSchema>
export type CommentUpdate = z.infer<typeof CommentUpdateSchema>
