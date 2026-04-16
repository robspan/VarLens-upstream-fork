# Priority 1 Maintainability Next Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Priority 1 maintainability work by inventorying the live IPC surface, tightening the preload/shared contract for `wrapHandler`-backed channels, standardizing renderer transport-error handling on `unwrapIpcResult(...)`, and completing the remaining domain-first IPC rollout without reopening already-completed work.

**Architecture:** Use a circuit-broken rollout. First freeze the live-tree inventory and acceptance harness. Then land a shared contract foundation that exposes `IpcResult<T>` to the renderer for scoped `wrapHandler` domains. Execute the remaining work in explicit sub-phases: core domains first, then remaining extracted domains, then thin/proxy domains and closeout. Each domain change keeps shared types, preload bindings, main handler structure, renderer migration, and targeted tests together so contract drift cannot reappear silently.

**Tech Stack:** TypeScript, Electron 40, Vue 3, Pinia, Vitest, existing preload bridge, existing `wrapHandler`, existing `unwrapIpcResult`, existing `*-logic.ts` handler pattern

**Spec:** [2026-04-16-priority-1-maintainability-next-phase-design.md](../specs/2026-04-16-priority-1-maintainability-next-phase-design.md)

---

## Planned Sub-Phases

This plan assumes the circuit-breaker is triggered, because the current tree already shows:

- 30 handler modules using `wrapHandler`
- 7 renderer files using `isIpcError(...)`
- 0 renderer files using `unwrapIpcResult(...)`

Execute in these sub-phases after the inventory task confirms the exact bucket counts:

1. **Foundation + inventory**
   Freeze the scope, add the contract harness, and make `IpcResult<T>` visible through the `WindowAPI` contract for the first wave of domains.
2. **Sub-phase A: Core user-facing domains**
   `cases`, `caseMetadata`, `variants`, `cohort`, `annotations`, `import`, `export`
3. **Sub-phase B: Remaining extracted / orchestration domains**
   `auth`, `batch-import`, `panels`, `tags`, `database`
4. **Sub-phase C: Thin or proxy domains**
   `analysis-groups`, `case-comments`, `case-metrics`, `filter-presets`, `gene-lists`, `gene-ref`, `protein`, `transcripts`, `audit-log`, `hpo`, `vep`, `myvariant`, `spliceai`, `gnomad`, plus any remaining `wrapHandler` domains not closed by inventory

If the inventory does **not** trip the circuit-breaker, collapse Sub-phases A-C into one execution sequence while keeping the same per-domain task boundaries.

## Target Files

- `src/shared/types/errors.ts`
  Keep the canonical `SerializableError`, `IpcResult<T>`, `isIpcError`, and `unwrapIpcResult`.
- `src/shared/types/api.ts`
  Encode renderer-visible `IpcResult<T>` return types for scoped `wrapHandler` channels.
- `src/preload/index.ts`
  Keep the bridge explicit, but ensure scoped methods are typed consistently with `WindowAPI`.
- `src/preload/index.d.ts`
  Keep `window.api` bound to the shared `WindowAPI` type.
- `tests/shared/types/preload-contract.test.ts`
  Validate that the preload implementation and `WindowAPI` contract stay aligned.
- `tests/utils/mock-api.ts`
  Mirror the `WindowAPI` shape so renderer tests fail fast when the contract changes.
- `src/main/ipc/handlers/*.ts`
  Keep handler files as the IPC shell; extract or retain logic only where inventory says the domain still needs it.
- `tests/main/handlers/*`
  Extend existing handler / logic tests only for domains touched in each sub-phase.
- `src/renderer/src/composables/*`
  Migrate renderer transport-error handling to `unwrapIpcResult(...)` at the domain boundary.
- `src/renderer/src/components/*`
  Remove component-level ad hoc transport-error guards where the composable/helper layer should own them.

## Task 1: Freeze the live-tree inventory and trigger the circuit-breaker

