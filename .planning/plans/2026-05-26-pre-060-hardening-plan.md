# Pre-0.60 Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [.planning/specs/2026-05-26-pre-060-hardening.md](../specs/2026-05-26-pre-060-hardening.md)

**Goal:** Land the four release-blockers (PR-1), tighten IPC payload validation (PR-2), close defence-in-depth + CI gaps (PR-3), and clear the perf hot-path findings (PR-4) so VarLens can cut tag **0.59.5** (after PR-1) and **0.60.0** (after PR-2/3/4).

**Note on the codebase reality checks:** this plan was peer-reviewed against the live repo and the following four assumptions in earlier drafts were corrected:
1. There is **no `@shared` Vite/TS alias** — only `@renderer` is configured (`electron.vite.config.ts:42`). Every code snippet below uses relative imports.
2. `SerializableError` is an **interface**, not a class; `IpcResult<T> = T | SerializableError` (no `{ok, error}` wrapper); the parameter-validation code path requires adding `ErrorCode.INVALID_PARAMETERS` + a new error class + a `toSerializableError` branch (see PR2-0).
3. `BedFilter.fromFile` is called from **both** worker threads (`src/main/workers/import-worker.ts` and `src/main/workers/postgres-import-worker.ts:606`); the path allow-list lives at the IPC boundary in main, not in the worker-shared `BedFilter` (see PR2-3).
4. The `cloneForIpc` body **deliberately strips Vue `reactive()`/`ref()` proxies** via JSON round-trip (locked in by `tests/renderer/utils/cloneForIpc.test.ts:24-33`). A naive `structuredClone` swap throws `DataCloneError`. QW-5 has been moved to non-goals (Sprint A).

