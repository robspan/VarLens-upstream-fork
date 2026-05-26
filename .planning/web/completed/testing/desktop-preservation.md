# Desktop preservation tests

Status: implemented desktop-preservation checkpoint.

Adds a refactor-checkpoint layer that pins desktop structural invariants the existing 290 tests do not cover, so the StorageSession extraction cannot silently change desktop behavior.

## Tests (v1)

Folder: `tests/refactor-checkpoint/`. Snapshots: `tests/refactor-checkpoint/__snapshots__/<name>.json` (plain JSON, sorted, hand-reviewable).

| Test | Snapshots |
|---|---|
| `transaction-boundaries.test.ts` | every `db.transaction(...)` call site: `{ file, callerFunction, firstStatement }` |
| `pool-vs-main-routing.test.ts` | each IPC handler classified `poolRouted` / `mainThread` / `unclassified` |

ts-morph walks `src/main/`. No native modules, no DB boot.

## Update flow

```bash
UPDATE_REFACTOR_SNAPSHOTS=1 npm run test -- tests/refactor-checkpoint/
```

PRs that legitimately shift a snapshot must include the regenerated JSON; reviewers read the diff.

## CI

Default `make test` and `make ci`. No bypass env var — intentional drift = update snapshot in same commit.

## Deferred

- `handler-storage-callgraph.test.ts` — overlap with `tests/web-gate/db-seam.test.ts`. Add only on rule-of-three; tracked in `../../backlog/testing-followups.md`.

## Lifecycle

Both tests can retire when the StorageSession refactor is fully closed and the snapshot value is replaced by stronger permanent tests.
