/**
 * Web-build stub for `src/main/database/geneReferenceLoader`.
 *
 * The desktop loader resolves the bundled `gene_reference.db` path via
 * `electron.app.getPath('userData')`. Electron is a desktop-only
 * devDependency, absent from the post-prune web container.
 *
 * The web server's Stage 1 hot path (cases / auth / variants) does not
 * touch gene-reference data. Whichever transitive import pulls this
 * module in (via SqliteStorageSession's repository graph) gets a stub
 * that throws if a code path actually needs gene-reference data — making
 * a future regression loud rather than silently broken.
 */

import { join } from 'path'

const NOT_AVAILABLE = new Error(
  'Gene-reference DB is not available in the web build (Stage 1). ' +
    'The web container does not ship gene_reference.db.'
)

export function resolveGeneRefDbPath(): string {
  // Return a placeholder that the rest of the web code path never reads.
  // Anyone who calls getGeneReferenceDb() below gets a clear error.
  return join('/data', 'gene_reference.db')
}

export function getGeneReferenceDb(): never {
  throw NOT_AVAILABLE
}

export function closeGeneReferenceDb(): void {
  // No-op: nothing was ever opened.
}
