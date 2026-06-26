# Web Shared-Handler Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dispatch a fresh implementer per task; run two-stage review (spec compliance, then code quality) before marking a task complete. **Run `make format` as part of every task's verification** (Sprint A/B learning: implementers skipped prettier and forced controller fix-ups).

**Spec:** [.planning/specs/2026-06-13-web-shared-handler-seam.md](../specs/2026-06-13-web-shared-handler-seam.md)

**Goal:** Make each of six web routes (`transcripts, panels, annotations, variants, cohort, export`) a thin transport adapter over a single shared, session-based operation function per domain, and enforce non-drift with a per-override-key seam gate plus cross-transport runtime parity.

**Architecture:** New **session/executor-based** orchestration functions added to the existing `src/main/ipc/handlers/<domain>-logic.ts` modules, called by BOTH the desktop IPC handler and the web Fastify route. Transport-specific behaviour (event broadcast vs. SSE publish, cache pings) is supplied as an injected callback. A `ts-morph` gate in `handler-seam.test.ts` asserts every override key is either a pure single-executor pass-through or calls a shared `<domain>-logic` export; a monotonic-decrease `PENDING_SHARED_LOGIC_EXTRACTION` allowlist empties by PR-3.

**Tech Stack:** Electron 40, Vue 3 + Vuetify 4, TypeScript 6 strict, Fastify (web), Vitest, Playwright `_electron`, better-sqlite3-multiple-ciphers, PostgreSQL 18, Zod, `ts-morph` (already a dev dep, used by `auth-isolation.test.ts`), electron-log.

---

## Architecture reality-checks (verified against `main @ 226e8cf2`; these refine the spec — re-verify line numbers at task time)

