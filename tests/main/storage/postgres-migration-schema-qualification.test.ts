import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

interface SchemaQualificationViolation {
  file: string
  line: number
  statement: string
}

const identifier = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_]*)`
const tableTarget = String.raw`(?<target>${identifier}(?:\s*\.\s*${identifier})?)`

const ddlPatterns = [
  new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${tableTarget}`, 'giu'),
  new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${tableTarget}`, 'giu'),
  new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${tableTarget}`, 'giu'),
  new RegExp(
    String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${identifier}\s+ON\s+${tableTarget}`,
    'giu'
  )
]

function findUnqualifiedAppTableDdl(sql: string, file: string): SchemaQualificationViolation[] {
  const strippedSql = stripLineComments(sql)
  const violations: SchemaQualificationViolation[] = []

  for (const pattern of ddlPatterns) {
    for (const match of strippedSql.matchAll(pattern)) {
      const target = match.groups?.target ?? ''
      if (isSchemaQualifiedTarget(target)) continue

      violations.push({
        file,
        line: lineNumberAt(strippedSql, match.index ?? 0),
        statement: firstLine(match[0])
      })
    }
  }

  return violations.sort((left, right) => left.line - right.line)
}

function stripLineComments(sql: string): string {
  return sql.replace(/--.*$/gmu, '')
}

function isSchemaQualifiedTarget(target: string): boolean {
  // Two deliberate qualifications exist: the per-project placeholder and
  // the shared cross-project audit schema (migration 0013).
  return /^(?:"__schema__"|"?varlens_audit"?)\s*\./u.test(target.trim())
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function firstLine(statement: string): string {
  return statement.trim().split('\n')[0]?.trim() ?? statement.trim()
}

function readMigrationSqlFiles(): Array<{ file: string; sql: string }> {
  const migrationsDir = join(process.cwd(), 'src/main/storage/postgres/migrations/sql')
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(migrationsDir, file), 'utf8')
    }))
}

describe('Postgres migration schema qualification', () => {
  it('detects unqualified app-table DDL statements', () => {
    const sql = `
      CREATE TABLE cases (id bigint);
      ALTER TABLE variants ADD COLUMN flagged integer;
      CREATE INDEX idx_variants_case ON variants(case_id);
      DROP TABLE cases;
    `

    expect(findUnqualifiedAppTableDdl(sql, 'fixture.sql')).toEqual([
      expect.objectContaining({ line: 2 }),
      expect.objectContaining({ line: 3 }),
      expect.objectContaining({ line: 4 }),
      expect.objectContaining({ line: 5 })
    ])
  })

  it('allows schema-qualified app-table DDL statements', () => {
    const sql = `
      CREATE TABLE "__schema__"."cases" (id bigint);
      ALTER TABLE "__schema__"."variants" ADD COLUMN flagged integer;
      CREATE INDEX idx_variants_case ON "__schema__"."variants"(case_id);
      DROP TABLE IF EXISTS "__schema__"."cases";
    `

    expect(findUnqualifiedAppTableDdl(sql, 'fixture.sql')).toEqual([])
  })

  it('keeps migration DDL targets qualified with the app schema placeholder', () => {
    const violations = readMigrationSqlFiles().flatMap(({ file, sql }) =>
      findUnqualifiedAppTableDdl(sql, file)
    )

    expect(violations).toEqual([])
  })
})