**Architecture:** Four independent PRs on four branches. Each task is atomic (≤ one file's worth of changes plus its test), TDD where a behaviour gate exists, and finishes with a single Conventional Commit. The plan is ordered for `superpowers:subagent-driven-development` — dispatch fresh implementer per task, two-stage review (spec compliance, then code quality) before marking complete.

**Tech Stack:** Electron 40, Vue 3 + Vuetify 4, TypeScript 6 strict, Vitest, Playwright `_electron`, better-sqlite3-multiple-ciphers (SQLCipher), PostgreSQL (pg + pg-copy-streams), Zod, electron-log, GitHub Actions.

---

## Pre-flight (controller, before dispatching any subagent)

- [ ] **Confirm branch hygiene.** From `main`, ensure working tree is clean: `git status` and `git fetch origin && git rev-list --left-right --count origin/main...main` (expect `0 0`).
- [ ] **Read the spec.** [.planning/specs/2026-05-26-pre-060-hardening.md](../specs/2026-05-26-pre-060-hardening.md). Note the four PR groupings and the eight acceptance gates.
- [ ] **Verify clean baseline.** Run `make ci` once on `main` to confirm a green starting point. If it fails, fix or call out before starting any task.

```bash
git checkout main && git pull --ff-only
make ci
```

Expected: `make ci` exits 0. If anything fails, do not begin Phase 1 work — surface to the user.

- [ ] **Pre-seed the renderer-perf baseline** (only needed before PR-4 starts; capture immediately after PR-1+PR-2+PR-3 land).

```bash
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls .planning/artifacts/perf/phase1/   # confirm latest run is captured
```

---

## Branch convention

| PR | Branch | Worktree path (optional) |
|---|---|---|
| PR-1 | `fix/release-pre-060-blockers` | `../varlens-pr1-release-blockers` |
| PR-2 | `fix/ipc-import-payload-validation` | `../varlens-pr2-ipc-validation` |
| PR-3 | `chore/security-and-ci-hygiene` | `../varlens-pr3-hygiene` |
| PR-4 | `perf/hot-path-cleanup` | `../varlens-pr4-perf` |

Create each branch from `main` immediately before that PR's first task. Worktrees recommended if working multiple PRs in parallel (see [`superpowers:using-git-worktrees`](https://github.com/anthropics/superpowers)).

```bash
git checkout main && git pull --ff-only
git checkout -b fix/release-pre-060-blockers
```

---

# PR-1 — `fix(release): pre-0.60 release blockers`

**Branch:** `fix/release-pre-060-blockers`
**Tasks:** QW-1 + QW-2 + QW-3
**Lands first; unblocks tag `0.59.5`.**

---

### Task PR1-1 (QW-1a): Hoist `sanitizeLogMessage` to shared

**Files:**
- Create: `src/shared/utils/sanitizers.ts`
- Modify: `src/renderer/src/utils/sanitizers.ts` — re-export from shared

**Context:** The current sanitizer (HGVS, genomic-coord, patient-ID regexes) is renderer-only. We need it available to the main process for QW-1b. Move the implementation to `src/shared/utils/` so both runtimes import the same code; the renderer file becomes a thin re-export so existing imports keep working.

- [ ] **Step 1: Create the shared module by copying the existing renderer file verbatim.**

```bash
cp src/renderer/src/utils/sanitizers.ts src/shared/utils/sanitizers.ts
```

- [ ] **Step 2: Verify content is unchanged.**

```bash
diff src/renderer/src/utils/sanitizers.ts src/shared/utils/sanitizers.ts
```

Expected: no output.

- [ ] **Step 3: Replace the renderer file body with a re-export.**

`src/renderer/src/utils/sanitizers.ts`:

```typescript
/**
 * Re-export of the shared sanitizer. See src/shared/utils/sanitizers.ts.
 * Kept for backwards-compatible imports across the renderer.
 */
export { sanitizeLogMessage } from '../../../shared/utils/sanitizers'
```

**Use relative imports.** The repo only configures the `@renderer` Vite alias (`electron.vite.config.ts:42`). There is no `@shared` alias — confirm with `grep -n "@shared" electron.vite.config.ts tsconfig*.json` (expect no output).

- [ ] **Step 4: Run typecheck + existing sanitizer tests.**

```bash
make typecheck
make rebuild-node && npx vitest run tests/renderer/utils/sanitizers
```

Expected: pass. If no existing test file is named that way, run `npx vitest run --reporter=verbose | grep -i sanitiz` to locate the existing tests and run them.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/utils/sanitizers.ts src/renderer/src/utils/sanitizers.ts
git commit -m "refactor(shared): hoist sanitizeLogMessage to shared utils"
```

---

### Task PR1-2 (QW-1b): Wire sanitizer into MainLogger persistence path (TDD)

**Files:**
- Modify: `src/main/services/MainLogger.ts:60-132` — wrap every `log.<level>` call AND the `emit` payload through `sanitizeLogMessage`.
- Create: `tests/main/services/main-logger-redaction.test.ts` — asserts both file-write and webContents.send paths are redacted.

**Context:** Spec acceptance gate 2 requires that `mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001')` produces a redacted line on disk AND a redacted `webContents.send` payload. The MainLogger has four level methods (debug/info/warn/error) and one private `emit` that calls `webContents.send`. Both paths must sanitise. The worker-thread `console.*` fallback in the same methods is exempt — workers can't reach BrowserWindow anyway.

- [ ] **Step 1: Write the failing test first.**

`tests/main/services/main-logger-redaction.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist the BrowserWindow + electron-log mocks before importing MainLogger.
// MainLogger.ts:22,29 imports 'electron-log/main' — mock THAT path, not /node.
const mockWebContentsSend = vi.fn()
const mockGetAllWindows = vi.fn(() => [
  { isDestroyed: () => false, webContents: { send: mockWebContentsSend } }
])
const mockFileLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mockGetAllWindows }
}))

vi.mock('electron-log/main', () => ({
  default: {
    ...mockFileLog,
    transports: { file: { getFile: () => ({ path: '/tmp/varlens-test.log' }) } }
  }
}))

describe('MainLogger PHI redaction', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFileLog.error.mockReset()
    mockFileLog.info.mockReset()
    mockWebContentsSend.mockReset()
  })

  it('redacts HGVS, coords, and patient IDs from the file-write path', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001', 'import')

    expect(mockFileLog.error).toHaveBeenCalledOnce()
    const writtenLine = mockFileLog.error.mock.calls[0][0] as string
    expect(writtenLine).toContain('[REDACTED:COORD]')
    expect(writtenLine).toContain('[REDACTED:HGVS]')
    expect(writtenLine).toContain('[REDACTED:ID]')
    expect(writtenLine).not.toContain('chr1:12345')
    expect(writtenLine).not.toContain('c.123A>G')
    expect(writtenLine).not.toContain('PATIENT-001')
  })

  it('redacts the webContents.send payload too', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.error('variant chr1:12345 c.123A>G failed for PATIENT-001', 'import')

    expect(mockWebContentsSend).toHaveBeenCalledOnce()
    const [channel, payload] = mockWebContentsSend.mock.calls[0]
    expect(channel).toBe('logs:message')
    expect(payload.message).toContain('[REDACTED:COORD]')
    expect(payload.message).toContain('[REDACTED:HGVS]')
    expect(payload.message).not.toContain('PATIENT-001')
  })

  it('does not redact a benign control message', async () => {
    const { mainLogger } = await import('../../../src/main/services/MainLogger')
    mainLogger.info('startup complete in 1.42s', 'main')

    const writtenLine = mockFileLog.info.mock.calls[0][0] as string
    expect(writtenLine).toContain('startup complete in 1.42s')
    expect(writtenLine).not.toContain('[REDACTED:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
make rebuild-node
npx vitest run tests/main/services/main-logger-redaction.test.ts
```

Expected: 3 failures (sanitizer not wired into MainLogger yet — the chr/HGVS/PATIENT-001 strings will appear in the log payload).

- [ ] **Step 3: Wire `sanitizeLogMessage` into `MainLogger`.**

Modify `src/main/services/MainLogger.ts`:

```typescript
// Add at top of file with other imports
import { sanitizeLogMessage } from '../../shared/utils/sanitizers'
```

**Relative import only** — there is no `@shared` alias in this repo (confirmed via `grep -n "@shared" electron.vite.config.ts tsconfig*.json` returns nothing). The path `../../shared/utils/sanitizers` resolves from `src/main/services/MainLogger.ts` to `src/shared/utils/sanitizers.ts`.

Update each level method (debug/info/warn/error) to sanitise *before* passing to `log` and to `emit`:

```typescript
  debug(message: string, source = 'main'): void {
    const safeMessage = sanitizeLogMessage(message)
    if (log) {
      log.debug(`[${source}] ${safeMessage}`)
    } else {
      console.debug(`[${source}] ${safeMessage}`)
    }
    this.emit('debug', safeMessage, source)
  }
```

Apply the same pattern (`const safeMessage = sanitizeLogMessage(message)`, then use `safeMessage` everywhere `message` appeared) to `info`, `warn`, and `error`. Do **not** modify `emit` itself — it now receives an already-sanitised message via every code path.

- [ ] **Step 4: Run test to verify it passes.**

```bash
npx vitest run tests/main/services/main-logger-redaction.test.ts
```

Expected: 3 passes.

- [ ] **Step 5: Run the full main-process suite to catch regressions.**

```bash
npx vitest run tests/main/
```

Expected: pass. If any existing logger test broke because it relied on a literal coord/HGVS/ID string surviving in the message, update the assertion to expect the redacted form.

- [ ] **Step 6: Commit.**

```bash
git add src/main/services/MainLogger.ts tests/main/services/main-logger-redaction.test.ts
git commit -m "fix(logger): redact PHI in MainLogger persistence and IPC paths

Wraps every level method in sanitizeLogMessage so HGVS notation,
genomic coordinates, and patient/sample IDs are scrubbed before
electron-log writes to disk and before webContents.send fan-out
to the renderer log channel.

Closes audit Rel-04 Obs-1."
```

---

### Task PR1-3 (QW-2): Backfill CHANGELOG.md for the 13 undocumented tags

**Files:**
- Modify: `CHANGELOG.md` — insert version sections between `## [Unreleased]` and `## [0.56.7] — 2026-04-23`.

**Context:** Thirteen tags between v0.56.7 and current `main` landed without changelog entries. The 13 tags are `v0.56.8`–`v0.56.14`, `v0.58.0`–`v0.58.3`, `v0.59.0`, `v0.59.3` (confirmed via `git tag --list --sort=v:refname`). v0.57.x was never tagged (history jumps 0.56.14 → 0.58.0); v0.59.1 / v0.59.2 / v0.59.4 were never tagged either. Use `git log <prev-tag>..<tag> --no-merges` per pair, grouped by Conventional Commit type. Keep section style consistent with the existing `[0.56.7]` block: `### Changed`, `### Security`, `### Internal`, `### Fixed`, `### Added` headings as appropriate. Dates come from `git log -1 --format=%ai vX.Y.Z`.

- [ ] **Step 1: Enumerate the tagged versions to backfill.**

```bash
git tag --list --sort=v:refname | awk '/^v0\.(56\.([89]|1[0-4])|58|59)/'
```

The authoritative list at the time this plan was written (confirmed via `git tag --list --sort=v:refname | tail -30`):

```
v0.56.8
v0.56.9
v0.56.10
v0.56.11
v0.56.12
v0.56.13
v0.56.14
v0.58.0
v0.58.1
v0.58.2
v0.58.3
v0.59.0
v0.59.3
```

**Thirteen** tagged-but-undocumented releases. Note the gaps: **v0.57.x was never tagged** (history jumps 0.56.14 → 0.58.0), and **v0.59.1 / v0.59.2 / v0.59.4 were never tagged either** (0.59.4 is the current `package.json` version but lives on `main` un-released). Do not invent sections for versions that were never tagged.

Re-run the command above when actually executing this task — new tags may have landed.

- [ ] **Step 2: Capture commits per tag pair.**

For each consecutive tag pair (starting at v0.56.7..v0.56.8), run:

```bash
git log v0.56.7..v0.56.8 --no-merges --pretty=format:'%h %s' --reverse | grep -v -i 'co-authored-by'
```

Group output by Conventional Commit type (`feat:` → Added, `fix:` → Fixed, `refactor:`/`perf:` → Changed, `chore:`/`ci:`/`docs:`/`style:`/`test:` → Internal, anything matching `sec`/`vuln` → Security). When in doubt about classification, prefer **Changed**.

- [ ] **Step 3: Write the changelog entries.**

For each version, insert a block in this shape — newest first, so file order is `[Unreleased]` → `[0.59.3]` → `[0.59.0]` → `[0.58.3]` → ... → `[0.56.8]` → `[0.56.7]`:

```markdown
## [0.59.3] — YYYY-MM-DD

### Added

- **Short headline.** One-to-three sentence summary of the user-visible
  change. Reference PR or issue number when discoverable from the
  commit message; otherwise omit.

### Changed

- ...

### Fixed

- ...

### Internal

- ...
```

The date is `git log -1 --format=%ai vX.Y.Z | cut -d' ' -f1`. Use the existing entries (`[0.56.7]`, `[0.56.6]`) as the style template — same bullet voice, same level of detail.

- [ ] **Step 4: Add the release-runbook note for acceptance gate 6.**

If `docs/internal/release-runbook.md` does not exist, search for the nearest equivalent:

```bash
find . -path ./node_modules -prune -o -name 'release*.md' -print 2>/dev/null | grep -v -E 'node_modules|out|dist|release/'
```

If a runbook exists, edit it. Otherwise create `.planning/docs/release-runbook.md` with this content:

```markdown
# VarLens Release Runbook

> One-page checklist for tagging a VarLens release.

## Before bumping `package.json` version

1. **Promote `## [Unreleased]` in `CHANGELOG.md`.**
   - Rename the `[Unreleased]` heading to `[X.Y.Z] — YYYY-MM-DD`.
   - Insert a new, empty `## [Unreleased]` block above it.
   - Reviewer checks: every change merged since the previous tag is reflected.
   - **Phase 1 chose runbook-line enforcement over a CI hook.** If a release
     ships with a stale changelog, that is the failure mode to learn from.
     Sprint A may add a `pre-tag` workflow step gating on a populated
     `[X.Y.Z]` block.

2. **Bump `package.json` version** to match the new heading.

3. **Tag with the same version**, prefixed `v`:
   `git tag -a vX.Y.Z -m "vX.Y.Z"`. The release workflow's
   tag↔version assertion (added in QW-3) refuses a mismatch.

## After tagging

- Push the tag: `git push origin vX.Y.Z`.
- Watch `Build` workflow on the tagged SHA; release.yml waits for it.
- Promote draft release once OS builds + signing complete.
```

- [ ] **Step 5: Verify the changelog renders cleanly.**

```bash
make docs-dev   # if docs site picks up CHANGELOG.md; otherwise skip
head -200 CHANGELOG.md
```

Expected: clean markdown, every version `[X.Y.Z] — YYYY-MM-DD` headline parses, no duplicate version sections.

- [ ] **Step 6: Commit.**

```bash
git add CHANGELOG.md .planning/docs/release-runbook.md   # or the actual runbook path
git commit -m "docs(changelog): backfill 13 undocumented tagged releases

Recovers v0.56.8-v0.56.14, v0.58.0-v0.58.3, v0.59.0, and v0.59.3 — the
13 tagged releases that landed without changelog entries. (v0.57.x and
v0.59.1/2/4 were never tagged.) Adds a release-runbook note codifying
the \"promote [Unreleased] before bumping package.json\" convention
(Phase 1 acceptance gate 6 — runbook-line form, no CI hook).

Closes audit Rel-04 Doc-1."
```

---

### Task PR1-4 (QW-3): Assert tag matches package.json in release workflow

**Files:**
- Modify: `.github/workflows/release.yml` — insert a new step in `create-release` after *Extract version from tag* and before *Verify Build workflow passed on tagged SHA*.

**Context:** Today a `v0.59.5` tag pushed against a `package.json` that still says `0.59.4` would silently produce a release whose installer reports the wrong version. Block at the workflow level.

- [ ] **Step 1: Locate the insertion point.**

```bash
grep -n 'Extract version from tag\|Verify Build workflow passed' .github/workflows/release.yml
```

Expected: line numbers for both steps (the assertion goes between them).

- [ ] **Step 2: Add the assertion step.**

Insert between the two existing steps:

```yaml
      - name: Assert tag matches package.json version
        run: |
          PKG_VERSION=$(node -p "require('./package.json').version")
          TAG_VERSION="${GITHUB_REF_NAME#v}"
          if [ "$PKG_VERSION" != "$TAG_VERSION" ]; then
            echo "::error::Tag $GITHUB_REF_NAME implies version $TAG_VERSION but package.json reports $PKG_VERSION"
            echo "::error::Bump package.json to match the tag (or retag) before releasing."
            exit 1
          fi
          echo "Tag and package.json agree on $PKG_VERSION"
```

- [ ] **Step 3: Lint the workflow file.**

```bash
# Validate yaml syntax — actionlint if present, otherwise yq
which actionlint && actionlint .github/workflows/release.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
```

Expected: no errors.

- [ ] **Step 4: Document the gate-4 dry-run verification in the PR body.**

The PR description must include the synthetic mismatched-tag test:

```text
Verification of acceptance gate 4 (will be executed on the PR feature branch after merge — destructive on main, so we do not run it pre-merge):

1. On a throwaway branch with package.json reverted to a stale version,
   push a tag whose ref does NOT match: `git tag vTEST-9.9.9 && git push origin vTEST-9.9.9`.
2. Expected: create-release job fails at the new assertion step with the
   "Tag X implies version Y but package.json reports Z" error.
3. Delete the draft release (if any) and delete the tag both locally and
   on origin.
```

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): assert tag matches package.json version

Adds a fail-fast gate in the create-release job that refuses to publish
when GITHUB_REF_NAME (without the v prefix) does not equal
package.json#version. Placed before the existing Build-workflow-success
check so we never wait on OS builders for a release that cannot ship.

Closes audit Rel-04 CR-2."
```

---

### PR-1 acceptance gates

Before opening the PR:

- [ ] **Gate 1 — `make ci-full` green.**

```bash
make ci-full
```

Expected: exits 0. If anything fails, fix before opening the PR.

- [ ] **Gate 2 — main-logger-redaction test exists and passes.**

```bash
npx vitest run tests/main/services/main-logger-redaction.test.ts
```

Expected: 3 passes.

- [ ] **Gate 6 — CHANGELOG and runbook landed.** Confirm `CHANGELOG.md` has entries for all 13 backfilled tags (v0.56.8-v0.56.14, v0.58.0-v0.58.3, v0.59.0, v0.59.3) and `## [Unreleased]` is still present (likely empty). Confirm runbook exists.

- [ ] **Open the PR.**

```bash
gh pr create --title "fix(release): pre-0.60 release blockers" --body "$(cat <<'EOF'
## Summary

- QW-1: hoist sanitizer to `src/shared/utils/sanitizers.ts` (relative import — no `@shared` alias in this repo), wire into MainLogger file + IPC paths, new redaction test
- QW-2: backfill CHANGELOG for 13 undocumented tags (v0.56.8-v0.56.14, v0.58.0-v0.58.3, v0.59.0, v0.59.3); add release-runbook line gating package.json bumps on [Unreleased] promotion
- QW-3: assert tag matches package.json in release workflow

Spec: `.planning/specs/2026-05-26-pre-060-hardening.md`

## Test plan

- [x] `make ci-full` green
- [x] `tests/main/services/main-logger-redaction.test.ts` — 3/3 pass
- [ ] **Post-merge** synthetic mismatched-tag dry run on a throwaway branch (gate 4 — destructive, cannot run pre-merge)

EOF
)"
```

After PR-1 merges, tag and ship:

```bash
git checkout main && git pull --ff-only
# Promote [Unreleased] in CHANGELOG.md per runbook, bump package.json to 0.59.5, commit.
git tag -a v0.59.5 -m "v0.59.5"
git push origin v0.59.5
```

---

# PR-2 — `fix(ipc): validate import handler payloads at runtime`

**Branch:** `fix/ipc-import-payload-validation`
**Tasks:** QW-7 (split across PR2-0..PR2-3) + QW-8 + QW-9
**Independent of PR-1 once it lands. Can branch from `main` while PR-1 is in review if worktrees are used.**

---

### Task PR2-0 (QW-7 prerequisite): Add `INVALID_PARAMETERS` error code + class + mapping

**Files:**
- Modify: `src/shared/types/errors.ts` — add `INVALID_PARAMETERS` to the `ErrorCode` enum.
- Create: `src/main/ipc/errors.ts` — new `InvalidParametersError` class.
- Modify: `src/main/ipc/errorHandler.ts:14` (`toSerializableError`) — add a branch that maps the new error class.

**Context:** The repo's existing IPC error flow is:
1. Handler `throw`s a typed Error subclass (e.g. `WrongPasswordError`, `NotFoundError` from `src/main/database/errors.ts`).
2. `wrapHandler` (at `src/main/ipc/errorHandler.ts:96`) catches and calls `toSerializableError(err)`.
3. `toSerializableError` returns a plain `SerializableError` object — `{ code, message, userMessage, details? }`. `SerializableError` is an **interface**, not a class; you do not `throw new SerializableError(...)`.
4. `IpcResult<T>` is `T | SerializableError` (per `src/shared/types/errors.ts:23`). There is **no `{ ok: false, error }` wrapper.**

For QW-7, we need an `INVALID_PARAMETERS` code and a matching error class that handlers can throw. None exists today (the current `ErrorCode` enum has 8 codes, none for parameter validation — confirmed by reading `src/shared/types/errors.ts`).

- [ ] **Step 1: Add the enum value.**

`src/shared/types/errors.ts`:

```typescript
export enum ErrorCode {
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  DB_ERROR = 'DB_ERROR',
  CANCELLED = 'CANCELLED',
  NOT_FOUND = 'NOT_FOUND',
  UNIQUE_CONSTRAINT = 'UNIQUE_CONSTRAINT',
  WRONG_PASSWORD = 'WRONG_PASSWORD',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  UNKNOWN = 'UNKNOWN'
}
```

- [ ] **Step 2: Create the error class.**

`src/main/ipc/errors.ts`:

```typescript
/**
 * Error class for IPC payload validation failures.
 *
 * Throw from a handler when a `safeParse` against an ipc-schemas.ts
 * schema returns `.success === false`. `wrapHandler` will catch it and
 * `toSerializableError` will map it to a SerializableError with
 * code === ErrorCode.INVALID_PARAMETERS.
 */
export class InvalidParametersError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string = 'The request contained invalid parameters.'
  ) {
    super(message)
    this.name = 'InvalidParametersError'
  }
}
```

- [ ] **Step 3: Add the mapping branch.**

`src/main/ipc/errorHandler.ts` — add a new branch near the other `instanceof` checks in `toSerializableError`:

```typescript
import { InvalidParametersError } from './errors'

// ... inside toSerializableError, add before the UNKNOWN fallback:
  if (error instanceof InvalidParametersError) {
    return {
      code: ErrorCode.INVALID_PARAMETERS,
      message: error.message,
      userMessage: error.userMessage
    }
  }
```

- [ ] **Step 4: Add a unit test for the mapping.**

`tests/main/ipc/errorHandler.test.ts` — extend (if it exists) or create:

```typescript
import { describe, it, expect } from 'vitest'
import { toSerializableError } from '../../../src/main/ipc/errorHandler'
import { InvalidParametersError } from '../../../src/main/ipc/errors'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('toSerializableError → InvalidParametersError', () => {
  it('maps the new error class to ErrorCode.INVALID_PARAMETERS', () => {
    const err = new InvalidParametersError('foo is required')
    const result = toSerializableError(err)
    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
    expect(result.message).toBe('foo is required')
    expect(result.userMessage).toBe('The request contained invalid parameters.')
  })

  it('honours a custom userMessage', () => {
    const err = new InvalidParametersError('chunked', 'The file path was not valid.')
    const result = toSerializableError(err)
    expect(result.userMessage).toBe('The file path was not valid.')
  })
})
```

- [ ] **Step 5: Run.**

```bash
make typecheck
make rebuild-node && npx vitest run tests/main/ipc/
```

Expected: pass.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/types/errors.ts src/main/ipc/errors.ts \
        src/main/ipc/errorHandler.ts tests/main/ipc/errorHandler.test.ts
git commit -m "feat(ipc): add INVALID_PARAMETERS error code and class

Prerequisite for QW-7 (import handler payload validation). Adds
ErrorCode.INVALID_PARAMETERS, InvalidParametersError class for handlers
to throw, and a mapping branch in toSerializableError.

Closes audit Sec-02 F-01 (error-code infrastructure half)."
```

---

### Task PR2-1 (QW-7a): Add Zod schemas for the four import IPC contracts

**Files:**
- Modify: `src/shared/types/ipc-schemas.ts` — append new schemas.

**Context:** The four import handlers (`import:start`, `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`) currently trust the renderer-supplied payload shape. We need Zod schemas in the shared module so both the main handler and (later, in a Sprint A pass) the preload typing can reuse them.

- [ ] **Step 1: Read the existing schema file to match style.**

```bash
sed -n '1,60p' src/shared/types/ipc-schemas.ts
```

Note: file uses `import { z } from 'zod'` and exports per-channel schemas (e.g. `CohortSearchParamsSchema`).

- [ ] **Step 2: Append the four import schemas.**

Append to `src/shared/types/ipc-schemas.ts`:

```typescript
/**
 * Import IPC payload schemas. Used by src/main/ipc/handlers/import.ts via
 * safeParse before any business logic runs.
 *
 * File-path validation is enforced separately in BedFilter.fromFile and
 * the import handler — these schemas only assert shape and primitive bounds.
 */

const NonEmptyTrimmedString = z.string().trim().min(1).max(4096)

export const ImportVcfOptionsSchema = z
  .object({
    selectedSample: z.string().min(1).max(255).optional(),
    genomeBuild: z.enum(['GRCh37', 'GRCh38', 'hg19', 'hg38']).optional()
  })
  .strict()
  .optional()

export const ImportStartParamsSchema = z.tuple([
  NonEmptyTrimmedString,             // filePath
  z.string().trim().min(1).max(255), // caseName
  ImportVcfOptionsSchema             // vcfOptions
])

const MultiFileImportSpecSchema = z
  .object({
    filePath: NonEmptyTrimmedString,
    format: z.enum(['vcf', 'json']),
    // The full MultiFileImportSpec has more optional fields — match
    // the existing TS type in src/shared/types/import.ts (grep first).
    selectedSample: z.string().min(1).max(255).optional()
  })
  .passthrough()

export const ImportStartMultiFileParamsSchema = z.tuple([
  z.string().trim().min(1).max(255),                              // caseName
  z.array(MultiFileImportSpecSchema).min(1).max(1000),            // files
  ImportVcfOptionsSchema,                                          // vcfOptions
  z.unknown().optional()                                           // filtersPayload (typed elsewhere)
])

export const ImportVcfPreviewParamsSchema = z.tuple([NonEmptyTrimmedString])

export const ImportVcfMultiPreviewParamsSchema = z.tuple([
  z.array(NonEmptyTrimmedString).min(1).max(1000)
])
```

Before committing the `MultiFileImportSpecSchema` fields, run:

```bash
grep -rn "MultiFileImportSpec" src/shared/types/ 2>&1 | head
```

Match the actual TS interface — `passthrough()` is intentionally permissive so we do not block legitimate fields not enumerated above. The goal is to reject *malformed* payloads (wrong type, missing required), not to enumerate every property.

- [ ] **Step 3: Typecheck.**

```bash
make typecheck
```

Expected: pass.

- [ ] **Step 4: Commit.**

```bash
git add src/shared/types/ipc-schemas.ts
git commit -m "feat(shared): add Zod schemas for import IPC handlers"
```

---

### Task PR2-2 (QW-7b): Wire `safeParse` into import handlers (TDD)

**Files:**
- Modify: `src/main/ipc/handlers/import.ts:117-175` (the four `ipcMain.handle` blocks)
- Create or extend: `tests/main/ipc/handlers/import.test.ts` — assert `INVALID_PARAMETERS` on malformed payloads

**Context:** `wrapHandler` already converts thrown errors into a `SerializableError`. We throw with a code that the renderer's `unwrapIpcResult` will surface.

- [ ] **Step 1: Locate or create the test file.**

```bash
ls tests/main/ipc/handlers/ 2>&1 | head
```

If `import.test.ts` does not exist, create it. If it does, append the new describe block.

- [ ] **Step 2: Write the failing test.**

**First**, read the existing handler test pattern in the repo so the mocks for `ipcMain.handle`, `app.getPath`, and the `registerImportHandlers` deps object are shaped consistently:

```bash
ls tests/main/ipc/handlers/
# Read the closest analogue (e.g. import-related or another domain handler test).
```

`tests/main/ipc/handlers/import.test.ts` (new) or new `describe` block in the existing file. The key shape facts: handlers return `IpcResult<T> = T | SerializableError` directly — **no `{ok, error}` wrapper**. An error result IS the `SerializableError` plain object.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

// Use the same mock pattern as other handler tests in this directory.
// `registerImportHandlers` deps object: read src/main/ipc/handlers/import.ts:84
// to see the exact shape (getSession, getDb, importCallbacks, etc.) and
// pass test doubles. Mirror an existing handler-test setup.

describe('import:start payload validation', () => {
  let handler: (event: unknown, ...args: unknown[]) => Promise<unknown>

  beforeEach(async () => {
    vi.resetModules()
    const handles: Record<string, typeof handler> = {}
    vi.mock('electron', () => ({
      ipcMain: {
        handle: (channel: string, fn: typeof handler) => {
          handles[channel] = fn
        }
      },
      app: { getPath: vi.fn((kind: string) => `/tmp/${kind}`) }
    }))
    const { registerImportHandlers } = await import(
      '../../../../src/main/ipc/handlers/import'
    )
    // Pass minimal test doubles for the deps object — match the shape at
    // src/main/ipc/handlers/import.ts:84.
    registerImportHandlers({ /* fill per actual signature */ } as never)
    handler = handles['import:start']
  })

  it('returns SerializableError with INVALID_PARAMETERS for empty filePath', async () => {
    const result = await handler({}, '', 'My Case')
    expect(isIpcError(result)).toBe(true)
    if (isIpcError(result)) {
      expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
    }
  })

  it('returns INVALID_PARAMETERS when caseName missing', async () => {
    const result = await handler({}, '/tmp/x.vcf', '')
    expect(isIpcError(result)).toBe(true)
    if (isIpcError(result)) {
      expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
    }
  })
})
```

The load-bearing assertion is `isIpcError(result) && result.code === ErrorCode.INVALID_PARAMETERS`. `isIpcError` is the existing type guard at `src/shared/types/errors.ts:26`.

- [ ] **Step 3: Run the test — expect failure.**

```bash
make rebuild-node
npx vitest run tests/main/ipc/handlers/import.test.ts
```

Expected: failure (no validation yet — handler will either succeed or throw a non-INVALID_PARAMETERS error).

- [ ] **Step 4: Wire safeParse into the four handlers.**

Modify `src/main/ipc/handlers/import.ts`. At top (use **relative imports** — no `@shared` alias):

```typescript
import {
  ImportStartParamsSchema,
  ImportStartMultiFileParamsSchema,
  ImportVcfPreviewParamsSchema,
  ImportVcfMultiPreviewParamsSchema
} from '../../../shared/types/ipc-schemas'
import { InvalidParametersError } from '../errors'
```

For each handler, add `safeParse` at the start of the `wrapHandler` callback. **Throw `InvalidParametersError` (the class added in PR2-0) — do not `throw new SerializableError(...)`; SerializableError is an interface.** `wrapHandler` catches the error and `toSerializableError` maps it to `{ code: ErrorCode.INVALID_PARAMETERS, ... }`.

Example for `import:start`:

```typescript
  ipcMain.handle(
    'import:start',
    async (
      _event,
      filePath: string,
      caseName: string,
      vcfOptions?: { selectedSample?: string; genomeBuild?: string }
    ) => {
      return wrapHandler(async () => {
        const parsed = ImportStartParamsSchema.safeParse([filePath, caseName, vcfOptions])
        if (!parsed.success) {
          throw new InvalidParametersError(
            `Invalid import:start params: ${parsed.error.message}`
          )
        }
        const [validatedPath, validatedCaseName, validatedOptions] = parsed.data
        return startImport(validatedPath, validatedCaseName, validatedOptions, getSession, importCallbacks)
      })
    }
  )
```

Apply the same pattern to `import:startMultiFile`, `import:vcfPreview`, `import:vcfMultiPreview`. Use the parsed/validated values for the downstream call, not the raw IPC args.

- [ ] **Step 5: Run the test — expect pass.**

```bash
npx vitest run tests/main/ipc/handlers/import.test.ts
```

Expected: pass.

- [ ] **Step 6: Run the full handler suite + the preload contract test.**

```bash
npx vitest run tests/main/ tests/shared/types/preload-contract.test.ts
```

Expected: pass. The preload contract test is a project-rule guardrail — must stay green.

- [ ] **Step 7: Commit.**

```bash
git add src/main/ipc/handlers/import.ts tests/main/ipc/handlers/import.test.ts
git commit -m "fix(ipc): validate import handler payloads at runtime

Wires safeParse on the four import:* IPC handlers. Malformed payloads
now return SerializableError with code 'INVALID_PARAMETERS', surfaced
to the renderer via unwrapIpcResult.

Closes audit Sec-02 F-01 (payload validation half)."
```

---

### Task PR2-3 (QW-7c): Path validation at IPC boundary + worker-safe defensive check

**Files:**
- Create: `src/main/security/import-path-allowlist.ts` — Electron-aware allow-list, main-process only.
- Modify: `src/main/ipc/handlers/import.ts` — register dialog-picked paths and validate IPC-supplied paths before dispatching to either worker.
- Modify: `src/main/import/vcf/bed-filter.ts:28-31` — add a worker-safe defensive check (no Electron imports).
- Create: `tests/main/security/import-path-allowlist.test.ts` — unit test the allow-list.
- Create or extend: `tests/main/import/vcf/bed-filter.test.ts` — assert the defensive check rejects relative and `..`-containing paths.

**Context (corrected vs. the earlier draft).** `BedFilter.fromFile` is called from **two** workers:
- `src/main/workers/import-worker.ts` (SQLite import)
- `src/main/workers/postgres-import-worker.ts:606` (PG import)

Worker threads **cannot import `electron`** (no IPC, no `app.getPath`). The earlier draft put the allow-list inside `BedFilter` and tried to import `electron` from a worker-shared file — that breaks the PG worker silently for any legitimate BED path outside `home/userData/temp`. The correct boundary is:

1. **Allow-list lives in main only.** Every dialog (`import:selectFile`, `import:selectFiles`, `import:selectBedFile`) registers the picked paths. Every `import:start*` IPC handler **validates the inbound `filePath` and any nested BED path** against the allow-list *before* dispatching to a worker.
2. **`BedFilter.fromFile` keeps a defensive check** that is worker-safe (only `path.resolve` — no Electron, no fs walking): reject relative paths, reject paths whose resolved form contains `..`. This is defence-in-depth — the IPC-boundary check is the real gate.

- [ ] **Step 1: Write the failing tests.**

`tests/main/security/import-path-allowlist.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAllowedImportPath,
  isAllowedImportPath,
  __resetAllowlistForTests
} from '../../../src/main/security/import-path-allowlist'

describe('import-path-allowlist', () => {
  beforeEach(() => __resetAllowlistForTests())

  it('rejects /etc/passwd', () => {
    expect(isAllowedImportPath('/etc/passwd')).toBe(false)
  })

  it('accepts a previously-registered dialog path', () => {
    addAllowedImportPath('/some/custom/mount/file.vcf')
    expect(isAllowedImportPath('/some/custom/mount/file.vcf')).toBe(true)
  })

  it('accepts paths under app.getPath(temp) via the env-fallback', () => {
    // Test context — app.getPath throws; fallback to TMPDIR/HOME/'/tmp'
    expect(isAllowedImportPath('/tmp/inside-tmp.bed')).toBe(true)
  })
})
```

`tests/main/import/vcf/bed-filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { BedFilter } from '../../../../src/main/import/vcf/bed-filter'

describe('BedFilter.fromFile worker-safe defensive check', () => {
  it('rejects relative paths', () => {
    expect(() => BedFilter.fromFile('relative/foo.bed', 0)).toThrow(
      /must be an absolute path/i
    )
  })

  it('rejects paths containing .. after resolve', () => {
    expect(() => BedFilter.fromFile('/tmp/../etc/shadow', 0)).toThrow(
      /must not contain '\.\.'/i
    )
  })

  it('passes the defensive check for an absolute path that does not exist (fails on read, not on guard)', () => {
    expect(() => BedFilter.fromFile('/tmp/does-not-exist.bed', 0)).toThrow(
      /ENOENT|no such file/i
    )
  })
})
```

- [ ] **Step 2: Run — expect failures on both files.**

```bash
make rebuild-node
npx vitest run tests/main/security/ tests/main/import/vcf/bed-filter.test.ts
```

Expected: allow-list module does not exist yet; BedFilter has no guard.

- [ ] **Step 3: Create the main-only allow-list.**

`src/main/security/import-path-allowlist.ts`:

```typescript
import { app } from 'electron'
import { resolve, sep } from 'path'

/**
 * In-memory session allow-list of paths the user explicitly picked via an
 * Electron file dialog this session, plus the three Electron-managed
 * directory roots (home, userData, temp). Cleared on app restart.
 *
 * Main-process only. Workers cannot import 'electron' and therefore cannot
 * consult this allow-list — they receive paths that main has already
 * validated. BedFilter.fromFile keeps a worker-safe defensive check as
 * defence-in-depth.
 *
 * Phase 1 (Pre-0.60 Hardening). See spec QW-7.
 */
const dialogAllowedPaths = new Set<string>()

export function addAllowedImportPath(absolutePath: string): void {
  dialogAllowedPaths.add(resolve(absolutePath))
}

export function isAllowedImportPath(candidate: string): boolean {
  const abs = resolve(candidate)

  if (dialogAllowedPaths.has(abs)) return true

  // Allow anything under the three Electron-managed roots.
  // app.getPath throws in non-Electron contexts (tests without
  // mocked electron); fall back to env-based defaults so unit tests work.
  const roots: string[] = []
  try {
    roots.push(app.getPath('home'), app.getPath('userData'), app.getPath('temp'))
  } catch {
    if (process.env.TMPDIR) roots.push(process.env.TMPDIR)
    if (process.env.HOME) roots.push(process.env.HOME)
    roots.push('/tmp')
  }

  return roots.some((root) => {
    const normalisedRoot = resolve(root)
    return abs === normalisedRoot || abs.startsWith(normalisedRoot + sep)
  })
}

/** Test-only reset helper. Do not call from production code. */
export function __resetAllowlistForTests(): void {
  dialogAllowedPaths.clear()
}
```

- [ ] **Step 4: Add the worker-safe defensive check in `BedFilter.fromFile`.**

Modify `src/main/import/vcf/bed-filter.ts`. **Do not import `electron`** — this module is loaded by workers.

```typescript
import { resolve, isAbsolute } from 'path'

  static fromFile(filePath: string, padding: number): BedFilter {
    // QW-7 worker-safe defensive check (no Electron imports — this file
    // is loaded by both src/main/workers/import-worker.ts and
    // src/main/workers/postgres-import-worker.ts). The full allow-list
    // check happens at the IPC boundary in main; this is defence-in-depth.
    if (!isAbsolute(filePath)) {
      throw new Error(`BedFilter.fromFile: path must be an absolute path: ${filePath}`)
    }
    const resolved = resolve(filePath)
    if (resolved !== filePath || resolved.split('/').includes('..')) {
      throw new Error(
        `BedFilter.fromFile: path must not contain '..' segments: ${filePath}`
      )
    }
    const raw = filePath.endsWith('.gz')
      ? gunzipSync(readFileSync(filePath)).toString('utf-8')
      : readFileSync(filePath, 'utf-8')
    // ... rest unchanged
```

The `resolved !== filePath` half catches `/tmp/../etc/shadow` (resolves to `/etc/shadow`); the explicit `.includes('..')` catches anything that survived `resolve()` (e.g. on edge-case platforms).

- [ ] **Step 5: Register dialog-picked paths and validate IPC-supplied paths in main.**

In `src/main/ipc/handlers/import.ts`, **all three** dialog handlers must register their result, and **all four** start/preview handlers must validate their inbound path(s) against the allow-list.

```typescript
import {
  addAllowedImportPath,
  isAllowedImportPath
} from '../../security/import-path-allowlist'
import { InvalidParametersError } from '../errors'
```

**5a. Register dialog-picked paths** — after each `dialog.showOpenDialog` success, in:
- `import:selectFile` (line 90)
- `import:selectFiles` (line 177)
- `import:selectBedFile` (line 200) — **critical**: feeds `BedFilter.fromFile`

```typescript
for (const p of result.filePaths) {
  addAllowedImportPath(p)
}
```

**5b. Validate IPC-supplied paths** — inside each start/preview handler's `wrapHandler` callback, *after* the Zod `safeParse` (PR2-2) and *before* dispatching to a worker:

```typescript
// import:start
if (!isAllowedImportPath(validatedPath)) {
  throw new InvalidParametersError(
    `import:start: filePath is not in the allowed import paths: ${validatedPath}`,
    'The selected file is not in an allowed location.'
  )
}
```

For `import:startMultiFile`, validate every `files[i].filePath` AND the BED-file path inside `filtersPayload` (if present). For `import:vcfPreview` and `import:vcfMultiPreview`, validate the single path / each path in the array.

**5c. Verify** by grepping the file after edits:

```bash
grep -B1 -A2 'addAllowedImportPath\|isAllowedImportPath' src/main/ipc/handlers/import.ts
```

Expected: three matches inside the three `import:select*` handlers (5a) and at least four matches inside the four `import:start*` / `import:vcf*Preview` handlers (5b).

- [ ] **Step 6: Run — expect pass.**

```bash
make rebuild-node
npx vitest run tests/main/security/ tests/main/import/vcf/bed-filter.test.ts tests/main/ipc/handlers/import.test.ts tests/main/
```

Expected: pass. The full `tests/main/` sweep catches any handler test that was relying on un-validated paths.

- [ ] **Step 7: Commit.**

```bash
git add src/main/security/import-path-allowlist.ts \
        src/main/import/vcf/bed-filter.ts \
        src/main/ipc/handlers/import.ts \
        tests/main/security/import-path-allowlist.test.ts \
        tests/main/import/vcf/bed-filter.test.ts
git commit -m "fix(import): validate import paths at IPC boundary, defence-in-depth in BedFilter

Adds src/main/security/import-path-allowlist.ts — a main-only session
allow-list of dialog-picked paths plus app.getPath('home'/'userData'/'temp').
The four import:* IPC handlers reject unallowed paths before dispatching
to either SQLite or PG worker.

BedFilter.fromFile (loaded by both workers — postgres-import-worker.ts:606
and import-worker.ts) gets a worker-safe defensive check: absolute path
required, no '..' segments. No Electron imports in the worker-shared path.

Closes audit Sec-02 F-01 (path-traversal half)."
```

---

### Task PR2-4 (QW-8): Validate `system:setWorkerThreads` count

**Files:**
- Modify: `src/main/ipc/handlers/system.ts:71-75`

**Context:** Renderer passes an integer that becomes the worker-pool size. Reject NaN, negatives, anything over 64.

- [ ] **Step 1: Add the schema usage inline.**

```typescript
import { z } from 'zod'
import { InvalidParametersError } from '../errors'
// ... if not already imported

const SetWorkerThreadsCountSchema = z.number().int().min(0).max(64)

  ipcMain.handle('system:setWorkerThreads', async (_event, count: number) => {
    return wrapHandler(async () => {
      const parsed = SetWorkerThreadsCountSchema.safeParse(count)
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid system:setWorkerThreads count: ${parsed.error.message}`
        )
      }
      setWorkerThreads(parsed.data)
    })
  })
