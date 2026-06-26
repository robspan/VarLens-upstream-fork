# Web Shared-Handler Seam — Spec

**Status:** Draft 2026-06-13 (fresh draft — not yet cross-AI reviewed; ready for `gsd-review` / Codex convergence after a first read)
**Predecessor:** [.planning/specs/2026-06-13-web-narrow-hardening.md](2026-06-13-web-narrow-hardening.md) — shipped and merged (`37167a54 fix(web): harden upload boundary and origin guard`, `367145be docs(planning): mark web hardening plan complete`). That spec **explicitly deferred** the work in this one: *"No shared handler object refactor in this pass… This is not a replacement for a later shared-handler refactor; it prevents accidental expansion while narrow hardening lands."* This spec is that deferred refactor.
**Upstream review:** [.planning/code-review/pr-202-web-pilot-strategy-review.md](../code-review/pr-202-web-pilot-strategy-review.md) — findings **B6** (SQLite-vs-Postgres / web-vs-desktop parity bugs), **B7** (handler-seam test reduced to `existsSync`), **B8** (web transport reaching into Postgres internals), **B9** (`IpcResult` not preserved on the web boundary), and recommendation **F1** (per-domain routes + shared logic + behavioural seam). Most of F1's *structural* half landed (dispatcher split 1,414 → 310 LOC; per-domain route files; `invokeAsIpcResult`; no `pg.Pool` in the dispatcher). Its *behavioural* half — one shared operation module per domain imported by both transports, enforced by a behavioural seam — did not. This spec finishes it.
**Baseline:** `main` @ `226e8cf2` (v0.68.1). `make ci` + `VARLENS_WEB=1 make ci` assumed green on baseline (re-verify in pre-flight).

---

## Goal

Make the web transport a **thin adapter over one shared, transport-agnostic operation module per domain**, for the six domains whose web routes today re-implement desktop domain orchestration — and **enforce non-drift with a CI gate** so the next divergence is a failing test, not a code-review hope.

Concretely:

1. **Collapse duplicated orchestration.** For `transcripts`, `panels`, `annotations`, `variants`, `cohort`, `export`, the *orchestration above the storage executor* (argument validation against the shared schema, multi-call sequencing, result shaping, event publication, audit/cache callbacks) lives in **one** `src/main/ipc/handlers/<domain>-logic.ts` module. Both the desktop IPC handler and the web Fastify route call the **same exported function**, supplying transport-specific behaviour only through the module's existing **callback injection points** (the `*Callbacks` pattern `panels-logic`/`cohort-logic`/`export-logic` already use).
2. **Upgrade the seam gate from structural to behavioural.** `tests/web-gate/handler-seam.test.ts` currently pins the *set* of override modules (the narrow-hardening guard). Extend it so that for every shared IPC contract method, the web path must either (a) autoroute to the **same** `task-types` entry the desktop handler dispatches, or (b) the web route and desktop handler import the **same** `<domain>-logic` symbol. A route that re-implements orchestration fails.
3. **Prove output equality at runtime.** Extend the **already-registered** per-domain scenarios in the parity harness (`tests/web-gate/parity/ipc-fixture-parity.test.ts` + `parity/ipc/<domain>.ts`) with the missing B6 regression cases, asserting desktop-IPC and web-HTTP produce set-equal returned values. Event-emission parity, which the harness cannot observe (RC-9a), is covered by targeted unit tests instead.

The work exits when all six domains are migrated, the behavioural seam gate is **strict** (no orchestration exceptions remain for the six), the parity scenarios pass for all six, and both `make ci-full` and `VARLENS_WEB=1 make ci` are green.

## Audience

A coding agent (Claude Code, Codex, OpenCode, …) executing `superpowers:subagent-driven-development` one task at a time across the PR branches below, the same way Sprints A and B shipped. TDD where a behaviour gate exists; atomic Conventional Commits; `make format` in every task's verification.

---

## Reality-check corrections (verified against `main @ 226e8cf2` this session — re-verify line numbers at task time; they drift)

These drive the spec. Do not re-derive them.

