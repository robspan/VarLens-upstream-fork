# Auto-Update Implementation Plan

## Goal

Add VS Code-style auto-update to VarLens: a subtle indicator in the footer bar when a new version is available, allowing the user to trigger the update with one click.

## Current State

- **No auto-update** exists — users must manually download new releases
- **GitHub Releases** already configured as publish target (`package.json` → `build.publish`)
- **Release workflow** uses `--publish never` + manual upload (svenstaro/upload-release-action) — this means **no `latest.yml` metadata files** are uploaded, which `electron-updater` requires
- **Code signing** is disabled on macOS/Linux; optional SignPath on Windows
- **AppFooter.vue** already shows version info (left side) — ideal location for update indicator
- **IPC pattern**: `domain:action` naming, typed API via preload, handlers in `src/main/ipc/handlers/`

## Architecture Decision

**Use `electron-updater`** (from electron-builder ecosystem) — it's the standard for electron-builder projects and already has a configured GitHub publish provider. No need for a separate update server.

### Why not `update-electron-app` or Squirrel?
- `update-electron-app` requires `update.electronjs.org` (public repos only, limited control)
- Squirrel.Windows is not supported by electron-builder's NSIS target
- `electron-updater` integrates natively with the existing electron-builder config

## Platform Support

| Platform | Target | Auto-Update Support | Code Signing Required |
|----------|--------|--------------------|-----------------------|
| Windows  | NSIS   | Full support       | No (works unsigned, shows SmartScreen warning) |
| macOS    | DMG    | Full support       | Yes — **updates will fail without signing** |
| Linux    | AppImage | Full support     | No |
| Linux    | deb    | Not supported      | N/A |

**Important**: macOS auto-update will not work until code signing is set up. The implementation should gracefully handle this — check for updates but show "download manually" on macOS if unsigned.

## Implementation Plan

### Phase 1: Install & Configure electron-updater

**1.1 Install dependency**
```bash
npm install electron-updater
```
Note: `electron-updater` is a **runtime dependency** (not devDependency) — it runs in the main process.

**1.2 Externalize in electron-vite config**

Add `electron-updater` to the main process externals in `electron.vite.config.ts` so Vite doesn't bundle it (same pattern as `better-sqlite3-multiple-ciphers`).

### Phase 2: Main Process — Update Service

**2.1 Create `src/main/services/AutoUpdater.ts`**

A service module that wraps `electron-updater` with project conventions:

```typescript
import { autoUpdater } from 'electron-updater'
import { mainLogger } from './MainLogger'
import { BrowserWindow } from 'electron'

// Key configuration:
// - autoDownload: false (user-initiated downloads, like VS Code)
// - autoInstallOnAppQuit: true (install silently on next restart)
// - Set logger to mainLogger for unified logging

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
  error?: string
}
```

Core behavior:
- On app ready, check for updates (with a short delay to not block startup)
- Periodic re-check every 4 hours (configurable)
- Emit status changes to renderer via IPC
- `autoDownload: false` — user must click to start download
- `autoInstallOnAppQuit: true` — after download, install on next app restart

**2.2 Event flow**

```
App starts → (30s delay) → checkForUpdates()
                              ↓
                    update-available event
                              ↓
              Send to renderer via IPC → show indicator
                              ↓
                   User clicks "Update"
                              ↓
              downloadUpdate() → download-progress events → update-downloaded
                              ↓
              User clicks "Restart" → quitAndInstall()
```

### Phase 3: IPC Layer

**3.1 Add IPC handlers in `src/main/ipc/handlers/updater.ts`**

Following the existing `domain:action` pattern:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `updater:check` | invoke | Manually trigger update check |
| `updater:download` | invoke | Start downloading available update |
| `updater:install` | invoke | Quit and install downloaded update |
| `updater:status` | send (main→renderer) | Push status changes to renderer |

**3.2 Extend preload API in `src/preload/index.ts`**

```typescript
updater: {
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onStatusChange: (callback: (status: UpdateStatus) => void) => {
    const handler = (_event, status) => callback(status)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  }
}
```

**3.3 Add types to `src/shared/types/api.ts`**

```typescript
export interface UpdaterAPI {
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onStatusChange: (callback: (status: UpdateStatus) => void) => () => void
}
```

Add `updater: UpdaterAPI` to `WindowAPI`.

### Phase 4: Renderer — UI in AppFooter

**4.1 Create `src/renderer/src/composables/useAutoUpdate.ts`**

A composable that:
- Listens to `updater:status` IPC events
- Exposes reactive `updateStatus` ref
- Provides `checkForUpdate()`, `downloadUpdate()`, `installUpdate()` methods
- Cleans up listener on unmount

**4.2 Modify `AppFooter.vue`**

Add an update indicator between the version display and the network status icon (left section of footer):

**States and UI:**