```

`InvalidParametersError` is the new error class from PR2-0. Do **not** `throw new SerializableError(...)` — `SerializableError` is an interface (`src/shared/types/errors.ts:13`), not a class.

- [ ] **Step 2: Add a single quick test in the relevant existing handler test file** (or extend `system.test.ts` if present). Assertion shape matches the actual IPC result type (`T | SerializableError`, no `{ok, error}` wrapper):

```typescript
import { ErrorCode, isIpcError } from '../../../../src/shared/types/errors'

it('system:setWorkerThreads rejects negative count with INVALID_PARAMETERS', async () => {
  const result = await handler({}, -1)
  expect(isIpcError(result)).toBe(true)
  if (isIpcError(result)) expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
})

it('system:setWorkerThreads rejects 65 with INVALID_PARAMETERS', async () => {
  const result = await handler({}, 65)
  expect(isIpcError(result)).toBe(true)
  if (isIpcError(result)) expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
})
```

- [ ] **Step 3: Run.**

```bash
npx vitest run tests/main/ipc/handlers/
```

Expected: pass.

- [ ] **Step 4: Commit.**

```bash
git add src/main/ipc/handlers/system.ts tests/main/ipc/handlers/
git commit -m "fix(ipc): validate system:setWorkerThreads count (0..64)