- **RC-1 — The storage-executor seam already converges the Postgres paths; the live drift surface is *above* it.** For the target domains the desktop Postgres branch and the web route both call `session.getReadExecutor()/getWriteExecutor().execute(...)` → the same `PostgresReadExecutor`/`PostgresWriteExecutor` (e.g. `src/main/ipc/handlers/transcripts.ts:81-89` → `PostgresWriteExecutor.ts:303-306` → `PostgresTranscriptsRepository.switchSelectedTranscript`). So B6 is **no longer a storage-layer divergence**. What is still duplicated — and is where the B6 bugs lived — is the **orchestration above the executor**: validation, multi-call sequencing, result shaping, event publication, audit ordering. This refactor targets that layer only.

- **RC-2 — Five of six target domains already have a transport-agnostic `*-logic.ts`; `transcripts` does not.** `panels-logic.ts` (402 LOC), `annotations-logic.ts` (319), `variants-logic.ts` (365), `cohort-logic.ts` (447), `export-logic.ts` (329) exist and are imported by their desktop handlers (`handlers/panels.ts:44`, `annotations.ts:23`, `variants.ts:25`, `cohort.ts:22`, `export.ts:19`). `transcripts` has **no** logic module — its logic is inline in `handlers/transcripts.ts`, branching on `session.capabilities.backend === 'postgres'` at `:38,:81,:123`. PR-1 extracts `transcripts-logic.ts` (the hardest case: proves the "no module yet" path).

- **RC-3 — The logic modules are already designed for transport injection.** `panels-logic` exports a `PanelCacheCallbacks` type; `cohort-logic` a `CohortCallbacks`; `export-logic` an `ExportCallbacks`. `annotations-logic.ts` carries a header comment that it is *"Handler-layer only … prohibited from touching"* the IPC layer — i.e. it is already transport-agnostic. **This is the clean seam:** transport-specific behaviour (window-broadcast vs. SSE publish, cache-invalidation notification) is supplied as a callback the transport passes in, not duplicated logic. The `annotations:upsertPerCase` event-scope difference (desktop broadcasts to all windows via `broadcastAnnotationChanged`; web publishes to one session via `events.publish` at `routes/annotations.ts:72-78`) becomes a **declared injection point**, not drift.

- **RC-4 — Concrete duplication evidence (the orchestration to move):**
  - **`panels:get`** — web `routes/panels.ts:14-20` hand-rolls the two-call merge `{ ...panel, genes }` (panel read + `panels:getGenes` read). The desktop equivalent lives in `panels-logic.ts`. Two implementations of one shaping rule — the B6 `panels:get` shape bug.
  - **`panels:update`** — web `routes/panels.ts:32-42` unpacks `{ id, name, description, version }` into `[id, {…}]` itself — the exact B6 argument-shape divergence point, now hand-corrected in the route but still a duplicate.
  - **`annotations`** — web `routes/annotations.ts` re-implements `detectAnnotationChangeKind` (`:11-20`) and the per-case event publish (`:67-78`); `annotations:getForVariant` uses a quirky per-field parse `CaseVariantIdSchema.shape.caseId.safeParse(caseId)` (`:86`). The write+audit **atomicity** B6 bug is already closed at the executor via the composite write-tasks `annotations:upsertGlobalWithAudit` / `annotations:upsertPerCaseWithAudit` (`routes/annotations.ts:51,68`) — the shared logic must keep that single-task boundary and not re-split write/audit.

- **RC-5 — `invokeAsIpcResult` already normalizes the web error envelope (B9 mostly closed).** `dispatcher.ts:101-115` wraps every override and autoroute result; `<400` returns the value, `>=400` and thrown errors become `SerializableError` via `toSerializableWebError`. Validation-failure shapes like `{ error: 'invalid-panel-id' }` with `reply.code(400)` are converted there. The refactor must **preserve** this envelope: shared logic throws on failure (desktop relies on `wrapHandler`), and the web route lets `invokeAsIpcResult` convert — routes must not invent new ad-hoc success shapes.

- **RC-6 — The dispatcher checks overrides *first*; `task-types` membership is a dormant fallback, not live behaviour.** `dispatcher.ts:255`: if `overrides[key]` exists it runs, and the autoroute branches (`:273`/`:287`, `isReadTaskType`/`isWriteTaskType`, `task-types.ts:128-135`) are never reached for that key. So a method that *both* has an override *and* is in `READ_TASK_TYPES`/`WRITE_TASK_TYPES` is served by the **override**. Concretely, `export:variants` and `export:cohort` are in `READ_TASK_TYPES` (`task-types.ts:41-42`) **but are also overridden** (`routes/export.ts:19,41`) — so the live path is the override, and they are **in scope** for migration (corrects the earlier "leave them, they autoroute" reading). A method with *no* override does autoroute and carries zero drift risk — it is the same executor call on both transports, out of scope for this refactor.

