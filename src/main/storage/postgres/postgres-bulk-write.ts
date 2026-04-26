// src/main/storage/postgres/postgres-bulk-write.ts
import * as stream from 'node:stream'
import { from as copyFrom } from 'pg-copy-streams'
import type { PoolClient } from 'pg'
import {
  encodeRowsToCopyText,
  type CopyColumn,
} from './copy-text-encoder'

export async function runBulkCopy(params: {
  client: Pick<PoolClient, 'query'>
  sql: string
  columns: ReadonlyArray<CopyColumn>
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>
}): Promise<void> {
  // pg-copy-streams' Writable lives on top of the active query session.
  const copyStream = (params.client.query as unknown as (q: unknown) => NodeJS.WritableStream)(
    copyFrom(params.sql),
  )
  await stream.promises.pipeline(
    encodeRowsToCopyText(params.columns, params.rows),
    copyStream,
  )
}