Closes audit Sec-02 F-02."
```

---

### Task PR2-5 (QW-9a): Cap `UserDomainsSchema` length

**Files:**
- Modify: `src/main/ipc/handlers/shell.ts:24`

**Context:** Current schema is `z.array(z.string().min(1).max(253))`. Cap the array length so a renderer can't push an arbitrary-size list.

- [ ] **Step 1: Tighten the schema.**

```typescript
const UserDomainsSchema = z.array(z.string().min(1).max(253)).max(100)
```

- [ ] **Step 2: Run the shell handler tests.**

```bash
npx vitest run tests/main/ipc/handlers/  # any shell handler tests live here
```

Expected: pass. If no shell-handler test exists, the behaviour is already covered by the existing `safeParse` error path at `shell.ts:30-37`.

- [ ] **Step 3: Commit (will batch with PR2-6 below).**

Hold the commit until QW-9b lands too, then commit both together.

---

### Task PR2-6 (QW-9b): Reject hex-literal SQLCipher keys

**Files:**
- Modify: `src/main/database/DatabaseService.ts:74` and `:304` — the two `pragma(\`key=…\`)` / `pragma(\`rekey=…\`)` call sites.

**Context:** SQLCipher accepts both quoted-string keys (`PRAGMA key='secret'`) and hex literals (`PRAGMA key="x'0102030405...'"`). The existing escape only doubles single quotes, which means a hex-literal-form key bypasses the quoting and could rebind to a different key.

- [ ] **Step 1: Add a guard helper near the top of the file.**

```typescript
function assertNotHexLiteralKey(key: string): void {
  // SQLCipher hex-literal syntax: x'<hex>' or X'<hex>'. Even after
  // single-quote doubling, an attacker-supplied key starting with x'/X'
  // can escape the quoted-string interpretation. Reject up-front.
  if (/^[xX]'/.test(key)) {
    throw new DatabaseError(
      'Encryption key cannot start with hex-literal prefix (x\\'/X\\').'
    )
  }
}
```

- [ ] **Step 2: Call the guard before each `pragma` invocation.**

`src/main/database/DatabaseService.ts:74` (constructor):

```typescript
      if (this.encrypted) {
        assertNotHexLiteralKey(encryptionKey!)
        const safeKey = encryptionKey!.split("'").join("''")
        this.db.pragma(`key='${safeKey}'`)
      }
```

`src/main/database/DatabaseService.ts:304` (rekey):

```typescript
  rekey(newPassword: string): void {
    try {
      assertNotHexLiteralKey(newPassword)
      const safePassword = newPassword.split("'").join("''")
      this.db.pragma(`rekey='${safePassword}'`)
    } catch (error) {
      throw new DatabaseError(
        'Failed to change database encryption key',
        error instanceof Error ? error : undefined
      )
    }
  }
```

- [ ] **Step 3: Check for worker analogues.**

```bash
grep -rn "pragma(.key='" src/main/ 2>&1
```

Expected: any other PRAGMA-key site (e.g. db-worker analogues) must get the same guard.

- [ ] **Step 4: Add tests.**

`tests/main/database/DatabaseService.test.ts` (extend existing or add a `describe`):

```typescript
import { describe, it, expect } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('DatabaseService PRAGMA-key hex-literal guard', () => {
  it("rejects encryption key starting with x'", () => {
    expect(() => new DatabaseService(':memory:', "x'0102'")).toThrow(/hex-literal/i)
  })
  it("rejects encryption key starting with X'", () => {
    expect(() => new DatabaseService(':memory:', "X'aabbcc'")).toThrow(/hex-literal/i)
  })
  it('accepts a normal quoted-string key', () => {
    expect(() => new DatabaseService(':memory:', 'correct horse battery staple')).not.toThrow()
  })
})
```

- [ ] **Step 5: Run.**

```bash
make rebuild-node && npx vitest run tests/main/database/
```

Expected: pass.

- [ ] **Step 6: Commit both QW-9 halves together.**

```bash
git add src/main/ipc/handlers/shell.ts \
        src/main/database/DatabaseService.ts \
        tests/main/database/DatabaseService.test.ts
git commit -m "fix(security): cap user-domains list and reject hex-literal PRAGMA keys

- UserDomainsSchema now max(100) entries (Sec-02 F-04)
- DatabaseService.encryptionKey + rekey reject keys starting with x'/X'
  to prevent SQLCipher hex-literal-syntax bypass of single-quote escaping
  (Sec-02 F-05)"
```

If `grep` in Step 3 surfaced worker analogues, include them in this same commit.

---

### PR-2 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 5.** Three assertions across three test files:
  - `tests/main/ipc/errorHandler.test.ts` — `InvalidParametersError` maps to `ErrorCode.INVALID_PARAMETERS` (PR2-0).
  - `tests/main/ipc/handlers/import.test.ts` — malformed `import:start` returns a `SerializableError` whose `code === ErrorCode.INVALID_PARAMETERS` (PR2-2).
  - `tests/main/security/import-path-allowlist.test.ts` — `isAllowedImportPath('/etc/passwd')` returns `false` (PR2-3).
  - `tests/main/import/vcf/bed-filter.test.ts` — defensive check rejects relative paths and `..` (PR2-3).

```bash
gh pr create --title "fix(ipc): validate import handler payloads at runtime" --body "$(cat <<'EOF'
## Summary

- PR2-0 (QW-7 prereq): add ErrorCode.INVALID_PARAMETERS + InvalidParametersError class + toSerializableError mapping
- PR2-1/PR2-2 (QW-7a/b): Zod schemas in src/shared/types/ipc-schemas.ts; safeParse on the four import:* handlers; throw InvalidParametersError on failure
- PR2-3 (QW-7c): main-only path allow-list (src/main/security/import-path-allowlist.ts); IPC handlers validate before dispatching to either worker; BedFilter.fromFile gets worker-safe defensive check (no Electron import — BedFilter is loaded by both SQLite and PG workers)
- QW-8: validate system:setWorkerThreads count (0..64)
- QW-9: cap user-domains list at 100; reject hex-literal SQLCipher PRAGMA keys

Spec: `.planning/specs/2026-05-26-pre-060-hardening.md`

## Test plan

- [x] make ci-full
- [x] tests/main/ipc/errorHandler.test.ts — INVALID_PARAMETERS mapping
- [x] tests/main/ipc/handlers/import.test.ts — INVALID_PARAMETERS on malformed payload
- [x] tests/main/security/import-path-allowlist.test.ts — /etc/passwd rejected, dialog paths allow-listed
- [x] tests/main/import/vcf/bed-filter.test.ts — defensive check rejects relative + '..'
- [x] tests/main/database/DatabaseService.test.ts — hex-literal key rejection
EOF
)"
```

---

# PR-3 — `chore: security + CI hygiene`

**Branch:** `chore/security-and-ci-hygiene`
**Tasks:** QW-4 + QW-6 + QW-12 + QW-13 + QW-15
**Independent of PR-1 and PR-2.**

---

### Task PR3-1 (QW-4): `npm audit fix` for the moderate transitive

**Files:**
- Modify: `package-lock.json` (auto-generated)
- Modify (if needed): `package.json` — only if the fix requires a top-level pin

**Context:** Audit lists one moderate-severity advisory on `qs` (transitive via `pg`).

- [ ] **Step 1: Snapshot current state.**

```bash
npm audit --omit=dev --json > /tmp/audit-before.json
jq '.metadata.vulnerabilities' /tmp/audit-before.json
```

- [ ] **Step 2: Run the fix.**

```bash
npm audit fix --omit=dev
```

If `npm audit fix` cannot resolve without `--force`, **do not** use `--force` blindly — instead read the advisory, identify which transitive needs `overrides` in `package.json`, and add a minimal override:

```json
"overrides": {
  "qs": "^6.13.0"
}
```

- [ ] **Step 3: Verify.**

```bash
npm audit --omit=dev
```

Expected: `found 0 vulnerabilities`.

- [ ] **Step 4: Run the test suite to confirm nothing regressed.**

```bash
make rebuild-node && make test
```

Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): npm audit fix (qs moderate via pg)

