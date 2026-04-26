// src/main/storage/postgres/postgres-bulk-write.ts
import * as stream from 'node:stream'
import type { Writable } from 'node:stream'
import { from as copyFrom, type CopyStreamQuery } from 'pg-copy-streams'
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
  // `pg.query` is overloaded for QueryConfig and Submittable, but the
  // published types only expose the QueryConfig overloads. pg-copy-streams'
  // CopyStreamQuery is a Submittable; the runtime accepts it and returns the
  // same instance as a Writable. The single residual cast bridges that gap.
  //
  // `pg.Client.query` reads `this.connectionParameters` (line 613 of
  // pg/lib/client.js as of pg 8), so we MUST preserve `this` — extracting
  // the function onto a bare variable and calling it loses the binding.
  // Use a bound thunk; the cost is one closure allocation per COPY call.
  const submit = copyFrom(params.sql)
  const queryFn = params.client.query.bind(params.client) as unknown as (
    q: CopyStreamQuery
  ) => Writable
  const copyStream = queryFn(submit)
  await stream.promises.pipeline(
    encodeRowsToCopyText(params.columns, params.rows),
    copyStream,
  )
}
