# Electron Fuse Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `onlyLoadAppFromAsar`, move fuse configuration into an `afterPack` hook that calls `addElectronFuses` with `strictlyRequireAllFuses: true`, and add a Linux packaged-binary smoke test.

**Architecture:** Replace the declarative `build.electronFuses` block with `scripts/configure-fuses.mjs`. The hook owns the complete fuse baseline (all 8 `FuseV1Options` values for pinned `@electron/fuses` 1.8.0). `strictlyRequireAllFuses` makes Electron upgrades that introduce new fuses fail the build until the baseline declares them. A new `tests/e2e/packaged-smoke.e2e.ts` launches the produced Linux AppImage via Playwright to catch boot regressions caused by the flipped fuse.

**Tech Stack:** Electron 40, electron-builder 26, `@electron/fuses` 1.8.0, Vitest 4, Playwright 1.59 `_electron`, Node 24.14.1.

**Spec reference:** `.planning/specs/2026-04-22-electron-fuse-hardening-design.md`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `scripts/configure-fuses.mjs` | Create | Exports the hook (default) and the `FUSE_BASELINE` constant (named) |
| `tests/scripts/configure-fuses.test.ts` | Create | Unit test asserting `FUSE_BASELINE` shape — every fuse declared, strict-require on, `OnlyLoadAppFromAsar` true |
| `tests/e2e/helpers/packaged-electron-app.ts` | Create | Discovers the Linux AppImage under `release/` and launches it via Playwright `_electron.launch({ executablePath })` |
| `tests/e2e/packaged-smoke.e2e.ts` | Create | Launches the produced AppImage and asserts app shell + perf milestones |
| `package.json` | Modify | Remove `build.electronFuses`; add `build.afterPack`; add `@electron/fuses` to `devDependencies` |
| `AGENTS.md` | Modify | Replace "fuses live in `package.json`" reference with a full fuse-baseline subsection |
| `Makefile` | Modify | Add `ci-packaged-smoke-linux` target; wire into `ci-actions` after `ci-package-linux` |
| `.github/workflows/build.yml` | Modify | Linux-only step in the Package job runs the packaged smoke after `electron-builder --publish never` |

---

## Task 1: Declare `@electron/fuses` as an explicit devDependency

**Files:**
- Modify: `package.json` (devDependencies block around line 43)

- [ ] **Step 1: Check the installed version is already what we want to pin to**

Run: `node -p "require('./node_modules/@electron/fuses/package.json').version"`
Expected output: `1.8.0`

- [ ] **Step 2: Add `@electron/fuses` to `devDependencies`**

Edit `package.json`. In the `devDependencies` block (alphabetical by convention), insert between `@electron-toolkit/utils` and `@electron/rebuild`:

```json
"@electron/fuses": "^1.8.0",
```

- [ ] **Step 3: Refresh lockfile without re-downloading everything**

Run: `npm install --package-lock-only`
Expected: lockfile updates; no error output.

- [ ] **Step 4: Verify the package is actually resolvable as a direct dep**

Run: `node -e "console.log(require.resolve('@electron/fuses'))"`
Expected: prints a path inside `node_modules/@electron/fuses`.

- [ ] **Step 5: Run lint and typecheck to confirm nothing unrelated broke**

Run: `make lint-check && make typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): declare @electron/fuses as direct devDependency"
```

---

## Task 2: TDD — write the failing test for `FUSE_BASELINE`

