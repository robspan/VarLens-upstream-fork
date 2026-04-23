# Electron Fuse Hardening — Phase 2

**Date:** 2026-04-22
**Status:** Design approved (revised after code review); ready for implementation plan
**Addresses:** `.planning/code-review/CODEBASE-REVIEW-2026-04-22.md` Priority A
**Scope:** Flip `onlyLoadAppFromAsar`, take ownership of fuse configuration in an `afterPack` hook with strict-require drift detection, document the baseline, and add a packaged-binary smoke test that actually exercises the flipped app.

## Problem

The 2026-04-22 review left Priority A partially resolved. `package.json` carries an initial declarative baseline under `build.electronFuses`, but two gaps remain:

1. The most impactful remaining fuse — `onlyLoadAppFromAsar` — has not been enabled. The pdbe-molstar cleanup removed the last plausible blocker, so this can now be turned on deliberately.
2. Nothing in the build catches drift between the declared baseline and what actually gets flipped. electron-builder's built-in `config.electronFuses` path does not set `strictlyRequireAllFuses`, so an Electron upgrade that introduces new fuses leaves them silently at default. And existing CI / local smoke tests run against `./out/main/index.js`, not a packaged binary, so a boot regression caused by a fuse would not surface until a user opens an installer.

## Goals

- Enable `onlyLoadAppFromAsar` in packaged builds on all three platforms.
- Detect fuse drift on Electron upgrades (new fuse introduced → build fails until baseline is updated).
- Keep the fuse baseline in a single place in the repo.
- Exercise the packaged, fuse-flipped Linux binary in CI so boot regressions surface before release.
- Document the baseline so future changes are deliberate.

## Non-Goals

- Flipping other currently-off fuses (`loadValidationBehavior`, `grantFileProtocolExtraPrivileges`, `resetAdHocDarwinSignature`, etc.). Each needs its own compatibility assessment; bundling them in one pass would make a startup-smoke regression ambiguous.
- Auto-updater changes. `electron-updater` replaces the whole app bundle; `onlyLoadAppFromAsar` does not affect the update path.
- Moving the renderer off `file://` toward a custom protocol. Electron recommends this long-term but it is a separate, larger change.
- Packaged-binary smoke on macOS and Windows. Linux coverage is enough to gate releases initially; macOS/Windows can be added in a follow-up if release data shows value.

## Design

### 1. Move fuse configuration into an `afterPack` hook

In the installed electron-builder, the lifecycle is:

1. pack Electron
2. `emitAfterPack` → user `afterPack` hook
3. `doAddElectronFuses` (only if `config.electronFuses` is set)
4. signing

(See `node_modules/app-builder-lib/out/platformPackager.js:246` and the comment "the fuses MUST be flipped right before signing".)

A read-only verifier inside `afterPack` would therefore inspect the *pre-flip* binary. The fix is to own the flip inside our own hook using the exposed method `context.packager.addElectronFuses(context, fuses)`, and remove the declarative `build.electronFuses` entirely. `doAddElectronFuses` short-circuits when `config.electronFuses == null`, so there is no double-flip.

New file: `scripts/configure-fuses.mjs`.

Contract:

```js
import { FuseVersion, FuseV1Options } from '@electron/fuses'

const FUSE_BASELINE = {
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // Any additional fuse known to the installed @electron/fuses version
  // must be listed here (defaulted explicitly) because strictlyRequireAllFuses
  // is on. The implementation plan enumerates the exact set for the pinned
  // version.
}

export default async function configureFuses(context) {
  await context.packager.addElectronFuses(context, FUSE_BASELINE)
}
```

`strictlyRequireAllFuses: true` is what replaces the spec's original "expected vs actual verifier". When `@electron/fuses` (and therefore the Electron version it supports) ships a new fuse, `addElectronFuses` will throw because our baseline does not mention it. That is the actual drift signal — not a same-source comparison.

Declare `@electron/fuses` in `devDependencies` so the fuse enum and API are explicit dependencies of this repo, not transitive guarantees of electron-builder. Pin to a version known to line up with the installed Electron ABI (implementation plan picks the exact version).

Pair with what is already in place: `enableEmbeddedAsarIntegrityValidation: true` stays enabled. Electron's guidance is to pair `onlyLoadAppFromAsar` with ASAR integrity validation; this combination is the intended posture.

### 2. Remove `build.electronFuses` from `package.json`

With the hook owning the flip, the declarative block is both redundant and a second source of truth. Delete it. The new baseline lives in `scripts/configure-fuses.mjs`.

Add to `package.json` `build`:

```json
"afterPack": "scripts/configure-fuses.mjs"
```

### 3. Packaged-binary smoke on Linux

The existing startup smoke at `tests/e2e/startup-smoke.e2e.ts` launches `./out/main/index.js` via the helper at `tests/e2e/helpers/electron-app.ts`. That is the *unpacked* app; fuses never touch it. To actually exercise `onlyLoadAppFromAsar`, CI must launch the produced AppImage.

New test: `tests/e2e/packaged-smoke.e2e.ts`.

- Discovers the Linux artifact produced by `make dist-linux` under `release/` (AppImage preferred; deb as a fallback if AppImage is absent).
- Launches it via Playwright `_electron.launch({ executablePath })`. Passes `--appimage-extract-and-run` where needed for CI environments without FUSE.
- Asserts `app-ready`, `window-created`, `renderer-interactive` perf milestones, same as the unpacked smoke.
- Closes the app cleanly.