**Files:**
- Modify: `.planning/specs/2026-04-16-priority-1-maintainability-next-phase-design.md` (only if the measured counts differ materially from the assumptions)
- Create: `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md`

- [ ] **Step 1: Generate the handler inventory from the live tree**

Run:

```bash
python - <<'PY'
from pathlib import Path
handlers = sorted(Path('src/main/ipc/handlers').glob('*.ts'))
logic = {p.name for p in Path('src/main/ipc/handlers').glob('*-logic*.ts')}
for h in handlers:
    if '-logic' in h.name:
        continue
    companions = sorted([n for n in logic if n.startswith(h.stem + '-logic')])
    print(f"{h.name}\tlogic={','.join(companions) if companions else '-'}")
PY
```

Expected: a domain-by-domain list showing which handlers already have companion `-logic` modules.

- [ ] **Step 2: Count the wrapped handler surface**

Run:

```bash
rg -l "wrapHandler\(" src/main/ipc/handlers | wc -l
```

Expected: `30` on the current tree. If the number differs, record the measured count in the inventory artifact.

- [ ] **Step 3: Count current renderer transport-error handling usage**

Run:

```bash
printf 'isIpcError files: '
rg -l "isIpcError\(" src/renderer/src | wc -l
printf 'unwrapIpcResult files: '
rg -l "unwrapIpcResult\(" src/renderer/src | wc -l
```

Expected:

```text
isIpcError files: 7
unwrapIpcResult files: 0
```

- [ ] **Step 4: Write the bucket classification artifact**

Create `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md` with this structure and fill it from the measured tree:

```md
# IPC Domain Inventory — 2026-04-16

## Bucket A — Closed / Already Aligned
- shell
- system

## Bucket B — Handler / Logic Extraction Remaining
- database

## Bucket C — Renderer Error Standardization Remaining
- cases
- case-metadata

## Bucket D — Both Remaining
- gene-lists
```

- [ ] **Step 5: Evaluate the circuit-breaker**

Rule:

```text
If Bucket B + Bucket C + Bucket D > 12 domains combined,
keep Sub-phases A-C in this plan and do not collapse them.
```

Expected on the current tree: the circuit-breaker remains active and the phase stays split.

- [ ] **Step 6: Commit the frozen inventory**

```bash
git add .planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md .planning/specs/2026-04-16-priority-1-maintainability-next-phase-design.md
git commit -m "docs: freeze priority 1 maintainability IPC inventory"
```

## Task 2: Add the shared contract harness before runtime changes

**Files:**
- Modify: `tests/shared/types/preload-contract.test.ts`
- Modify: `tests/utils/mock-api.ts`
- Modify: `src/shared/types/api.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Write a failing preload contract test for `IpcResult<T>`-backed methods**

Add a contract assertion like:

```typescript
import type { WindowAPI } from '../../../src/shared/types/api'
import type { IpcResult } from '../../../src/shared/types/errors'

type CasesListReturn = Awaited<ReturnType<WindowAPI['cases']['list']>>
type CohortRunAssociationReturn = Awaited<ReturnType<WindowAPI['cohort']['runAssociation']>>

it('exposes IpcResult for scoped wrapHandler-backed methods', () => {
  expectTypeOf<CasesListReturn>().toEqualTypeOf<IpcResult<import('../../../src/shared/types/api').Case[]>>()
  expectTypeOf<CohortRunAssociationReturn>().toEqualTypeOf<IpcResult<unknown>>()
})
```

- [ ] **Step 2: Make the mock API fail on contract drift**

Update `tests/utils/mock-api.ts` so the mock is typed against `WindowAPI` instead of a looser structural shape:

```typescript
import type { WindowAPI } from '../../src/shared/types/api'

