import { describe, expect, it } from 'vitest'

import {
  PostgresConnectionProfileInputSchema,
  PostgresConnectionProfileSaveInputSchema
} from '../../../src/main/storage/postgres/postgres-profile-validation'

const validInput = {
  name: 'Lab PG',
  host: 'db.example.org',
  port: 5432,
  database: 'varlens',
  username: 'varlens_app',
  schema: 'workspace_a',
  sslMode: 'require-verify',
  poolMax: 4,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
  lockTimeoutMs: 5000,
  idleInTransactionSessionTimeoutMs: 10000,
  secrets: { password: 'secret', caCertificatePem: 'pem' }
}

describe('PostgresConnectionProfileInputSchema', () => {
  it('rejects blank passwords', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse({
      ...validInput,
      secrets: { password: '   ' }
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid ports', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse({
      ...validInput,
      port: 65536
    })

    expect(result.success).toBe(false)
  })

  it('rejects blank schemas', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse({
      ...validInput,
      schema: ''
    })

    expect(result.success).toBe(false)
  })

  it('rejects invalid SSL modes', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse({
      ...validInput,
      sslMode: 'prefer'
    })

    expect(result.success).toBe(false)
  })

  it('accepts valid profile input', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse(validInput)

    expect(result.success).toBe(true)
  })

  it('preserves password whitespace while rejecting blank passwords', () => {
    const result = PostgresConnectionProfileInputSchema.safeParse({
      ...validInput,
      secrets: { password: '  secret with spaces  ' }
    })

    expect(result.success).toBe(true)
    expect(result.data?.secrets.password).toBe('  secret with spaces  ')
  })
})

describe('PostgresConnectionProfileSaveInputSchema', () => {
  it('allows profile updates without secrets', () => {
    const result = PostgresConnectionProfileSaveInputSchema.safeParse({
      ...validInput,
      id: 'profile-1',
      secrets: undefined
    })

    expect(result.success).toBe(true)
  })

  it('still requires secrets for new profiles', () => {
    const result = PostgresConnectionProfileSaveInputSchema.safeParse({
      ...validInput,
      secrets: undefined
    })

    expect(result.success).toBe(false)
  })
})