- **RC-7 — Schema-source split (hygiene, opportunistic).** `routes/panels.ts:1` imports `PanelIdSchema/PanelUpdateSchema` from `shared/types/ipc-schemas`, while `routes/annotations.ts:1-6` and `routes/region-files.ts:4` import from `shared/api/schemas/<domain>`. F1's single-source-of-truth goal is `src/shared/api/schemas/<domain>.ts`. Migrated domains should validate handler, route, and logic against **one** schema symbol; consolidate to `shared/api/schemas/<domain>.ts` **only where trivial** (no behaviour change). Do not turn this into a schema migration project (OQ-2).

- **RC-8 — The current seam gate is set-pinning, not behavioural.** `handler-seam.test.ts` holds `EXPECTED_ROUTE_OVERRIDE_MODULES` (20 modules) and `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS` annotating each as e.g. *"thin storage-executor adapters with web-only argument validation."* It prevents new override modules appearing unreviewed but asserts nothing about web↔desktop behavioural equivalence (B7). The upgrade adds the behavioural assertion and a **shrinking** `PENDING_SHARED_LOGIC_EXTRACTION` allowlist (monotonic-decrease, like `agent-health-postgres-baseline.json`) seeded with the six domains and emptied by PR-3.

- **RC-9 — The runtime parity harness already exists, is scenario-driven, and already has all six domains registered.** `tests/web-gate/parity/ipc-fixture-parity.test.ts` launches real Electron (`callElectronApi` / `launchElectronApp`) **and** an isolated web schema (`startWebDriver` / `startIsolatedWebSchema`), runs `IPC_SCENARIOS` from `parity/ipc/scenarios.ts` against both, and compares by hash. Scenario files for `transcripts, panels, annotations, variants, cohort, export` **already exist** under `parity/ipc/`. The work is therefore **extending existing scenarios with the specific B6 cases**, not adding scenario groups — e.g. `parity/ipc/transcripts.ts` currently runs only `insertAndSwitch` + `list` (no `switch`, no parent-`variants`-row assertion).
- **RC-9a — The parity harness compares returned values by hash and exposes no event channel.** `RuntimeContext` (`parity/ipc/shared.ts:20-28`) exposes only `call(...)` plus case/variant anchors; the harness hashes returned values. It therefore **cannot** observe "a change event fired once with kind X." Event-emission/event-scope parity (the `annotations:upsertPerCase` injected-callback behaviour) must be verified by **targeted adapter/handler unit tests**, not the runtime parity harness. Parity covers the returned-value equality only.

- **RC-10 — `transcripts-logic` should route *both* backends through the executors and drop the `capabilities.backend` branch.** The desktop handler currently branches: Postgres → write executor (`handlers/transcripts.ts:81-89`), SQLite → `db.transcripts.*` (`:89,:131`). But the **SQLite write executor already handles these tasks** (`SqliteWriteExecutor.ts:310-315` → `databaseService.transcripts.switchSelectedTranscript`/`insertTranscriptAndSwitch`), and `transcripts:switch`/`transcripts:insertAndSwitch` are in the write-executor task union (`write-executor.ts:135,137`). `StorageSession` is explicit: *"New domain logic must use getReadExecutor() / getWriteExecutor()"* (`session.ts:15-19`). So the extracted `transcripts-logic.ts` calls `session.getWriteExecutor().execute({ type: 'transcripts:switch', … })` for **all** backends — no `db.transcripts.*`, no `capabilities.backend` branch. This is behaviour-preserving (the SQLite executor case calls the same repository method the old branch did) and strictly simpler. Verify the read executor likewise serves `transcripts:list` for both backends (the web route already calls it), so the read path drops its branch too.

---

## In scope

Three sequenced PRs. PR-1 builds the gate + harness extension and migrates the hardest domain (proves the pattern). PR-2 migrates the B6 flagships. PR-3 migrates the rest and flips the gate to strict. **No IPC contract change, no executor contract change, no renderer behaviour change** in any PR.

