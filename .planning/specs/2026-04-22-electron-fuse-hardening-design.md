# Electron Fuse Hardening — Phase 2

**Date:** 2026-04-22
**Status:** Design approved; ready for implementation plan
**Addresses:** `.planning/code-review/CODEBASE-REVIEW-2026-04-22.md` Priority A
**Scope:** Packaged-app integrity hardening — one additional fuse + automated verification + documentation

## Problem

The 2026-04-22 codebase review left Priority A partially resolved. The repo ships an initial fuse baseline in `package.json` `build.electronFuses`:

- `runAsNode: false`
- `enableNodeOptionsEnvironmentVariable: false`
- `enableNodeCliInspectArguments: false`
- `enableCookieEncryption: true`
- `enableEmbeddedAsarIntegrityValidation: true`

Two gaps remain:

1. The most impactful remaining fuse, `onlyLoadAppFromAsar`, has not yet been evaluated or flipped. The earlier pdbe-molstar cleanup removed the last known blocker, so the repo is now in a position to make this decision deliberately.
2. The fuse baseline lives only as configuration. Nothing verifies that the packaged binary actually has the intended fuses flipped. Electron upgrades, electron-builder internal changes, or an accidental config edit can silently drift the shipped binary from the declared baseline.

## Goals

- Turn on `onlyLoadAppFromAsar` in packaged builds for all three platforms.
- Fail the build (not just CI) when the packaged binary's fuse wiring diverges from the declared baseline.
- Make the declared baseline the single source of truth — no duplicate lists to keep in sync.
- Document the baseline so future fuse changes are deliberate.

## Non-Goals

- Flipping other currently-off fuses (`loadValidationBehavior`, `grantFileProtocolExtraPrivileges`, `resetAdHocDarwinSignature`, etc.). Each needs its own compatibility assessment — bundling them with this pass would make startup-smoke regressions ambiguous.
- Auto-updater changes. `electron-updater` replaces the whole app bundle; `onlyLoadAppFromAsar` does not affect the update path.
- Runtime fuse assertions from the main process. Build-time verification is strictly better — it catches drift before an artifact reaches a user.
- Changes to `docs/` (the user-facing VitePress site). Fuse posture is an internal invariant.

## Design

### 1. Fuse change

In `package.json` `build.electronFuses`, add:

```json
"onlyLoadAppFromAsar": true
```

No other fuse flags are modified in this pass. Dev mode is unaffected because fuses are burned into the packaged Electron binary by electron-builder during `make dist`; `make dev` runs against the unmodified Electron binary from `node_modules/electron/`.

### 2. Verification script

New file: `scripts/verify-fuses.mjs`.

Contract:

- Exported default async function matching the electron-builder `afterPack` signature: `(context) => Promise<void>`.
- Reads the expected baseline from `package.json` `build.electronFuses`. This is the single source of truth.
- Resolves the packaged Electron binary path from `context.appOutDir` and `context.electronPlatformName`:
  - `darwin`: `<appOutDir>/<productFilename>.app/Contents/MacOS/<productFilename>`
  - `win32`: `<appOutDir>/<productName>.exe`
  - `linux`: `<appOutDir>/<executableName>`
  The `productName` and `executableName` come from `context.packager.appInfo`.
- Calls `getCurrentFuseWiring(binaryPath)` from `@electron/fuses`.
- Compares each declared fuse against the actual wiring. On mismatch, throws with a message of the form:
  ```
  Fuse verification failed for <platform>/<arch>:
    onlyLoadAppFromAsar: expected true, actual false
    <other mismatches>
  ```
- Throwing from `afterPack` aborts electron-builder cleanly — no artifact is produced.
- The script is side-effect-free beyond logging and throwing. It never modifies fuses; flipping is electron-builder's job.

### 3. Wiring

In `package.json` `build`, add:

```json
"afterPack": "scripts/verify-fuses.mjs"
```

Add `@electron/fuses` to `devDependencies` explicitly (it is already a transitive dep via electron-builder, but declaring it pins the API surface this repo depends on).

### 4. Documentation

Append a short "Electron fuse baseline" subsection to the "Security Defaults" section of `AGENTS.md`:

- List each baseline fuse and the one-line reason it is set the way it is.
- State the rule: `package.json` `build.electronFuses` is the only place the baseline lives. `scripts/verify-fuses.mjs` reads from it. Changing a fuse means editing that one block.
- Reference `https://www.electronjs.org/docs/latest/tutorial/fuses` and `https://www.electron.build/tutorials/adding-electron-fuses.html` for future readers.

`CLAUDE.md` already imports `AGENTS.md`, so no separate Claude-specific update is needed.

## Integration points

| Touchpoint | Change |
|---|---|
| `package.json` `build.electronFuses` | Add `onlyLoadAppFromAsar: true` |
| `package.json` `build.afterPack` | Add `"scripts/verify-fuses.mjs"` |
| `package.json` `devDependencies` | Add `@electron/fuses` (pin latest compatible) |
| `scripts/verify-fuses.mjs` | New file |
| `AGENTS.md` | New "Electron fuse baseline" subsection |
| `Makefile` | No changes — existing `dist` targets pick up `afterPack` automatically |

## Verification flow

- **Local**: `make dist`, `make dist-linux`, `make dist-mac`, `make dist-win` all trigger `verify-fuses.mjs` via `afterPack`. A mismatch aborts the build before any installer is produced.
- **CI (`build.yml`)**: unchanged — the existing dist jobs inherit the `afterPack` hook. No new CI step required.
- **Runtime regression check**: `make ci-startup-smoke` and the release-gating startup smoke in `build.yml` continue to cover the case where `onlyLoadAppFromAsar` breaks application boot on Linux.
- **Manual acceptance**: a test flip (e.g., temporarily changing `enableCookieEncryption` to `false` in `package.json`) must cause `make dist-linux` to fail with a clear expected-vs-actual diff. This is a throwaway sanity check run during implementation, not committed.

## Risks and rollback

- **`onlyLoadAppFromAsar` breaks boot on some platform.** The Mol* cleanup removed the most plausible cause of that failure, and nothing in `src/main/index.ts` uses custom app-path loading. If smoke fails post-flip, rollback is a one-line revert of the fuse in `package.json`. The verification script does not need to change.
- **macOS code signing.** electron-builder flips fuses *before* signing on macOS; afterPack runs *after* flipping and *before* signing. `getCurrentFuseWiring` reads the intended state. Notarization is unaffected.
- **Hoisting.** Declaring `@electron/fuses` in `devDependencies` avoids resolving through electron-builder's internal `node_modules`. If a future electron-builder version vendors its own copy, the declared dep still wins.
- **CI cost.** Reading fuse wiring from a binary is O(milliseconds). No meaningful impact on build time.

## Acceptance criteria

1. `make dist-linux` produces an AppImage and deb package, and `verify-fuses.mjs` confirms `onlyLoadAppFromAsar: true` on the packaged binary.
2. `make ci-startup-smoke` passes against the built Linux app with `onlyLoadAppFromAsar` enabled.
3. `AGENTS.md` contains the fuse baseline subsection, including the "single source of truth" rule.
4. A deliberate fuse-weakening edit in `package.json` causes `make dist-linux` to fail with a clear message naming the fuse, expected value, and actual value.
5. `make ci` still passes (lint, format, typecheck, unit tests).

## External references

- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-builder `electronFuses` and `addElectronFuses`: https://www.electron.build/tutorials/adding-electron-fuses.html
- `@electron/fuses` API: https://github.com/electron/fuses
