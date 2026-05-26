import { copyFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

import type { LaunchElectronAppResult } from '../../e2e/helpers/electron-app'

interface SerializableIpcError {
  code: string
  message: string
  userMessage: string
}

function isSerializableIpcError(value: unknown): value is SerializableIpcError {
  return (
    value !== null &&
    typeof value === 'object' &&
    'code' in value &&
    'message' in value &&
    'userMessage' in value
  )
}

export function unwrapIpcResultForParity<T>(value: unknown): T {
  if (isSerializableIpcError(value)) {
    throw new Error(`IPC error [${value.code}]: ${value.message}`)
  }

  if (value !== null && typeof value === 'object' && 'ok' in value) {
    const result = value as { ok: boolean; data?: T; error?: { message?: string } }
    if (!result.ok) throw new Error(`IPC error: ${result.error?.message ?? 'unknown'}`)
    return result.data as T
  }

  return value as T
}

export function stageElectronImportFile(
  session: Pick<LaunchElectronAppResult, 'isolationRoot'>,
  sourcePath: string
): string {
  const source = resolve(sourcePath)
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12)
  const targetDir = join(session.isolationRoot, 'allowed-imports', digest)
  const targetPath = join(targetDir, basename(source))
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(source, targetPath)
  return targetPath
}

export function prepareElectronApiArgs(
  session: Pick<LaunchElectronAppResult, 'isolationRoot'>,
  domain: string,
  method: string,
  args: unknown[]
): unknown[] {
  if (domain === 'import' && method === 'start' && typeof args[0] === 'string') {
    return [stageElectronImportFile(session, args[0]), ...args.slice(1)]
  }

  if (domain === 'import' && method === 'startMultiFile') {
    const files = Array.isArray(args[1])
      ? args[1].map((file) => {
          if (file === null || typeof file !== 'object') return file
          const value = file as Record<string, unknown>
          return typeof value.filePath === 'string'
            ? { ...value, filePath: stageElectronImportFile(session, value.filePath) }
            : value
        })
      : args[1]

    const filters =
      args[3] !== null && typeof args[3] === 'object'
        ? stageElectronImportFilters(session, args[3] as Record<string, unknown>)
        : args[3]

    return [args[0], files, args[2], filters]
  }

  if (domain === 'import' && method === 'vcfPreview' && typeof args[0] === 'string') {
    return [stageElectronImportFile(session, args[0])]
  }

  if (domain === 'import' && method === 'vcfMultiPreview' && Array.isArray(args[0])) {
    return [
      args[0].map((path) =>
        typeof path === 'string' ? stageElectronImportFile(session, path) : path
      )
    ]
  }

  if (
    domain === 'batchImport' &&
    (method === 'extractZip' || method === 'testZipPassword') &&
    typeof args[0] === 'string'
  ) {
    return [stageElectronImportFile(session, args[0]), ...args.slice(1)]
  }

  return args
}

function stageElectronImportFilters(
  session: Pick<LaunchElectronAppResult, 'isolationRoot'>,
  filters: Record<string, unknown>
): Record<string, unknown> {
  return typeof filters.bedFile === 'string'
    ? { ...filters, bedFile: stageElectronImportFile(session, filters.bedFile) }
    : filters
}

export async function callElectronApi<T>(
  session: LaunchElectronAppResult,
  domain: string,
  method: string,
  args: unknown[] = []
): Promise<T> {
  const apiDomain = domain === 'batch-import' ? 'batchImport' : domain
  const preparedArgs = prepareElectronApiArgs(session, apiDomain, method, args)
  const raw = await session.window.evaluate(
    async ({ domain: innerDomain, method: innerMethod, args: innerArgs }) => {
      const api = (window as unknown as { api?: Record<string, Record<string, unknown>> }).api
      const fn = api?.[innerDomain]?.[innerMethod]
      if (typeof fn !== 'function') {
        throw new Error(`window.api.${innerDomain}.${innerMethod} is not exposed`)
      }
      return await (fn as (...callArgs: unknown[]) => Promise<unknown>)(...innerArgs)
    },
    { domain: apiDomain, method, args: preparedArgs }
  )
  return unwrapIpcResultForParity<T>(raw)
}
