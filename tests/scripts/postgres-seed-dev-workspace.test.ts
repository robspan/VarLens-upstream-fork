// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = resolve('scripts/postgres/seed-dev-workspace.mjs')

function printSql(args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, '--print-sql', ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      VARLENS_PG_URL: '',
      PGHOST: 'forbidden.invalid',
      PGPORT: '1'
    }
  })
}

describe('postgres dev workspace seed script', () => {
  it('prints deterministic seed SQL without opening a PostgreSQL connection', () => {
    const first = printSql()
    const second = printSql()

    expect(first.status).toBe(0)
    expect(first.stderr).toBe('')
    expect(second.status).toBe(0)
    expect(second.stderr).toBe('')
    expect(first.stdout).toBe(second.stdout)

    expect(first.stdout).toContain('BEGIN;')
    expect(first.stdout).toContain('COMMIT;')
    expect(first.stdout).toContain('CREATE SCHEMA IF NOT EXISTS "public";')
    expect(first.stdout).toContain('CREATE TABLE IF NOT EXISTS "public"."schema_migrations"')
    expect(first.stdout).toContain(
      `INSERT INTO "public"."schema_migrations" (version, name, checksum, execution_ms)`
    )
    expect(first.stdout).toContain(`CREATE TABLE IF NOT EXISTS "public"."filter_presets"`)
    expect(first.stdout).toContain('INSERT INTO "public"."cases"')
    expect(first.stdout).toContain("'Oldest Case'")
    expect(first.stdout).toContain("'Middle Case'")
    expect(first.stdout).toContain("'Newest Case'")
    expect(first.stdout).toContain('INSERT INTO "public"."variants"')
    expect(first.stdout.match(/\(\d+, \d+, '[^']+', \d+,/gu)).toHaveLength(6)
    expect(first.stdout).toContain("'BRCA1'")
    expect(first.stdout).toContain("'HTT'")
    expect(first.stdout).toContain('INSERT INTO "public"."filter_presets"')
    expect(first.stdout).toContain('INSERT INTO "public"."metric_definitions"')
    expect(first.stdout).toContain("'Age at Onset'")
    expect(first.stdout).toContain("'Rare Pathogenic'")
    expect(first.stdout).toContain("'Tier 1 candidates'")
    expect(first.stdout).toContain("'shortlist'")
    expect(first.stdout).toContain('SET variant_count = COALESCE(seed_counts.count, 0)')
    expect(first.stdout).toContain(`LEFT JOIN "public"."variants" v ON v.case_id = c.id`)
    expect(first.stdout).toContain(`pg_get_serial_sequence('"public"."cohort_groups"', 'id')`)
    expect(first.stdout).toContain(`pg_get_serial_sequence('"public"."metric_definitions"', 'id')`)
  })

  it('allows schema selection while quoting identifiers deterministically', () => {
    const result = printSql(['--schema', 'clinical_workspace'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('SET search_path TO "clinical_workspace";')
    expect(result.stdout).toContain('INSERT INTO "clinical_workspace"."cases"')
    expect(result.stdout).not.toContain('"public"."cases"')
  })

  it('exports pure SQL builders that are safe to import in tests', async () => {
    const source = await readFile(SCRIPT_PATH, 'utf8')
    expect(source).not.toMatch(/from ['"]pg['"]/u)

    const module = (await import(pathToFileURL(SCRIPT_PATH).href)) as {
      buildSeedSql: (options?: { schema?: string }) => string
      buildSeedOperations: (options?: { schema?: string }) => readonly { text: string }[]
    }

    const sql = module.buildSeedSql({ schema: 'public' })
    const operations = module.buildSeedOperations({ schema: 'public' })

    expect(sql).toBe(module.buildSeedSql({ schema: 'public' }))
    expect(operations).toHaveLength(1)
    expect(operations[0].text).toBe(sql)
    expect(sql).toContain('SELECT setval(pg_get_serial_sequence')
  })
})