New Makefile target: `make ci-packaged-smoke-linux`. Runs after `make dist-linux`. `make ci-full` gains a step that invokes it. `.github/workflows/build.yml` Linux job runs the same target after its existing packaging step.

If AppImage extract-and-run turns out to be flaky in CI, the implementation plan may fall back to installing the `.deb` into a throwaway prefix. Decision deferred to the plan.

### 4. Documentation

Append a "Fuse baseline" subsection to the "Security Defaults" section of `AGENTS.md`:

- List each baseline fuse with one-line rationale.
- State the rule: the baseline lives only in `scripts/configure-fuses.mjs`. `strictlyRequireAllFuses: true` enforces completeness.
- Mention the pairing with `enableEmbeddedAsarIntegrityValidation`, per Electron guidance.
- Reference the Electron fuse and ASAR integrity docs.

`CLAUDE.md` imports `AGENTS.md`, so no separate Claude-side update is needed.

## Integration points

| Touchpoint | Change |
|---|---|
| `package.json` `build.electronFuses` | **Removed** — baseline moves into hook |
| `package.json` `build.afterPack` | Added: `"scripts/configure-fuses.mjs"` |
| `package.json` `devDependencies` | Added: `@electron/fuses` at a pinned version |
| `scripts/configure-fuses.mjs` | New — owns flip via `addElectronFuses` with `strictlyRequireAllFuses: true` |
| `tests/e2e/packaged-smoke.e2e.ts` | New — launches produced Linux binary |
| `tests/e2e/helpers/electron-app.ts` | Extended to accept an `executablePath` override, or a new sibling helper introduced |
| `Makefile` | New target `ci-packaged-smoke-linux`; wired into `ci-full` |
| `.github/workflows/build.yml` | Linux job runs `ci-packaged-smoke-linux` after dist |
| `AGENTS.md` | New "Fuse baseline" subsection |

## Verification flow

- **Local `make dist-linux`**: `configure-fuses.mjs` flips fuses with `strictlyRequireAllFuses: true`. Any undeclared fuse aborts the build with a clear electron-builder error.
- **Local `make ci-full`**: after dist, `ci-packaged-smoke-linux` launches the AppImage and asserts boot milestones. Boot regression caused by `onlyLoadAppFromAsar` fails here rather than in the field.
- **CI `build.yml`**: same chain on the Linux runner. macOS and Windows jobs package as before; their packaged-binary smoke is deferred.
- **Manual acceptance (one-off)**: during implementation, temporarily delete one fuse line from `FUSE_BASELINE` (keeping `strictlyRequireAllFuses: true`) and confirm `make dist-linux` fails with a clear strict-require error naming the missing fuse. Not committed.

## Risks and rollback

- **`onlyLoadAppFromAsar` breaks boot.** Caught by the new packaged-binary smoke on Linux. macOS/Windows risk is higher because they are not smoked post-pack in this pass — mitigated by the fact that the Mol* cleanup removed the most plausible trigger, and by keeping the change to a single new fuse. If a platform-specific regression appears post-release, rollback is a one-line change in `scripts/configure-fuses.mjs` (set `OnlyLoadAppFromAsar` to `false`). No rebuild plumbing changes.
- **`strictlyRequireAllFuses` blocks benign Electron upgrades.** That is the design. When `@electron/fuses` adds a new fuse, the upgrader must declare it explicitly (defaulting to the safe value). This is the drift-detection mechanism; treating it as friction is a misread.
- **macOS signing / notarization.** `addElectronFuses` flips before signing inside electron-builder's normal pipeline; notarization is unaffected. If signing ever breaks here, the cause is cert/entitlement, not the fuse.
- **Hoisting.** Declaring `@electron/fuses` in `devDependencies` pins the API surface. A future electron-builder bump that changes which version it vendors cannot silently shift the fuse enum out from under this repo.
- **AppImage in CI.** AppImage needs FUSE or `--appimage-extract-and-run`. The packaged-smoke test plans to use the latter. If that proves flaky, fall back to `.deb` install into a scratch prefix — an implementation-plan decision, not a spec-level one.

## Acceptance criteria

1. `make dist-linux` produces an AppImage and a deb package with `onlyLoadAppFromAsar: true`, driven by `scripts/configure-fuses.mjs`.
2. `build.electronFuses` is absent from `package.json`.
3. `scripts/configure-fuses.mjs` sets `strictlyRequireAllFuses: true` and lists every fuse exposed by the pinned `@electron/fuses` version.
4. Removing any single fuse declaration from `FUSE_BASELINE` (while keeping `strictlyRequireAllFuses: true`) causes `make dist-linux` to fail with an error naming the missing fuse. (Verified once during implementation; not a committed test.)
5. `make ci-packaged-smoke-linux` launches the produced AppImage and passes its perf-milestone assertions. Wired into `make ci-full` and `.github/workflows/build.yml`'s Linux job.
6. `AGENTS.md` contains the "Fuse baseline" subsection, including the single-source-of-truth rule and the ASAR-integrity pairing note.
7. `make ci` still passes (lint, format, typecheck, unit tests).

## External references

- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron ASAR integrity: https://www.electronjs.org/docs/latest/tutorial/asar-integrity
- Electron security guide (custom-protocol direction, longer-term): https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder `electronFuses` and custom-hook path: https://www.electron.build/tutorials/adding-electron-fuses.html
- electron-builder lifecycle hooks: https://www.electron.build/configuration.html
- `@electron/fuses` API (`getCurrentFuseWire`, `flipFuses`): https://github.com/electron/fuses