### PR-1 — `feat/web-shared-logic-seam-and-transcripts`

The gate, the harness extension, and the `transcripts` migration (the only target with no existing logic module).

| Sub-item | Ref | Summary |
|---|---|---|
| **S1: Behavioural seam gate (per override *key*, not per file)** | B7, RC-8 | Extend `tests/web-gate/handler-seam.test.ts`. The gate operates **per override key** (a route-file import check is insufficient — `routes/variants.ts:2` imports `searchVariants` yet `variants:query`/`variants:columnMeta`/`variants:getFilterOptions` at `:48,:28,:107` hand-roll their own executor calls). For **every override key** in a migrated domain, assert it is one of: **(a) a pure executor pass-through** — its only non-validation action is a single `getReadExecutor()/getWriteExecutor().execute({ type: <the same key>, … })` call (behaviourally identical to autoroute), or **(b) it calls a named `<domain>-logic` export** that the desktop handler also calls. Inline multi-call sequencing, result reshaping, or event/audit logic in the route **fails** the gate. Domains in a new `PENDING_SHARED_LOGIC_EXTRACTION` allowlist (seeded with all six: `transcripts, panels, annotations, variants, cohort, export`) are exempt until migrated; methods with **no** override are out of scope (autoroute already shares behaviour). Seeding all six means S1 lands as a green no-op; each extraction removes one entry. Keep the existing set-pinning + `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS` (web-only adapters: `auth, audit-log, batch-import, import, region-files, gene-ref, hpo, protein, vep, cases, case-metadata, gene-lists, analysis-groups, database`). Both allowlists are monotonic-decrease — a `// do not add` banner + a test that fails if either grows. Per-method body analysis needs AST (OQ-1). |
| **S2: Extend the existing `transcripts` parity scenario** | B6, RC-9 | `parity/ipc/transcripts.ts` already runs `insertAndSwitch` + `list`. **Extend** it with `transcripts:switch` and a follow-up read asserting the parent `variants` row reflects the switch (the original B6 case). No new scenario group; the area is already in `REQUIRED_IPC_AREAS`. Run the gated parity test (locks current behaviour before extraction). |
| **S3: Extract `transcripts-logic.ts` (executor-routed, no backend branch)** | RC-2, RC-10 | Create `src/main/ipc/handlers/transcripts-logic.ts` exporting transport-agnostic fns `(session, params, callbacks?) => Promise<…>` for list/switch/insertAndSwitch that route **all** backends through `session.getReadExecutor()/getWriteExecutor()` (RC-10: the SQLite executor already serves these tasks; `session.ts:15` mandates it). **No `db.transcripts.*`, no `capabilities.backend` branch.** `handlers/transcripts.ts` and `routes/transcripts.ts` both import these; the route keeps only HTTP/validation concerns. In the **same task**, remove `transcripts` from `PENDING_SHARED_LOGIC_EXTRACTION` so the gate enforces it. Commit order keeps every commit green: S1 lands with all six allowlisted (no-op), then S3 extracts + de-lists transcripts. |
| **S4: Gate + parity + CI green** | gates | `transcripts` passes the behavioural gate (both import the symbol); the `transcripts` parity scenarios pass; `make ci-full` + `VARLENS_WEB=1 make ci` green. |

### PR-2 — `feat/web-shared-logic-panels-annotations`

The two B6 flagships.

