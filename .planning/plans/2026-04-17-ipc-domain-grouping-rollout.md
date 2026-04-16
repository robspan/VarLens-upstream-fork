# IPC Domain Grouping Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remaining 23 IPC handlers to the domain-module pattern (`src/shared/ipc/domains/<name>.ts` + `src/preload/domains/<name>.ts` + `src/main/ipc/domains/<name>.ts`), ending the "two-tier IPC codebase" noted in the 2026-04-16 Priority 1 closeout.

**Architecture:** Each handler gets a 3-file domain triple plus a per-domain preload test, created in Wave 1 entirely as **new files** (zero file-level conflicts → fully parallel). A single serial Wave 2 reconciles the two aggregator files (`src/preload/index.ts`, `src/main/ipc/index.ts`) and `src/shared/types/api.ts` type aliases. Wave 3 is verification. Wave 4 updates the inventory artifact.

**Tech Stack:** TypeScript 6, Electron 40, Vitest 4, existing `wrapHandler` + `IpcResult<T>` infrastructure (no library additions).

**Parallelization & model plan:**

- Wave 1 — 23 handler migrations. **Model: Haiku 4.5.** Each task creates 4 new files in disjoint paths. Dispatch **6–8 at a time** (respecting rate limits) until all 23 are done. Each task commits atomically.
- Wave 2 — 1 aggregator reconciliation. **Model: Sonnet 4.6.** Touches shared files; must be serial.
- Wave 3 — verification. **Model: Sonnet 4.6.** Runs `make ci-full` and reports.
- Wave 4 — inventory update. **Model: Haiku 4.5.** Edits one artifact file.

**Branch / worktree:** Work on `feat/ipc-domain-grouping` (new branch off `main`). Subagents may optionally use worktrees, but because Wave 1 creates only new files in disjoint paths there are no merge conflicts — a shared branch with per-task commits is sufficient. If concurrent `git commit` locks become a bottleneck, fall back to worktrees (one per handler) and batch-merge at the end of Wave 1.

**Spec sources:**
- `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md` (per-handler disposition)
- `.planning/code-review/CODEBASE-REVIEW-2026-04-16.md` (Priority A context)
- Live examples: `src/{shared/ipc,preload,main/ipc}/domains/{cases,database,filter-presets}.ts`
- Test harness: `tests/shared/types/preload-contract.test.ts`

---

## File structure

### New files (Wave 1, per migrated handler `<name>`)

