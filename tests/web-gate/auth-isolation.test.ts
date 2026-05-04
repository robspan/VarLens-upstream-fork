import { describe, expect, test } from 'vitest'
import { getProject, relPath } from './helpers/ts-morph-project'

/**
 * Phase 1 gate — direct imports of password-hashing or token libraries
 * live ONLY behind the auth-provider abstraction at
 * `src/main/auth/providers/`. AuthService consumes Argon2 through the
 * `PasswordProvider` interface. The OIDC swap in Stage 2 is a one-file
 * addition under `providers/`.
 *
 * Sealed 2026-05-04 by extracting `argon2-provider.ts`; the assertion
 * is a regular `test()` (was `test.fails()` until the refactor landed).
 */

const BANNED_PACKAGES = new Set([
  '@node-rs/argon2',
  'argon2',
  'bcrypt',
  'bcryptjs',
  'jsonwebtoken',
  'jose'
])

const PROVIDER_DIR_PREFIX = 'src/main/auth/providers/'

describe('auth-isolation gate', () => {
  test('phase 1: no direct password/token imports outside src/main/auth/providers/', () => {
    // Sealed: argon2 lives only in src/main/auth/providers/argon2-provider.ts;
    // AuthService consumes it through the PasswordProvider interface.
    const project = getProject()
    const violations: string[] = []

    for (const sf of project.getSourceFiles('src/**/*.ts')) {
      const path = relPath(sf.getFilePath())
      if (path.startsWith(PROVIDER_DIR_PREFIX)) continue

      for (const decl of sf.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue()
        if (!BANNED_PACKAGES.has(spec)) continue
        if (decl.isTypeOnly()) continue
        violations.push(`${path}:${decl.getStartLineNumber()} imports ${spec}`)
      }
    }

    expect(
      violations,
      violations.length
        ? `auth library imported outside providers/:\n  ${violations.join('\n  ')}`
        : 'no direct auth imports'
    ).toEqual([])
  })

  test('Credential discriminated union is shaped for OIDC retrofit', () => {
    // Bridge-Clause type bet (per `.planning/web/testing/desktop-to-web-parity.md`):
    // even though Phase 1 only implements password auth, the Credential
    // type must already declare a `kind: 'token'` arm so OIDC plugs in
    // without touching call sites.
    //
    // Today this is a forward-looking assertion: if `Credential` doesn't
    // exist yet, the test passes (nothing to enforce). The day the type
    // appears, it must include both arms.
    const project = getProject()
    const candidates = project
      .getSourceFiles('src/shared/**/*.ts')
      .concat(project.getSourceFiles('src/main/auth/**/*.ts'))

    let found: { path: string; text: string } | undefined
    for (const sf of candidates) {
      const alias = sf.getTypeAlias('Credential')
      if (alias) {
        found = { path: relPath(sf.getFilePath()), text: alias.getText() }
        break
      }
    }

    if (!found) return // type not yet declared — nothing to assert today

    expect(found.text).toMatch(/kind\s*:\s*['"]password['"]/)
    expect(
      found.text,
      `Credential at ${found.path} must include a kind:'token' arm for Stage 2 OIDC`
    ).toMatch(/kind\s*:\s*['"]token['"]/)
  })
})