| State | UI Element | Icon | Behavior |
|-------|-----------|------|----------|
| `idle` / `not-available` | Hidden | — | Nothing shown |
| `checking` | Spinning icon | `mdi-refresh` (spinning) | "Checking for updates..." tooltip |
| `available` | Chip/badge | `mdi-arrow-up-circle` | "Update v{version} available — click to download" |
| `downloading` | Progress indicator | `mdi-download` | "Downloading update... {percent}%" tooltip |
| `downloaded` | Chip/badge (emphasized) | `mdi-restart` | "Update ready — click to restart" |
| `error` | Small warning | `mdi-alert-circle` | Tooltip shows error, click to retry |

Design notes:
- Use a small `v-btn` with icon, consistent with existing footer buttons
- Use a subtle color (not the footer background `#E5AA94`) — e.g., `info` or `primary` for the available state
- The "downloaded → restart" state should be slightly more prominent (pulsing dot or badge)
- Keep it unobtrusive — the user should notice it but not be interrupted

### Phase 5: Release Workflow Changes

**5.1 Switch to `--publish always` in CI**

The release workflow currently uses `--publish never` and manually uploads artifacts. For `electron-updater` to work, **`latest.yml` / `latest-mac.yml` / `latest-linux.yml` metadata files must be uploaded** alongside the release artifacts.

**Option A (Recommended)**: Keep manual upload but also upload the generated `.yml` files:
```yaml
- name: Upload to release
  uses: svenstaro/upload-release-action@v2
  with:
    file: release/*  # already globs everything — yml files will be included
```

This should already work since `release/*` glob includes yml files. Verify that electron-builder generates these yml files even with `--publish never`. If not, switch to `--publish always` and remove the manual upload step.

**Option B**: Use `--publish always` with `GH_TOKEN`:
```yaml
- name: Build and publish
  run: npx electron-vite build && npx electron-builder --linux --publish always
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This lets electron-builder handle the upload directly, including yml metadata.

**5.2 Release type consideration**

Current config uses `"releaseType": "draft"`. With `--publish always`, electron-builder creates draft releases. The updater by default checks **published** releases only. Options:
- Change to `"releaseType": "release"` for auto-publish
- Or keep drafts and manually publish them (updater only sees published releases)
- Or set `allowPrerelease: true` on the updater if using pre-releases

**Recommendation**: Keep drafts for review, but document that releases must be manually published on GitHub for the updater to detect them.

### Phase 6: Dev Mode Handling

`electron-updater` throws in development (no `app-update.yml`). Guard with:

```typescript
import { is } from '@electron-toolkit/utils'

if (!is.dev) {
  // Initialize auto-updater
}
```

In dev mode, the updater IPC handlers should still be registered but return no-op responses so the renderer doesn't break.

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `electron-updater` dependency |
| `electron.vite.config.ts` | Modify | Externalize `electron-updater` |
| `src/main/services/AutoUpdater.ts` | **Create** | Update service wrapping electron-updater |
| `src/main/ipc/handlers/updater.ts` | **Create** | IPC handlers for update channels |
| `src/main/ipc/index.ts` | Modify | Register updater handlers |
| `src/main/index.ts` | Modify | Initialize auto-updater after app ready |
| `src/preload/index.ts` | Modify | Expose updater API |
| `src/shared/types/api.ts` | Modify | Add UpdaterAPI and UpdateStatus types |
| `src/renderer/src/composables/useAutoUpdate.ts` | **Create** | Composable for update state |
| `src/renderer/src/components/AppFooter.vue` | Modify | Add update indicator UI |
| `.github/workflows/release.yml` | Modify | Ensure yml metadata files are uploaded |

## Security Considerations

- **Signature verification**: `electron-updater` verifies updates against `latest.yml` which contains file checksums. Without code signing, this provides integrity but not authenticity
- **macOS Gatekeeper**: unsigned apps cannot auto-update on macOS — show a "download from GitHub" fallback
- **HTTPS only**: GitHub Releases uses HTTPS, so transport is secure
- **No `GH_TOKEN` in app**: the updater checks public GitHub releases — no token embedded in the app binary
- **CSP**: no CSP changes needed — update checks go through Node.js (main process), not the renderer

## Testing Strategy

- **Unit tests**: Mock `electron-updater` autoUpdater to test the service logic and IPC handlers
- **Manual testing**: Use `autoUpdater.setFeedURL()` with a test repo or local server
- **Dev mode**: Add a simulated update state for UI development (e.g., via a hidden dev menu action)

## Future Enhancements (Out of Scope)

- Release notes dialog showing changelog before update
- Staged rollouts via `stagingPercentage` in `latest.yml`
- Delta updates (differential downloads) — requires NSIS web installer
- macOS code signing setup (Apple Developer account required)
- Update settings page (check frequency, auto-download toggle)

## References

- [electron-builder Auto Update docs](https://www.electron.build/auto-update.html)
- [Electron official update guide](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Doyensec: Building a Secure Electron Auto-Updater](https://blog.doyensec.com/2026/02/16/electron-safe-updater.html)
- [electron-updater API reference](https://www.electron.build/electron-updater/index.html)
