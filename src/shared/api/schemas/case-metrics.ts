import { z } from 'zod'
import { CaseIdSchema } from '../../types/ipc-schemas'

export const CaseMetricIdSchema = z.number().int().positive()
export const CaseMetricCaseIdSchema = CaseIdSchema
export const MetricValueTypeSchema = z.enum(['numeric', 'text', 'date'])

export const MetricDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(200),
  valueType: MetricValueTypeSchema,
  unit: z.string(),
  category: z.string().min(1)
})

export const MetricValueSchema = z.object({
  numeric_value: z.number().nullish(),
  text_value: z.string().nullish(),
  date_value: z.string().nullish()
})

export const MetricUpsertSchema = z.object({
  caseId: CaseMetricCaseIdSchema,
  metricId: CaseMetricIdSchema,
  value: MetricValueSchema
})

export const MetricDeleteSchema = z.object({
  caseId: CaseMetricCaseIdSchema,
  metricId: CaseMetricIdSchema
})

export const MetricDefinitionSchema = z.object({
  id: CaseMetricIdSchema,
  name: z.string(),
  value_type: MetricValueTypeSchema,
  unit: z.string(),
  category: z.string(),
  is_predefined: z.number().int(),
  created_at: z.number().int().nonnegative()
})

export const CaseMetricSchema = z.object({
  id: CaseMetricIdSchema,
  case_id: CaseMetricCaseIdSchema,
  metric_id: CaseMetricIdSchema,
  numeric_value: z.number().nullable(),
  text_value: z.string().nullable(),
  date_value: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative()
})

export const CaseMetricWithDefinitionSchema = CaseMetricSchema.extend({
  name: z.string(),
  value_type: MetricValueTypeSchema,
  unit: z.string(),
  metric_category: z.string()
})

export const CaseMetricInvokeBodySchemas = {
  empty: z.object({ args: z.tuple([]).optional() }),
  createDefinition: z.object({
    args: z.tuple([
      MetricDefinitionCreateSchema.shape.name,
      MetricDefinitionCreateSchema.shape.valueType,
      MetricDefinitionCreateSchema.shape.unit,
      MetricDefinitionCreateSchema.shape.category
    ])
  }),
  listForCase: z.object({ args: z.tuple([CaseMetricCaseIdSchema]) }),
  upsert: z.object({
    args: z.tuple([
      MetricUpsertSchema.shape.caseId,
      MetricUpsertSchema.shape.metricId,
      MetricUpsertSchema.shape.value
    ])
  }),
  delete: z.object({
    args: z.tuple([MetricDeleteSchema.shape.caseId, MetricDeleteSchema.shape.metricId])
  })
} as const

export const MetricDefinitionListResponseSchema = z.array(MetricDefinitionSchema)
export const CaseMetricWithDefinitionListResponseSchema = z.array(CaseMetricWithDefinitionSchema)

export type MetricDefinitionCreate = z.infer<typeof MetricDefinitionCreateSchema>
export type MetricValue = z.infer<typeof MetricValueSchema>
export type MetricUpsert = z.infer<typeof MetricUpsertSchema>
