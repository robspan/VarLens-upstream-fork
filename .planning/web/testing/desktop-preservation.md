# Desktop preservation tests (refactor checkpoint layer)

Status: plan (2026-05-04)
Branch: `VarLens-Web`
Sibling document: `desktop-to-web-parity.md` (Purpose 1)
Index: `README.md`

## Purpose

Catch silent behavior changes in the **desktop** Electron app caused by the upcoming `StorageSession` extraction refactor. The existing 290 tests verify *what* desktop does at the IPC contract level. They do not verify *how* desktop does it — and the refactor will change exactly the "how": who owns the DB handle, where transactions wrap, how reads are routed across the worker pool.

Without these tests, a refactor PR can:

- Preserve the IPC contract ✓
- Preserve domain behavior on the happy path ✓
- Silently drop or add a transaction wrapper around a multi-statement operation ✗
- Silently move a write into the read-only worker pool (writes invisible across workers) ✗
- Silently route a read out of the pool (UI thread blocks on slow queries) ✗

The 290 existing tests don't catch any of those, by design — they test what they were written to test. **This layer pins the dimensions on which the refactor is most likely to drift.**

## Non-goals (what this layer is NOT)

- **Not a parity layer.** That's `desktop-to-web-parity.md`. These tests run only against the desktop / SQLite implementation.
- **Not a snapshot of every line.** Source-of-truth snapshots break on every legitimate refactor with no signal. We pin a small number of structural invariants, not the whole codebase.
- **Not behavioral-equivalence tests.** Existing handler tests cover behavioral correctness. These are *structural* checks — facts about how the code is organized, not facts about how it runs.
- **Not permanent.** Once the StorageSession extraction is fully done and Postgres-on-web is the production path, the `pool-vs-main-routing` test in particular has limited remaining value. The layer should be reviewed for relevance after Phase 2.

## Scope: two tests at v1

### Test 1 — `transaction-boundaries.test.ts`

**Pins:** every call site of `db.transaction(...)` (or equivalent better-sqlite3 transaction API) in `src/main/`. Captures the containing function name, file path, and the immediate string content of the transaction body's first statement (as a stability marker).

**Failure modes caught:**
- Refactor accidentally drops transaction wrapping around a multi-statement operation → data corruption risk
- Refactor accidentally adds transaction wrapping where none existed → deadlock risk under concurrent reads (the Piscina pool readers can starve)
- Refactor moves a transaction boundary from outer to inner scope → atomicity surprise

**Mechanism:** ts-morph walk of `src/main/`. Find all CallExpressions where the callee is `<expr>.transaction`. Emit a sorted JSON array of `{ file, callerFunction, firstStatement }`. Compare against snapshot at `tests/refactor-checkpoint/__snapshots__/transaction-boundaries.json`. Update via `UPDATE_REFACTOR_SNAPSHOTS=1 npm run test`.

### Test 2 — `pool-vs-main-routing.test.ts`

**Pins:** the classification of every IPC handler in `src/main/ipc/` as either *pool-routed* (reads delegated to `dbPoolManager.run(...)` or equivalent worker dispatch) or *main-thread* (direct `getDatabaseService()`-style call on the main thread).

**Failure modes caught:**
- Refactor accidentally moves a write operation into the read-only pool → writes invisible across worker handles, data loss
- Refactor accidentally moves a read out of the pool → main thread blocks on synchronous SQLite calls, UI freezes
- Refactor adds a new handler with no clear classification → forces explicit reviewer decision

**Mechanism:** ts-morph walk of `src/main/ipc/`. For each registered handler, scan its function body for the canonical pool-dispatch call vs. direct service call. Classify into `{ poolRouted: [...], mainThread: [...], unclassified: [...] }`. Compare against snapshot at `tests/refactor-checkpoint/__snapshots__/pool-vs-main-routing.json`. Any `unclassified` entries fail the test with the file/handler name; the fix is either to reclassify (update snapshot) or refactor for clarity.

### Test 3 (deferred) — `handler-storage-callgraph.test.ts`

**Pins:** for each IPC handler, the set of service or repository function names it directly invokes.

**Failure modes caught:**
- Refactor leaves a handler bypassing the new `StorageSession`-injected service (still calls the old layer directly).

**Why deferred:** partly overlaps with the existing `tests/web-gate/db-seam.test.ts`, which already enforces "no imports from forbidden paths." The call-graph view is a finer-grained variant of the same idea. We'll add it only if a concrete pain point emerges where `db-seam` passes but a regression slipped through. **Rule of three applies:** wait for the third occurrence before extracting this test.

## Mechanism details

### Why ts-morph and not a runtime snapshot

A runtime snapshot (boot the app, capture call traces) would:
- Require booting Electron → slow, fragile in CI
- Capture only the paths exercised by test fixtures → false negatives
- Couple to test data → snapshot updates noisy

A static (ts-morph) snapshot:
- Runs in milliseconds in plain Vitest
- Captures every static call site, not just the exercised ones
- Coupled only to source structure → snapshot updates align with refactor commits
- Same toolchain as the existing web-gate static layer (no new dependency)