1. **`*-logic.ts` are `getDb`-based SQLite logic, NOT the web seam.** `panels-logic.ts` exports `getPanel(id, getDb)`, `getGenes(panelId, getDb)`; `annotations-logic.ts` exports `getGlobalAnnotation(coords, getDb)`, `upsertPerCaseAnnotation(…, getDb)`; etc. The desktop handler branches **postgres → `session.get{Read,Write}Executor()`**, **sqlite → these `getDb` functions** (e.g. `handlers/transcripts.ts:38-50,81-90,123-134`). The web route is Postgres-only and calls the **executor**. So the shared layer this plan introduces is a set of **new session-based functions** added to each `<domain>-logic.ts`; the existing `getDb` functions are left untouched (they remain the SQLite path's building blocks).
2. **`transcripts`' web route is already gate-compliant.** `routes/transcripts.ts:19,35,52` are pure executor pass-throughs (gate branch (a)). The B6 "transcript switch doesn't update parent `variants` row" is a **backend-parity** divergence in `PostgresTranscriptsRepository` vs SQLite, caught by the *cross-transport* parity scenario and fixed in the repository — not by extracting `transcripts-logic`. PR-1 therefore (a) upgrades the gate, (b) extends the transcripts parity scenario to catch the backend divergence, (c) fixes the repository if the scenario is red, and (d) extracts `transcripts-logic` only for symmetry/return-shape normalization.
3. **The cross-transport parity harness compares returned values by hash and exposes no event channel** (`parity/ipc/shared.ts:20-28`: `RuntimeContext` is `call(...)` + anchors only). Event-emission/scope parity is verified by **targeted unit tests**, not parity scenarios.
4. **The seam test already has the coarse check to replace.** `handler-seam.test.ts:191-203` (`'web route override modules use shared logic or audited exceptions'`) passes a route if it imports *any* `handlers/<x>-logic` OR is in `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS`. That is the file-level false-positive (F2). The upgrade adds a per-override-key `ts-morph` assertion; the module-set guards (`:137-166`) stay.
5. **`export:variants`/`export:cohort` are overridden** (`routes/export.ts:19,41`), so the override is live despite `READ_TASK_TYPES` membership (`task-types.ts:41-42`) — the dispatcher checks overrides first (`dispatcher.ts:255`). Both keys are in scope.
6. **Determine the parity harness's desktop backend at task time.** `ipc-fixture-parity.test.ts` launches real Electron (desktop) and an isolated web schema (Postgres). Confirm whether desktop runs SQLite or Postgres — it decides whether the transcripts scenario catches the *backend*-parity divergence (RC-2) or only transport drift. Gated by `VARLENS_RUN_WEB_GATE_PARITY=1 && VARLENS_RUN_WEB_PARITY_E2E=1`, needs `VARLENS_PG_URL` + built `out/main/index.js`.

## File structure

| File | Role | PR |
|---|---|---|
| `tests/web-gate/handler-seam.test.ts` | **Modify** — add per-override-key `ts-morph` gate + `PENDING_SHARED_LOGIC_EXTRACTION` | PR-1 |
| `src/main/ipc/handlers/transcripts-logic.ts` | **Create** — session-based list/switch/insertAndSwitch | PR-1 |
| `src/main/ipc/handlers/transcripts.ts`, `src/web/server/routes/transcripts.ts` | **Modify** — call shared logic | PR-1 |
| `tests/web-gate/parity/ipc/{transcripts,panels,annotations,variants,cohort,export}.ts` | **Modify** — extend with B6 cases | PR-1/2/3 |
| `src/main/ipc/handlers/{panels,annotations,variants,cohort,export}-logic.ts` | **Modify** — add session-based orchestration fns + callback types | PR-2/3 |
| `src/web/server/routes/{panels,annotations,variants,cohort,export}.ts` | **Modify** — call shared logic; remove inline orchestration | PR-2/3 |
| `src/main/ipc/handlers/{panels,annotations,variants,cohort,export}.ts` | **Modify** — call the same shared fn (where behaviour-preserving) | PR-2/3 |
| `tests/main/ipc/annotations-event-parity.test.ts` | **Create** — targeted event-callback unit tests (RC-3) | PR-2 |
| `src/main/storage/postgres/PostgresTranscriptsRepository.ts` | **Modify only if** the transcripts parity scenario is red (RC-2) | PR-1 |

---

## Pre-flight (controller, before dispatching any subagent)

- [ ] **Branch hygiene.** From `main`: `git status` clean; `git fetch origin && git rev-list --left-right --count origin/main...main` → `0 0`.
- [ ] **Read the spec.** Note the 6 domains, the per-key gate, the 10 acceptance gates, the 4 Open Questions. Settled decisions must not be re-litigated mid-execution.
- [ ] **Verify clean baseline:** `make ci` and `VARLENS_WEB=1 make ci` both exit 0. Surface failures before starting. (Heavy builds on this workstation: wrap in `systemd-run --user --scope -p MemoryMax=16G`.)
- [ ] **Bring up Postgres + build for parity:** `make pg-reset && make pg-up` (PG @ 55434 per `.env.postgres.local`); `make build` (produces `out/main/index.js` for the parity harness).
- [ ] **Resolve RC-6:** read `ipc-fixture-parity.test.ts` setup; record whether desktop runs SQLite or Postgres in the parity run.

## Branch convention

| PR | Branch | Tasks | Depends on |
|---|---|---|---|
| PR-1 | `feat/web-shared-logic-seam-and-transcripts` | 1.1–1.5 | — |
| PR-2 | `feat/web-shared-logic-panels-annotations` | 2.1–2.6 | PR-1 merged |
| PR-3 | `feat/web-shared-logic-variants-cohort-export` | 3.1–3.7 | PR-2 merged |

```bash
git checkout main && git pull --ff-only
git checkout -b feat/web-shared-logic-seam-and-transcripts
```

---

# PR-1 — `refactor(web): behavioural handler seam + share transcripts logic across transports`

### Task 1.1: Add the `PENDING_SHARED_LOGIC_EXTRACTION` allowlist (seeded with all six), gate stays green

**Files:** Modify `tests/web-gate/handler-seam.test.ts`.

- [ ] **Step 1 — add the allowlist constant** below `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS` (line ~42):

```ts
/**
 * Domains whose web overrides have not yet been collapsed onto a shared
 * session-based <domain>-logic function. MONOTONIC-DECREASE ONLY — remove
 * an entry when the domain's overrides all pass the per-key seam check.
 * do not add.
 */
const PENDING_SHARED_LOGIC_EXTRACTION = new Set<string>([
  'transcripts.ts',
  'panels.ts',
  'annotations.ts',
  'variants.ts',
  'cohort.ts',
  'export.ts'
])
```

- [ ] **Step 2 — add a guard test** that the allowlist cannot grow, inside the `describe` block:

```ts
test('PENDING_SHARED_LOGIC_EXTRACTION only shrinks (max 6, all known)', () => {
  const known = new Set([
    'transcripts.ts', 'panels.ts', 'annotations.ts',
    'variants.ts', 'cohort.ts', 'export.ts'
  ])
  expect(PENDING_SHARED_LOGIC_EXTRACTION.size).toBeLessThanOrEqual(6)
  for (const entry of PENDING_SHARED_LOGIC_EXTRACTION) {
    expect(known.has(entry), `unknown pending domain: ${entry}`).toBe(true)
  }
})
```

- [ ] **Step 3 — run:** `make rebuild-node && npx vitest run tests/web-gate/handler-seam.test.ts` → all PASS.
- [ ] **Step 4 — `make format` + commit:** `test(web): seed PENDING_SHARED_LOGIC_EXTRACTION allowlist for seam upgrade`.

### Task 1.2: Upgrade the seam gate to a per-override-key `ts-morph` check (TDD)

**Files:** Modify `tests/web-gate/handler-seam.test.ts`. Reference: `tests/web-gate/auth-isolation.test.ts` for the `ts-morph` `Project` setup pattern.

- [ ] **Step 1 — write the failing test.** Replace the body of the existing `'web route override modules use shared logic or audited exceptions'` test (`:191-203`) with a per-key analyzer. Add `import { Project, SyntaxKind } from 'ts-morph'` at the top.

```ts
// Returns, per override key in a route file, the verdict: 'passthrough' | 'shared-logic' | 'inline'.
function analyzeOverrideKeys(routePath: string): Record<string, 'passthrough' | 'shared-logic' | 'inline'> {
  const project = new Project({ tsConfigFilePath: 'tsconfig.node.json', skipAddingFilesFromTsConfig: true })
  const sf = project.addSourceFileAtPath(resolve(process.cwd(), routePath))
  const verdicts: Record<string, 'passthrough' | 'shared-logic' | 'inline'> = {}

  // Find the object literal returned by buildXxxOverrides() and walk its keys.
  const builder = sf.getFunctions().find((f) => /^build[A-Za-z]+Overrides$/.test(f.getName() ?? ''))
  const ret = builder?.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)[0]
  for (const prop of ret?.getProperties() ?? []) {
    const key = prop.getChildAtIndex(0).getText().replace(/['"`]/g, '')
    const text = prop.getText()
    const execCalls = (text.match(/get(Read|Write)Executor\(\)\s*\.execute\(/g) ?? []).length
    const callsTypeKey = text.includes(`type: '${key}'`) || text.includes(`type: "${key}"`)
    if (callsSharedLogicFn(sf, prop)) {
      verdicts[key] = 'shared-logic'           // branch (b): delegates to a *-logic export
    } else if (execCalls === 1 && callsTypeKey) {
      verdicts[key] = 'passthrough'            // branch (a): single executor call, same task key
    } else {
      verdicts[key] = 'inline'                 // hand-rolled orchestration — fails the gate
    }
  }
  return verdicts
}