Closes audit §3.2 (release-readiness)."
```

---

### Task PR3-2 (QW-6): `will-navigate` guard in main window

**Files:**
- Modify: `src/main/index.ts:createWindow`

**Context:** `setWindowOpenHandler` covers `window.open` paths but not in-page navigations. Spec acceptance: only `rendererUrl` (in dev) and `file://` (in prod) allowed.

**Codebase reality check:** in the current `src/main/index.ts`, `rendererUrl` is declared at line 101 — **after** `setWindowOpenHandler` at line 86 and after the new `will-navigate` block would otherwise be inserted. The declaration must be hoisted before both handlers, and the production case where `rendererUrl` is `undefined` must be handled.

- [ ] **Step 1: Read the current `createWindow` body.**

```bash
sed -n '58,105p' src/main/index.ts
```

Expected: `BrowserWindow` constructor → `mainWindow.on('ready-to-show', ...)` → `setWindowOpenHandler` → comment → `const rendererUrl = process.env['ELECTRON_RENDERER_URL']` → `if (is.dev && rendererUrl !== undefined && rendererUrl !== '')` block.

- [ ] **Step 2: Hoist `rendererUrl` to the top of `createWindow`, immediately after the `BrowserWindow` constructor.**

```typescript
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    /* ...unchanged constructor args... */
  })

  // HMR for renderer based on electron-vite cli. Hoisted from below so
  // both setWindowOpenHandler and the will-navigate guard can use it.
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  mainWindow.on('ready-to-show', () => {
    /* unchanged */
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    /* unchanged */
  })
```