export function createMockApi(): WindowAPI {
  return {
    cases: {
      list: vi.fn(),
      query: vi.fn(),
      delete: vi.fn(),
      deleteAll: vi.fn(),
      deleteBatch: vi.fn(),
      availableBuilds: vi.fn()
    },
    cohort: {
      getVariants: vi.fn(),
      getColumnMeta: vi.fn(),
      getSummary: vi.fn(),
      getCarriers: vi.fn(),
      getGeneBurden: vi.fn(),
      getSummaryStatus: vi.fn(),
      rebuildSummary: vi.fn(),
      runAssociation: vi.fn(),
      cancelAssociation: vi.fn(),
      onAssociationProgress: vi.fn(),
      onSummaryStatusChanged: vi.fn()
    }
  } as unknown as WindowAPI
}
```

- [ ] **Step 3: Tighten the shared API types for the first-wave domains**

Update `src/shared/types/api.ts` return types for the first-wave scoped domains to use `IpcResult<T>` instead of bare `Promise<T>`:

```typescript
import type { IpcResult, SerializableError } from './errors'

export interface CasesAPI {
  list: () => Promise<IpcResult<Case[]>>
  query: (params: CaseSearchParams) => Promise<IpcResult<{ data: CaseWithCohorts[]; total_count: number }>>
}

export interface CohortAPI {
  getSummary: () => Promise<IpcResult<CohortSummary>>
  runAssociation: (config: unknown) => Promise<IpcResult<unknown>>
}
```

- [ ] **Step 4: Mirror the shared typing in preload**

In `src/preload/index.ts`, annotate the methods for the same first-wave domains so the implementation matches the shared contract:

```typescript
import type { WindowAPI } from '../shared/types/api'

const api: WindowAPI = {
  cases: {
    list: () => ipcRenderer.invoke('cases:list'),
    query: (params) => ipcRenderer.invoke('cases:query', params),
    delete: (id) => ipcRenderer.invoke('cases:delete', id),
    deleteAll: () => ipcRenderer.invoke('cases:deleteAll'),
    deleteBatch: (ids) => ipcRenderer.invoke('cases:deleteBatch', ids),
    availableBuilds: () => ipcRenderer.invoke('cases:availableBuilds')
  },
  cohort: {
    getSummary: () => ipcRenderer.invoke('cohort:summary'),
    runAssociation: (config) => ipcRenderer.invoke('cohort:geneBurdenCompare', config),
    cancelAssociation: () => ipcRenderer.invoke('cohort:geneBurdenCancel')
  }
}
```

- [ ] **Step 5: Run the narrow contract harness**

Run:

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected: PASS after the contract types and preload annotations align.

- [ ] **Step 6: Commit**

```bash
git add tests/shared/types/preload-contract.test.ts tests/utils/mock-api.ts src/shared/types/api.ts src/preload/index.ts
git commit -m "test: lock preload contract to IpcResult return types"
```

## Task 3: Sub-phase A — migrate core domains to typed transport unwrapping

**Files:**
- Modify: `src/shared/types/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/composables/useAssociation.ts`
- Modify: `src/renderer/src/composables/useCaseMetadata.ts`
- Modify: `src/renderer/src/composables/useCohortData.ts`
- Modify: `src/renderer/src/composables/useFilterExport.ts`
- Modify: `src/renderer/src/components/association/GeneBurdenView.vue`
- Modify: `src/renderer/src/components/cohort/CohortFilterBar.vue`
- Modify: `src/renderer/src/components/CohortTable.vue`
- Modify: `src/renderer/src/components/FilterToolbar.vue`
- Modify: `src/renderer/src/components/import/ImportWizard.vue`
- Modify: `src/renderer/src/components/import/VcfImportDialog.vue`
- Test: `tests/main/handlers/cohort-handlers.test.ts`
- Test: `tests/main/handlers/cohort-logic.test.ts`
- Test: `tests/main/handlers/export-handlers.test.ts`
- Test: `tests/main/handlers/variants-handlers.test.ts`

- [ ] **Step 1: Expand `IpcResult<T>` typing to the core domains**

In `src/shared/types/api.ts`, cover these domain surfaces first:

```typescript
export interface VariantsAPI {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    offset?: number,
    limit?: number,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean
  ) => Promise<IpcResult<PaginatedResult<Variant> & { unfiltered_count?: number }>>
  getFilterOptions: (caseId: number) => Promise<IpcResult<FilterOptions>>
  search: (caseId: number, query: string, limit?: number) => Promise<IpcResult<Variant[]>>
}