// True if the override body calls a function imported from a *-logic module.
function callsSharedLogicFn(sf: import('ts-morph').SourceFile, prop: import('ts-morph').ObjectLiteralElementLike): boolean {
  const logicNames = new Set<string>()
  for (const d of sf.getImportDeclarations()) {
    if (!/handlers\/[A-Za-z0-9-]+-logic/.test(d.getModuleSpecifierValue())) continue
    for (const n of d.getNamedImports()) logicNames.add(n.getName())
  }
  return prop.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const expr = c.getExpression()
    return expr.getKind() === SyntaxKind.Identifier && logicNames.has(expr.getText())
  })
}

test('every override key of a migrated domain is pass-through or calls shared logic', () => {
  const offenders: string[] = []
  for (const file of listRouteOverrideModules()) {
    if (PENDING_SHARED_LOGIC_EXTRACTION.has(file)) continue          // not migrated yet
    if (ROUTE_OVERRIDE_LOGIC_EXCEPTIONS[file] !== undefined) continue // web-only adapter
    const verdicts = analyzeOverrideKeys(`${WEB_ROUTES_DIR}/${file}`)
    for (const [key, verdict] of Object.entries(verdicts)) {
      if (verdict === 'inline') offenders.push(`${file} → ${key} (inline orchestration; extract to <domain>-logic)`)
    }
  }
  expect(offenders, offenders.join('\n')).toEqual([])
})
```

- [ ] **Step 2 — run to verify it PASSES now** (all six domains are in `PENDING_SHARED_LOGIC_EXTRACTION`, so none are analyzed yet): `npx vitest run tests/web-gate/handler-seam.test.ts`. Expected: PASS. (The gate becomes load-bearing as domains leave the allowlist.)
- [ ] **Step 3 — prove the gate bites:** temporarily delete `'transcripts.ts'` from `PENDING_SHARED_LOGIC_EXTRACTION`, re-run. Expected: still PASS (transcripts overrides are already pure pass-throughs per RC-2). Then temporarily add an inline second executor call to one transcripts override and confirm the gate reports it `inline`. Revert both probes.
- [ ] **Step 4 — keep the old coarse test deleted** (it is replaced by the per-key test). Confirm the module-set tests (`:137-166`) and the Postgres-direct-access test (`:168-189`) are untouched.
- [ ] **Step 5 — `make format` + commit:** `test(web): per-override-key seam gate via ts-morph (replaces file-level check)`.

### Task 1.3: Extend the transcripts parity scenario to cover switch + parent-row (TDD red-or-lock)

**Files:** Modify `tests/web-gate/parity/ipc/transcripts.ts`.

- [ ] **Step 1 — extend the scenario** (current content runs only `insertAndSwitch` + `list`):

```ts
import type { IpcScenario } from './shared'

