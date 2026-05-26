import { describe, expect, test } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import { getProject, relPath } from './helpers/ts-morph-project'

/**
 * Phase 1 gate — `getDatabaseService` and `getDbPool` are no longer on
 * the `StorageSession` interface (sealed 2026-05-04). They remain as
 * concrete public methods on `SqliteStorageSession` only; consumers
 * type-narrow on `capabilities.backend` first.
 *
 * Three orthogonal assertions:
 *
 * 1. **Import shrinking allowlist** — every file that imports
 *    `getDatabaseService` or `getDbPool` from the definer modules is
 *    listed. New imports outside the allowlist fail. Stale entries fail.
 *    The list trends toward empty as remaining call sites migrate.
 *
 * 2. **Tripwire** — no module outside the definer files contains a
 *    CallExpression with bare-identifier callee `getDatabaseService` /
 *    `getDbPool` *that resolves to the imported binding*. (DI parameters
 *    with the same name are fine.)
 *
 * 3. **Interface seal** — `StorageSession` declares zero escape-hatch
 *    methods (was `test.fails()` until the seal landed; now a regular
 *    `test()`).
 *
 * The "definers" are the files that own these symbols and may freely
 * reference them: see `DEFINER_FILES`. Storage-session implementations
 * are *also* allowed because the methods are interface obligations.
 */

const DEFINER_FILES = new Set([
  'src/main/database/index.ts',
  'src/main/ipc/dbPoolManager.ts',
  'src/main/storage/session.ts',
  'src/main/storage/sqlite/SqliteStorageSession.ts',
  'src/main/storage/postgres/PostgresStorageSession.ts',
  'src/main/services/DatabaseManager.ts',
  'src/main/storage/sqlite/SqliteImportExecutor.ts'
])

const BANNED_NAMES = new Set(['getDatabaseService', 'getDbPool'])

// Definer modules. An import is "loophole-shaped" if it pulls
// `getDatabaseService` / `getDbPool` from one of these specifiers.
const LOOPHOLE_MODULES = [
  /(^|\/)database(\/index)?$/,
  /(^|\/)dbPoolManager$/,
  /\.\.\/database$/,
  /\.\.\/\.\.\/database$/,
  /\.\.\/dbPoolManager$/,
  /\.\.\/\.\.\/ipc\/dbPoolManager$/
]

/**
 * Snapshot of files that currently import `getDatabaseService` / `getDbPool`
 * from a definer module. Phase 1 work shrinks this set to empty. When you
 * remove the import in a file, remove the file from this allowlist in the
 * same PR.
 *
 * Generated 2026-05-04 from the working tree.
 */
const ALLOWLIST_LOOPHOLE_IMPORTERS = new Set([
  'src/main/ipc/domains/analysis-groups.ts',
  'src/main/ipc/domains/annotations.ts',
  'src/main/ipc/domains/audit-log.ts',
  'src/main/ipc/domains/auth.ts',
  'src/main/ipc/domains/batch-import.ts',
  'src/main/ipc/domains/case-comments.ts',
  'src/main/ipc/domains/case-metadata.ts',
  'src/main/ipc/domains/case-metrics.ts',
  'src/main/ipc/domains/cases.ts',
  'src/main/ipc/domains/cohort.ts',
  'src/main/ipc/domains/database.ts',
  'src/main/ipc/domains/export.ts',
  'src/main/ipc/domains/filter-presets.ts',
  'src/main/ipc/domains/gene-lists.ts',
  'src/main/ipc/domains/gene-ref.ts',
  'src/main/ipc/domains/gnomad.ts',
  'src/main/ipc/domains/hpo.ts',
  'src/main/ipc/domains/import.ts',
  'src/main/ipc/domains/myvariant.ts',
  'src/main/ipc/domains/panels.ts',
  'src/main/ipc/domains/protein.ts',
  'src/main/ipc/domains/spliceai.ts',
  'src/main/ipc/domains/tags.ts',
  'src/main/ipc/domains/transcripts.ts',
  'src/main/ipc/domains/variants.ts',
  'src/main/ipc/domains/vep.ts',
  'src/main/ipc/index.ts'
])