| Sub-item | Ref | Summary |
|---|---|---|
| **P1: Extend the `panels` parity scenario** | B6, RC-4 | Extend `parity/ipc/panels.ts` with `panels:get` (assert the `{ ...panel, genes }` shape — the B6 genes-payload bug) and `panels:update` (assert `[id, {name,description,version}]` shaping → returned value equal across transports). |
| **P2: Migrate `panels` route to `panels-logic`** | RC-3, RC-4 | Move the two-call merge and the update-arg unpacking out of `routes/panels.ts` into a `panels-logic` function (extend the existing module, keep it ≤600 LOC; split by operation if needed). Web route + desktop handler both call it. Remove `panels` from `PENDING_SHARED_LOGIC_EXTRACTION`. |
| **P3: Extend the `annotations` parity scenario + add targeted event tests** | B6, RC-4, RC-9a | Extend `parity/ipc/annotations.ts` with returned-value coverage of `annotations:upsertPerCase`, `annotations:upsertGlobal` (write+audit atomicity: audit row present iff write committed — assert via a follow-up read in the scenario), `annotations:getForVariant`, `annotations:getGlobal`. **Event-emission/scope is NOT parity-harness-observable** (RC-9a) → add **targeted adapter/handler unit tests** asserting the injected event callback fires once with the correct `kind` on each transport. |
| **P4: Migrate `annotations` route to `annotations-logic`** | RC-3, RC-4, RC-5 | Move `detectAnnotationChangeKind` and the per-case event emission into `annotations-logic` behind an **event callback** the transport supplies (desktop → `broadcastAnnotationChanged`; web → `events.publish(userId, …)`). Keep the composite `*WithAudit` write-tasks (do not re-split write/audit). Web route keeps only validation + the SSE callback. Remove `annotations` from the allowlist. |
| **P5: Gate + parity + CI green** | gates | Behavioural gate passes for both; parity scenarios pass; `make ci-full` + `VARLENS_WEB=1 make ci` green. |

### PR-3 — `feat/web-shared-logic-variants-cohort-export`

The remainder, then strict gate.

| Sub-item | Ref | Summary |
|---|---|---|
| **V1: `variants` parity + migration** | B6, RC-4, F2 | Extend `parity/ipc/variants.ts` for `variants:search` (return shape matches the contract — the B6 envelope-vs-`Variant[]` divergence). Then bring **every** `variants` override key to gate-passing: `variants:search` → `variants-logic`; for `variants:query`/`variants:columnMeta`/`variants:getFilterOptions`, either confirm they are pure executor pass-throughs (gate branch (a)) or route them through `variants-logic` if the desktop handler does extra orchestration. Remove `variants` from the allowlist. |
| **C1: `cohort` parity + migration** | RC-4 | Extend `parity/ipc/cohort.ts` for the five `cohort` override methods (`exec=5` in `routes/cohort.ts`), incl. any cache-rebuild side effect (modelled as a `CohortCallbacks` injection; web-only staleness pings stay in the route as documented transport concerns, OQ-4). Bring every cohort override key to gate-passing via `cohort-logic`. Remove `cohort` from the allowlist. |
| **E1: `export` parity + migration** | RC-6, F1 | `export:variants` and `export:cohort` are **overridden** (`routes/export.ts:19,41`), so the override is the live path despite `READ_TASK_TYPES` membership (RC-6). Bring both override keys to gate-passing: route through `export-logic` (via `ExportCallbacks`) **or**, if each override is already a pure single-executor pass-through with the same task key, confirm it satisfies gate branch (a). Remove `export` from the allowlist. |
| **G1: Flip the gate strict** | B7, RC-8 | `PENDING_SHARED_LOGIC_EXTRACTION` is now empty; assert it is empty (the gate is strict for the six). Any future override for these domains must be backed by a shared symbol or the test fails. |
| **G2: Full gates** | gates | `make ci-full` + `VARLENS_WEB=1 make ci` green; the full parity suite (all six domains) passes under the gated env. |

---

## Open Questions (resolve at task time — each has a default so the plan is executable)

| # | Question | Default (used if unresolved) | Resolved by |
|---|---|---|---|
| **OQ-1** | How does the per-override-key gate analyse handler bodies (pass-through vs. calls-logic-export, RC-8/F2)? | **`ts-morph`** — the per-key predicate ("only non-validation action is one `executor.execute({type:<key>})`" vs. "calls a named `<domain>-logic` export") requires AST, not regex; a file-level regex import check is exactly the false-positive F2 flagged. Precedent: `tests/web-gate/auth-isolation.test.ts` already uses `ts-morph` static analysis. Keep the cheap regex set-pinning for the *module-set* guard. | PR-1 / S1 |
| **OQ-2** | Consolidate each migrated domain onto `src/shared/api/schemas/<domain>.ts` (RC-7)? | **Opportunistic only** — share whatever schema symbol the desktop handler already validates against; move to `shared/api/schemas` only where it's a zero-behaviour-change re-export. No schema migration project. | per-domain PR |
| **OQ-3** | Do the parity scenarios run in required CI or stay opt-in gated (RC-9)? | **Stay opt-in** (`VARLENS_RUN_WEB_GATE_PARITY=1 && VARLENS_RUN_WEB_PARITY_E2E=1`, needs PG + Electron build) exactly as today; the **behavioural-static** gate (S1) is the always-on required signal. Document the gated command in the PR body and run it locally per PR. | PR-1 / S1 |
| **OQ-4** | `cohort` cache-rebuild side effects — model as a `CohortCallbacks` injection or leave in the route? | **Callback injection** (RC-3 pattern) so the side effect is declared, not duplicated; if a side effect is genuinely web-only (SSE staleness ping), it stays in the route as a documented transport concern. | PR-3 / C1 |

