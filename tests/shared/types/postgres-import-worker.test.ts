import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  PostgresClientConfig,
  PostgresImportWorkerStartMessage,
  PostgresImportWorkerCancelMessage,
  PostgresImportWorkerProgressMessage,
  PostgresImportWorkerFileCompleteMessage,
  PostgresImportWorkerCompleteMessage,
  PostgresImportWorkerErrorMessage,
  PostgresImportWorkerInboundMessage,
  PostgresImportWorkerOutboundMessage
} from '../../../src/shared/types/postgres-import-worker'
import { toPostgresClientConfigMessage } from '../../../src/shared/types/postgres-import-worker'

describe('postgres-import-worker types', () => {
  it('PostgresClientConfig contains the connection-relevant pg fields', () => {
    expectTypeOf<PostgresClientConfig>().toMatchTypeOf<{
      connectionString: string
      application_name?: string
      connectionTimeoutMillis?: number
      statement_timeout?: number
      query_timeout?: number
      lock_timeout?: number
      idle_in_transaction_session_timeout?: number
      keepAlive?: boolean
    }>()
  })

  it('inbound and outbound message unions are exhaustive', () => {
    expectTypeOf<PostgresImportWorkerInboundMessage>().toEqualTypeOf<
      PostgresImportWorkerStartMessage | PostgresImportWorkerCancelMessage
    >()
    expectTypeOf<PostgresImportWorkerOutboundMessage>().toEqualTypeOf<
      | PostgresImportWorkerProgressMessage
      | PostgresImportWorkerFileCompleteMessage
      | PostgresImportWorkerCompleteMessage
      | PostgresImportWorkerErrorMessage
    >()
  })
})

describe('toPostgresClientConfigMessage', () => {
  it('maps undefined ssl to disable mode', () => {
    const result = toPostgresClientConfigMessage({ connectionString: 'postgres://x' })
    expect(result.ssl).toEqual({ mode: 'disable' })
  })

  it('maps boolean false ssl to disable mode', () => {
    const result = toPostgresClientConfigMessage({ connectionString: 'postgres://x', ssl: false })
    expect(result.ssl).toEqual({ mode: 'disable' })
  })

  it('maps boolean true ssl to require with rejectUnauthorized: true (pg shorthand)', () => {
    const result = toPostgresClientConfigMessage({ connectionString: 'postgres://x', ssl: true })
    expect(result.ssl).toEqual({ mode: 'require', rejectUnauthorized: true })
  })

  it('maps object ssl with rejectUnauthorized: true to require mode', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      ssl: { rejectUnauthorized: true }
    })
    expect(result.ssl).toEqual({ mode: 'require', rejectUnauthorized: true })
  })

  it('maps object ssl with rejectUnauthorized: false to require mode preserving the false', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      ssl: { rejectUnauthorized: false }
    })
    expect(result.ssl).toEqual({ mode: 'require', rejectUnauthorized: false })
  })

  it('maps unknown ssl object (e.g. cert payload) to disable mode conservatively', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      ssl: { ca: 'cert-material' } as never
    })
    expect(result.ssl).toEqual({ mode: 'disable' })
  })

  it('omits statement_timeout when pg passes false (boolean shorthand for "no timeout")', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      statement_timeout: false as never
    })
    expect(result.statement_timeout).toBeUndefined()
  })

  it('preserves numeric statement_timeout', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      statement_timeout: 60_000
    })
    expect(result.statement_timeout).toBe(60_000)
  })

  it('plumbs application_name, connectionTimeoutMillis, lock_timeout, idle_in_transaction_session_timeout, keepAlive', () => {
    const result = toPostgresClientConfigMessage({
      connectionString: 'postgres://x',
      application_name: 'varlens-worker-test',
      connectionTimeoutMillis: 1234,
      query_timeout: 60_000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 10_000,
      keepAlive: true
    })
    expect(result.application_name).toBe('varlens-worker-test')
    expect(result.connectionTimeoutMillis).toBe(1234)
    expect(result.query_timeout).toBe(60_000)
    expect(result.lock_timeout).toBe(5000)
    expect(result.idle_in_transaction_session_timeout).toBe(10_000)
    expect(result.keepAlive).toBe(true)
  })
})
