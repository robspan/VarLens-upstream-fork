/**
 * Shortlist IPC handler — `variants:shortlist`.
 *
 * Wave 3 of the unified-shortlist rollout. Forwards the discriminated-union
 * `GetShortlistParams` ({ presetId } | { adHocConfig }) to
 * `ShortlistService.getShortlist()` and returns the ranked `ShortlistResult`
 * to the renderer.
 *
 * Validation strategy (spec §5, §7):
 *   1. Shape validation at the IPC boundary via `GetShortlistParamsSchema`
 *      (Wave 0). Shape failures → `DatabaseError` wrapped by `wrapHandler`
 *      into a `SerializableError` with `ErrorCode.DB_ERROR` — this codebase
 *      does not have a dedicated `ValidationError` class (Wave 2 followed
 *      the same convention).
 *   2. Service-layer allowlist check on `tieBreaker` sort keys via
 *      `resolveSortColumn` from `VariantFilterBuilder`. Unknown keys are
 *      rejected BEFORE they reach any SQL builder — this is the seam that
 *      prevents SQL injection via user-supplied sort keys. Shape validation
 *      alone cannot enforce this because the Zod schema treats `SortItem.key`
 *      as an opaque string.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md
 * (§5, §7)
 */

import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { GetShortlistParamsSchema } from '../../../shared/types/ipc-schemas'
import { DatabaseError } from '../../database/errors'
import { resolveSortColumn } from '../../database/VariantFilterBuilder'
import { mainLogger } from '../../services/MainLogger'
import type { GetShortlistParams } from '../../database/ShortlistService'

/**
 * Register the `variants:shortlist` handler against the injected
 * `ipcMain`. Pulls `ShortlistService` off the `DatabaseService` getter
 * exposed in Wave 3 (see `DatabaseService.shortlistService`).
 */
export function registerShortlistHandlers({ ipcMain, getDb }: HandlerDependencies): void {
  ipcMain.handle('variants:shortlist', async (_event, params: unknown) => {
    return wrapHandler(async () => {
      // ── Step 1: shape validation at the IPC boundary ────────────
      const parsed = GetShortlistParamsSchema.safeParse(params)
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        mainLogger.error(`Invalid variants:shortlist params: ${detail}`, 'shortlist')
        throw new DatabaseError(`Invalid variants:shortlist params: ${detail}`)
      }

      // ── Step 2: service-layer tieBreaker sort-key allowlist ─────
      // Prevents SQL injection via user-supplied sort keys. Unknown
      // keys are rejected BEFORE reaching the SQL builder.
      if ('adHocConfig' in parsed.data && parsed.data.adHocConfig.tieBreakers != null) {
        for (const tb of parsed.data.adHocConfig.tieBreakers) {
          if (resolveSortColumn(tb.key) == null) {
            throw new DatabaseError(
              `Unknown tieBreaker sort key for variants:shortlist: "${tb.key}"`
            )
          }
        }
      }

      // ── Step 3: dispatch to service ─────────────────────────────
      // `ShortlistService.getShortlist` is synchronous (Wave 2 adapted
      // from the plan's `async` signature since better-sqlite3 is
      // blocking). Cast to the service-level union because the Zod
      // schema inference widens `Partial<FilterState>` shapes that
      // the service typing narrows back via its own imports.
      const db = getDb()
      return db.shortlistService.getShortlist(parsed.data as unknown as GetShortlistParams)
    })
  })
}