- [ ] **Step 3: Add the will-navigate guard immediately after `setWindowOpenHandler`.**

```typescript
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Dev: allow the renderer URL. Prod: rendererUrl is undefined, only file:// is allowed.
    const allowed =
      (rendererUrl !== undefined && rendererUrl !== '' && url.startsWith(rendererUrl)) ||
      url.startsWith('file://')
    if (!allowed) {
      mainLogger.warn(
        `Blocked in-page navigation to disallowed URL: ${url}`,
        'main-window'
      )
      event.preventDefault()
    }
  })
```

- [ ] **Step 4: Confirm the `if (is.dev && rendererUrl !== undefined ...)` block below still uses `rendererUrl` correctly** (no change needed — the variable is now declared higher in the same scope).

- [ ] **Step 5: Confirm `mainLogger` is imported at the top of `src/main/index.ts`; if not, add `import { mainLogger } from './services/MainLogger'`.**

- [ ] **Step 3: Typecheck and run main-process tests.**

```bash
make typecheck
make rebuild-node && npx vitest run tests/main/
```

- [ ] **Step 4: Commit.**

```bash
git add src/main/index.ts
git commit -m "fix(main): block in-page navigations to disallowed URLs

Adds a will-navigate guard alongside the existing
setWindowOpenHandler so renderer-initiated location changes
cannot escape the renderer URL or file:// scheme.

Closes audit Sec-02 F-10."
```

---

### Task PR3-3 (QW-12 + QW-13): Tighten the Build workflow gates

**Files:**
- Modify: `.github/workflows/build.yml`

**Context:**
- QW-12: the existing "all-builds-pass" or similar status job at `:266-281` interprets cancelled/skipped as success. Treat them as failure unless the entire job set was skipped because no code changed.
- QW-13: the `code:` path filter currently excludes workflow files. A workflow edit can ship without the pipeline that should have validated it. Include `.github/workflows/**`.

- [ ] **Step 1: Read the file to confirm line numbers and the exact `code:` filter shape.**

```bash
sed -n '1,60p' .github/workflows/build.yml
sed -n '260,290p' .github/workflows/build.yml
```

- [ ] **Step 2: Update the `paths` / `paths-ignore` filter.** Add `.github/workflows/**` to the `code:` path filter (if filters live in a `paths-filter` action) or to the top-level workflow `on.push.paths` block, whichever the project uses.

If the file uses `dorny/paths-filter` (common pattern):

```yaml
- uses: dorny/paths-filter@...
  id: changes
  with:
    filters: |
      code:
        - 'src/**'
        - 'tests/**'
        - 'package.json'
        - 'package-lock.json'
        - 'Makefile'
        - '.github/workflows/**'   # QW-13: workflow edits must run the pipeline
```

Match the existing surrounding indentation and key order.

- [ ] **Step 3: Tighten the status-aggregation job.** Find the job around `:266-281` that checks `needs.*.result` to set overall status. Change so cancelled / skipped count as failure unless `needs.changes.outputs.code == 'false'`:

```yaml
  build-status:
    if: ${{ always() }}
    needs: [changes, build-linux, build-macos, build-windows, startup-smoke]
    runs-on: ubuntu-latest
    steps:
      - name: Compute overall result
        run: |
          if [ "${{ needs.changes.outputs.code }}" = "false" ]; then
            echo "No code changed — build jobs were intentionally skipped. PASS."
            exit 0
          fi
          for r in \
            "${{ needs.build-linux.result }}" \
            "${{ needs.build-macos.result }}" \
            "${{ needs.build-windows.result }}" \
            "${{ needs.startup-smoke.result }}"; do
            if [ "$r" != "success" ]; then
              echo "::error::Required job result was '$r' (expected 'success'). Failing."
              exit 1
            fi
          done
          echo "All required jobs succeeded."
```

Adjust the `needs:` list and the iterated result names to match what is already in the file — do not invent job names. The principle is: **anything other than `success` is a failure**, with the single exception of the `changes.outputs.code == 'false'` short-circuit.

- [ ] **Step 4: Lint the workflow.**

```bash
which actionlint && actionlint .github/workflows/build.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"
```

- [ ] **Step 5: Commit.**

```bash
git add .github/workflows/build.yml
git commit -m "ci(build): treat cancelled/skipped as failure and gate on workflow edits

QW-12: build-status job now fails on any non-success result from the
required jobs, except when no code changed (changes.code == 'false').
QW-13: code filter now includes .github/workflows/** so workflow edits
must pass the same pipeline they modify.

Closes audit Rel-04 CR-1, CR-3."
```

---

### Task PR3-4 (QW-15): Startup warn when PG profile secret store is insecure

**Files:**
- Modify: `src/main/ipc/handlers/database.ts` near line 161 (the existing `VARLENS_POSTGRES_PROFILE_SECRET_STORE === 'insecure-local'` branch)

**Context:** Today the insecure mode silently activates. Add a `mainLogger.warn` at the point of activation, naming the env var.

- [ ] **Step 1: Locate the conditional.**

```bash
sed -n '155,175p' src/main/ipc/handlers/database.ts
```

- [ ] **Step 2: Add the warn at first activation.**

If the branch is evaluated per call, emit at most once. The simplest approach is a module-level flag:

```typescript
let insecureSecretStoreWarned = false

function warnIfInsecureSecretStore(): void {
  if (insecureSecretStoreWarned) return
  if (process.env.VARLENS_POSTGRES_PROFILE_SECRET_STORE === 'insecure-local') {
    mainLogger.warn(
      'VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local is active. ' +
        'PostgreSQL profile credentials are stored in plaintext. ' +
        'Unset this env var or set it to a secure backend before any production-like workflow.',
      'database-handler'
    )
    insecureSecretStoreWarned = true
  }
}
```

Call `warnIfInsecureSecretStore()` immediately before the existing branch at `:161`. Import `mainLogger` if not already imported in this file.

- [ ] **Step 3: Run main-process tests.**

