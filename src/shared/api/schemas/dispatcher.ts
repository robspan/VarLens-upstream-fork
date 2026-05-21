import { z } from 'zod'

export const DispatcherParamsSchema = z.object({
  domain: z.string().min(1),
  method: z.string().min(1)
})

export const DispatcherInvokeBodySchema = z.object({
  args: z.array(z.unknown()).optional()
})

export const DispatcherErrorResponseSchema = z
  .object({
    error: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    userMessage: z.string().optional()
  })
  .passthrough()