---

## Non-goals (defer / out)

- **No storage-executor contract change.** Chosen shape is shared operation modules, not pushing orchestration into the read/write executors (the alternative considered and rejected for blast-radius).
- **No row-level / tenant-level multi-user data scoping.** Remains a narrow-hardening non-goal (B2 stays accepted single-admin; `auth:createUser` stays disabled). This refactor does not touch the auth boundary.
- **No new public REST / OpenAPI vocabulary.** The dispatcher RPC shape and `/api/<domain>/<method>` surface are unchanged.
- **No migration of the legitimately web-only adapters** — `auth` (cookie/session boundary), `audit-log` (admin-gated audit-trail read adapter; already an audited override per `handler-seam.test.ts`), `import`/`batch-import`/`upload-staging` (browser-upload refs), `region-files` (server-path guard), `gene-ref`/`hpo`/`protein`/`vep` (web mode disables external fetches by design), and trivial single-executor pass-throughs (`cases`, `case-metadata`, `gene-lists`, `analysis-groups`, `database`). These stay thin adapters; the seam test's exception allowlist documents each.
- **No Electron behaviour change.** Desktop SQLite and Postgres paths must be byte-for-byte unchanged (the refactor-checkpoint + main suites are the trip-wire).
- **No schema-migration project** (OQ-2 default).

---

## Acceptance gates

Every gate maps 1:1 to a verification step in the plan.

1. **Behavioural seam (always-on, per override key):** `handler-seam.test.ts` asserts every override **key** of a migrated domain is either a pure single-executor pass-through with the same task key, or calls a `<domain>-logic` export the desktop handler also calls (S1/F2). The `PENDING_SHARED_LOGIC_EXTRACTION` allowlist is monotonic-decrease and ends empty (PR-3). A route that re-implements orchestration for any single method fails the test.
2. **transcripts:** `transcripts-logic.ts` exists; desktop handler + web route both import it; SQLite-desktop / Postgres-desktop / Postgres-web all served by the one module; `transcripts:switch` parity scenario shows the parent `variants` row reflects the switch on both transports.
3. **panels:** `panels:get` returns `{ ...panel, genes }` and `panels:update` shapes `[id, {…}]` identically on desktop and web, both via `panels-logic`; parity scenarios pass.
4. **annotations:** both transports go through `annotations-logic`; write+audit atomicity preserved (`*WithAudit` task) and returned-value parity scenarios pass; the per-case change event firing once with the correct `kind` via the injected callback is verified by **targeted adapter/handler unit tests** (not the parity harness, RC-9a).
5. **variants:** `variants:search` return shape matches the IPC contract on both transports via `variants-logic`; parity scenario passes.
6. **cohort:** the five cohort overrides go through `cohort-logic` with cache side effects modelled as callbacks; parity scenarios pass.
7. **export:** the overridden `export:variants`/`export:cohort` keys (RC-6/F1 — overridden, not autorouted) pass the per-key gate, via `export-logic` or as confirmed pure pass-throughs; parity scenarios pass.
8. **Strict gate:** `PENDING_SHARED_LOGIC_EXTRACTION` is empty and asserted empty; the six domains can no longer re-implement orchestration without a test failure.
9. **No-contract-change:** `tests/shared/types/preload-contract.test.ts`, the refactor-checkpoint suite, and the desktop main/renderer suites pass unchanged (no IPC/executor/renderer behaviour change).
10. **CI:** `make ci-full` green per PR; `VARLENS_WEB=1 make ci` green per PR; `make agent-check` clean (no migrated `*-logic.ts` over 600 LOC without justification).

---

## PR shape

