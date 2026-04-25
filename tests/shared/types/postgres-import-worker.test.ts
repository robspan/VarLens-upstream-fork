import { describe, expectTypeOf, it } from 'vitest'
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