```bash
make rebuild-node && npx vitest run tests/main/
```

- [ ] **Step 4: Commit.**

```bash
git add src/main/ipc/handlers/database.ts
git commit -m "fix(security): warn at startup when PG profile secret store is insecure

When VARLENS_POSTGRES_PROFILE_SECRET_STORE=insecure-local activates the
plaintext store, mainLogger now emits a warn once per session naming
the env var and recommending a secure backend.

Closes audit Sec-02 F-06."
```

---

### PR-3 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 3.** `npm audit --omit=dev` returns 0 critical / 0 high / 0 moderate.

```bash
gh pr create --title "chore: security + CI hygiene" --body "$(cat <<'EOF'
## Summary

- QW-4: npm audit fix (qs moderate via pg)
- QW-6: will-navigate guard in main window
- QW-12 + QW-13: Build workflow — fail on cancelled/skipped, include workflow edits in code: filter
- QW-15: startup warn when PG profile secret store is insecure

Spec: `.planning/specs/2026-05-26-pre-060-hardening.md`

## Test plan

- [x] make ci-full
- [x] npm audit --omit=dev → 0/0/0
EOF
)"
```

---

# PR-4 — `perf: hot-path cleanup`

**Branch:** `perf/hot-path-cleanup`
**Tasks:** QW-10 + QW-11 + QW-14 + QW-16
**Lands last so the renderer-perf-phase1 baseline (gate 7) compares against the post-PR-1/2/3 state.**

**Note:** QW-5 (`cloneForIpc` → `structuredClone`) was **dropped from Phase 1** during peer review. The current `cloneForIpc` body deliberately strips Vue `reactive()`/`ref()` proxies via JSON round-trip — locked in by `tests/renderer/utils/cloneForIpc.test.ts:24-33`. A naive `structuredClone` swap throws `DataCloneError` on Vue proxies. The proper fix requires splitting "strip proxies" (renderer, Vue-aware) from "deep clone" (cross-process, can use `structuredClone`) — sized for Sprint A. See spec Non-goals.

---

### Task PR4-0 (controller): Capture renderer-perf baseline

Before opening PR-4, with PR-1, PR-2, PR-3 already on `main`:

```bash
git checkout main && git pull --ff-only
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls -lt .planning/artifacts/perf/phase1/ | head -5
```

Note the most recent artifact filename — that is the **before** baseline for gate 7.

---

### Task PR4-1 (QW-10): Add `idx_variants_case_type`

**Files:**
- Modify: `src/main/database/migrations.ts` — append a new migration.

**Context:** Cohort queries filter on `case_id` first. The existing `idx_variants_type_case (variant_type, case_id)` is intentionally retained — `variant-extension-registry.ts:50/80/116` documents the planner relying on it for `variant_type`-first reads. Spec confirms: add the new index, keep the old one, defer any drop.

- [ ] **Step 1: Locate the existing migration tail and confirm the next version.**

```bash
grep -n "PRAGMA user_version" src/main/database/migrations.ts | tail -10
tail -60 src/main/database/migrations.ts
```

The latest `PRAGMA user_version` at the time of writing is **27** (at `migrations.ts:1718`). The new migration is **v28**. Re-run the grep when actually executing — if `main` has moved, use whatever the next integer is.

- [ ] **Step 2: Append migration v28 in the same shape as v27.**

Open `migrations.ts` and copy the structural shape of the v27 block (read 30 lines above `PRAGMA user_version = 27` to see the version-check + try/catch wrapping pattern). The new block, expressed in the same idiom:

```typescript
// Migration v28: add idx_variants_case_type for case_id-first cohort scans
// QW-10 (Phase 1 Pre-0.60 Hardening, audit Perf-01 #4/#10)
// Keeps the existing idx_variants_type_case (variant_type, case_id) intact
// because the variant-extension-registry planner reasoning depends on it.
if (currentVersion < 28) {
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_variants_case_type ON variants(case_id, variant_type)'
  )
  db.exec('PRAGMA user_version = 28')
}
```

The exact statement shape must match what the file already does — `migrations.ts` is a flat sequential `if`-chain on `user_version`, not a registry array. Read v25/v26/v27 in the file before writing v28.

- [ ] **Step 2a: Update the migration version-history test if one exists.**

```bash
grep -rn "user_version\|migration.*version\|version.*28\|version.*27" tests/main/database/ 2>&1 | head -10
```

If a `migrations.test.ts` or similar asserts the highest expected version (`expect(version).toBe(27)`), bump it to 28.

- [ ] **Step 3: Confirm cohort-view parity.**

```bash
grep -rn "cohort_variant_summary\|case_id, variant_type\|variant_type, case_id" src/main/database/ src/shared/sql/ 2>&1 | head -20
```

Read each hit and confirm none of them needs to be touched — a new covering index is a planner hint, not a contract change. Note any surprises in the PR body.

- [ ] **Step 4: Run the database test suite + import suite + cohort suite.**

```bash
make rebuild-node
npx vitest run tests/main/database/ tests/main/import/ tests/main/cohort
```

Expected: pass.

- [ ] **Step 5: Capture EXPLAIN QUERY PLAN before/after.** With a populated dev DB (e.g. `/home/$USER/.config/varlens/varlens.db`):

```bash
sqlite3 ~/.config/varlens/varlens.db "EXPLAIN QUERY PLAN SELECT * FROM variants WHERE case_id = 1 AND variant_type = 'snv';"
```

Run once before applying the migration (a fresh checkout of `main`) and once after (this branch with the migration applied). Capture both for the PR description.

- [ ] **Step 6: Commit.**

```bash
git add src/main/database/migrations.ts
git commit -m "perf(db): add idx_variants_case_type for case_id-first cohort scans

Adds a (case_id, variant_type) covering index. Retains the existing
idx_variants_type_case (variant_type, case_id) because the
variant-extension-registry planner relies on it for variant_type-first
narrowing in JOIN paths.

EXPLAIN QUERY PLAN before/after captured in the PR description.

Closes audit Perf-01 #4 / #10."
```

---

### Task PR4-2 (QW-11): Drop per-file FTS rebuild

**Files:**
- Modify: `src/main/workers/import-pipeline.ts:247-266` (`finishBulkInsert`)

**Context:** Per-file `INSERT INTO variants_fts('rebuild')` + `db.exec(createFTSTriggers)` compounds quadratically across multi-file imports. The session-end `rebuildFts(db)` in `import-worker.ts:252` already does the final rebuild. Spec confirms: keep `updateVariantCountStmt.run(...)` per file; drop the per-file rebuild + trigger recreate.

- [ ] **Step 1: Confirm the session-end rebuild is the only consumer.**

```bash
grep -rn "createFTSTriggers\|rebuildFts" src/main/ 2>&1
```

Expected: `finishBulkInsert` is the only mid-session call site; `import-worker.ts:252` is the session-end call site. If a third call site appears, surface to the controller before deleting.

- [ ] **Step 2: Confirm cohort parity.**

```bash
grep -rn "rebuildCohortSummary\|cohort_variant_summary" src/main/workers/ 2>&1
```

Expected: `import-worker.ts:253` calls `rebuildCohortSummary(db)` after the FTS rebuild. The cohort summary depends on completed FTS state — by moving FTS rebuild to session-end (which it already is), nothing in the cohort path changes.

- [ ] **Step 3: Edit `finishBulkInsert` to keep variant-count update only.**

```typescript
  function finishBulkInsert(caseId: number, totalInserted: number): void {
    // QW-11: Per-file FTS rebuild + trigger recreate removed (audit Perf-01 #8).
    // Session-end rebuildFts(db) in import-worker.ts handles the single FTS
    // rebuild for the whole import session.
    updateVariantCountStmt.run(totalInserted, caseId)
  }
```

Remove the two try/catch blocks that called `INSERT INTO variants_fts('rebuild')` and `db.exec(createFTSTriggers)`. Leave the `DROP_FTS_TRIGGERS` call sites that surround the bulk-insert intact (those are not part of this task — they let the bulk insert run without trigger overhead, and the session-end rebuild recreates the triggers).

- [ ] **Step 4: Run the full import test suite.**

```bash
make rebuild-node
npx vitest run tests/main/import/ tests/main/workers/
```

Expected: pass. Pay special attention to multi-file import tests — they are the regression risk.

- [ ] **Step 5: Run a real-data import smoke** (manual, only if dev DB is set up):

```bash
make dev   # in a separate terminal, import a multi-file fixture from tests/test-data/vcf/
```

Verify the import completes and that the cohort view returns search results (FTS works after session end).

- [ ] **Step 6: Commit.**

```bash
git add src/main/workers/import-pipeline.ts
git commit -m "perf(import): drop per-file FTS rebuild and trigger recreate

finishBulkInsert no longer runs INSERT INTO variants_fts('rebuild') or
re-execs createFTSTriggers per file — session-end rebuildFts(db) in
import-worker.ts already does the single rebuild for the whole import
session. Multi-file imports now scale linearly instead of quadratically.

Closes audit Perf-01 #8."
```

---

### Task PR4-3 (QW-14): Fail perf comparison on budget breach

**Files:**
- Modify: `scripts/perf/compare-wgs-import.mjs` (only)

**Context (corrected):** Today the comparison script logs a budget breach but exits 0. The earlier draft proposed adding a `perf-wgs-compare` Makefile target — **but no such target exists** today (`grep -n perf-wgs Makefile` finds only `tests/perf/postgres-vcf-wgs-import.perf.test.ts:242`, not a comparison recipe). The script is invoked directly (`node scripts/perf/compare-wgs-import.mjs`); a non-zero exit from the script propagates naturally to any shell/CI caller. Adding a new Make target would be a YAGNI expansion. Limit the change to the script.

- [ ] **Step 1: Read the script.**

```bash
sed -n '1,80p' scripts/perf/compare-wgs-import.mjs
tail -20 scripts/perf/compare-wgs-import.mjs
```

Identify the budget-breach branch — usually a `console.warn`/`console.error` followed by no explicit exit.

- [ ] **Step 2: Add `process.exit(1)` on breach.** Pattern:

```javascript
if (ratio > BUDGET) {
  console.error(
    `::error::WGS import budget breach: ratio ${ratio.toFixed(2)} exceeds budget ${BUDGET.toFixed(2)}`
  )
  process.exit(1)
}
```

Confirm the variable names (`ratio` / `BUDGET`) match the script — they may be named differently (e.g. `baseline.ratio`, `THRESHOLD`). Preserve all existing output.

- [ ] **Step 3: Smoke-test the exit code.**