### Snapshot file format

Plain JSON, sorted, pretty-printed for readable diffs:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-04",
  "entries": [
    {
      "file": "src/main/database/CaseRepository.ts",
      "callerFunction": "deleteCase",
      "firstStatement": "db.prepare('DELETE FROM variants WHERE case_id = ?').run(caseId);"
    }
  ]
}
```

Stored at `tests/refactor-checkpoint/__snapshots__/<test-name>.json`. **Not** Vitest's built-in `.snap` files — those obscure the diff in PR review tools and accidentally update via `vitest -u`. We want explicit, opt-in updates only.

### Update flow

```bash
# Confirm what changed
npm run test -- tests/refactor-checkpoint/

# Read the diff carefully
git diff tests/refactor-checkpoint/__snapshots__/

# If the change is intentional, regenerate
UPDATE_REFACTOR_SNAPSHOTS=1 npm run test -- tests/refactor-checkpoint/
git add tests/refactor-checkpoint/__snapshots__/
git commit
```

The PR diff shows exactly which transaction boundaries or routing classifications shifted. Reviewers see the structural change as a first-class artifact.

## Test placement and CI integration

### Folder layout

```
tests/refactor-checkpoint/
  README.md                          # purpose + update flow
  transaction-boundaries.test.ts
  pool-vs-main-routing.test.ts
  helpers/
    snapshot-io.ts                   # readSnapshot / writeSnapshot / asserts
    ts-morph-project.ts              # shared Project loader for src/main/
  __snapshots__/
    transaction-boundaries.json
    pool-vs-main-routing.json
```

### CI integration

- Included in **default** `make test` and `make ci`. The whole point is to fail loudly on unintended drift; opt-in defeats the purpose.
- Each test runs in well under 1 second (no native modules, no DB, just ts-morph parse + JSON compare). No CI cost.
- A snapshot drift fails CI with a clear message that explains the update flow.

### Bypass

There is no env-var bypass. If you intentionally changed something, update the snapshot and commit it. If you accidentally changed something, fix the code. The commit message that updates a snapshot must explain *why* — that's the load-bearing artifact, not the snapshot itself.

## Acceptance criteria

1. Both tests pass green on `VarLens-Web` HEAD on first run.
2. Snapshots are checked in under `tests/refactor-checkpoint/__snapshots__/`.
3. A failing test prints both: (a) the structural diff in human-readable form, and (b) the `UPDATE_REFACTOR_SNAPSHOTS=1 npm run test` instruction.
4. Tests are part of default `make test` (visible to anyone running CI without flags).
5. `tests/refactor-checkpoint/README.md` documents the purpose and the update flow at-a-glance.

## Forcing functions

- **No abstraction beyond what's needed.** The `helpers/` folder gets two functions: `readSnapshot` and `assertSnapshotMatches`. No driver pattern, no test factory, no DSL. If a third test arrives and the helpers feel duplicated, *then* extract.
- **No test grows past one snapshot.** If a test naturally wants to pin two unrelated things, split it into two tests with one snapshot each. One test, one snapshot, one purpose.
- **Snapshots stay reviewable.** Pretty-print, stable sort, comment-friendly schema. If a snapshot is too large to read in a PR diff, the test is overscoped — narrow it.

## Lifecycle

- **Today:** snapshots reflect current desktop reality. All green.
- **During StorageSession refactor:** every refactor PR updates snapshots; reviewers see structural shifts.
- **Post-Phase 2 review:** evaluate whether `pool-vs-main-routing` still earns its keep — the Piscina pool exists because better-sqlite3 is sync; once Postgres is the production path for web, the pool/main distinction becomes a desktop-only concern. Likely this test gets retired then. `transaction-boundaries` continues to have value as long as the desktop SQLite path exists.

## Open questions for review

1. **Should `transaction-boundaries` capture the full transaction body or just the first statement?** Full body produces large diffs; first statement gives a stability marker without bloating snapshots. Plan: first statement only, escalate if pain emerges.
2. **Should `pool-vs-main-routing` distinguish read-only handlers from write handlers explicitly?** Today it's binary (pool vs. main). Could be `{ readPool, mainRead, mainWrite }`. Plan: keep binary at v1; refine if classifications are ambiguous in practice.
3. **Should the third test ever ship?** Wait for evidence. The web-gate `db-seam` test plus the two checkpoint tests cover the failure modes we can name today. Adding a third upfront violates the "rule of three" stated in `desktop-to-web-parity.md`.

## Pointers

- Sibling: `desktop-to-web-parity.md` (Phase 1 gate suite, parity track)
- Index: `README.md` (this folder)
- Decision: `../decision-postgres-as-web-backend.md` (web backend choice; informs parity scenarios but not these checkpoint tests)
- Existing static-analysis precedent: `tests/web-gate/db-seam.test.ts`, `tests/web-gate/handler-seam.test.ts` — same toolchain (ts-morph), different purpose (web seam enforcement vs. desktop preservation).
