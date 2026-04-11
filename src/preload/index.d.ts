import type { WindowAPI } from '../shared/types/api'

declare global {
  interface Window {
    api: WindowAPI
  }
}

/**
 * Wave 4 — the `shortlist` and `onAnnotationChanged` methods previously lived
 * in a module augmentation here because earlier waves (1.E, 3) were forbidden
 * from modifying `api.ts`. Wave 4 unblocked that file, so they are now
 * first-class members of `VariantsAPI` in `src/shared/types/api.ts`. This
 * ensures renderer code can see them (`tsconfig.renderer.json` only includes
 * `src/renderer/**`, so augmentations in `src/preload/**` never reached the
 * renderer side).
 */

export {}