export interface CaseMetadataAPI {
  get: (caseId: number) => Promise<IpcResult<CaseMetadata | null>>
  getFullMetadata: (caseId: number) => Promise<IpcResult<FullCaseMetadata>>
}
```

- [ ] **Step 2: Update the core composables to unwrap immediately after each API call**

Apply the standard pattern:

```typescript
import { unwrapIpcResult } from '../../../shared/types/errors'

const result = await api.cohort.runAssociation(config)
return unwrapIpcResult(result)
```

and:

```typescript
const [caseListResult, cohortsResult] = await Promise.all([
  api.cases.list(),
  api.caseMetadata.listCohorts()
])

const caseList = unwrapIpcResult(caseListResult)
const cohorts = unwrapIpcResult(cohortsResult)
```

- [ ] **Step 3: Remove component-level ad hoc guards where the composable now owns transport unwrapping**

Replace patterns like:

```typescript
if (isIpcError(result)) {
  throw new Error(result.userMessage)
}
```

with:

```typescript
const result = unwrapIpcResult(await api.cohort.runAssociation(config))
```

and delete the now-redundant guard from the component.

- [ ] **Step 4: Preserve domain result unions**

Keep code like this intact in `useFilterExport.ts` after transport unwrapping:

```typescript
const result = unwrapIpcResult(await api.export.variants(caseId, exportFilters, caseName))

if (result.success === true) {
  return { success: true, filePath: result.filePath }
}
```

Do **not** convert domain-level `success/error` handling into transport-error handling.

- [ ] **Step 5: Run focused core-domain verification**

Run:

```bash
npx vitest run tests/main/handlers/cohort-handlers.test.ts tests/main/handlers/cohort-logic.test.ts tests/main/handlers/export-handlers.test.ts tests/main/handlers/variants-handlers.test.ts
npm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/api.ts src/preload/index.ts src/renderer/src/composables/useAssociation.ts src/renderer/src/composables/useCaseMetadata.ts src/renderer/src/composables/useCohortData.ts src/renderer/src/composables/useFilterExport.ts src/renderer/src/components/association/GeneBurdenView.vue src/renderer/src/components/cohort/CohortFilterBar.vue src/renderer/src/components/CohortTable.vue src/renderer/src/components/FilterToolbar.vue src/renderer/src/components/import/ImportWizard.vue src/renderer/src/components/import/VcfImportDialog.vue tests/main/handlers/cohort-handlers.test.ts tests/main/handlers/cohort-logic.test.ts tests/main/handlers/export-handlers.test.ts tests/main/handlers/variants-handlers.test.ts
git commit -m "refactor(ipc): standardize core renderer unwrapping with IpcResult"
```

## Task 4: Sub-phase B — finish the remaining extracted/orchestration domains

**Files:**
- Modify: `src/shared/types/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/stores/authStore.ts`
- Modify: `src/renderer/src/composables/usePanelManager.ts`
- Modify: `src/renderer/src/composables/useTags.ts`
- Modify: `src/renderer/src/components/BatchImportDialog.vue`
- Modify: `src/renderer/src/components/panels/PanelManagerDialog.vue`
- Modify: `src/renderer/src/components/TagManagementDialog.vue`
- Modify: `src/renderer/src/components/CreateDatabaseDialog.vue`
- Modify: `src/renderer/src/components/DatabasePicker.vue`
- Test: `tests/main/handlers/auth-handlers.test.ts`
- Test: `tests/main/handlers/auth-logic.test.ts`
- Test: `tests/main/handlers/batch-import-logic.test.ts`
- Test: `tests/main/handlers/panels-logic.test.ts`
- Test: `tests/main/handlers/tags-handlers.test.ts`
- Test: `tests/main/handlers/tags-logic.test.ts`

- [ ] **Step 1: Extend the shared contract to the Sub-phase B domains**

Examples:

```typescript
export interface AuthAPI {
  currentUser: () => Promise<IpcResult<{ id: number; username: string; role: string } | null>>
  isAccountsEnabled: () => Promise<IpcResult<boolean>>
  createUser: (username: string, displayName: string, tempPassword: string) => Promise<IpcResult<void>>
}