export const transcriptsScenario: IpcScenario = {
  area: 'transcripts',
  run: async (ctx) => [
    await ctx.call('transcripts', 'insertAndSwitch', [
      ctx.primaryVariant.id,
      { transcript_id: 'ENST_PARITY_000001', gene_symbol: 'COMT', consequence: 'stop_gained',
        cdna: 'c.493G>A', aa_change: 'p.Glu165Ter', hpo_sim_score: 0.87, moi: 'AD', is_selected: 1 }
    ]),
    await ctx.call('transcripts', 'switch', [ctx.primaryVariant.id, 'ENST_PARITY_000001']),
    await ctx.call('transcripts', 'list', [ctx.primaryVariant.id]),
    // B6: after switch, the parent variants row must reflect the selected transcript.
    // A variants:query anchored on the same variant exposes transcript/gene_symbol/consequence.
    await ctx.call('variants', 'query', [
      ctx.primaryCaseId, { /* minimal filter selecting primaryVariant */ }, 1, 0, []
    ])
  ]
}
```

(Adjust the `variants:query` filter args to the real `VariantFilter` shape used by other scenarios in `parity/ipc/variants.ts` — copy that filter literal.)

- [ ] **Step 2 — run the gated parity test:**

```bash
VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 \
  VARLENS_PG_URL=postgres://varlens:varlens_dev_password@127.0.0.1:55434/varlens_dev \
  npx vitest run tests/web-gate/parity/ipc-fixture-parity.test.ts