| File | Responsibility |
|---|---|
| `src/shared/ipc/domains/<name>.ts` | Exports `<Name>DomainContract` interface. Every method returns `Promise<IpcResult<T>>`. Imports types from existing shared modules — does NOT redeclare. |
| `src/preload/domains/<name>.ts` | Exports `create<Name>Api(): <Name>DomainContract`. Single `ipcRenderer.invoke(channel, args)` per method. **Must NOT contain `unwrapIpcResult`** (preload stays raw; unwrapping is the renderer's edge concern). |
| `src/main/ipc/domains/<name>.ts` | Exports `register<Name>Domain(ipcMain: IpcMain)` that calls the existing `register<Name>Handlers(deps)` from `src/main/ipc/handlers/<name>.ts`. Dependency injection (getDb, getDbPool, etc.) lives here. |
| `tests/preload/domains/<name>.test.ts` | Extract the per-domain behavior test from `tests/shared/types/preload-contract.test.ts` into its own file, following the `'<name> preload domain behavior'` describe block pattern already present for `cases`. Mocks `electron`, invokes the factory, asserts channel+arg forwarding. |

### Modified files (Wave 2 only — one task, touches each once)

| File | What changes |
|---|---|
| `src/preload/index.ts` | Add 23 `import { create<Name>Api } from './domains/<name>'` lines. Replace each handler's inline `ipcRenderer.invoke(...)` block in the `const api = { ... }` object with `<name>Domain.method(...)` calls, typed via `as WindowAPI['<name>']`. |
| `src/main/ipc/index.ts` | Add 23 `import { register<Name>Domain } from './domains/<name>'` lines. Replace each handler's inline `register<Name>Handlers({ ipcMain, … })` call with `register<Name>Domain(ipcMain)`. Keep the 4 already-closed handlers (`shell`, `system`, `shortlist`, `updater`) as-is. |
| `src/shared/types/api.ts` | For each migrated domain, replace the inline `export interface <Name>API { … }` with `export type <Name>API = <Name>DomainContract` and import the contract. Mirrors the existing pattern already applied to `CasesAPI`. |

### Modified files (Wave 4)

| File | What changes |
|---|---|
| `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md` | Mark all 23 handlers as completed; update the circuit-breaker count to 0; add closeout note with the PR number. |

---

## The 23 handlers (Wave 1 matrix)

Ordered alphabetically. `<Name>` column shows the PascalCase identifier used in `create<Name>Api` / `<Name>DomainContract` / `register<Name>Domain`. `channel-prefix` is what `ipcRenderer.invoke('<prefix>:<method>', …)` uses — match the existing handler file exactly.

| # | `<name>` | `<Name>` | channel-prefix | handler file | logic file |
|---:|---|---|---|---|---|
| 1 | `analysis-groups` | `AnalysisGroups` | `analysis-groups` | `src/main/ipc/handlers/analysis-groups.ts` | — |
| 2 | `annotations` | `Annotations` | `annotations` | `src/main/ipc/handlers/annotations.ts` | `annotations-logic.ts` |
| 3 | `audit-log` | `AuditLog` | `audit-log` | `src/main/ipc/handlers/audit-log.ts` | — |
| 4 | `auth` | `Auth` | `auth` | `src/main/ipc/handlers/auth.ts` | `auth-logic.ts` |
| 5 | `batch-import` | `BatchImport` | `batch-import` | `src/main/ipc/handlers/batch-import.ts` | `batch-import-logic.ts` |
| 6 | `case-comments` | `CaseComments` | `case-comments` | `src/main/ipc/handlers/case-comments.ts` | — |
| 7 | `case-metadata` | `CaseMetadata` | `case-metadata` | `src/main/ipc/handlers/case-metadata.ts` | `case-metadata-logic.ts` |
| 8 | `case-metrics` | `CaseMetrics` | `case-metrics` | `src/main/ipc/handlers/case-metrics.ts` | — |
| 9 | `cohort` | `Cohort` | `cohort` | `src/main/ipc/handlers/cohort.ts` | `cohort-logic.ts` |
| 10 | `export` | `Export` | `export` | `src/main/ipc/handlers/export.ts` | `export-logic.ts` |
| 11 | `gene-lists` | `GeneLists` | `gene-lists` | `src/main/ipc/handlers/gene-lists.ts` | — |
| 12 | `gene-ref` | `GeneRef` | `gene-ref` | `src/main/ipc/handlers/gene-ref.ts` | — |
| 13 | `gnomad` | `Gnomad` | `gnomad` | `src/main/ipc/handlers/gnomad.ts` | — |
| 14 | `hpo` | `Hpo` | `hpo` | `src/main/ipc/handlers/hpo.ts` | — |
| 15 | `import` | `Import` | `import` | `src/main/ipc/handlers/import.ts` | `import-logic.ts`, `import-logic-append.ts` |
| 16 | `myvariant` | `Myvariant` | `myvariant` | `src/main/ipc/handlers/myvariant.ts` | — |
| 17 | `panels` | `Panels` | `panels` | `src/main/ipc/handlers/panels.ts` | `panels-logic.ts` |
| 18 | `protein` | `Protein` | `protein` | `src/main/ipc/handlers/protein.ts` | — |
| 19 | `spliceai` | `Spliceai` | `spliceai` | `src/main/ipc/handlers/spliceai.ts` | — |
| 20 | `tags` | `Tags` | `tags` | `src/main/ipc/handlers/tags.ts` | `tags-logic.ts` |
| 21 | `transcripts` | `Transcripts` | `transcripts` | `src/main/ipc/handlers/transcripts.ts` | — |
| 22 | `variants` | `Variants` | `variants` | `src/main/ipc/handlers/variants.ts` | `variants-logic.ts` |
| 23 | `vep` | `Vep` | `vep` | `src/main/ipc/handlers/vep.ts` | — |

**Channel-prefix mismatch check:** `filter-presets` uses `presets:*` (not `filter-presets:*`). Before starting a task, `grep -E "ipcMain\.handle\('\w" src/main/ipc/handlers/<name>.ts` to confirm the actual prefix. Update the contract to match reality, not the handler filename.

**Existing cases already migrated (reference only, do not touch):** `cases`, `database`, `filter-presets`, `shell`, `system`, `shortlist`, `updater`.

---

## Task 0: Create feature branch and read the pattern

**Files:**
- Read (reference): `src/shared/ipc/domains/cases.ts`, `src/preload/domains/cases.ts`, `src/main/ipc/domains/cases.ts`, `src/main/ipc/handlers/cases.ts`
- Read (reference): `tests/shared/types/preload-contract.test.ts` lines 409–499

- [ ] **Step 1: Create the feature branch**

Run:
```bash
git checkout main
git pull --ff-only
git checkout -b feat/ipc-domain-grouping
```

Expected: clean checkout, branch `feat/ipc-domain-grouping` created.

- [ ] **Step 2: Confirm baseline is green**

Run:
```bash
make rebuild-node && make typecheck && make test
```

Expected: typecheck 0 errors; tests all pass (228 files, 2972 tests as of 2026-04-16; run `make rebuild-node` first or you will see an `ERR_MODULE_NOT_FOUND` on `out/main/db-worker.js`).

If any test fails, STOP and fix baseline before Wave 1.

- [ ] **Step 3: Commit**

No changes to commit at this step. Proceed to Wave 1.

---

## Task 1 (Template, parallelizable): Migrate handler `<name>` to domain-module pattern

> **Orchestrator note:** Dispatch 23 subagents in parallel (6–8 at a time). Each subagent gets this task body with `<name>`, `<Name>`, `<channel-prefix>`, and `<handler-path>` substituted from the matrix above. Example substitutions shown use `annotations`.

**Files:**
- Create: `src/shared/ipc/domains/<name>.ts`
- Create: `src/preload/domains/<name>.ts`
- Create: `src/main/ipc/domains/<name>.ts`
- Create: `tests/preload/domains/<name>.test.ts`
- Read: `src/main/ipc/handlers/<name>.ts` (to enumerate channels and method signatures)
- Read: `src/shared/types/api.ts` (for the existing `<Name>API` interface shape — do NOT modify in this task)

- [ ] **Step 1: Enumerate the handler's channels and signatures**

Run:
```bash
grep -nE "ipcMain\.(handle|on)\(" src/main/ipc/handlers/<name>.ts
```

Record: each `<channel-prefix>:<method>` string, each method's parameter types, and the unwrapped return type (what the inner function in `wrapHandler(() => …)` returns — the `IpcResult<T>` wrapping is added by `wrapHandler`, so your domain contract declares `Promise<IpcResult<T>>`).

Also run:
```bash
grep -nE "^\s+(\w+)(\?|)\s*:\s*\(" src/shared/types/api.ts | grep -iA1 "<Name>API"
```

Cross-check method names with the existing `<Name>API` interface in `src/shared/types/api.ts`. The two must agree — contract extracts what `api.ts` already promises.

- [ ] **Step 2: Write the domain contract**

Create `src/shared/ipc/domains/<name>.ts`:

```typescript
// Example for <name>=annotations. Substitute types from the existing AnnotationsAPI interface.
import type {
  VariantAnnotationsUpsert,
  VariantAnnotations,
  VariantTagsUpdate
  // …any other types referenced by the existing AnnotationsAPI
} from '../../types/annotations' // or wherever they already live
import type { IpcResult } from '../../types/errors'

export interface AnnotationsDomainContract {
  // One method per channel. Copy signatures from src/shared/types/api.ts AnnotationsAPI,
  // wrapping the return type in IpcResult<T>:
  get: (variantKey: string) => Promise<IpcResult<VariantAnnotations | null>>
  upsert: (payload: VariantAnnotationsUpsert) => Promise<IpcResult<VariantAnnotations>>
  updateTags: (payload: VariantTagsUpdate) => Promise<IpcResult<void>>
  // … one per channel from Step 1
}
```

- [ ] **Step 3: Write the preload factory**

Create `src/preload/domains/<name>.ts`:

```typescript
import { ipcRenderer } from 'electron'
import type { AnnotationsDomainContract } from '../../shared/ipc/domains/annotations'

export function createAnnotationsApi(): AnnotationsDomainContract {
  return {
    get: (variantKey) => ipcRenderer.invoke('annotations:get', variantKey),
    upsert: (payload) => ipcRenderer.invoke('annotations:upsert', payload),
    updateTags: (payload) => ipcRenderer.invoke('annotations:updateTags', payload)
    // … one per channel
  }
}
```

**Hard requirements:**
- No `unwrapIpcResult` in this file (the preload-contract test fails otherwise).
- No business logic — pure channel forwarding.
- Argument names must match the contract interface (TypeScript will fail otherwise).

- [ ] **Step 4: Write the main-side registration wrapper**

Create `src/main/ipc/domains/<name>.ts`:

```typescript
// Pattern A (handlers that only need getDb/getDbPool):
import type { IpcMain } from 'electron'
import { getDatabaseService } from '../../database'
import { getDbPool } from '../dbPoolManager'
import { registerAnnotationsHandlers } from '../handlers/annotations'

export function registerAnnotationsDomain(ipcMain: IpcMain): void {
  registerAnnotationsHandlers({
    ipcMain,
    getDb: getDatabaseService,
    getDbPool
  })
}
```

**Handler-dependency discovery:** Open the existing handler's `register<Name>Handlers` signature (`src/main/ipc/handlers/<name>.ts`, first `export function` around line 30). The `HandlerDependencies` fields it destructures are what you must pass through. For example, `cases` also needs `getDbManager`. Copy those exactly.

- [ ] **Step 5: Write the per-domain preload test**

Create `tests/preload/domains/<name>.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('annotations preload domain behavior', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
  })

  it('forwards all annotations domain channels without unwrapping', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ stars: 3 })
      .mockResolvedValueOnce({ stars: 4 })
      .mockResolvedValueOnce(undefined)
      // …one mock per channel, in the order the assertions below check

    vi.doMock('electron', () => ({
      ipcRenderer: { invoke }
    }))

    const { createAnnotationsApi } = await import('../../../src/preload/domains/annotations')
    const api = createAnnotationsApi()

    await expect(api.get('1:100:A:T')).resolves.toEqual({ stars: 3 })
    await expect(api.upsert({ variantKey: '1:100:A:T', stars: 4 })).resolves.toEqual({ stars: 4 })
    await expect(api.updateTags({ variantKey: '1:100:A:T', tags: ['vus'] })).resolves.toBeUndefined()

    expect(invoke).toHaveBeenNthCalledWith(1, 'annotations:get', '1:100:A:T')
    expect(invoke).toHaveBeenNthCalledWith(2, 'annotations:upsert', { variantKey: '1:100:A:T', stars: 4 })
    expect(invoke).toHaveBeenNthCalledWith(3, 'annotations:updateTags', { variantKey: '1:100:A:T', tags: ['vus'] })
  })
})
```

- [ ] **Step 6: Run the per-domain test**

Run:
```bash
make rebuild-node   # only if not already done in this shell session
npx vitest run tests/preload/domains/<name>.test.ts
```

Expected: all assertions pass. If TypeScript errors on imports, the contract or the logic file signatures don't match — re-check Step 1.

- [ ] **Step 7: Typecheck the new files**

Run:
```bash
npm run typecheck:renderer && npm run typecheck:node
```

Expected: 0 errors. If errors appear only in `src/shared/types/api.ts` claiming the domain contract doesn't match `<Name>API`, that is expected — Wave 2 fixes it. Proceed if the errors are confined to that file.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc/domains/<name>.ts \
        src/preload/domains/<name>.ts \
        src/main/ipc/domains/<name>.ts \
        tests/preload/domains/<name>.test.ts
git commit -m "refactor(ipc): add domain triple for <name>"
```

**Do NOT touch `src/preload/index.ts`, `src/main/ipc/index.ts`, or `src/shared/types/api.ts` in this task.** Those are Wave 2's responsibility. If you edit them now, parallel tasks will conflict.

---

## Task 2–23: Apply Task 1 to each remaining handler

Same task body as Task 1, substituting `<name>`, `<Name>`, and `<channel-prefix>` from the matrix above. Dispatch all 23 in parallel waves of 6–8.

The 23 `<name>` values: `analysis-groups, annotations, audit-log, auth, batch-import, case-comments, case-metadata, case-metrics, cohort, export, gene-lists, gene-ref, gnomad, hpo, import, myvariant, panels, protein, spliceai, tags, transcripts, variants, vep`.

**Handler-specific overrides** (discovered during `register<Name>Handlers` inspection — add to Step 4 as needed):

- `cohort`, `import`, `batch-import` — may need additional deps beyond `getDb`/`getDbPool`. Follow the existing handler's `HandlerDependencies` destructure.
- `auth` — may need `getDbManager`.
- `database` (already done) — shows the full-dependency pattern.

If a handler uses `safeEmit` callbacks (like `cases` with `deleteCallbacks`), the existing `register<Name>Handlers` already wires them — you do NOT rewire them in the domain file.

---

## Task 24: Aggregation — wire new domains into preload, main IPC, and api.ts

> **Serial task, run after all Wave 1 tasks have committed.** Sonnet-class model recommended; many careful edits in three shared files.

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/shared/types/api.ts`

- [ ] **Step 1: Pull all Wave 1 commits into the working tree**

Run:
```bash
git fetch
git status           # confirm no uncommitted changes
git log --oneline main..HEAD | wc -l   # expect 23 (or 23 + earlier task commits)
```

Expected: 23 new commits on `feat/ipc-domain-grouping`, each adding a domain triple + its test.

- [ ] **Step 2: Update `src/preload/index.ts`**

For each of the 23 migrated domains, make three edits:

1. Add the import near the existing `createCasesApi` imports (alphabetical):
   ```typescript
   import { createAnnotationsApi } from './domains/annotations'
   ```

2. Add the factory call near the existing `casesDomain = createCasesApi()` block:
   ```typescript
   const annotationsDomain = createAnnotationsApi()
   ```

3. Inside the `const api = { ... }` object, replace the existing inline `annotations: { get: (key) => ipcRenderer.invoke('annotations:get', key), … }` block with:
   ```typescript
   annotations: {
     get: (variantKey: string) => annotationsDomain.get(variantKey),
     upsert: (payload: VariantAnnotationsUpsert) => annotationsDomain.upsert(payload),
     updateTags: (payload: VariantTagsUpdate) => annotationsDomain.updateTags(payload)
     // …one per method
   } as WindowAPI['annotations'],
   ```

   Preserve the `as WindowAPI['<name>']` cast — it lets the preload object validate against the shared interface.

Repeat for all 23 domains. Keep `cases`, `database`, `filter-presets` exactly as they are (already done).

- [ ] **Step 3: Update `src/main/ipc/index.ts`**

For each of the 23 migrated domains:

1. Add the import near the existing `registerCasesDomain` imports:
   ```typescript
   import { registerAnnotationsDomain } from './domains/annotations'
   ```

2. Replace the inline `registerAnnotationsHandlers({ ipcMain, getDb, getDbPool })` call (or whatever the current inline registration looks like) with:
   ```typescript
   registerAnnotationsDomain(ipcMain)
   ```

Keep `shell`, `system`, `shortlist`, `updater` untouched — those are intentionally not migrated.

- [ ] **Step 4: Update `src/shared/types/api.ts`**

For each of the 23 migrated domains, replace the inline `export interface <Name>API { … }` with a type alias:

```typescript
// Before:
export interface AnnotationsAPI {
  get: (variantKey: string) => Promise<IpcResult<VariantAnnotations | null>>
  upsert: (payload: VariantAnnotationsUpsert) => Promise<IpcResult<VariantAnnotations>>
  updateTags: (payload: VariantTagsUpdate) => Promise<IpcResult<void>>
}

// After:
import type { AnnotationsDomainContract } from '../ipc/domains/annotations'
export type AnnotationsAPI = AnnotationsDomainContract
```

Follow the existing `export type CasesAPI = CasesDomainContract` pattern.

- [ ] **Step 5: Run the preload contract test**

Run:
```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected: all `preload api keys match WindowAPI interface keys` and `mockApi keys match WindowAPI interface keys exactly` assertions pass. If `mockApi` mismatches, also update `tests/utils/mock-api.ts` — same top-level keys, same method names.

- [ ] **Step 6: Run typecheck and full tests**

Run:
```bash
npm run typecheck
make test
```

Expected: 0 type errors; all tests pass.

If `typecheck:renderer` complains about `WindowAPI['<name>']` method signatures, the contract return types don't match the `<Name>API` inline declarations. Compare the two and align them — usually the inline `<Name>API` had incorrect types that the new contract revealed.

- [ ] **Step 7: Commit**

```bash
git add src/preload/index.ts src/main/ipc/index.ts src/shared/types/api.ts tests/utils/mock-api.ts
git commit -m "refactor(ipc): wire 23 migrated domains into preload and main aggregators"
```

---

## Task 25: Verification — full CI parity

**Files:** none modified; verification only.

- [ ] **Step 1: Run the full local CI parity pipeline**

Run:
```bash
make ci-full
```

Expected: lint + format + typecheck + rebuild-node + test + startup-smoke all pass.

If the startup smoke fails under `xvfb-run`, inspect `/tmp/playwright-failure-context` and the perf snapshot; most IPC-wire mistakes surface as `renderer-interactive` milestone timeout or a missing `window.api.<name>` property.

- [ ] **Step 2: Push the branch**

Run:
```bash
git push -u origin feat/ipc-domain-grouping
```

Do **not** open the PR yet — Wave 4 still needs to run.

---

## Task 26: Inventory update and PR

**Files:** Modify: `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md`

- [ ] **Step 1: Update the inventory artifact**

Replace the three "Bucket B / C / D" sections with a single closeout note:

```markdown
## Rollout closeout — 2026-04-17

All 23 remaining handlers are now on the domain-module pattern:

- Bucket B (handler extraction): ✅ database already done; no others in this bucket
- Bucket C (renderer error standardization): ✅ all 6 migrated
- Bucket D (both remaining): ✅ all 19 migrated

### Circuit-breaker

- Active domains in Buckets B + C + D: `0`
- Result: circuit-breaker retired
- All 30 handlers are now: domain-contracted, IpcResult-typed, and grouped under `src/{shared/ipc,preload,main/ipc}/domains/<name>.ts`

See `feat/ipc-domain-grouping` / PR for the execution log.
```

- [ ] **Step 2: Commit and push**

```bash
git add .planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md
git commit -m "docs(planning): mark IPC domain rollout complete"
git push
```

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --title "refactor(ipc): complete domain-module rollout for remaining 23 handlers" --body "$(cat <<'EOF'
## Summary
- Migrates 23 IPC handlers to the `src/shared/ipc/domains/<name>.ts` + `src/preload/domains/<name>.ts` + `src/main/ipc/domains/<name>.ts` pattern, matching the 3 already-migrated examples (`cases`, `database`, `filter-presets`).
- Replaces inline `<Name>API` interfaces in `src/shared/types/api.ts` with `export type <Name>API = <Name>DomainContract` aliases.
- Adds a per-domain preload behavior test under `tests/preload/domains/<name>.test.ts` for each migrated handler.
- Retires the "two-tier IPC codebase" noted in the 2026-04-16 Priority 1 closeout; circuit-breaker count is now 0.

## Scope
- No channel-name changes; no renderer code changes required.
- `shell`, `system`, `shortlist`, `updater` were already closed/aligned and are intentionally unchanged.

## Test plan
- [ ] `make ci-full` green locally
- [ ] Startup smoke passes under `xvfb-run`
- [ ] Preload contract test passes
- [ ] 23 new per-domain tests pass
- [ ] Manual: launch app, import a case, run a cohort query — all IPC round-trips work

Closes Priority A of `.planning/code-review/CODEBASE-REVIEW-2026-04-16.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**1. Spec coverage.** Every handler in the 2026-04-16 inventory Buckets B/C/D (23 items) has a matrix row and an identical Task-1 body. The 4 already-closed handlers (shell/system/shortlist/updater) are excluded per the inventory's "closed from start" designation. The 3 already-migrated (cases/database/filter-presets) are referenced as patterns only. Total coverage: 30/30 handlers accounted for.

**2. Placeholder scan.** Task bodies contain concrete code blocks for `annotations` as the worked example; the matrix provides `<name>`/`<Name>`/channel-prefix substitutions for the other 22. No "similar to" references, no TBD, no empty "add tests" steps. The per-handler specific overrides (e.g., `cohort`'s extra deps) are discovered by `grep` in Step 1 — that's concrete, not a placeholder.

**3. Type consistency.** `<Name>` is PascalCase without hyphens (`AnalysisGroups`, `AuditLog`, `BatchImport`, `CaseComments`, `CaseMetadata`, `CaseMetrics`, `GeneLists`, `GeneRef`). `<name>` is kebab-case matching file names. Channel prefix matches the existing handler file — with one verified counter-example (`filter-presets` uses `presets:`), flagged explicitly.

**4. Parallelization safety.** Wave 1 writes only new files in disjoint paths (`src/{shared/ipc,preload,main/ipc}/domains/<name>.ts` and `tests/preload/domains/<name>.test.ts`). Concurrent writes cannot conflict. Commits serialize at git's lock but that's a throughput issue, not a correctness issue. Wave 2 is explicitly serial. Wave 3 and Wave 4 are serial by nature.

**5. Model-cost efficiency.** 23 Haiku-4.5 subagents × ~200 tokens of task prompt + ~2 KB of source reads ≈ under $0.50 total for Wave 1. Sonnet-4.6 for Wave 2 (~5–10 K tokens of careful edits) is ~$0.10. Total rollout cost estimate: under $2.

## Execution Handoff

Plan complete and saved to `.planning/plans/2026-04-17-ipc-domain-grouping-rollout.md`. Two execution options:

**1. Subagent-Driven (recommended for this plan)** — I dispatch 6–8 Haiku subagents in parallel for Wave 1, review each commit as it lands, then do Wave 2 inline. Fast iteration, clean rollback if any single handler goes wrong.

**2. Inline Execution** — Execute tasks sequentially in this session using executing-plans. Simpler mental model but ~10× longer wall time.

Which approach?
