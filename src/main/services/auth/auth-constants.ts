/**
 * Cross-backend auth policy constants.
 *
 * Phase 2 deliverable #2. Both the desktop SQLite AuthService
 * (src/main/services/auth/AuthService.ts) and the upcoming
 * PostgresWebAuthService (src/web/auth/PostgresWebAuthService.ts)
 * import from here. Without a single source of truth the two backends
 * drift on policy — different lockout thresholds, mismatched role
 * enums, divergent CHECK constraints between SQLite migrations.ts v12
 * and Postgres migrations/sql/0007_*.sql.
 *
 * Anything that is *policy* belongs here. SQL fragments, query
 * shape, and row-mapping stay in the per-backend implementation.
 */

/** Allowed values for the users.role column. */
export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * After this many consecutive failed login attempts the account is
 * temporarily locked. Matches the pre-Phase-2 local constant in
 * AuthService.ts.
 */
export const MAX_FAILED_ATTEMPTS = 5

/**
 * How long an account stays locked after exceeding MAX_FAILED_ATTEMPTS.
 * Both backends compute `locked_until = now() + this duration`.
 */
export const LOCKOUT_DURATION_MINUTES = 15