**Files:**
- Create: `tests/scripts/configure-fuses.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/configure-fuses.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { FUSE_BASELINE } from '../../scripts/configure-fuses.mjs'

describe('FUSE_BASELINE', () => {
  it('targets fuse wire version V1', () => {
    expect(FUSE_BASELINE.version).toBe(FuseVersion.V1)
  })

  it('enables strictlyRequireAllFuses so Electron upgrades fail loudly on new fuses', () => {
    expect(FUSE_BASELINE.strictlyRequireAllFuses).toBe(true)
  })

  it('declares every fuse exposed by the pinned @electron/fuses version', () => {
    const numericFuseKeys = Object.values(FuseV1Options).filter(
      (v): v is number => typeof v === 'number'
    )
    for (const fuseKey of numericFuseKeys) {
      expect(
        FUSE_BASELINE,
        `FUSE_BASELINE is missing a declaration for FuseV1Options=${FuseV1Options[fuseKey]} (${fuseKey})`
      ).toHaveProperty(String(fuseKey))
    }
  })

  it('enables OnlyLoadAppFromAsar', () => {
    expect(FUSE_BASELINE[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
  })

  it('keeps RunAsNode disabled', () => {
    expect(FUSE_BASELINE[FuseV1Options.RunAsNode]).toBe(false)
  })

  it('enables embedded ASAR integrity validation (pairs with OnlyLoadAppFromAsar)', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
  })

  it('keeps EnableNodeOptionsEnvironmentVariable and EnableNodeCliInspectArguments disabled', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(FUSE_BASELINE[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
  })

  it('enables EnableCookieEncryption', () => {
    expect(FUSE_BASELINE[FuseV1Options.EnableCookieEncryption]).toBe(true)
  })

  it('requests resetAdHocDarwinSignature so ad-hoc-signed macOS builds get re-signed post-flip', () => {
    expect(FUSE_BASELINE.resetAdHocDarwinSignature).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `make rebuild-node && npx vitest run tests/scripts/configure-fuses.test.ts`
Expected: FAIL — import resolves to a missing file (`scripts/configure-fuses.mjs` does not exist yet).

---

## Task 3: Implement `scripts/configure-fuses.mjs`

**Files:**
- Create: `scripts/configure-fuses.mjs`

- [ ] **Step 1: Write the hook and the baseline**

Create `scripts/configure-fuses.mjs` with this exact content:

```javascript
// Electron fuse baseline for packaged VarLens builds.
// Invoked by electron-builder via `build.afterPack` in package.json.
// Owns the flip via `addElectronFuses(...)`; the declarative
// `build.electronFuses` block in package.json is intentionally absent so
// electron-builder's internal `doAddElectronFuses` short-circuits.
//
// `strictlyRequireAllFuses: true` forces this file to declare every fuse
// known to the pinned @electron/fuses version. A future Electron upgrade
// that introduces a new fuse will make builds fail here until the baseline
// declares an explicit value for it.

import { FuseVersion, FuseV1Options } from '@electron/fuses'

export const FUSE_BASELINE = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  resetAdHocDarwinSignature: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
}

export default async function configureFuses(context) {
  await context.packager.addElectronFuses(context, FUSE_BASELINE)
}
```

- [ ] **Step 2: Run the FUSE_BASELINE test and confirm it passes**

Run: `npx vitest run tests/scripts/configure-fuses.test.ts`
Expected: all 9 test cases PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/configure-fuses.mjs tests/scripts/configure-fuses.test.ts
git commit -m "feat(build): add configure-fuses afterPack hook with strict-require baseline"
```

---

## Task 4: Wire the `afterPack` hook and remove `build.electronFuses`

**Files:**
- Modify: `package.json` (`build` block)

- [ ] **Step 1: Remove the declarative `electronFuses` block**

Edit `package.json`. Delete lines 89-95 (the `electronFuses` object):

```json
    "electronFuses": {
      "runAsNode": false,
      "enableCookieEncryption": true,
      "enableNodeOptionsEnvironmentVariable": false,
      "enableNodeCliInspectArguments": false,
      "enableEmbeddedAsarIntegrityValidation": true
    },
```

- [ ] **Step 2: Add `afterPack` in the `build` block**

Insert the following as the first line inside `build` (immediately after `"npmRebuild": false,`):

```json
    "afterPack": "scripts/configure-fuses.mjs",
```

