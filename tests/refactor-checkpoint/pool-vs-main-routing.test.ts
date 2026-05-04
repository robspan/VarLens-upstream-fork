import { resolve } from 'node:path'
import { describe, test } from 'vitest'
import { SyntaxKind } from 'ts-morph'
import { getProject, relPath } from '../web-gate/helpers/ts-morph-project'
import { assertSnapshotMatches, findEnclosingFunctionName, type Snapshot } from './helpers/snapshot-io'

interface Entry {
  file: string
  callerFunction: string
  type: string
}

const SNAPSHOT_PATH = resolve(
  process.cwd(),
  'tests/refactor-checkpoint/__snapshots__/pool-vs-main-routing.json'
)

describe('refactor checkpoint — pool vs main routing', () => {
  test('every dbPool.run({ type }) dispatch matches the committed snapshot', () => {
    const entries: Entry[] = []

    for (const sourceFile of getProject().getSourceFiles()) {
      const filePath = sourceFile.getFilePath()
      if (!filePath.includes('/src/main/')) continue
      if (filePath.endsWith('.test.ts')) continue

      sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
        const expr = call.getExpression()
        const prop = expr.asKind(SyntaxKind.PropertyAccessExpression)
        if (!prop) return
        if (prop.getName() !== 'run') return

        const receiver = prop.getExpression().getText()
        if (!receiver.endsWith('dbPool')) return

        const args = call.getArguments()
        if (args.length === 0) return
        const obj = args[0].asKind(SyntaxKind.ObjectLiteralExpression)
        if (!obj) return

        const typeProp = obj.getProperty('type')?.asKind(SyntaxKind.PropertyAssignment)
        const initializer = typeProp?.getInitializer()?.asKind(SyntaxKind.StringLiteral)
        if (!initializer) return

        entries.push({
          file: relPath(filePath),
          callerFunction: findEnclosingFunctionName(call),
          type: initializer.getLiteralText()
        })
      })
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      if (a.file !== b.file) return a.file.localeCompare(b.file)
      return a.callerFunction.localeCompare(b.callerFunction)
    })

    const snapshot: Snapshot<Entry> = {
      schemaVersion: 1,
      capturedAt: '2026-05-04',
      entries
    }

    assertSnapshotMatches(SNAPSHOT_PATH, snapshot)
  })
})
