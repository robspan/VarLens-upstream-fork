# Priority 1 Maintainability Next Phase — Design Spec

**Date:** 2026-04-16
**Primary driver:** `.planning/code-review/CODEBASE-REVIEW-2026-04-15.md`
**Supporting inventory:** `.planning/plans/2026-04-02-ipc-testability-error-standardization.md`
**Goal:** Finish the remaining Priority 1 maintainability work by completing the domain-first IPC rollout across the remaining modules and standardizing renderer-side handling of wrapped IPC failures across the remaining domains, without reopening maintainability work that is already complete.

---

## Problem Statement

The 2026-04-15 codebase review identifies IPC contract maintenance as the main remaining maintainability hotspot in an otherwise solid application architecture. The codebase already has meaningful progress in this area:

- several IPC domains already use extracted `*-logic.ts` modules
- `safeEmit` has already been centralized
- the renderer shell has already been partially decomposed through shared app-state infrastructure

The remaining gap is not a missing pattern. The gap is incomplete rollout and inconsistent usage. Some domains already follow the intended domain-first structure, while others still mix handler orchestration, business logic, preload contract drift, and renderer-side wrapped-error branching in ways that increase change cost and review overhead.

The renderer-side gap is broader than a handful of visible ad hoc checks. In the current tree:

- `wrapHandler` is used across 30 handler files in `src/main/ipc/handlers/`
- the preload layer is largely a thin `ipcRenderer.invoke(...)` pass-through
- only 7 renderer files currently call `isIpcError(...)`
- `unwrapIpcResult(...)` already exists in `src/shared/types/errors.ts` and is used by 0 renderer files

That means the maintainability issue is not only "replace a few bad checks." The larger problem is that many renderer call sites still treat wrapped IPC channels as if they either succeed with `T` or throw a JavaScript exception, even though the transport contract is `T | SerializableError`. This phase therefore includes both explicit ad hoc guard cleanup and wider transport-error handling standardization across the remaining scoped domains.

This phase exists to finish that rollout cleanly and declare Priority 1 maintainability complete for the IPC/error-standardization track.

---

## Scope

### In Scope

This phase is maintainability-only and includes exactly two delivery tracks:

1. Complete the domain-first IPC rollout across the remaining eligible modules.
2. Standardize renderer-side handling of wrapped IPC failures across the remaining domains.

This phase may include:

- extracting pure `*-logic.ts` modules from remaining orchestration-heavy IPC handlers
- tightening shared typing so `wrapHandler`-backed APIs are represented consistently at the shared contract layer
- organizing preload bindings and renderer client usage so domain ownership is easier to trace
- replacing remaining ad hoc wrapped-error checks in renderer code with one standard pattern
- adding targeted tests that protect the maintainability refactor without changing product behavior

### Out of Scope

The following are explicitly out of scope for this phase:

- new product features
- renderer shell decomposition follow-up work
- filter query-shaping ownership consolidation
- PostgreSQL, hosted backend, or database dialect abstraction work
- broad IPC API redesign beyond what is required to finish the remaining domain-first structure
- converting intentional domain result unions such as `{ success, error }` into transport-layer error unions

The filter query-shaping ownership task remains an important maintainability item from the 2026-04-15 review, but it is deferred to the next maintainability phase so this phase can close quickly and predictably.

---

## Closed / Already Completed Priority 1 Work

This phase must preserve already-completed Priority 1 maintainability work as closed and out of scope. The spec assumes the following are already done enough that they should not be reopened except where a remaining domain depends on them incidentally:

- shared `safeEmit` utility introduction
- existing `*-logic.ts` extraction work already present in `src/main/ipc/handlers/`
- current shell/app-state decomposition work already present in the renderer
- previous testability and IPC hardening work that is already merged on `main`

If implementation discovers a local inconsistency in one of these completed areas, it may adapt to that reality, but it should not expand the phase into a second redesign of completed work.

