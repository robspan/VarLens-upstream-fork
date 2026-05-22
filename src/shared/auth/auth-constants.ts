/**
 * Cross-backend auth policy constants.
 *
 * Both the desktop SQLite AuthService and PostgresWebAuthService import from
 * here. Without a single source of truth the two backends
 * drift on policy — different lockout thresholds, mismatched role
 * enums, divergent CHECK constraints between SQLite migrations.ts v12
 * and Postgres migrations/sql/0007_*.sql.
 *
 * Anything that is *policy* belongs here. SQL fragments, query
 * shape, and row-mapping stay in the per-backend implementation.
 *
 * SECURITY POLICY: changes to the lockout threshold or duration are
 * security-policy changes, not refactors. They affect every operator's
 * exposure to credential-stuffing and brute-force attacks. The pinned-
 * value tests in tests/main/services/auth/auth-constants.test.ts force
 * these edits to be deliberate, but reviewers should treat any PR that
 * touches these constants as a security review, not a routine cleanup.
 */

/** Allowed values for the users.role column. */
export const USER_ROLES = ['admin', 'user'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * Named role constants — use these in code paths instead of string
 * literals so a rename of the role enum is a TypeScript-caught change
 * rather than a silent runtime divergence between schema and inserts.
 */
export const ROLE_ADMIN: UserRole = 'admin'
export const ROLE_USER: UserRole = 'user'

/**
 * Default value for the users.role column. Both backends declare
 * `DEFAULT 'user'`; the migration-parity tests pin both to this value.
 */
export const DEFAULT_USER_ROLE: UserRole = ROLE_USER

/**
 * After this many consecutive failed login attempts the account is
 * temporarily locked. Matches the desktop AuthService constant.
 */
export const MAX_FAILED_ATTEMPTS = 5

/**
 * How long an account stays locked after exceeding MAX_FAILED_ATTEMPTS.
 * Both backends compute `locked_until = now() + this duration`.
 */
export const LOCKOUT_DURATION_MINUTES = 15
