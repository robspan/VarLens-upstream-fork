// Type shim for pg-copy-streams (no upstream types as of v7).
// The library exposes `from(sql)` and `to(sql)` factories that return
// duplex/Writable streams compatible with `client.query(...)` from `pg`.
declare module 'pg-copy-streams' {
  import type { Writable, Readable } from 'node:stream'

  /** Build a Writable stream for `COPY ... FROM STDIN`. */
  export function from(sql: string, options?: Record<string, unknown>): Writable

  /** Build a Readable stream for `COPY ... TO STDOUT`. */
  export function to(sql: string, options?: Record<string, unknown>): Readable
}
