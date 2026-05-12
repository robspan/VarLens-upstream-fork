# Testing Follow-Ups

Status: backlog.

The web-gate and desktop-preservation test strategy is implemented. These are deferred expansions,
not blockers for the current completed testing plan.

## Parity Scenario Expansion

- Add `parity/export-roundtrip.parity.test.ts` for streamed bytes/download behavior.
- Add progress-event parity assertions once the web event transport surface is stable.
- Decide whether the old pool-vs-HTTP concurrency idea remains useful as a desktop-only regression;
  web production is Postgres-backed, so the original web risk is gone.

## Auth And Multi-User Expansion

- Keep expanding `parity/auth-scenarios.parity.test.ts` for Stage 3 session expiry, OIDC/token, and
  row isolation scenarios.
- Continue shrinking any `user-id-schema` exemptions as Stage 2/3 schema work lands.

## Desktop Checkpoint Retirement

- Retire `tests/refactor-checkpoint/` only after the StorageSession refactor is fully closed and the
  useful invariants are covered by permanent tests.