export interface TagsAPI {
  list: () => Promise<IpcResult<Tag[]>>
  create: (name: string, color: string) => Promise<IpcResult<Tag>>
}
```

- [ ] **Step 2: Migrate renderer stores/composables to `unwrapIpcResult(...)`**

Use the same pattern everywhere in this sub-phase:

```typescript
const currentUser = unwrapIpcResult(await api.auth.currentUser())
const tags = unwrapIpcResult(await api.tags.list())
const panels = unwrapIpcResult(await api.panels.list())
```

- [ ] **Step 3: Extract missing orchestration logic only if inventory placed the domain in Bucket B or D**

If the inventory says `database`, `batch-import`, or another sub-phase B domain still mixes shell and business logic too heavily, create a focused companion `-logic.ts` module using the existing pattern:

```typescript
export async function openDatabase(deps: {
  service: DatabaseService
  logger: LogFunctions
}, params: { path: string; password?: string }): Promise<DatabaseOpenResult> {
  return deps.service.open(params.path, params.password)
}
```

Do **not** create a new `-logic.ts` file for a domain that landed in Bucket C only.

- [ ] **Step 4: Keep preload explicit**

Maintain `src/preload/index.ts` as a typed object literal:

```typescript
const api: WindowAPI = {
  auth: {
    currentUser: () => ipcRenderer.invoke('auth:currentUser'),
    createUser: (username, displayName, tempPassword) =>
      ipcRenderer.invoke('auth:createUser', username, displayName, tempPassword)
  }
}
```

- [ ] **Step 5: Run focused Sub-phase B verification**

Run:

```bash
npx vitest run tests/main/handlers/auth-handlers.test.ts tests/main/handlers/auth-logic.test.ts tests/main/handlers/batch-import-logic.test.ts tests/main/handlers/panels-logic.test.ts tests/main/handlers/tags-handlers.test.ts tests/main/handlers/tags-logic.test.ts
npm run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/api.ts src/preload/index.ts src/renderer/src/stores/authStore.ts src/renderer/src/composables/usePanelManager.ts src/renderer/src/composables/useTags.ts src/renderer/src/components/BatchImportDialog.vue src/renderer/src/components/panels/PanelManagerDialog.vue src/renderer/src/components/TagManagementDialog.vue src/renderer/src/components/CreateDatabaseDialog.vue src/renderer/src/components/DatabasePicker.vue tests/main/handlers/auth-handlers.test.ts tests/main/handlers/auth-logic.test.ts tests/main/handlers/batch-import-logic.test.ts tests/main/handlers/panels-logic.test.ts tests/main/handlers/tags-handlers.test.ts tests/main/handlers/tags-logic.test.ts
git commit -m "refactor(ipc): finish extracted domain transport typing"
```

## Task 5: Sub-phase C — close the thin/proxy domains and remove remaining drift

**Files:**
- Modify: `src/shared/types/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/composables/useCaseComments.ts`
- Modify: `src/renderer/src/composables/useCaseMetrics.ts`
- Modify: `src/renderer/src/composables/useFilterPresetStore.ts`
- Modify: `src/renderer/src/composables/useGeneValidation.ts`
- Modify: `src/renderer/src/composables/useProteinData.ts`
- Modify: `src/renderer/src/composables/useTranscripts.ts`
- Modify: `src/renderer/src/components/ActivityLogPanel.vue`
- Modify: `src/renderer/src/components/CaseCommentsTab.vue`
- Modify: `src/renderer/src/components/CaseMetricsTab.vue`
- Modify: `src/renderer/src/components/panels/PanelAppImportDialog.vue`
- Test: `tests/shared/types/preload-contract.test.ts`
- Test: `tests/main/handlers/case-metadata-handlers.test.ts`

- [ ] **Step 1: Extend `IpcResult<T>` typing to the remaining scoped thin/proxy domains**

Examples:

```typescript
export interface CaseCommentsAPI {
  list: (caseId: number) => Promise<IpcResult<CaseComment[]>>
  create: (caseId: number, category: CommentCategory, content: string) => Promise<IpcResult<CaseComment>>
}