| PR | Branch | Tasks | Conventional title | Depends on |
|---|---|---|---|---|
| **PR-1** | `feat/web-shared-logic-seam-and-transcripts` | S1–S4 | `refactor(web): behavioural handler seam + share transcripts logic across transports` | — |
| **PR-2** | `feat/web-shared-logic-panels-annotations` | P1–P5 | `refactor(web): share panels + annotations logic across transports` | PR-1 |
| **PR-3** | `feat/web-shared-logic-variants-cohort-export` | V1, C1, E1, G1, G2 | `refactor(web): share variants/cohort/export logic; strict transport seam` | PR-2 |

Sequenced (each builds on the prior's gate state). Not parallel — they share `handler-seam.test.ts` and the parity scenario registry.

## Project-rule constraints (all PRs)

- **Branch discipline.** No feature work on `main` (`AGENTS.md`). Each PR on its own branch; worktrees if a clean checkout is needed.
- **No `console.*`.** New `*-logic.ts` uses `mainLogger`; routes use the existing web error envelope. Logic modules stay free of Electron/Fastify imports (RC-3: `annotations-logic` already enforces this).
- **DRY / cohort parity / never-lower-thresholds.** `feedback_dry_principles.md` is the entire thesis here (one implementation, two transports). Do not weaken any gate to land a PR; fix the code.
- **LLM-sustainable size.** Migrated `*-logic.ts` stay ≤600 LOC (`cohort-logic.ts` is already 447 — split by operation if folding web orchestration would exceed the bar). `make agent-check` before each PR.
- **Preserve `IpcResult`/`SerializableError` envelope** (RC-5). Logic throws; desktop `wrapHandler` and web `invokeAsIpcResult` convert. Routes invent no new success/error shapes.
- **`.planning/` for specs/plans/artifacts.** Parity artifacts under `.planning/artifacts/web/parity/` are gitignored; numbers live in PR bodies.

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Extracting `transcripts-logic` from a backend-branching inline handler changes desktop SQLite behaviour. | Parity + refactor-checkpoint + main suites written/run before extraction; the `session.capabilities.backend` branch is preserved verbatim (RC-10). | Revert PR-1; transcripts handler is in git history. |
| Annotation write+audit atomicity regresses when moving event logic into shared logic. | Keep the composite `*WithAudit` write-tasks (RC-4); parity scenario asserts audit-row-iff-committed (gate 4). | Revert P4; the route's current path stands. |
| `cohort-logic.ts` exceeds 600 LOC after folding web orchestration. | Split by operation into helper fns/modules; `make agent-check` gate (gate 10). | Land the split as its own commit within PR-3. |
| The behavioural gate produces false positives (regex import matching). | OQ-1 default regex; escalate to `ts-morph` (precedent: `auth-isolation.test.ts`) if needed. | Loosen the regex; the allowlist still constrains scope. |
| Parity harness env is heavy (PG + Electron build) and not in required CI. | OQ-3: behavioural-static gate is the always-on signal; parity is gated and run locally per PR with the documented command. | N/A — parity is advisory-but-required-per-PR, not a CI blocker. |

## References

- `.planning/code-review/pr-202-web-pilot-strategy-review.md` — B6/B7/B8/B9, F1
- `.planning/specs/2026-06-13-web-narrow-hardening.md` — the predecessor that deferred this
- `.planning/web/context/decisions/adr/0002-parallel-maintainability.md` — "single codebase, two transports; domain logic in one module both import"
- `src/web/server/dispatcher.ts` (override + autoroute + `invokeAsIpcResult`), `src/web/server/task-types.ts` (read/write task sets, `toTaskDomain`)
- `src/web/server/routes/{transcripts,panels,annotations,variants,cohort,export}.ts` — the routes to thin out
- `src/main/ipc/handlers/{panels,annotations,variants,cohort,export}-logic.ts` — the shared modules to extend; `handlers/transcripts.ts` — the module to extract from
- `tests/web-gate/handler-seam.test.ts` (the gate to upgrade), `tests/web-gate/parity/ipc-fixture-parity.test.ts` + `parity/ipc/scenarios.ts` (the harness to extend)
- `AGENTS.md`, `CLAUDE.md`; memory `feedback_dry_principles.md`, `feedback_never_lower_thresholds.md`, `feedback_cohort_parity.md`
