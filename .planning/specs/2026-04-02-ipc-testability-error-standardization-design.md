# IPC Handler Testability & Error Standardization — Design Spec

**Date:** 2026-04-02
**Version:** 0.52.0
**Branch:** `refactor/ipc-testability` (off `main`)
**Goal:** Extract testable logic from all IPC handlers, centralize `safeEmit`, and standardize renderer error handling — raising handler coverage from ~5.7% to >30%.

---

## Problem Statement

The IPC handler layer (`src/main/ipc/handlers/`) contains the highest coordination complexity in VarLens but has only 5.7% test coverage. Business logic is interleaved with Electron IPC plumbing, making it untestable without mocking `ipcMain`. Meanwhile, renderer callers use 3+ inconsistent patterns to check IPC errors, and `safeEmit` is duplicated across handler files.

---

## Approach

### A. Pure Function Extraction

Every handler file gets a companion `-logic.ts` module containing all business logic as pure, independently testable functions.

**Handler file (thin wrapper):**
```typescript
// cases.ts
ipcMain.handle('cases:list', (_e, params) =>
  wrapHandler(() => casesLogic.listCases(getDb(), params))
)
```

**Logic module (pure, testable):**
```typescript
// cases-logic.ts
export function listCases(db: Database, params: CaseSearchParams): PaginatedResult<Case> {
  // all business logic here
}
```

**Key rules:**
- Logic functions take explicit dependencies (db, logger) as parameters — no globals
- Logic functions return plain values, never touch IPC/Electron APIs
- Handler files only do: arg parsing (Zod), call logic, wrap in `wrapHandler`
- Existing handler tests migrate to test the logic module directly

### B. Centralized `safeEmit`

One shared utility replaces all local `safeEmit` definitions:

**File:** `src/main/ipc/utils/safeEmit.ts`
```typescript
import { BrowserWindow } from 'electron'

export function safeEmit(channel: string, data: unknown): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(channel, data)
}
```

Logic modules never call `safeEmit` directly. For progress-reporting handlers (import, batch-import, cohort summary), the handler passes an `onProgress` callback that the handler wires to `safeEmit`:

```typescript
// handler (thin)
ipcMain.handle('import:start', (_e, args) =>
  wrapHandler(() => importLogic.runImport(getDb(), args, {
    onProgress: (p) => safeEmit('import:progress', p)
  }))
)

// logic (pure, testable)
export async function runImport(
  db: Database,
  args: ImportArgs,
  callbacks: { onProgress: (p: ProgressUpdate) => void }
): Promise<ImportResult> {
  // calls callbacks.onProgress(...) — easily mocked in tests
}
```

### C. Standardized `isIpcError` Guard

Replace all ad-hoc renderer error checks with the canonical `isIpcError()` type guard:

```typescript
// src/shared/types/errors.ts (already exists)
export function isIpcError(value: unknown): value is SerializableError {
  return value != null && typeof value === 'object' && 'code' in value && 'error' in value
}
```

**Banned patterns** (enforced via ESLint):
- `'error' in result`
- `result.error` without `isIpcError()` guard
- `typeof result.error === 'string'`

