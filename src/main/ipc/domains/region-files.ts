import type { IpcMain } from 'electron'

/**
 * Register the region-files domain handlers.
 *
 * NOTE: The region-files:* channels are registered by `registerGeneListHandlers`
 * (called via `registerGeneListsDomain`), which registers both `gene-lists:*`
 * and `region-files:*` channels from the single shared handler file. This
 * function is a no-op to avoid double-registration; the domain module exists
 * only to satisfy the preload contract (WindowAPI has a `regionFiles` top-level
 * key that needs a shared/preload/main triple).
 */
export function registerRegionFilesDomain(_ipcMain: IpcMain): void {
  // No-op — see NOTE above.
}
