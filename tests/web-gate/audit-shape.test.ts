import { afterAll, describe, expect, test } from 'vitest'
import { openMigratedTmpDb, tableColumns } from './helpers/tmp-db'

/**
 * Phase 1 gate — `audit_log` is the table that grows the most between
 * Phase 1 and Stage 2 (Stage 2 adds `pre_state`, `post_state`, `ip`,
 * `user_agent`, plus the move from `user_name` → `user_id`).
 *
 * The test asserts: every column on `audit_log` is either in the current
 * baseline (today's columns, frozen below) OR in the Stage 2 vocabulary.
 * Adding a new column with a name that is neither baseline nor Stage 2
 * fails the test — forcing alignment with the planned Stage 2 schema
 * before the audit table grows in incompatible directions.
 *
 * Cheap insurance, lexical only. See `.planning/web/completed/testing/desktop-to-web-parity.md`
 * and the web audit contract.
 */

// Column names present on the v7 baseline schema (frozen 2026-05-04).
// When the v8+ migration moves to user_id-keyed audit, these columns will
// be removed; the test will then need its assertion tightened to
// `STAGE2_VOCAB`-only.
const CURRENT_BASELINE = new Set([
  'id',
  'timestamp',
  'action_type',
  'entity_type',
  'entity_key',
  'old_value',
  'new_value',
  'user_name'
])

const STAGE2_VOCAB = new Set([
  'id',
  'ts',
  'user_id',
  'action',
  'entity',
  'entity_id',
  'pre_state',
  'post_state',
  'ip',
  'user_agent'
])

describe('audit-shape gate', () => {
  const tmp = openMigratedTmpDb()
  afterAll(() => tmp.cleanup())

  test('audit_log columns are subset of (current baseline ∪ Stage 2 vocabulary)', () => {
    const cols = tableColumns(tmp.db, 'audit_log').map((c) => c.name)
    const allowed = new Set([...CURRENT_BASELINE, ...STAGE2_VOCAB])
    const violations = cols.filter((c) => !allowed.has(c))

    expect(violations, `unexpected columns: ${violations.join(', ')}`).toEqual([])
  })

  test('audit_log table exists at the expected schema version', () => {
    const cols = tableColumns(tmp.db, 'audit_log')
    expect(cols.length).toBeGreaterThan(0)
    expect(cols.find((c) => c.name === 'id' && c.pk === 1)).toBeTruthy()
  })
})
