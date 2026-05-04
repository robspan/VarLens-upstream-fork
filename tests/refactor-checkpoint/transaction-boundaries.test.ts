import { resolve } from 'node:path'
import { describe, test } from 'vitest'
import { SyntaxKind } from 'ts-morph'
import { getProject, relPath } from '../web-gate/helpers/ts-morph-project'
import { assertSnapshotMatches, findEnclosingFunctionName, type Snapshot } from './helpers/snapshot-io'

interface Entry {
  file: string
  callerFunction: string
  assignedTo: string | null
}

const SNAPSHOT_PATH = resolve(
  process.cwd(),
  'tests/refactor-checkpoint/__snapshots__/transaction-boundaries.json'
)

describe('refactor checkpoint — transaction boundaries', () => {
  test('every db.transaction(...) call site matches the committed snapshot', () => {
    const entries: Entry[] = []

    for (const sourceFile of getProject().getSourceFiles()) {
      const filePath = sourceFile.getFilePath()
      if (!filePath.includes('/src/main/')) continue
      if (filePath.endsWith('.test.ts')) continue

      sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
        const expr = call.getExpression()
        const prop = expr.asKind(SyntaxKind.PropertyAccessExpression)
        if (!prop) return
        if (prop.getName() !== 'transaction') return

        const varDecl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
        entries.push({
          file: relPath(filePath),
          callerFunction: findEnclosingFunctionName(call),
          assignedTo: varDecl ? varDecl.getName() : null
        })
      })
    }

    entries.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file)
      if (a.callerFunction !== b.callerFunction) return a.callerFunction.localeCompare(b.callerFunction)
      return (a.assignedTo ?? '').localeCompare(b.assignedTo ?? '')
    })

    const snapshot: Snapshot<Entry> = {
      schemaVersion: 1,
      capturedAt: '2026-05-04',
      entries
    }

    assertSnapshotMatches(SNAPSHOT_PATH, snapshot)
  })
})