```bash
# Verify the script exits 0 on the happy path (real perf fixture available)
VARLENS_RUN_WGS_PERF=1 node scripts/perf/compare-wgs-import.mjs && echo "exit=0"

# Verify exit-on-breach by temporarily editing the BUDGET to 0 (or by
# passing a synthetic high-ratio baseline file). Revert before committing.
```

If the fixture is not available locally, at minimum confirm via a quick read that the new `process.exit(1)` is on the breach branch and `process.exit(0)` (or natural return) is on the happy path.

- [ ] **Step 4: Commit.**

```bash
git add scripts/perf/compare-wgs-import.mjs
git commit -m "ci(perf): exit non-zero on WGS budget breach

compare-wgs-import.mjs now exits 1 when the ratio exceeds the budget,
so any shell/CI caller fails fast on a regression. No Makefile change
needed — the script is invoked directly and exit-code propagation is
already the default in Make. Closes audit Rel-04 CR-6 / Perf-2."
```

---

### Task PR4-4 (QW-16): PG BRIN + pg_trgm GIN migrations

**Files:**
- Create: `src/main/storage/postgres/migrations/sql/0007_perf_indexes.sql`
- Modify: `src/main/storage/postgres/migrations/definitions.ts` — append the migration to `MIGRATION_FILES`

**Context (corrected vs. earlier draft):** Two cheap indexes the PG cohort path is missing today. JSONB GIN is explicitly deferred to Sprint B per audit BP-05 §5.

**Schema-quoting reality check:** existing migrations use the placeholder pattern `"__schema__"."<table>"` (see `0001_create_cases.sql:1` → `CREATE TABLE IF NOT EXISTS "__schema__"."cases" (...)`). `__schema__` is template-replaced at execution time. Earlier drafts used bare `variants` which would break against custom or quoted schemas.

- [ ] **Step 1: Verify the next migration number.**

```bash
ls src/main/storage/postgres/migrations/sql/ | sort
```

Expected: highest is `0006_create_audit_log.sql`. Next is `0007_perf_indexes.sql`.

- [ ] **Step 2: Create the SQL file with `"__schema__"."variants"` quoting.**

`src/main/storage/postgres/migrations/sql/0007_perf_indexes.sql`:

```sql
-- QW-16 (Phase 1 Pre-0.60 Hardening, audit Sch-03 F3, BP-05 §5)
-- Adds the two cheapest cohort-scan indexes that PostgreSQL is missing today.
-- The JSONB GIN on info_json is deferred to Sprint B per the audit, bundled
-- with the partitioning work.
--
-- "__schema__" is the template placeholder replaced by the migration runner
-- at execution time (see 0001_create_cases.sql and friends for the pattern).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- BRIN on (chr, pos): cohort scans are positional and the table is
-- naturally clustered by load order, which is the BRIN sweet spot.
CREATE INDEX IF NOT EXISTS variants_brin_chr_pos
  ON "__schema__"."variants" USING BRIN (chr, pos);

-- Trigram GIN on gene_symbol: substring/case-insensitive gene-name
-- lookups from the cohort filter UI go through this index.
CREATE INDEX IF NOT EXISTS variants_gene_trgm
  ON "__schema__"."variants" USING GIN (gene_symbol gin_trgm_ops);
```

- [ ] **Step 3: Register the migration.**

Modify `src/main/storage/postgres/migrations/definitions.ts` — append to `MIGRATION_FILES`:

```typescript
  {
    version: '0007',
    name: 'perf_indexes',
    fileName: '0007_perf_indexes.sql'
  }
```

- [ ] **Step 4: Run the PG test suite.**

Test files live **flat** under `tests/main/storage/` (file names like `postgres-*.test.ts`); there is no `tests/main/storage/postgres/` directory. Confirm:

```bash
ls tests/main/storage/postgres-*.test.ts | head
```

Then run:

```bash
make pg-reset && make pg-up
make rebuild-node && npx vitest run tests/main/storage/
make pg-down
```

Expected: pass; the new migration runs as part of bootstrap, all `postgres-*.test.ts` suites continue to pass.

- [ ] **Step 5: Commit.**

```bash
git add src/main/storage/postgres/migrations/sql/0007_perf_indexes.sql \
        src/main/storage/postgres/migrations/definitions.ts
git commit -m "perf(pg): add BRIN(chr,pos) and pg_trgm GIN(gene_symbol) indexes

Two cheap cohort-scan indexes the PG path was missing. Uses the
existing \"__schema__\".\"<table>\" placeholder quoting pattern so the
migration works with custom/quoted schemas. JSONB GIN on info_json is
deferred to Sprint B per audit BP-05 §5, bundled with the partitioning
work.

Closes audit Sch-03 F3 (cheap-index half)."
```

---

### Task PR4-5 (gate 7): Capture renderer-perf comparison

After QW-11 is committed and before opening PR-4:

```bash
make build
npx playwright test tests/e2e/renderer-perf-phase1.e2e.ts
ls -lt .planning/artifacts/perf/phase1/ | head -5
```

Compare against the baseline captured in **PR4-0**. The expected outcome is no regression — QW-11 changes import-pipeline behaviour, not renderer-query behaviour, so the renderer-perf numbers should be flat. Include the comparison in the PR body — the artifact directory is gitignored so the numbers go in the PR description.

If a regression appears, do **not** open the PR. Investigate with `superpowers:systematic-debugging` — possible cause: a cohort query that implicitly depends on per-file FTS rebuild state (very unlikely given the existing session-end rebuild, but worth checking the cohort-summary path).

---

### PR-4 acceptance gates

- [ ] **Gate 1.** `make ci-full` exits 0.
- [ ] **Gate 7.** Renderer-perf-phase1 artifacts show no regression vs. the PR4-0 baseline.

```bash
gh pr create --title "perf: hot-path cleanup" --body "$(cat <<'EOF'
## Summary

- QW-10: add SQLite migration v28 — idx_variants_case_type (keep idx_variants_type_case per variant-extension-registry comments)
- QW-11: drop per-file FTS rebuild — session-end rebuild covers it
- QW-14: exit non-zero from scripts/perf/compare-wgs-import.mjs on budget breach (script-only, no Makefile change)
- QW-16: PG migration 0007 — BRIN(chr,pos) + pg_trgm GIN(gene_symbol), quoted "__schema__"."variants"

QW-5 (cloneForIpc → structuredClone) was dropped from Phase 1 — current
JSON-round-trip implementation strips Vue reactive proxies on purpose
(tests/renderer/utils/cloneForIpc.test.ts:24-33). Deferred to Sprint A.

Spec: `.planning/specs/2026-05-26-pre-060-hardening.md`

## Test plan

- [x] make ci-full
- [x] EXPLAIN QUERY PLAN before/after for idx_variants_case_type: <paste from PR4-1 step 5>
- [x] renderer-perf-phase1 comparison: <paste from PR4-5 — no regression>
EOF
)"
```

---

## Phase 1 close-out

After all four PRs land on `main`:

- [ ] **Run `make ci-full` on `main`** as a final cross-check.

- [ ] **Decide tag cadence with the user.** Two options:
  - **Tag 0.59.5 after PR-1 lands** (release-blockers only); then **0.60.0** after PR-2/3/4 settle.
  - **Tag a single 0.60.0** once all four PRs are in. Lower release-management overhead; longer time between release-blocker fix and shipped binary.

  The spec's gate 8 accepts either ("0.59.5 or 0.60.0 if scope justifies").

- [ ] **Promote `[Unreleased]` per the runbook on a release-prep branch, then PR + tag.**

`AGENTS.md` forbids feature/work commits on `main`. The `[Unreleased]`-promotion + `package.json` bump is exactly that kind of commit — do it on a short-lived `release/v0.60.0` branch with its own PR (or, if your project allows narrow release housekeeping commits directly to `main`, document the exception in the PR description and proceed).

```bash
git checkout main && git pull --ff-only
git checkout -b release/v0.60.0

# Promote [Unreleased] → [0.60.0] in CHANGELOG.md per the runbook.
# Bump package.json version to 0.60.0.
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): v0.60.0"

gh pr create --title "chore(release): v0.60.0" --body "Promotes [Unreleased] and bumps package.json for v0.60.0 tag."
# Merge once green.

git checkout main && git pull --ff-only
git tag -a v0.60.0 -m "v0.60.0"
git push origin v0.60.0
```

The release workflow's QW-3 assertion now refuses the push if `package.json` and tag disagree — which is why the version bump must precede the tag.

- [ ] **Spike: synthetic mismatched-tag dry run (gate 4).** On a throwaway branch off `main` (delete after):

```bash
git checkout -b tmp/gate-4-dry-run
# Hand-edit package.json to a stale version, commit.
git tag vTEST-9.9.9
git push origin vTEST-9.9.9
# Observe: release.yml create-release job fails at the new assertion step.
# Cleanup:
gh release delete vTEST-9.9.9 --yes --cleanup-tag
git push origin :vTEST-9.9.9
git checkout main && git branch -D tmp/gate-4-dry-run
```

Capture the failed run URL in the spec's "acceptance gates" section (or a closing note in `.planning/code-review/CODEBASE-AUDIT-2026-05-25.md`'s Sprint 0 entry).

---

## Self-review checklist (for the controller before dispatching)

- Every spec acceptance gate (1–8) maps to a verification step above.
- No placeholders, no "TBD", no "similar to Task N".
- All file paths are absolute-from-repo-root or relative-to-cwd as appropriate.
- Type/path consistency: `sanitizeLogMessage` is imported the same way across PR1-1 and PR1-2 (relative path `../../shared/utils/sanitizers` from main, `../../../shared/utils/sanitizers` from the renderer re-export — no `@shared` alias exists). `InvalidParametersError` is the throwable; `SerializableError` is the interface returned via `wrapHandler` (PR2-2, PR2-4 reference both correctly).
- Each task ends in a commit; commits use the project's Conventional Commit types.
- Branch convention respected: no work on `main`.
- Cohort parity check is explicit in PR4-1 (QW-10 index) and PR4-2 (QW-11 FTS rebuild) — the two tasks where the audit could spill into cohort code paths.

If the controller is using `superpowers:subagent-driven-development`:

- Dispatch the implementer per task. Provide the full task text + the spec acceptance gate(s) the task is responsible for.
- After each implementer reports `DONE`, dispatch a spec-compliance reviewer (verify the acceptance gate language is met), then a code-quality reviewer.
- Do **not** start the next task while either review has open issues.
- After all PR-N tasks, run the per-PR "acceptance gates" block as a final controller check before `gh pr create`.
