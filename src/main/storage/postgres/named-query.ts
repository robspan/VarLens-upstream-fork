import { createHash } from 'crypto'
import type { Pool, QueryResult, QueryResultRow } from 'pg'
import { mainLogger } from '../../services/MainLogger'

/**
 * Sprint A PR-2 B1 — named/prepared statement helpers.
 *
 * `runNamed`: static-SQL call sites. SQL text is constant per logical name.
 * `runNamedDynamic`: dynamic-SQL call sites (queryVariants etc.). SQL text
 *   varies; the effective name carries a :t<sha1-8> tail keyed by text.
 *
 * Effective name format:
 *   runNamed:        `${name}@${schemaToken(schema)}`
 *   runNamedDynamic: `${baseName}:t${sha1(text).slice(0,8)}@${schemaToken(schema)}`
 *
 * Why `@${schemaToken}`: PG repositories interpolate the schema name into the
 * SQL text via the `"__schema__"."<table>"` placeholder — the same logical
 * query against two schemas has different text after interpolation. Without
 * per-schema name isolation, a connection that has prepared `foo:v1` against
 * schema A errors or mis-resolves when re-used against schema B (Codex Pass-1
 * #3 + Pass-2 verdict #2).
 *
 * Why `schemaToken` ALWAYS appends hash6: `Case Lab`/`case-lab`/`case_lab`
 * slug to the same `case_lab` (Pass-3 MED #4). The hash disambiguates.
 *
 * Version-suffix rule: when a `runNamed` call's SQL text changes, bump the
 * `name` (e.g. `foo:bar:v1` → `foo:bar:v2`). node-postgres CLIENT-side
 * `parsedStatements[name]` check at `pg/lib/query.js:156` rejects same-name
 * different-text BEFORE the server sees the query — the wrapper's
 * 26000/42704 retry cannot save you. Enforced by an agent-check grep
 * (PR2-11 adds the rule).
 *
 * `runNamedDynamic` cap: process-level effective-name Set. When size exceeds
 * `Math.max(64, 16 * top20Size)`, new dynamic calls fall back to unnamed
 * pool.query and log once at WARN (Pass-9 #2).
 */

const seenDynamicNames = new Set<string>()
const TOP20_SIZE_DEFAULT = 20
let dynamicNameCap = Math.max(64, 16 * TOP20_SIZE_DEFAULT)
let dynamicCapLogged = false

export function schemaToken(schema: string): string {
  const slug = schema
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 24)
  const hash6 = createHash('sha1').update(schema).digest('hex').slice(0, 6)
  return `${slug}_${hash6}`
}

export interface RunNamedSpec {
  name: string
  text: string
  values: unknown[]
  schema: string
}

export interface RunNamedDynamicSpec {
  baseName: string
  text: string
  values: unknown[]
  schema: string
}

export async function runNamed<R extends QueryResultRow>(
  pool: Pool,
  spec: RunNamedSpec
): Promise<QueryResult<R>> {
  if (spec.name.includes('@')) {
    throw new Error(
      `runNamed: logical name "${spec.name}" must not contain "@" (reserved as the schema-token separator).`
    )
  }
  const effectiveName = `${spec.name}@${schemaToken(spec.schema)}`
  return executeWithFallback(pool, effectiveName, spec.text, spec.values)
}

export async function runNamedDynamic<R extends QueryResultRow>(
  pool: Pool,
  spec: RunNamedDynamicSpec
): Promise<QueryResult<R>> {
  if (spec.baseName.includes('@')) {
    throw new Error(`runNamedDynamic: baseName "${spec.baseName}" must not contain "@".`)
  }
  const textHash = createHash('sha1').update(spec.text).digest('hex').slice(0, 8)
  const effectiveName = `${spec.baseName}:t${textHash}@${schemaToken(spec.schema)}`

  if (seenDynamicNames.size >= dynamicNameCap && !seenDynamicNames.has(effectiveName)) {
    if (!dynamicCapLogged) {
      mainLogger.warn(
        `runNamedDynamic cap exceeded (${seenDynamicNames.size}); falling back to unnamed queries`,
        'postgres-named-query'
      )
      dynamicCapLogged = true
    }
    return pool.query(spec.text, spec.values as unknown[]) as Promise<QueryResult<R>>
  }
  seenDynamicNames.add(effectiveName)
  return executeWithFallback(pool, effectiveName, spec.text, spec.values)
}

async function executeWithFallback<R extends QueryResultRow>(
  pool: Pool,
  name: string,
  text: string,
  values: unknown[]
): Promise<QueryResult<R>> {
  try {
    return (await pool.query({ name, text, values: values as unknown[] })) as QueryResult<R>
  } catch (err) {
    const code = (err as { code?: string }).code
    const message = (err as Error).message ?? ''
    if (/Prepared statements must be unique/i.test(message)) {
      const wrapped = new Error(
        `${message} — bump the version suffix on the logical name (e.g. foo:bar:v1 → v2).`
      )
      ;(wrapped as Error & { cause?: unknown }).cause = err
      throw wrapped
    }
    if (code === '26000' || code === '42704') {
      return (await pool.query(text, values as unknown[])) as QueryResult<R>
    }
    throw err
  }
}

// Test-only helpers — do not call from production code.
export function __setCapForTests(n: number): void {
  dynamicNameCap = n
  dynamicCapLogged = false
}

export function __resetCapForTests(): void {
  dynamicNameCap = Math.max(64, 16 * TOP20_SIZE_DEFAULT)
  seenDynamicNames.clear()
  dynamicCapLogged = false
}