---

## Design Principles

### 1. Finish the pattern already in the tree

This phase should extend the maintainability pattern that already exists instead of introducing a new abstraction framework. VarLens already uses explicit Electron preload bindings, explicit handler registration, and selective logic extraction. The correct next move is consistent rollout, not replacement.

### 2. One maintainability owner per IPC domain

Each remaining eligible domain should be understandable as a unit. For planning and implementation purposes, a domain owns:

- its shared request/response types and any schema-backed IPC boundary validation
- its preload exposure surface
- its main-process handler registration
- any extracted pure logic needed to keep handler files thin
- its renderer-side client/error-handling usage pattern

This does not mean every concern must live in one file. It means contract edits should stay local to one domain slice rather than requiring broad, manual synchronization across unrelated modules.

### 3. Thin handler shells, but only where it pays off

Pure logic extraction is required only for remaining orchestration-heavy handlers. Thin proxy handlers with trivial behavior do not need forced extraction. The phase is maintainability-driven, not purity-driven.

### 4. Standardize wrapped IPC failures without erasing domain unions

This phase distinguishes two valid result families:

- transport-level wrapped failures produced by `wrapHandler` and represented as `SerializableError`
- intentional domain result unions such as `{ success: boolean, error?: string }`

The first family is in scope for renderer-side standardization. The second remains domain-specific and should not be force-converted during this phase.

### 5. Fix the preload typing gap at the contract boundary

The preload bridge is the main place where transport-error drift becomes invisible to the renderer. Many preload methods are thin pass-through `ipcRenderer.invoke(...)` calls, while shared API typings still advertise bare success values for channels that are actually `IpcResult<T>`.

This phase should therefore treat preload/shared contract tightening as a first-class deliverable for `wrapHandler`-backed channels in scope. Where a channel returns `T | SerializableError` at runtime, the renderer-visible contract should encode `IpcResult<T>` so TypeScript pushes callers toward the correct boundary pattern instead of silently permitting unsafe success-only assumptions.

### 6. Inventory first, refactor second

The plan should derive from the live tree, not from historical assumptions. The older 2026-04-02 plan is a candidate task inventory only. Actual work is determined by the current codebase state.

---

## Domain-First IPC Target State

For each remaining eligible IPC domain, the maintainability target state is:

1. The handler file is primarily an IPC boundary shell.
2. Non-trivial business or orchestration logic is extracted into a pure companion module where needed.
3. Shared types reflect the real request/response contract of the domain.
4. Preload exposure for that domain remains explicit and grouped predictably.
5. Renderer usage for that domain follows one standard wrapped-error handling pattern where applicable.

The target state is intentionally practical. A domain does not need to be perfectly isolated to count as complete. It does need to be consistent enough that a future change to that domain does not require hunting through unrelated files to reconstruct the contract.

---

## Eligible Domain Classification

Before implementation work begins, each IPC domain must be classified into one of four buckets:

### Bucket A: Closed / Already Aligned

The domain already matches the intended maintainability pattern closely enough. No work is planned beyond incidental adjustments caused by adjacent changes.

### Bucket B: Handler / Logic Extraction Remaining

The domain still mixes IPC shell code and meaningful business orchestration in ways that make tests or maintenance costly. It needs a thin-shell extraction pass, but renderer-side wrapped-error handling is already acceptable or not applicable.

### Bucket C: Renderer Error Standardization Remaining

The domain’s main/preload/shared structure is acceptable, but renderer call sites still use ad hoc wrapped-error checks or inconsistent unwrap patterns.

### Bucket D: Both Remaining

The domain still needs both structure cleanup and renderer-side wrapped-error standardization.

This classification is part of the implementation input and must be captured in the plan so already-aligned domains are not reopened.

---

## Renderer-Side Error Standardization

### Standard Rule