```

- [ ] **Step 3 — record the verdict.** If the `transcripts` area passes, current behaviour is locked — proceed to 1.4 (extraction is symmetry-only). If it FAILS on the parent-row read (desktop SQLite updates the parent row, web Postgres does not — RC-2), the divergence is real: continue to 1.3b.
- [ ] **Step 3b (only if red) — fix the backend parity in the repository.** In `src/main/storage/postgres/PostgresTranscriptsRepository.ts`, make `switchSelectedTranscript`/`insertTranscriptAndSwitch` update the parent `variants` row (transcript, gene_symbol, consequence, cdna, aa_change, hpo_sim_score, moi) inside the same transaction, mirroring the SQLite `TranscriptRepository.switchSelectedTranscript`. Re-run Step 2 → the `transcripts` area passes. Add a backend-parity assertion to the relevant `tests/main/storage/*transcript*` test if one exists; otherwise note it in the PR body.
- [ ] **Step 4 — `make format` + commit:** `test(web): transcripts switch+parent-row cross-transport parity` (and, if 3b ran, fold the repository fix into a second commit `fix(pg): transcript switch updates parent variants row`).

### Task 1.4: Extract `transcripts-logic.ts` and route both transports through the executor

**Files:** Create `src/main/ipc/handlers/transcripts-logic.ts`; modify `src/main/ipc/handlers/transcripts.ts`, `src/web/server/routes/transcripts.ts`.

- [ ] **Step 1 — read `SqliteReadExecutor`/`SqliteWriteExecutor`** for `transcripts:list`/`switch`/`insertAndSwitch` and record their **return shapes** (e.g. does `transcripts:switch` return `{ success: true }` or the repo's return?). The desktop SQLite branch currently returns `{ success: true }` (`handlers/transcripts.ts:90,135`). The shared logic must normalize to preserve that observable contract.
- [ ] **Step 2 — create `transcripts-logic.ts`:**

```ts
import type { StorageSession } from '../../storage/session'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'

export async function listTranscripts(variantId: number, getSession: () => StorageSession): Promise<unknown> {
  return getSession().getReadExecutor().execute({ type: 'transcripts:list', params: [variantId] })
}

export async function switchTranscript(
  variantId: number, transcriptId: string, getSession: () => StorageSession
): Promise<{ success: true }> {
  await getSession().getWriteExecutor().execute({ type: 'transcripts:switch', params: [variantId, transcriptId] })
  return { success: true }
}

export async function insertAndSwitchTranscript(
  variantId: number, row: TranscriptInsertRow, getSession: () => StorageSession
): Promise<{ success: true }> {
  await getSession().getWriteExecutor().execute({ type: 'transcripts:insertAndSwitch', params: [variantId, row] })
  return { success: true }
}
```

(If Step 1 showed the executor already returns `{ success: true }`, return its result directly instead of synthesizing — match the executor.)

- [ ] **Step 3 — rewire the desktop handler** `handlers/transcripts.ts`: replace each `session.capabilities.backend === 'postgres' ? executor : getDb` branch with a single call to the shared fn, passing `() => getDbManager().getCurrentSession()`. Keep the Zod validation + `wrapHandler`. Remove the now-dead `getDb`/`getDbPool` transcript imports if unused.
- [ ] **Step 4 — rewire the web route** `routes/transcripts.ts`: import the three fns; each override validates (unchanged) then `return await listTranscripts(validated.data, () => session)` etc.
- [ ] **Step 5 — de-list:** remove `'transcripts.ts'` from `PENDING_SHARED_LOGIC_EXTRACTION` AND from `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS` in `handler-seam.test.ts` (it now passes via branch (b)).
- [ ] **Step 6 — run:**

```bash
make rebuild-node
npx vitest run tests/web-gate/handler-seam.test.ts tests/main/ipc/ tests/refactor-checkpoint/
VARLENS_RUN_WEB_GATE_PARITY=1 VARLENS_RUN_WEB_PARITY_E2E=1 VARLENS_PG_URL=… npx vitest run tests/web-gate/parity/ipc-fixture-parity.test.ts
```

Expected: seam gate PASS (transcripts now enforced), parity `transcripts` PASS, refactor-checkpoint + main unchanged.

- [ ] **Step 7 — `make format` + commit:** `refactor(web): share transcripts logic across transports (executor-routed)`.

### Task 1.5: PR-1 full gates

- [ ] **Step 1 — run:** `make ci-full` and `VARLENS_WEB=1 make ci` → both exit 0. `make agent-check` clean.
- [ ] **Step 2 — open PR-1.** Body cites the spec, gates 1 + 2 + 9, the parity command, and (if 1.3b ran) the repository fix. Controller merges after review + green cross-platform Actions.

---

# PR-2 — `refactor(web): share panels + annotations logic across transports`

> **Pattern (from PR-1):** add a **session-based** orchestration fn to `<domain>-logic.ts` (alongside the existing `getDb` fns, which stay); call it from both `handlers/<domain>.ts` and `routes/<domain>.ts`; extend the parity scenario; de-list the domain. Each fn takes `getSession: () => StorageSession` and, where a transport-specific side effect exists, an injected callback.

### Task 2.1: Extend the panels parity scenario (lock current shape)

**Files:** Modify `tests/web-gate/parity/ipc/panels.ts`.

- [ ] **Step 1 — add `panels:get` and `panels:update` calls** asserting returned-value equality across transports. `panels:get` must surface the `{ ...panel, genes }` shape; `panels:update` must round-trip `{ id, name, description, version }`. Mirror the existing scenario's create→act→read structure (copy the panel-create setup already in the file).
- [ ] **Step 2 — run** the gated parity test (command from Task 1.3 Step 2) → `panels` area PASS (locks current behaviour). **Step 3 — `make format` + commit:** `test(web): panels get/update cross-transport parity`.

### Task 2.2: Add `getPanelWithGenes` to `panels-logic.ts`

**Files:** Modify `src/main/ipc/handlers/panels-logic.ts`. Existing exports include `getPanel(id, getDb)`, `getGenes(panelId, getDb)`, `updatePanel(...)` (`panels-logic.ts:35,98,54`).

- [ ] **Step 1 — add a session-based orchestration fn** that reproduces the two-call merge currently inlined at `routes/panels.ts:14-20`:

```ts
import type { StorageSession } from '../../storage/session'

export async function getPanelWithGenes(id: number, getSession: () => StorageSession): Promise<unknown> {
  const session = getSession()
  const panel = await session.getReadExecutor().execute({ type: 'panels:get', params: [id] })
  if (panel === null) return null
  const genes = await session.getReadExecutor().execute({ type: 'panels:getGenes', params: [id] })
  return { ...(panel as object), genes }
}
```

- [ ] **Step 2 — add `updatePanelFields`** if the desktop handler's update unpacking (`{ id, ...updates } → [id, updates]`) is not already a single shared fn; otherwise reuse the existing `updatePanel`. Keep ≤600 LOC (`panels-logic.ts` is 402 — fine).
- [ ] **Step 3 — `make format` + commit:** `feat(ipc): session-based getPanelWithGenes in panels-logic`.

### Task 2.3: Route both transports through the shared panels fns

**Files:** Modify `src/web/server/routes/panels.ts`, `src/main/ipc/handlers/panels.ts`.

- [ ] **Step 1 — web route:** replace the inline merge (`routes/panels.ts:14-20`) with `return await getPanelWithGenes(validated.data, () => session)`; replace the inline update unpack with the shared fn. Import from `'../../../main/ipc/handlers/panels-logic'`.
- [ ] **Step 2 — desktop handler:** have the `panels:get` handler call `getPanelWithGenes(id, () => getDbManager().getCurrentSession())` so both transports share one implementation (verify behaviour-preserving against the parity scenario; if the desktop SQLite enrich path differs, normalize in the shared fn).
- [ ] **Step 3 — de-list** `panels.ts` from `PENDING_SHARED_LOGIC_EXTRACTION` and `ROUTE_OVERRIDE_LOGIC_EXCEPTIONS`.
- [ ] **Step 4 — run:** `make rebuild-node && npx vitest run tests/web-gate/handler-seam.test.ts tests/main/ipc/` + the gated parity `panels` area + `VARLENS_WEB=1 make test`. Expected PASS. **Step 5 — `make format` + commit:** `refactor(web): panels get/update via shared session logic`.

### Task 2.4: Targeted annotation event-callback unit tests (TDD; RC-3)

**Files:** Create `tests/main/ipc/annotations-event-parity.test.ts`.

- [ ] **Step 1 — write failing tests** asserting that the shared per-case upsert fn invokes its injected `onChange` callback exactly once with the correct `kind` (`star`/`acmg`/`evidence`/`comment`), for representative `updates`. This is the verification the parity harness cannot do (RC-3).

```ts
import { describe, expect, test, vi } from 'vitest'
// import { upsertPerCaseAnnotationWithEvent } from '../../../src/main/ipc/handlers/annotations-logic'
test('emits a single change event with kind=acmg for an acmg update', async () => {
  const onChange = vi.fn()
  // call the shared fn with a fake session/executor + onChange; assert called once with kind 'acmg'
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange.mock.calls[0][0]).toMatchObject({ kind: 'acmg' })
})
```

- [ ] **Step 2 — run, expect FAIL** (fn not yet exported). **Step 3 — commit after 2.5 makes it pass.**

### Task 2.5: Add session-based annotation upsert fn with injected event callback; route both transports

**Files:** Modify `src/main/ipc/handlers/annotations-logic.ts`, `src/web/server/routes/annotations.ts`, `src/main/ipc/handlers/annotations.ts`.

- [ ] **Step 1 — add a session-based fn** that issues the composite `annotations:upsertPerCaseWithAudit` write task (RC-5: keep the atomic `*WithAudit` task — do not re-split write/audit) and then calls an injected `onChange(event)` callback. Move `detectAnnotationChangeKind` (currently `routes/annotations.ts:11-20`) into `annotations-logic.ts` as the single source.

```ts
import type { AnnotationChangeEvent } from '../../../shared/types/api'
import type { StorageSession } from '../../storage/session'

export function detectAnnotationChangeKind(u: { starred?: unknown; acmg_classification?: unknown; acmg_evidence?: unknown }): AnnotationChangeEvent['kind'] {
  if (u.starred !== undefined) return 'star'
  if (u.acmg_classification !== undefined) return 'acmg'
  if (u.acmg_evidence !== undefined) return 'evidence'
  return 'comment'
}

export async function upsertPerCaseAnnotationWithEvent(
  caseId: number, variantId: number, updates: unknown,
  getSession: () => StorageSession,
  onChange: (e: AnnotationChangeEvent) => void
): Promise<unknown> {
  const result = await getSession().getWriteExecutor().execute({
    type: 'annotations:upsertPerCaseWithAudit', params: [caseId, variantId, updates]
  })
  onChange({ caseId, variantId, kind: detectAnnotationChangeKind(updates as object) })
  return result
}
```

- [ ] **Step 2 — web route** (`routes/annotations.ts`): call the shared fn, passing the SSE callback `(e) => { const uid = request.session?.user?.id; if (uid !== undefined) events.publish(uid, WEB_EVENT_VARIANTS_ANNOTATION_CHANGED, e) }`. Remove the local `detectAnnotationChangeKind`.
- [ ] **Step 3 — desktop handler** (`handlers/annotations.ts`): for `annotations:upsertPerCase`, call the same shared fn passing the window-broadcast callback (`broadcastAnnotationChanged`). Confirm the existing desktop event payload matches the `AnnotationChangeEvent` shape.
- [ ] **Step 4 — make 2.4 pass:** wire the test import to `upsertPerCaseAnnotationWithEvent`. Run `npx vitest run tests/main/ipc/annotations-event-parity.test.ts` → PASS.
- [ ] **Step 5 — extend the annotations parity scenario** (`parity/ipc/annotations.ts`) with returned-value coverage of `upsertPerCase`, `upsertGlobal` (audit atomicity via a follow-up audit read), `getForVariant`, `getGlobal`. Run the gated parity → `annotations` PASS.
- [ ] **Step 6 — de-list** `annotations.ts` from both allowlists. **Step 7 — run** seam gate + `tests/main/ipc/` + `VARLENS_WEB=1 make test`. **Step 8 — `make format` + commit:** `refactor(web): annotations per-case upsert via shared logic with injected event`.

### Task 2.6: PR-2 full gates

- [ ] `make ci-full` + `VARLENS_WEB=1 make ci` green; `make agent-check` clean (`annotations-logic.ts` ≤600). Open PR-2; controller merges after review.

---

# PR-3 — `refactor(web): share variants/cohort/export logic; strict transport seam`

### Task 3.1: variants — parity + migrate every override key

**Files:** `tests/web-gate/parity/ipc/variants.ts`, `src/main/ipc/handlers/variants-logic.ts`, `src/web/server/routes/variants.ts`, `src/main/ipc/handlers/variants.ts`.

- [ ] **Step 1 — extend the parity scenario** for `variants:search` (assert the return shape matches the IPC contract — the B6 envelope-vs-`Variant[]` case). Run gated parity → record.
- [ ] **Step 2 — classify each variants override key** (`variants:search`, `variants:columnMeta`, `variants:query`, `variants:getFilterOptions` — `routes/variants.ts:16,28,48,107`): for each, decide **(a) pure pass-through** (single executor call, same key → leave as-is, gate accepts) or **(b) needs shared fn** (extra shaping → add a session-based fn to `variants-logic.ts` and call it from both transports). `variants:search` already calls `searchVariants` — confirm that fn is session-based (it takes `() => session` per `routes/variants.ts:24`); if it is `getDb`-based, add a session-based sibling.
- [ ] **Step 3 — apply** the (a)/(b) decision per key; de-list `variants.ts` from both allowlists.
- [ ] **Step 4 — run** seam gate (now enforces variants) + `tests/main/ipc/` + gated parity `variants` + `VARLENS_WEB=1 make test`. **Step 5 — `make format` + commit:** `refactor(web): variants overrides pass per-key seam (shared logic / pass-through)`.

### Task 3.2: cohort — parity + migrate every override key (OQ-4)

**Files:** `tests/web-gate/parity/ipc/cohort.ts`, `src/main/ipc/handlers/cohort-logic.ts`, `src/web/server/routes/cohort.ts`, `src/main/ipc/handlers/cohort.ts`.

- [ ] **Step 1 — extend the cohort parity scenario** for the five overridden cohort methods (`exec=5` in `routes/cohort.ts`). Run gated parity → record.
- [ ] **Step 2 — for each cohort override key,** apply (a)/(b). Cache-rebuild side effects (e.g. cohort-summary staleness) become a `CohortCallbacks`-style injected callback (RC-3 pattern); a genuinely web-only SSE staleness ping stays in the route as a documented transport concern (OQ-4 default).
- [ ] **Step 3 — de-list** `cohort.ts` from both allowlists. **Step 4 — run** seam gate + `tests/main/ipc/` + gated parity `cohort` + `VARLENS_WEB=1 make test`. **Step 5 — `make format` + commit:** `refactor(web): cohort overrides via shared session logic`.

### Task 3.3: export — migrate the overridden `export:variants`/`export:cohort` (RC-5/F1)

**Files:** `tests/web-gate/parity/ipc/export.ts`, `src/main/ipc/handlers/export-logic.ts`, `src/web/server/routes/export.ts`.

- [ ] **Step 1 — extend the export parity scenario** (export returns a file; reuse `normalizeExport` from `parity/ipc/shared.ts:48` to compare by file hash). Run gated parity → record.
- [ ] **Step 2 — classify `export:variants` and `export:cohort`** (`routes/export.ts:19,41`): each is likely a near-pass-through to an executor export task. If pure pass-through with the same key → gate accepts (a). If it shapes args / picks `exportPostgresVariants` vs `exportVariants` → route through a session-based `export-logic` fn (b). Existing `export-logic` exports: `exportPostgresVariants`, `exportPostgresCohort` (`export-logic.ts:211,225`).
- [ ] **Step 3 — de-list** `export.ts` from both allowlists. **Step 4 — run** seam gate + gated parity `export` + `VARLENS_WEB=1 make test`. **Step 5 — `make format` + commit:** `refactor(web): export overrides pass per-key seam`.

### Task 3.4: Flip the seam gate strict

**Files:** Modify `tests/web-gate/handler-seam.test.ts`.

- [ ] **Step 1 — assert the allowlist is empty:** `PENDING_SHARED_LOGIC_EXTRACTION` should now be `new Set()`. Add:

```ts
test('PENDING_SHARED_LOGIC_EXTRACTION is empty — all six domains migrated', () => {
  expect([...PENDING_SHARED_LOGIC_EXTRACTION]).toEqual([])
})
```

- [ ] **Step 2 — run:** `npx vitest run tests/web-gate/handler-seam.test.ts` → PASS. **Step 3 — `make format` + commit:** `test(web): strict transport seam — no pending shared-logic domains`.

### Task 3.5: PR-3 full gates + sprint exit

- [ ] **Step 1 — full gates:** `make ci-full` + `VARLENS_WEB=1 make ci` green; full gated parity suite (all six areas) PASS; `make agent-check` clean (no migrated `*-logic.ts` >600 LOC without justification).
- [ ] **Step 2 — open PR-3;** controller merges after review + green Actions. No version tag required (internal refactor; bundle into the next release per the release runbook if desired).

---

## Verification matrix (gate → task)

| Spec gate | Verified by |
|---|---|
| 1 — behavioural seam (per key), allowlist empties | 1.1, 1.2, 1.4 (de-list), 3.4 |
| 2 — transcripts shared + parent-row parity | 1.3, 1.4 |
| 3 — panels get/update via shared logic | 2.1, 2.2, 2.3 |
| 4 — annotations shared + event via callback (unit) + atomicity (parity) | 2.4, 2.5 |
| 5 — variants:search shape | 3.1 |
| 6 — cohort via shared logic + callbacks | 3.2 |
| 7 — export overridden keys pass per-key gate | 3.3 |
| 8 — strict gate (allowlist empty) | 3.4 |
| 9 — no contract/Electron change | 1.4/2.3/2.5/3.x (refactor-checkpoint + main + preload-contract suites) |
| 10 — CI green per PR | 1.5, 2.6, 3.5 |

## Per-task verification checklist (every task)

1. `make typecheck` (always).
2. Touching renderer/IPC/db/web → `make rebuild-node && <scoped vitest>`.
3. Touching a web seam → gated parity command (PG @ 55434 + `out/main/index.js`); `make pg-down` after.
4. Touching shared/web contracts → `VARLENS_WEB=1 make test`.
5. **`make format`** (Sprint A/B learning).
6. `make agent-check` before opening each PR.
7. Atomic Conventional Commit; never on `main`.

## Self-review notes

- **Spec coverage:** PR-1 (S1–S4 → tasks 1.1–1.5), PR-2 (P1–P5 → 2.1–2.6), PR-3 (V1/C1/E1/G1/G2 → 3.1–3.5). All 10 gates mapped above.
- **Refines spec (carry into spec if back-porting):** the shared layer is **session-based** fns added to `<domain>-logic.ts` (the existing `getDb` fns are SQLite-internal, not the web seam — corrects spec RC-3's "already transport-agnostic"); `transcripts`' web route is already gate-compliant and its B6 case is a **backend-parity** repository fix, not transport-drift (task 1.3/1.3b).
- **Type consistency:** shared-fn convention is `(…params, getSession: () => StorageSession[, onChange])`; matches the existing `searchVariants(…, () => session)` call site.
- **Open items the implementer resolves at task time (flagged, not hidden):** RC-6 (parity desktop backend), executor return shapes for transcripts (1.4 S1), and the per-key (a)/(b) classification for variants/cohort/export (3.1–3.3 S2).