export interface TranscriptAPI {
  list: (variantId: number) => Promise<IpcResult<TranscriptAnnotation[]>>
}
```

- [ ] **Step 2: Migrate the remaining renderer edges to immediate unwrapping**

Examples:

```typescript
const comments = unwrapIpcResult(await api.caseComments.list(caseId))
const metrics = unwrapIpcResult(await api.caseMetrics.listForCase(caseId))
const transcriptRows = unwrapIpcResult(await api.transcripts.list(variantId))
```

- [ ] **Step 3: Keep domain-level success unions intact**

Do not rewrite APIs like these into transport unions:

```typescript
const openResult = await api.database.open(path, password)
if (openResult.success === false) {
  // domain-level outcome
}
```

Only prepend transport unwrapping where the domain method is actually `wrapHandler`-backed:

```typescript
const openResult = unwrapIpcResult(await api.database.open(path, password))
```

- [ ] **Step 4: Re-run the preload contract test against the final scoped surface**

Run:

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
```

Expected: PASS with the final scoped `WindowAPI` / preload contract.

- [ ] **Step 5: Run the final typed regression suite**

Run:

```bash
npm run typecheck
npm run test -- --runInBand
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/api.ts src/preload/index.ts src/renderer/src/composables/useCaseComments.ts src/renderer/src/composables/useCaseMetrics.ts src/renderer/src/composables/useFilterPresetStore.ts src/renderer/src/composables/useGeneValidation.ts src/renderer/src/composables/useProteinData.ts src/renderer/src/composables/useTranscripts.ts src/renderer/src/components/ActivityLogPanel.vue src/renderer/src/components/CaseCommentsTab.vue src/renderer/src/components/CaseMetricsTab.vue src/renderer/src/components/panels/PanelAppImportDialog.vue tests/shared/types/preload-contract.test.ts tests/main/handlers/case-metadata-handlers.test.ts
git commit -m "refactor(ipc): close remaining renderer transport drift"
```

## Task 6: Close the phase and record deferred work

**Files:**
- Modify: `.planning/specs/2026-04-16-priority-1-maintainability-next-phase-design.md`
- Modify: `.planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md`
- Create: `.planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md`

- [ ] **Step 1: Record final bucket disposition**

Update the inventory artifact so every domain ends with one final state:

```md
- cases — complete in Sub-phase A
- panels — complete in Sub-phase B
- shell — closed from start, untouched
```

- [ ] **Step 2: Write the closeout artifact**

Create `.planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md` with:

```md
# Priority 1 Maintainability Closeout

## Completed in this phase
- preload/shared `IpcResult<T>` contract for scoped wrapHandler domains
- renderer transport-error standardization on `unwrapIpcResult(...)`

## Explicitly deferred
- filter query-shaping ownership consolidation
```

- [ ] **Step 3: Re-run the minimum final verification set**

Run:

```bash
npx vitest run tests/shared/types/preload-contract.test.ts
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit the closeout docs**

```bash
git add .planning/specs/2026-04-16-priority-1-maintainability-next-phase-design.md .planning/artifacts/maintainability/2026-04-16-ipc-domain-inventory.md .planning/artifacts/maintainability/2026-04-16-priority-1-closeout.md
git commit -m "docs: record priority 1 maintainability closeout"
```