- [ ] **Step 3: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`
Expected: no output, exit 0.

- [ ] **Step 4: Run lint and format check**

Run: `make lint-check && make format-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build: move electron fuse config to afterPack hook"
```

---

## Task 5: Verify the flipped fuse on a real packaged build

This task produces no code change; it confirms the wiring works end-to-end before we add automated coverage.

- [ ] **Step 1: Rebuild native modules for Electron**

Run: `make rebuild`
Expected: `@electron/rebuild` completes without error.

- [ ] **Step 2: Package a Linux build**

Run: `make dist-linux`
Expected: exit 0. `release/` now contains `Varlens-*.AppImage` and `Varlens-*.deb`. Build log shows `configure-fuses.mjs` invoked (no explicit log line — absence of an error is the signal).

- [ ] **Step 3: Read fuses back from the produced AppImage using `getCurrentFuseWire`**

Run:

```bash
node --input-type=module -e "
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses'
import { readdirSync } from 'fs'
import { join } from 'path'
const release = 'release'
const app = readdirSync(release).find(f => f.endsWith('.AppImage'))
if (!app) throw new Error('no AppImage in release/')
const wire = await getCurrentFuseWire(join(release, app))
console.log(JSON.stringify({
  OnlyLoadAppFromAsar: wire[FuseV1Options.OnlyLoadAppFromAsar],
  RunAsNode: wire[FuseV1Options.RunAsNode],
  EnableEmbeddedAsarIntegrityValidation: wire[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]
}, null, 2))
"
```

Expected output (exactly):

```json
{
  "OnlyLoadAppFromAsar": "ENABLE",
  "RunAsNode": "DISABLE",
  "EnableEmbeddedAsarIntegrityValidation": "ENABLE"
}
```

(The `@electron/fuses` types return `FuseState` enum values — `"ENABLE"` / `"DISABLE"` strings.)

- [ ] **Step 4: Clean `release/` so it does not pollute subsequent lint / CI runs**

Run: `rm -rf release/`
Expected: no output.

- [ ] **Step 5: No commit**

This task validates; nothing to commit.

---

## Task 6: TDD — write the failing test for the packaged-app launcher helper

**Files:**
- Create: `tests/scripts/packaged-electron-app.test.ts`

This test exercises only the path-resolution part of the new helper — launching the AppImage is covered by the e2e test in Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/packaged-electron-app.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveLinuxPackagedBinary } from '../e2e/helpers/packaged-electron-app'

describe('resolveLinuxPackagedBinary', () => {
  const createdDirs: string[] = []

  afterEach(() => {
    for (const dir of createdDirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
    createdDirs.length = 0
  })

  function makeReleaseDir(files: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    const release = join(root, 'release')
    mkdirSync(release, { recursive: true })
    for (const name of files) {
      writeFileSync(join(release, name), 'placeholder')
    }
    createdDirs.push(root)
    return root
  }

  it('returns the path to the AppImage when present', () => {
    const root = makeReleaseDir(['Varlens-0.56.5.AppImage', 'Varlens-0.56.5.deb'])
    const resolved = resolveLinuxPackagedBinary(root)
    expect(resolved).toBe(join(root, 'release', 'Varlens-0.56.5.AppImage'))
  })

  it('throws when release/ is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'varlens-packaged-test-'))
    createdDirs.push(root)
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(/release\/ does not exist/)
  })

  it('throws when no AppImage is produced', () => {
    const root = makeReleaseDir(['Varlens-0.56.5.deb'])
    expect(() => resolveLinuxPackagedBinary(root)).toThrow(/No \.AppImage found/)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/scripts/packaged-electron-app.test.ts`
Expected: FAIL — import resolves to a missing file.

---

## Task 7: Implement the packaged-app launcher helper

**Files:**
- Create: `tests/e2e/helpers/packaged-electron-app.ts`

- [ ] **Step 1: Write the helper**

Create `tests/e2e/helpers/packaged-electron-app.ts`:

```typescript
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export interface LaunchPackagedAppResult {
  app: ElectronApplication
  window: Page
  isolationRoot: string
  userDataDir: string
  appDataDir: string
  executablePath: string
  consoleMessages: string[]
  cleanup: () => Promise<void>
}

export function resolveLinuxPackagedBinary(projectRoot: string = process.cwd()): string {
  const releaseDir = resolve(projectRoot, 'release')
  if (!existsSync(releaseDir)) {
    throw new Error(
      `release/ does not exist at ${releaseDir} — run 'make dist-linux' before the packaged smoke test.`
    )
  }
  const entries = readdirSync(releaseDir)
  const appImage = entries.find((f) => f.endsWith('.AppImage'))
  if (appImage === undefined) {
    throw new Error(
      `No .AppImage found under ${releaseDir}. Entries: ${entries.join(', ') || '(empty)'}`
    )
  }
  return join(releaseDir, appImage)
}

export async function launchPackagedLinuxApp(): Promise<LaunchPackagedAppResult> {
  const executablePath = resolveLinuxPackagedBinary()

  const isolationRoot = mkdtempSync(join(tmpdir(), 'varlens-packaged-'))
  const userDataDir = join(isolationRoot, 'user-data')
  const appDataDir = join(isolationRoot, 'app-data')
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(appDataDir, { recursive: true })

  const app = await electron.launch({
    executablePath,
    // --appimage-extract-and-run removes the FUSE dependency; required in CI
    // containers where FUSE is not mounted. Harmless on developer machines.
    args: ['--appimage-extract-and-run'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOME: isolationRoot,
      XDG_CONFIG_HOME: appDataDir,
      XDG_DATA_HOME: appDataDir,
      VARLENS_APP_DATA_DIR: appDataDir,
      VARLENS_USER_DATA_DIR: userDataDir,
      VARLENS_PERF_MODE: '1'
    }
  })

  const window = await app.firstWindow()

  const consoleMessages: string[] = []
  window.on('console', (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
  })
  window.on('pageerror', (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`)
  })

  return {
    app,
    window,
    isolationRoot,
    userDataDir,
    appDataDir,
    executablePath,
    consoleMessages,
    cleanup: async () => {
      await app.close()
    }
  }
}
```

- [ ] **Step 2: Run the helper tests and confirm they pass**

Run: `npx vitest run tests/scripts/packaged-electron-app.test.ts`
Expected: all 3 test cases PASS.

- [ ] **Step 3: Run lint and typecheck**

Run: `make lint-check && make typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers/packaged-electron-app.ts tests/scripts/packaged-electron-app.test.ts
git commit -m "test(e2e): add packaged Linux app launcher helper"
```

---

## Task 8: Add the packaged-binary smoke e2e test

**Files:**
- Create: `tests/e2e/packaged-smoke.e2e.ts`

- [ ] **Step 1: Write the test**

Create `tests/e2e/packaged-smoke.e2e.ts`:

```typescript
import { test, expect } from '@playwright/test'
import {
  type LaunchPackagedAppResult,
  launchPackagedLinuxApp
} from './helpers/packaged-electron-app'
import { dismissDisclaimerIfPresent, waitForAppShell } from './helpers/electron-app'
import { ensureArtifactDir, writeJsonArtifact } from './helpers/perf-artifacts'

test('packaged Linux AppImage boots with fuses flipped', async ({}, testInfo) => {
  const artifactDir = ensureArtifactDir('packaged-smoke')
  test.setTimeout(180_000)

  let launched: LaunchPackagedAppResult | undefined
  const launchStartedAt = Date.now()

  try {
    launched = await launchPackagedLinuxApp()
    await waitForAppShell(launched.window)
    await dismissDisclaimerIfPresent(launched.window)

    await expect(launched.window.locator('.v-app-bar')).toBeVisible()
    await expect(launched.window.locator('.v-footer')).toBeVisible()

    const snapshot = await launched.window.evaluate(async () => {
      return window.api.perf.getSnapshot()
    })

    expect(snapshot.main.milestones['app-ready']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['window-created']).toBeGreaterThanOrEqual(0)
    expect(snapshot.main.milestones['renderer-interactive']).toBeGreaterThanOrEqual(0)

    await launched.window.screenshot({ path: `${artifactDir}/app-shell.png` })

    writeJsonArtifact('packaged-smoke/launch-context.json', {
      isolationRoot: launched.isolationRoot,
      executablePath: launched.executablePath,
      consoleMessages: launched.consoleMessages
    })
    writeJsonArtifact('packaged-smoke/perf-snapshot.json', snapshot)
  } catch (error) {
    if (launched !== undefined) {
      await launched.window.screenshot({ path: `${artifactDir}/failure.png` }).catch(() => {})
    }
    writeJsonArtifact('packaged-smoke/failure-context.json', {
      message: error instanceof Error ? error.message : String(error),
      launchElapsedMs: Date.now() - launchStartedAt,
      launchedWindow: launched !== undefined,
      consoleMessages: launched?.consoleMessages ?? [],
      testOutputDir: testInfo.outputDir
    })
    throw error
  } finally {
    if (launched !== undefined) {
      await launched.cleanup()
    }
  }
})
```

- [ ] **Step 2: Produce a fresh Linux build**

Run: `make dist-linux`
Expected: `release/Varlens-*.AppImage` exists.

- [ ] **Step 3: Run the packaged smoke**

Run: `xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npx playwright test tests/e2e/packaged-smoke.e2e.ts --workers=1`
(Drop the `xvfb-run` prefix on macOS or an already-headful Linux session.)
Expected: 1 passed.

- [ ] **Step 4: Clean `release/`**

Run: `rm -rf release/`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/packaged-smoke.e2e.ts
git commit -m "test(e2e): add packaged Linux AppImage smoke test"
```

---

## Task 9: Add `ci-packaged-smoke-linux` Makefile target and wire it into `ci-actions`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update the `.PHONY` line**

In the `.PHONY:` line at the top of `Makefile`, insert `ci-packaged-smoke-linux` alphabetically near the other `ci-*` targets. The line becomes (shown here with only the change region — keep surrounding targets intact):

