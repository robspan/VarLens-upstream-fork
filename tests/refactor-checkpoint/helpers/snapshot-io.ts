import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect } from 'vitest'
import { Node, SyntaxKind } from 'ts-morph'

export interface Snapshot<T> {
  schemaVersion: number
  capturedAt: string
  entries: T[]
}

const UPDATE_FLAG = 'UPDATE_REFACTOR_SNAPSHOTS'

export function assertSnapshotMatches<T>(path: string, current: Snapshot<T>): void {
  const update = process.env[UPDATE_FLAG] === '1'
  const existing = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Snapshot<T>) : null

  if (update) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(current, null, 2) + '\n', 'utf8')
    return
  }

  if (existing === null) {
    throw new Error(
      `Snapshot missing at ${path}.\n` +
        `Seed it with: ${UPDATE_FLAG}=1 npm run test\n` +
        `Then commit the JSON file.`
    )
  }

  expect(current.entries, driftMessage(path)).toEqual(existing.entries)
}

function driftMessage(path: string): string {
  return (
    `Refactor checkpoint snapshot drift at ${path}.\n` +
    `If the change is intentional: review the diff carefully, then run\n` +
    `  ${UPDATE_FLAG}=1 npm run test\n` +
    `and commit the regenerated snapshot in the same PR with a reason.\n` +
    `If unintended: investigate before updating.`
  )
}

export function findEnclosingFunctionName(node: Node): string {
  let cursor: Node | undefined = node.getParent()
  while (cursor) {
    const fn =
      cursor.asKind(SyntaxKind.MethodDeclaration) ??
      cursor.asKind(SyntaxKind.FunctionDeclaration) ??
      cursor.asKind(SyntaxKind.FunctionExpression) ??
      cursor.asKind(SyntaxKind.ArrowFunction) ??
      cursor.asKind(SyntaxKind.GetAccessor) ??
      cursor.asKind(SyntaxKind.SetAccessor) ??
      cursor.asKind(SyntaxKind.Constructor)

    if (fn) {
      if (fn.getKind() === SyntaxKind.Constructor) return 'constructor'
      const named = fn as { getName?: () => string | undefined }
      if (typeof named.getName === 'function') {
        const name = named.getName()
        if (name) return name
      }
      const varDecl = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
      if (varDecl) return varDecl.getName()
      const propAssign = fn.getFirstAncestorByKind(SyntaxKind.PropertyAssignment)
      if (propAssign) return propAssign.getName()
      return '<anonymous>'
    }
    cursor = cursor.getParent()
  }
  return '<top-level>'
}