For `wrapHandler`-backed channels, renderer code in this phase must standardize on `unwrapIpcResult(...)` from `src/shared/types/errors.ts` as the single transport-error boundary pattern. Ad hoc checks such as:

- `'error' in result`
- `'code' in result`
- `'userMessage' in result`
- property branching that reconstructs the same guard by hand
- `try/catch` blocks that assume `await api.*` throws on transport failure

should be removed from the remaining domains in scope.

`unwrapIpcResult(...)` already exists, throws the received `SerializableError`, and fits the desired renderer control flow: callers can unwrap the transport result immediately after the API call and let their existing `catch` paths handle the thrown error object naturally.

### Non-Goals

This phase must not misclassify domain-level result unions as transport-level wrapped errors. Code that intentionally checks `result.success` or `result.error` for a domain-defined return type is not automatically a bug and should remain unless the contract itself is changed for another reason.

---

## Shared Contract Expectations

Where a domain is backed by `wrapHandler`, the shared API contract should make that explicit enough that renderer callers are pushed toward correct handling rather than assuming a bare success value.

For the domains in scope, this means the preload-exposed `WindowAPI` contract should encode `IpcResult<T>` for `wrapHandler`-backed channels rather than advertising bare `Promise<T>` success types. The goal is to reduce contract drift and manual reasoning, not to perform a full shared-type rewrite of every channel in one pass.

---

## Testing Strategy

This phase is a maintainability refactor and should preserve user-visible behavior. Testing should therefore focus on protecting boundaries and proving consistency:

- add logic tests for any newly extracted pure domain logic
- keep existing handler tests where they cover IPC-specific behavior such as registration, validation, or wrapper behavior
- add targeted renderer or composable tests for standardized wrapped-error handling in remaining domains
- run typecheck and relevant test suites to confirm no contract regressions
- use targeted lint coverage if new guard/helper conventions are enforced

Tests should be added only where they protect the maintainability change. This is not a blanket coverage campaign.

---

## Risks and Controls

### Risk: Reopening already-completed maintainability work

Control:
Use the domain classification pass to mark closed domains explicitly before any refactor tasks are written.

### Risk: Conflating transport errors with domain result unions

Control:
Treat `wrapHandler`-backed transport failures and intentional domain `{ success, error }` results as separate categories throughout the plan and implementation.

### Risk: Overscoping into shell, filter, or database redesign

Control:
Keep the phase limited to the two delivery tracks in scope and record deferred maintainability items explicitly rather than absorbing them.

### Risk: Contract drift between shared types, preload, and renderer consumers

Control:
Plan work by domain and keep each domain’s shared contract, preload binding, and renderer usage changes together.

### Risk: Inventory reveals a phase that is still too large to close predictably

Control:
Use a scope circuit-breaker during planning. If the live-tree inventory places more than 12 domains into Buckets B, C, or D combined, the implementation plan must split execution into explicit sub-phases instead of absorbing the entire backlog into one pass. Renderer migration volume should be used as a supporting signal when sequencing those sub-phases.

---

## Completion Criteria

Priority 1 maintainability is considered complete for this phase when all of the following are true:

1. Every remaining eligible IPC domain has been classified from the live tree.
2. Every domain not classified as closed has a bounded implementation task in the plan.
3. Remaining renderer call sites for wrapped IPC failures in the scoped domains use the standardized pattern.
4. Newly extracted logic, where needed, is covered by targeted tests.
5. Already-completed Priority 1 work is explicitly preserved as closed/out of scope.
6. Filter query-shaping ownership consolidation is recorded as the next maintainability phase rather than left ambiguous.

---

## Deferred Follow-Up

The next maintainability phase after this one should address filter query-shaping ownership consolidation, which the 2026-04-15 review correctly identifies as a real maintainability issue. It is intentionally deferred so this phase can finish the remaining IPC/domain maintainability work quickly and get those changes into production without coupling them to a broader renderer-state refactor.