```makefile
.PHONY: help rebuild dev build preview lint lint-check test test-watch test-coverage typecheck dist dist-linux dist-mac dist-win package package-linux package-mac package-win clean clean-all install reinstall all ci ci-full ci-build ci-checks ci-startup-smoke ci-package-linux ci-packaged-smoke-linux ci-actions docs docs-dev docs-preview docs-screenshots
```

- [ ] **Step 2: Add the new target after `ci-package-linux`**

Insert this block immediately after the `ci-package-linux` target (after line ~175, before `ci-full: ci-actions`):

```makefile
ci-packaged-smoke-linux: ## Run the packaged-binary smoke on Linux (requires a built Linux artifact in release/)
	@echo "=== Packaged Smoke (Linux) using Node $(CI_NODE_VERSION) ==="
	$(ensure_ci_node)
	@echo ""
	@echo "Step 1/1: Running packaged smoke against release/*.AppImage..."
	$(XVFB_RUN)npx playwright test tests/e2e/packaged-smoke.e2e.ts --workers=1
	@echo ""
	@echo "=== Packaged Smoke (Linux) PASSED ==="

```

- [ ] **Step 3: Wire it into `ci-actions`**

Modify the `ci-actions` target to run the new smoke after `ci-package-linux`. Change:

```makefile
ci-actions: ## Run the required local GitHub Actions parity pipeline under Node $(CI_NODE_VERSION)
	@echo "=== GitHub Actions parity pipeline using Node $(CI_NODE_VERSION) ==="
	$(MAKE) ci-checks
	$(MAKE) ci-startup-smoke
	$(MAKE) ci-package-linux
	@echo ""
	@echo "=== GitHub Actions parity pipeline PASSED ==="
```

to:

```makefile
ci-actions: ## Run the required local GitHub Actions parity pipeline under Node $(CI_NODE_VERSION)
	@echo "=== GitHub Actions parity pipeline using Node $(CI_NODE_VERSION) ==="
	$(MAKE) ci-checks
	$(MAKE) ci-startup-smoke
	$(MAKE) ci-package-linux
	$(MAKE) ci-packaged-smoke-linux
	@echo ""
	@echo "=== GitHub Actions parity pipeline PASSED ==="
```

- [ ] **Step 4: Validate Make can parse the file**

