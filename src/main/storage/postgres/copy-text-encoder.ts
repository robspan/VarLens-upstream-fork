// src/main/storage/postgres/copy-text-encoder.ts
//
// Pure encoders for PostgreSQL COPY ... FROM STDIN text format.
// No pg imports — fully unit-testable in isolation.

export class EncoderInvalidValueError extends Error {
  constructor(public readonly column: string | undefined, public readonly reason: string) {
    super(`COPY encoder rejected value: ${reason}${column ? ` (column ${column})` : ''}`)
    this.name = 'EncoderInvalidValueError'
  }
}

export type CopyColumnEncoder = (value: unknown) => string

const NULL_TOKEN = '\\N'

/**
 * Encodes a text value for COPY text format.
 * - null/undefined → \N
 * - empty string  → '' (NOT null)
 * - U+0000        → throws (Postgres `text` cannot store NUL)
 * - Escape order: \ first, then \n, \r, \t.
 */
export const encodeText: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value !== 'string') return encodeText(String(value))
  if (value.indexOf('\u0000') >= 0) {
    throw new EncoderInvalidValueError(undefined, 'U+0000 not representable in PostgreSQL text')
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export const encodeInteger: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'bigint') return value.toString()
  // Verbatim quirk: per JS precedence this parses as
  //   `value | (0 === value) ? (value | 0) : value`
  // The boolean → number coercion is a runtime no-op (`true`→1, `false`→0)
  // but TypeScript strict mode rejects it; the cast preserves identical
  // runtime behavior without changing the parse.
  if (typeof value === 'number') return String(value | ((0 === value) as unknown as number) ? (value | 0) : value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value
  return String(value)
}

export const encodeFloat: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    return String(value)
  }
  return String(value)
}

export const encodeBoolean: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  return value === true || value === 't' ? 't' : 'f'
}

/**
 * Reserved encoder — no Phase 16 caller (info_json is currently TEXT, not jsonb).
 * Documents the safe path for any future migration.
 */
export const encodeJsonb: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  let s = JSON.stringify(value)
  // Strip U+0000 — JSONB rejects it, and JSON.stringify allows it through.
  s = s.replace(/\u0000/g, '')
  // Double-escape every backslash so the COPY decoder un-escapes back to the
  // JSON-legal form before the JSONB caster sees it.
  s = s.replace(/\\/g, '\\\\')
  // Then escape COPY's transport metacharacters.
  return s
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

export const encodeBytea: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (!Buffer.isBuffer(value)) {
    throw new EncoderInvalidValueError(undefined, 'expected Buffer for bytea encoder')
  }
  return '\\\\x' + value.toString('hex')
}

export const encodeArray: CopyColumnEncoder = (value) => {
  if (value === null || value === undefined) return NULL_TOKEN
  if (!Array.isArray(value)) {
    throw new EncoderInvalidValueError(undefined, 'expected array for array encoder')
  }
  if (value.length === 0) return '{}'
  return '{' + value.map((v) => (v === null ? NULL : encodeText(String(v)))).join(',') + '}'
}
const NULL = 'NULL'

export interface CopyColumn {
  name: string
  encoder: CopyColumnEncoder
}

/**
 * Async generator that consumes a row producer and yields COPY text-format Buffers.
 * Each row is encoded as one line of tab-separated tokens terminated by \n.
 */
export async function* encodeRowsToCopyText(
  columns: ReadonlyArray<CopyColumn>,
  rows: AsyncIterable<Record<string, unknown>> | Iterable<Record<string, unknown>>,
): AsyncGenerator<Buffer> {
  for await (const row of rows as AsyncIterable<Record<string, unknown>>) {
    const fields: string[] = new Array(columns.length)
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      try {
        fields[i] = col.encoder(row[col.name])
      } catch (err) {
        if (err instanceof EncoderInvalidValueError) {
          throw new EncoderInvalidValueError(col.name, err.reason)
        }
        throw err
      }
    }
    yield Buffer.from(fields.join('\t') + '\n', 'utf8')
  }
}
