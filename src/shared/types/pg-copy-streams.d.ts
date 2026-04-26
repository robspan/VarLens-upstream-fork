// Type shim for pg-copy-streams (no upstream types as of v7).
// The library exposes `from(sql)` and `to(sql)` factories that return
// duplex/Writable streams compatible with `client.query(...)` from `pg`.
declare module 'pg-copy-streams' {
  import type { Writable, Readable } from 'node:stream'

  /**
   * Submittable Writable returned by `from(sql)`. Once handed to
   * `client.query(...)` it carries a `rowCount` set by the backend after
   * the COPY completes.
   */
  export interface CopyStreamQuery extends Writable {
    rowCount?: number
  }

  /** Build a Writable stream for `COPY ... FROM STDIN`. */
  export function from(sql: string, options?: Record<string, unknown>): CopyStreamQuery

  /** Build a Readable stream for `COPY ... TO STDOUT`. */
  export function to(sql: string, options?: Record<string, unknown>): Readable
}
