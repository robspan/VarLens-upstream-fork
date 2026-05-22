import { z } from 'zod'

export const TagIdSchema = z.number().int().positive()

export const TagCreateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().min(4).max(9)
})

export const TagUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().min(4).max(9).optional()
})

export const TagCaseVariantIdSchema = z.object({
  caseId: z.number().int().positive(),
  variantId: z.number().int().positive()
})

export const VariantTagAssignSchema = TagCaseVariantIdSchema.extend({
  tagId: z.number().int().positive()
})

export const VariantTagSetSchema = TagCaseVariantIdSchema.extend({
  tagIds: z.array(TagIdSchema)
})

export const TagSchema = TagCreateSchema.extend({
  id: TagIdSchema,
  created_at: z.number().int().nonnegative()
})

export const TagsInvokeBodySchemas = {
  empty: z.object({ args: z.tuple([]).optional() }),
  tagId: z.object({ args: z.tuple([TagIdSchema]) }),
  create: z.object({ args: z.tuple([TagCreateSchema.shape.name, TagCreateSchema.shape.color]) }),
  update: z.object({ args: z.tuple([TagIdSchema, TagUpdateSchema]) }),
  caseVariant: z.object({
    args: z.tuple([TagCaseVariantIdSchema.shape.caseId, TagCaseVariantIdSchema.shape.variantId])
  }),
  assign: z.object({
    args: z.tuple([
      VariantTagAssignSchema.shape.caseId,
      VariantTagAssignSchema.shape.variantId,
      VariantTagAssignSchema.shape.tagId
    ])
  }),
  set: z.object({
    args: z.tuple([
      VariantTagSetSchema.shape.caseId,
      VariantTagSetSchema.shape.variantId,
      VariantTagSetSchema.shape.tagIds
    ])
  })
} as const

export const TagsListResponseSchema = z.array(TagSchema)
export const TagsUsageCountResponseSchema = z.number().int().nonnegative()

export type TagCreate = z.infer<typeof TagCreateSchema>
export type TagUpdate = z.infer<typeof TagUpdateSchema>
export type VariantTagAssign = z.infer<typeof VariantTagAssignSchema>
export type VariantTagSet = z.infer<typeof VariantTagSetSchema>
