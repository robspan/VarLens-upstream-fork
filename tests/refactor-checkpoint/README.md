# Refactor checkpoint tests

Pins desktop structural invariants the existing 290 tests do not cover, so the StorageSession extraction cannot silently change desktop behavior.

Tests:

- `transaction-boundaries.test.ts` — every `db.transaction(...)` call site in `src/main/`.
- `pool-vs-main-routing.test.ts` — every `dbPool.run({ type })` dispatch in `src/main/`.

Snapshots: `__snapshots__/<test>.json`. Plain JSON, sorted, hand-reviewable. Read by Vitest, written only when explicitly requested.

## Update flow

```bash
# Inspect the drift
npm run test -- tests/refactor-checkpoint/

# If intentional, regenerate:
UPDATE_REFACTOR_SNAPSHOTS=1 npm run test -- tests/refactor-checkpoint/
git add tests/refactor-checkpoint/__snapshots__/
git commit
```

The PR diff is the structural-change artifact. Reviewers read it.

## Plan

`.planning/web/completed/testing/desktop-preservation.md`
