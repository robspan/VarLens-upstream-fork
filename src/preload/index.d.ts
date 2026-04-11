import type { WindowAPI, AnnotationChangeEvent } from '../shared/types/api'

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
 */
declare module '../shared/types/api' {
  interface VariantsAPI {
    /**
     * Subscribe to `variants:annotationChanged` broadcasts. Returns an
     * unsubscribe function. Emitted only on per-case annotation upserts
     * in Phase 1 (global upserts do NOT fire this event).
     */
    onAnnotationChanged: (callback: (ev: AnnotationChangeEvent) => void) => () => void
  }
}

export {}
