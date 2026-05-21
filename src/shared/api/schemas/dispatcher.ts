import { z } from 'zod'

export const DispatcherParamsSchema = z.object({
  domain: z.string().min(1),
  method: z.string().min(1)
})

export const DispatcherInvokeBodySchema = z
  .object({
    args: z.array(z.unknown()).optional()
  })
  .nullable()
  .optional()

export const DispatcherErrorResponseSchema = z.object({
  code: z.string(),
  message: z.string(),
  userMessage: z.string(),
  details: z.record(z.string(), z.unknown()).optional()
})
