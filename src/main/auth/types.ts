/**
 * Auth type definitions.
 *
 * `Credential` is a discriminated union prepared for the OIDC swap in
 * Stage 2. Phase 1 only implements the `password` arm; the `token` arm
 * exists so OIDC plugs in without touching call sites.
 *
 * Enforced by `tests/web-gate/auth-isolation.test.ts` ("Credential
 * discriminated union is shaped for OIDC retrofit").
 */
export type Credential =
  | { kind: 'password'; username: string; password: string }
  | { kind: 'token'; jwt: string }
