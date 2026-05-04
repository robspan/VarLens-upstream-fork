/**
 * Argon2id password provider — the only place in the codebase allowed to
 * import `@node-rs/argon2`. Everywhere else gets the abstract
 * `PasswordProvider` interface.
 *
 * Enforced by `tests/web-gate/auth-isolation.test.ts`.
 */
import { hash, verify } from '@node-rs/argon2'

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4
}

export interface PasswordProvider {
  hashPassword(plain: string): Promise<string>
  verifyPassword(hashed: string, plain: string): Promise<boolean>
}

export class Argon2PasswordProvider implements PasswordProvider {
  async hashPassword(plain: string): Promise<string> {
    return await hash(plain, ARGON2_OPTIONS)
  }

  async verifyPassword(hashed: string, plain: string): Promise<boolean> {
    return await verify(hashed, plain)
  }
}

/** Module-level default. AuthService picks this up unless DI'd otherwise. */
export const defaultPasswordProvider: PasswordProvider = new Argon2PasswordProvider()