describe('db-seam gate', () => {
  test('no new files import getDatabaseService / getDbPool from a definer module', () => {
    const project = getProject()
    const importers = new Set<string>()

    for (const sf of project.getSourceFiles('src/**/*.ts')) {
      const path = relPath(sf.getFilePath())
      if (DEFINER_FILES.has(path)) continue

      for (const decl of sf.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue()
        if (!LOOPHOLE_MODULES.some((re) => re.test(spec))) continue
        const importsLoopholeName = decl
          .getNamedImports()
          .some((n) => BANNED_NAMES.has(n.getName()))
        if (importsLoopholeName) {
          importers.add(path)
        }
      }
    }

    const newViolators = [...importers].filter((f) => !ALLOWLIST_LOOPHOLE_IMPORTERS.has(f)).sort()
    expect(
      newViolators,
      newViolators.length
        ? `New files import the loophole symbols. Either inject StorageSession instead, or add the file to ALLOWLIST_LOOPHOLE_IMPORTERS in this test (and document why in the PR). Context: .planning/web/completed/testing/desktop-to-web-parity.md db-seam\n  ${newViolators.join('\n  ')}`
        : 'no new loophole importers'
    ).toEqual([])
  })

  test('loophole-importer allowlist is consistent (no stale entries)', () => {
    const project = getProject()
    const stillImporting = new Set<string>()

    for (const sf of project.getSourceFiles('src/**/*.ts')) {
      const path = relPath(sf.getFilePath())
      if (DEFINER_FILES.has(path)) continue
      for (const decl of sf.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue()
        if (!LOOPHOLE_MODULES.some((re) => re.test(spec))) continue
        const importsLoopholeName = decl
          .getNamedImports()
          .some((n) => BANNED_NAMES.has(n.getName()))
        if (importsLoopholeName) stillImporting.add(path)
      }
    }

    const stale = [...ALLOWLIST_LOOPHOLE_IMPORTERS].filter((f) => !stillImporting.has(f)).sort()
    expect(
      stale,
      stale.length
        ? `allowlist contains files that no longer import the loophole symbols — remove from ALLOWLIST_LOOPHOLE_IMPORTERS:\n  ${stale.join('\n  ')}`
        : 'allowlist consistent'
    ).toEqual([])
  })

  test('tripwire: no bare calls to getDatabaseService / getDbPool from non-definer non-importer files', () => {
    // Defends against a future where someone re-exports the global from a
    // different module — the original call test had false positives from
    // DI parameters of the same name. By restricting "interesting calls"
    // to files that actually import the loophole symbols, we eliminate
    // the parameter-binding ambiguity.
    const project = getProject()
    const violations: string[] = []

    for (const sf of project.getSourceFiles('src/**/*.ts')) {
      const path = relPath(sf.getFilePath())
      if (DEFINER_FILES.has(path)) continue
      if (ALLOWLIST_LOOPHOLE_IMPORTERS.has(path)) continue

      // Does this file import any loophole-shaped name?
      const importsLoophole = sf.getImportDeclarations().some((decl) => {
        const spec = decl.getModuleSpecifierValue()
        if (!LOOPHOLE_MODULES.some((re) => re.test(spec))) return false
        return decl.getNamedImports().some((n) => BANNED_NAMES.has(n.getName()))
      })

      if (!importsLoophole) continue

      // Files that import but aren't allowlisted shouldn't even reach
      // here (the first test catches them). This branch is defensive.
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression()
        if (!expr.isKind(SyntaxKind.Identifier)) continue
        if (!BANNED_NAMES.has(expr.getText())) continue
        violations.push(`${path}:${call.getStartLineNumber()} bare call ${expr.getText()}()`)
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  test('phase 1: StorageSession declares no escape-hatch methods', () => {
    // Sealed: getDatabaseService / getDbPool are off the interface.
    // Concrete classes (SqliteStorageSession) keep them as public
    // methods; consumers that need them type-narrow on capabilities.backend
    // first (see DatabaseManager.getCurrent and dbPoolManager.getDbPool).
    const project = ensureFreshProject()
    const sessionFile = project.getSourceFileOrThrow('src/main/storage/session.ts')
    const iface = sessionFile.getInterfaceOrThrow('StorageSession')
    const escapes = iface
      .getMethods()
      .map((m) => m.getName())
      .filter((name) => BANNED_NAMES.has(name))

    expect(escapes, escapes.join(', ')).toEqual([])
  })
})

function ensureFreshProject(): Project {
  return new Project({ tsConfigFilePath: 'tsconfig.node.json' })
}
