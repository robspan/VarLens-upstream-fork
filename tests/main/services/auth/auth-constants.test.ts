import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  USER_ROLES,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MINUTES,
  type UserRole
} from '../../../../src/main/services/auth/auth-constants'

/**
 * Phase 2 #2: cross-backend auth policy lives in one module.
 *
 * Both backends (the existing SQLite AuthService and the upcoming
 * PostgresWebAuthService under src/web/auth/) consume the same role
 * enum, lockout threshold, and lockout duration. Without a shared
 * source of truth they drift on policy — a desktop password lockout
 * after 5 attempts but a web one after 3, or a Postgres CHECK
 * constraint that allows roles the SQLite path silently rejects.
 *
 * This file is the gate. It goes RED until auth-constants.ts exists,
 * AuthService.ts imports from it, and the Postgres migration's role
 * CHECK enumerates exactly the same role names.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('auth-constants module', () => {
  it('exposes USER_ROLES with admin and user (no others)', () => {
    expect(new Set(USER_ROLES)).toEqual(new Set(['admin', 'user']))
  })

  it('exposes lockout threshold + duration matching pre-refactor values', () => {
    // Before extraction these were locals in AuthService.ts. Pinning to
    // the same numbers ensures the refactor is mechanically equivalent.
    expect(MAX_FAILED_ATTEMPTS).toBe(5)
    expect(LOCKOUT_DURATION_MINUTES).toBe(15)
  })

  it('UserRole type derives from USER_ROLES', () => {
    // Compile-time check via assignability — runtime assertion is
    // structural, but TS would refuse this assignment if the type drift.
    const sample: UserRole = 'admin'
    expect(USER_ROLES).toContain(sample)
  })
})

describe('auth-constants cross-backend wiring', () => {
  it('AuthService.ts imports from auth-constants (no local copies)', () => {
    const authPath = resolve(REPO_ROOT, 'src/main/services/auth/AuthService.ts')
    const src = readFileSync(authPath, 'utf8')
    expect(src, 'AuthService must import from auth-constants').toMatch(
      /from\s+['"]\.\/auth-constants['"]/
    )
    // The pre-refactor file declared these as local `const`. The refactor
    // must remove the locals; otherwise the constants module is just a
    // shadow that can drift.
    expect(src, 'AuthService must not redeclare MAX_FAILED_ATTEMPTS locally').not.toMatch(
      /^const\s+MAX_FAILED_ATTEMPTS\s*=/m
    )
    expect(src, 'AuthService must not redeclare LOCKOUT_DURATION_MINUTES locally').not.toMatch(
      /^const\s+LOCKOUT_DURATION_MINUTES\s*=/m
    )
  })

  it('Postgres migration 0007 role CHECK enumerates exactly USER_ROLES', () => {
    const sqlPath = resolve(
      REPO_ROOT,
      'src/main/storage/postgres/migrations/sql/0007_create_users_and_settings.sql'
    )
    const sql = readFileSync(sqlPath, 'utf8')
    for (const role of USER_ROLES) {
      expect(sql, `role CHECK must allow '${role}'`).toMatch(new RegExp(`'${role}'`))
    }
    // Negative: no other role names appear in a CHECK clause. Catches a
    // future migration that relaxes the enum.
    const checkClauseMatch = sql.match(/CHECK\(role IN \(([^)]+)\)\)/i)
    expect(checkClauseMatch, 'role CHECK clause must be present').not.toBeNull()
    const enumeratedRoles =
      checkClauseMatch![1]
        .split(',')
        .map((s) => s.trim().replace(/^'(.*)'$/, '$1'))
        .filter(Boolean) ?? []
    expect(new Set(enumeratedRoles)).toEqual(new Set(USER_ROLES))
  })

  it('SQLite migration v12 role CHECK enumerates exactly USER_ROLES', () => {
    const migPath = resolve(REPO_ROOT, 'src/main/database/migrations.ts')
    const src = readFileSync(migPath, 'utf8')
    // Find the role CHECK fragment in the v12 block.
    const checkMatch = src.match(/role TEXT NOT NULL DEFAULT 'user' CHECK\(role IN \(([^)]+)\)\)/)
    expect(checkMatch, 'SQLite v12 role CHECK must be present').not.toBeNull()
    const enumeratedRoles = checkMatch![1].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'))
    expect(new Set(enumeratedRoles)).toEqual(new Set(USER_ROLES))
  })
})
