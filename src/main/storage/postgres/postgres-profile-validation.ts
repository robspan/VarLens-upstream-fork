import { z } from 'zod'

const PostgresConnectionProfileSecretInputSchema = z.object({
  password: z.string().refine((value) => value.trim().length > 0),
  caCertificatePem: z
    .string()
    .refine((value) => value.trim().length > 0)
    .optional()
})

const PostgresConnectionProfilePublicInputSchema = z.object({
  name: z.string().trim().min(1),
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1),
  username: z.string().trim().min(1),
  schema: z.string().trim().min(1),
  sslMode: z.enum(['disable', 'require-verify']),
  poolMax: z.number().int().min(1).max(32),
  connectionTimeoutMillis: z.number().int().nonnegative(),
  statementTimeoutMs: z.number().int().nonnegative(),
  lockTimeoutMs: z.number().int().nonnegative(),
  idleInTransactionSessionTimeoutMs: z.number().int().nonnegative()
})

export const PostgresConnectionProfileInputSchema =
  PostgresConnectionProfilePublicInputSchema.extend({
    secrets: PostgresConnectionProfileSecretInputSchema
  })

export const PostgresConnectionProfileSaveInputSchema =
  PostgresConnectionProfilePublicInputSchema.extend({
    id: z.string().trim().min(1).optional(),
    secrets: PostgresConnectionProfileSecretInputSchema.optional()
  }).superRefine((value, context) => {
    if (value.id === undefined && value.secrets === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['secrets'],
        message: 'Secrets are required for new PostgreSQL profiles'
      })
    }
  })
