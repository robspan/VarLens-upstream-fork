import { z } from 'zod'

// A Postgres schema name is quoted as an identifier before use (see quoteIdentifier),
// which doubles `"` but does NOT neutralise a `'`. Some DDL paths embed the quoted
// identifier inside a single-quoted SQL string literal (e.g. to_regclass('"schema"."tbl"')
// in the audit/migration scripts), where an embedded quote or backslash would break out.
// Reject those break-out characters (and any control character) at the validation seam,
// while still allowing legitimate mixed-case / hyphenated quoted identifiers (e.g. "Workspace-A").
function schemaNameHasNoBreakoutChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (char === "'" || char === '"' || char === '\\' || code < 0x20) {
      return false
    }
  }
  return true
}

const schemaNameSchema = z.string().trim().min(1).refine(schemaNameHasNoBreakoutChars, {
  message: 'Schema name must not contain quotes, backslashes, or control characters'
})

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
  schema: schemaNameSchema,
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