**ESLint rule:**
```javascript
{
  files: ['src/renderer/**/*.{ts,tsx,vue}'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "BinaryExpression[operator='in'][left.value='error'][right.type='Identifier']",
      message: "Use isIpcError() from shared/types/errors instead of 'error' in result"
    }]
  }
}
```

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `src/main/ipc/utils/safeEmit.ts` | Shared safe window emit utility |
| `src/main/ipc/handlers/analysis-groups-logic.ts` | Pure logic for analysis groups |
| `src/main/ipc/handlers/annotations-logic.ts` | Pure logic for annotations |
| `src/main/ipc/handlers/auth-logic.ts` | Pure logic for auth |
| `src/main/ipc/handlers/batch-import-logic.ts` | Pure logic for batch import |
| `src/main/ipc/handlers/case-comments-logic.ts` | Pure logic for case comments |
| `src/main/ipc/handlers/case-metadata-logic.ts` | Pure logic for case metadata |
| `src/main/ipc/handlers/cases-logic.ts` | Pure logic for cases |
| `src/main/ipc/handlers/cohort-logic.ts` | Pure logic for cohort |
| `src/main/ipc/handlers/database-logic.ts` | Pure logic for database ops |
| `src/main/ipc/handlers/export-logic.ts` | Pure logic for export |
| `src/main/ipc/handlers/gene-lists-logic.ts` | Pure logic for gene lists |
| `src/main/ipc/handlers/import-logic.ts` | Pure logic for import |
| `src/main/ipc/handlers/panels-logic.ts` | Pure logic for panels |
| `src/main/ipc/handlers/presets-logic.ts` | Pure logic for presets |
| `src/main/ipc/handlers/region-files-logic.ts` | Pure logic for region files |
| `src/main/ipc/handlers/system-logic.ts` | Pure logic for system |
| `src/main/ipc/handlers/tags-logic.ts` | Pure logic for tags |
| `src/main/ipc/handlers/transcripts-logic.ts` | Pure logic for transcripts |
| `src/main/ipc/handlers/variants-logic.ts` | Pure logic for variants |
| `tests/main/handlers/*-logic.test.ts` | 19 test files (one per logic module) |

### Modified Files

| File | Change |
|------|--------|
| All 19 `src/main/ipc/handlers/*.ts` | Thin wrapper: delegate to `-logic.ts` |
| `eslint.config.js` | Add `no-restricted-syntax` rule for ad-hoc error checks |
| `vitest.config.ts` | Add per-glob threshold for handler logic |
| Renderer files using ad-hoc error checks | Replace with `isIpcError()` |

### Deleted Files

| File | Reason |
|------|--------|
| Local `safeEmit` definitions in handler files | Replaced by shared utility |

---

## Execution Waves

### Wave 1 — Infrastructure
- Create `src/main/ipc/utils/safeEmit.ts`
- Ensure `isIpcError` is properly exported from shared
- Add ESLint rule banning ad-hoc error checks

### Wave 2 — Handler Extraction
- Extract logic from all 19 handler files into companion `-logic.ts` modules
- Replace local `safeEmit` with shared import
- Progress-emitting handlers get callback pattern

### Wave 3 — Renderer Standardization
- Audit all renderer IPC call sites
- Replace ad-hoc error checks with `isIpcError()`
- Verify ESLint rule catches all violations

### Wave 4 — Tests & Coverage
- Write tests for all 19 logic modules
- Migrate existing handler tests to call logic directly
- Add per-glob coverage thresholds
- Run full verification (lint, typecheck, tests, coverage)

---

## Test Strategy

**Pattern:** Each test creates a real in-memory SQLite database (existing project pattern), calls the pure logic function, and asserts results. No mocking of `ipcMain`, `BrowserWindow`, or Electron APIs.

**Progress-emitting logic:** Pass `vi.fn()` as `onProgress` callback, assert call count and arguments.

**Coverage targets:**
- `src/main/ipc/handlers/*-logic.ts`: 70% lines, 60% branches
- Global thresholds stay with `autoUpdate` ratcheting

**Existing handler tests:** Migrate to call logic modules directly, removing IPC mock complexity.

---

## Success Criteria

- Handler layer coverage rises from ~5.7% to >30%
- Zero ad-hoc error checks in renderer (`isIpcError()` everywhere)
- Zero duplicate `safeEmit` definitions
- All handler files become thin wrappers (<20 lines of logic each)
- ESLint rule prevents regression of both error check patterns and raw `safeEmit`
- All existing tests continue to pass
- `npm run lint:check && npm run typecheck && npm run test` clean

---

## Research References

- Electron IPC has no built-in way to query registered handlers ([electron#38560](https://github.com/electron/electron/issues/38560)) — pure function extraction is the recommended test pattern
- Vitest supports per-glob coverage thresholds with `autoUpdate` ratcheting ([vitest PR #4442](https://github.com/vitest-dev/vitest/pull/4442))
- Thin worker entry + extracted logic is the established pattern for testable Electron workers ([vitest#3419](https://github.com/vitest-dev/vitest/discussions/3419))