Run: `make help | head -20`
Expected: help text prints without syntax errors; `ci-packaged-smoke-linux` appears in the target list.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "build(make): add ci-packaged-smoke-linux target and wire into ci-actions"
```

---

## Task 10: Wire packaged smoke into `.github/workflows/build.yml`

**Files:**
- Modify: `.github/workflows/build.yml` (Linux-only step in the Package job)

- [ ] **Step 1: Add the post-package smoke step**

In `.github/workflows/build.yml`, locate the `Package Electron app` step in the `Package` job (around line 240). Immediately after it, add:

```yaml
      - name: Run packaged smoke (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npx playwright test tests/e2e/packaged-smoke.e2e.ts --workers=1

      - name: Upload packaged smoke artifacts (Linux)
        if: runner.os == 'Linux' && always()
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # actions/upload-artifact@v7.0.1
        with:
          name: packaged-smoke-linux
          path: |
            test-results/
            .planning/artifacts/perf/phase1/baseline/packaged-smoke/
```

Keep the existing trailing newline between jobs. The SHA pin on `upload-artifact` matches the one already used in the file for `startup-smoke-linux`.

- [ ] **Step 2: Validate workflow syntax with `actionlint` if available, otherwise with a YAML parser**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml'))"`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci(build): run packaged smoke after Linux package step"
```

---

## Task 11: Update `AGENTS.md` security defaults with the fuse baseline subsection

**Files:**
- Modify: `AGENTS.md` (Security Defaults section, around line 157)

- [ ] **Step 1: Replace the stale fuse bullet with a reference to the new subsection**

Edit `AGENTS.md`. Replace the existing bullet at line 157:

```markdown
- Packaged builds also harden Electron fuses in `package.json` (`build.electronFuses`). Keep `runAsNode` disabled unless the app intentionally adds a main-process `fork()` dependency, and reassess fuses before changing packaging/load behavior.
```

with:

```markdown
- Packaged builds harden Electron fuses via `scripts/configure-fuses.mjs`, invoked from electron-builder's `afterPack` hook. See the "Electron fuse baseline" subsection below.
```

- [ ] **Step 2: Append the new subsection after the Security Defaults bullet list**

Immediately after the final bullet in the Security Defaults section (the `SQLite databases can be encrypted...` bullet), append:

```markdown

### Electron fuse baseline

`scripts/configure-fuses.mjs` owns the packaged fuse configuration. `strictlyRequireAllFuses: true` forces the baseline to declare every fuse known to the pinned `@electron/fuses` version — an Electron upgrade that introduces a new fuse makes the build fail until the baseline declares an explicit value.

Current baseline (read the script for the authoritative list):

- `RunAsNode: false` — blocks repurposing the packaged binary as a generic Node.js runtime.
- `EnableCookieEncryption: true` — at-rest cookie encryption for the session.
- `EnableNodeOptionsEnvironmentVariable: false` — disables `NODE_OPTIONS` injection paths.
- `EnableNodeCliInspectArguments: false` — disables CLI inspector attachment.
- `EnableEmbeddedAsarIntegrityValidation: true` — validates the shipped asar against its hash; pairs with `OnlyLoadAppFromAsar` per Electron guidance (see https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
- `OnlyLoadAppFromAsar: true` — refuses to launch the main app from any location other than `app.asar`.
- `LoadBrowserProcessSpecificV8Snapshot: false` — current default preserved.
- `GrantFileProtocolExtraPrivileges: true` — current default preserved; tightening this fuse is a separate, deliberate decision.
- `resetAdHocDarwinSignature: true` — re-ad-hoc-signs the macOS binary after fuse flipping so local ad-hoc builds remain launchable.

The baseline lives only in `scripts/configure-fuses.mjs`. Do not reintroduce `build.electronFuses` in `package.json`; the hook owns the flip and `doAddElectronFuses` short-circuits when the declarative block is absent.
```

- [ ] **Step 3: Verify formatting with Prettier**

Run: `make format-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): document electron fuse baseline and afterPack hook"
```

---

## Task 12: Final validation — run the full local parity pipeline

- [ ] **Step 1: Run `make ci-full`**

Run: `make ci-full`
Expected: exit 0. The pipeline runs `ci-checks`, `ci-startup-smoke`, `ci-package-linux`, and `ci-packaged-smoke-linux` in sequence. Final line: `=== GitHub Actions parity pipeline PASSED ===`.

- [ ] **Step 2: Confirm no release artifacts were left behind by lint**

Run: `make lint-check`
Expected: exit 0 (this confirms the earlier `release/**` ignore from commit `a8a80fc` continues to hold after the new pipeline produces packaged artifacts).

- [ ] **Step 3: Clean `release/`**

Run: `rm -rf release/`

- [ ] **Step 4: No commit**

This task is a gate, not a change.

---

## Self-Review (complete — issues fixed inline)

**Spec coverage:**

| Spec requirement | Task(s) |
|---|---|
| Flip `onlyLoadAppFromAsar` | 3 (`FUSE_BASELINE`), 4 (wires hook), 5 (manual verify) |
| `afterPack` hook owns the flip via `addElectronFuses` | 3, 4 |
| Remove `build.electronFuses` | 4 |
| `strictlyRequireAllFuses: true` for drift detection | 2 (test), 3 (implement) |
| Declare `@electron/fuses` in devDependencies | 1 |
| Packaged-binary smoke on Linux | 6–10 |
| `make ci-packaged-smoke-linux` target, wired into `ci-actions` | 9 |
| Linux CI job runs packaged smoke after dist | 10 |
| `AGENTS.md` fuse baseline subsection | 11 |
| Final validation via `make ci-full` | 12 |
| Acceptance #4 (strict-require catches removed fuse) | Implicit in Task 2 completeness test — removing any fuse from `FUSE_BASELINE` makes the completeness test fail, and removing it from production would surface identically via `strictlyRequireAllFuses` at `addElectronFuses` call time. |

**Placeholder scan:** No TBDs, TODOs, or "similar to Task N" references. Every code step shows the exact content.

**Type consistency:** `FUSE_BASELINE`, `resolveLinuxPackagedBinary`, `launchPackagedLinuxApp`, `LaunchPackagedAppResult` are consistent across tasks 2, 6, 7, 8.

**Ordering:** Dep declaration (1) → test (2) → implementation (3) → wiring (4) → manual verify (5) → helper test/impl (6, 7) → e2e (8) → Makefile (9) → CI (10) → docs (11) → final gate (12). No forward references.
