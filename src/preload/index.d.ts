import type { WindowAPI, AnnotationChangeEvent } from '../shared/types/api'
import type { ShortlistResult } from '../shared/types/shortlist'
import type { ValidatedGetShortlistParams } from '../shared/types/ipc-schemas'

declare global {
  interface Window {
    api: WindowAPI
  }
}

/**
 * Wave 1.E — extend the shared `VariantsAPI` surface with the
 * `onAnnotationChanged` subscription wrapper added by the preload.
 *
 * Module augmentation is used here (rather than editing `api.ts`) because
 * Wave 0 declared `VariantsAPI` as the canonical contract and Wave 1.E is
 * forbidden from modifying that file. The augmentation keeps the surface
 * discoverable to consumers that import `WindowAPI` (renderer composables
 * in Wave 4).
 *
 * Wave 3 — adds `shortlist(params)` as a typed invoke wrapper over the
 * `variants:shortlist` IPC channel. Same module-augmentation rationale:
 * `api.ts` is out of scope for Wave 3, and downstream consumers
 * (Wave 4 `useShortlistQuery`) import `WindowAPI` to reach this surface.
 */
declare module '../shared/types/api' {
  interface VariantsAPI {
    /**
     * Run the unified shortlist pipeline for a case. Accepts either a
     * preset id or an inline `adHocConfig` (discriminated union) and
     * resolves to the ranked `ShortlistResult` envelope.
     */
    shortlist: (params: ValidatedGetShortlistParams) => Promise<ShortlistResult>

    /**
     * Subscribe to `variants:annotationChanged` broadcasts. Returns an
     * unsubscribe function. Emitted only on per-case annotation upserts
     * in Phase 1 (global upserts do NOT fire this event).
     */
    onAnnotationChanged: (callback: (ev: AnnotationChangeEvent) => void) => () => void
  }
}

export {}
