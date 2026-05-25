import { app } from 'electron'
import { resolve, sep } from 'path'

/**
 * In-memory session allow-list of paths the user explicitly picked via an
 * Electron file dialog this session, plus the three Electron-managed
 * directory roots (home, userData, temp). Cleared on app restart.
 *
 * Main-process only. Workers cannot import 'electron' and therefore cannot
 * consult this allow-list; they receive paths that main has already
 * validated. BedFilter.fromFile keeps a worker-safe defensive check as
 * defence-in-depth.
 */
const dialogAllowedPaths = new Set<string>()

export function addAllowedImportPath(absolutePath: string): void {
  dialogAllowedPaths.add(resolve(absolutePath))
}

export function isAllowedImportPath(candidate: string): boolean {
  const abs = resolve(candidate)

  if (dialogAllowedPaths.has(abs)) return true

  const roots: string[] = []
  try {
    roots.push(app.getPath('home'), app.getPath('userData'), app.getPath('temp'))
  } catch {
    if (process.env.TMPDIR !== undefined && process.env.TMPDIR !== '') {
      roots.push(process.env.TMPDIR)
    }
    if (process.env.HOME !== undefined && process.env.HOME !== '') {
      roots.push(process.env.HOME)
    }
    roots.push('/tmp')
  }

  return roots.some((root) => {
    const normalisedRoot = resolve(root)
    return abs === normalisedRoot || abs.startsWith(normalisedRoot + sep)
  })
}

/** Test-only reset helper. Do not call from production code. */
export function __resetAllowlistForTests(): void {
  dialogAllowedPaths.clear()
}
