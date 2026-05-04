import { describe, expect, test } from 'vitest'
import { readFileSync } from 'fs'
import { getProject, relPath } from './helpers/ts-morph-project'

/**
 * Phase 1 gate — `src/shared/` (and once it exists, `src/web/`) must contain
 * NO Electron runtime imports. Type-only imports are allowed because they
 * compile away.
 *
 * Reasoning: shared modules run in three contexts (main, preload, renderer).
 * Renderer + preload can't see Electron's main-process APIs at runtime; a
 * runtime import would either silently fail or pull Electron's binary into
 * the web bundle once that build target exists.
 */

const BANNED_RUNTIME_IDENTIFIERS = [
  'BrowserWindow',
  'ipcRenderer',
  'ipcMain',
  'Menu',
  'Tray',
  'dialog',
  'shell',
  'app'
]

const FORWARD_GLOBS = ['src/shared/**/*.ts', 'src/web/**/*.ts']

describe('electron-leak gate', () => {
  test('no runtime electron imports under src/shared/ or src/web/', () => {
    const project = getProject()
    const violations: string[] = []

    for (const glob of FORWARD_GLOBS) {
      const files = project.getSourceFiles(glob)
      for (const sf of files) {
        const path = relPath(sf.getFilePath())
        for (const decl of sf.getImportDeclarations()) {
          const spec = decl.getModuleSpecifierValue()
          if (spec !== 'electron') continue
          if (decl.isTypeOnly()) continue
          // Per-named-import type-only check
          const namedImports = decl.getNamedImports()
          const allNamedAreTypeOnly =
            namedImports.length > 0 && namedImports.every((n) => n.isTypeOnly())
          if (allNamedAreTypeOnly) continue
          violations.push(`${path}:${decl.getStartLineNumber()} imports from 'electron' at runtime`)
        }
      }
    }

    expect(violations, violations.join('\n') || 'expected no runtime electron imports').toEqual([])
  })

  test('no runtime references to Electron-only identifiers under src/shared/', () => {
    // Cheap grep — catches unqualified identifiers like `BrowserWindow.foo()`
    // that would only exist if a runtime electron import sneaked in. Type
    // references in `import type` blocks are skipped by the import test
    // above; bare identifiers in code are caught here.
    const project = getProject()
    const sharedFiles = project.getSourceFiles('src/shared/**/*.ts')
    const violations: string[] = []

    for (const sf of sharedFiles) {
      const path = relPath(sf.getFilePath())
      const text = readFileSync(sf.getFilePath(), 'utf8')
      // Strip comments and string literals to avoid noise from prose / docs.
      const stripped = stripCommentsAndStrings(text)
      for (const ident of BANNED_RUNTIME_IDENTIFIERS) {
        const re = new RegExp(`\\b${ident}\\.[A-Za-z_]`, 'g')
        if (re.test(stripped)) {
          violations.push(`${path}: references ${ident}.* at runtime`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })
})

function stripCommentsAndStrings(src: string): string {
  // Remove block comments, line comments, then string + template literals.
  // Good-enough heuristic — this file isn't trying to be a parser.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}
