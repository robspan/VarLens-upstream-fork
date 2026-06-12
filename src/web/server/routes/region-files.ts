import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { RegionFileImportBedArgsSchema } from '../../../shared/api/schemas/region-files'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'
import { isWebUploadRef, resolveWebUploadPath } from './upload-staging'

function normalizeBedLine(
  line: string
): { chr: string; start: number; end: number; label?: string } | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const [chr, startRaw, endRaw, label] = trimmed.split(/\s+/u)
  const start = Number(startRaw)
  const end = Number(endRaw)
  if (chr === undefined || !Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`Invalid BED row: ${line}`)
  }
  return {
    chr,
    start,
    end,
    ...(label !== undefined && label !== '' ? { label } : {})
  }
}

async function readBedEntries(
  filePath: string
): Promise<Array<{ chr: string; start: number; end: number; label?: string }>> {
  const content = await readFile(filePath, 'utf8')
  return content
    .split(/\r?\n/u)
    .map(normalizeBedLine)
    .filter(
      (entry): entry is { chr: string; start: number; end: number; label?: string } =>
        entry !== null
    )
}

export function buildRegionFileOverrides(): Record<string, OverrideHandler> {
  return {
    'region-files:importBed': {
      async handle(args, request, reply, { session }) {
        const parsed = RegionFileImportBedArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        const [fileId, filePath] = parsed.data

        const resolvedPath = resolveBedFilePath(filePath, request.session.user?.id)
        if (resolvedPath === null) {
          reply.code(isWebUploadRef(filePath) ? 404 : 403)
          return isWebUploadRef(filePath)
            ? { error: 'upload-not-found', message: 'Uploaded BED file is no longer available' }
            : serverPathImportDisabledResponse()
        }
        if (!isAbsolute(resolvedPath)) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        return await session.getWriteExecutor().execute({
          type: 'region-files:importBed',
          params: [fileId, await readBedEntries(resolvedPath)]
        })
      }
    }
  }
}

function resolveBedFilePath(filePath: string, userId: number | undefined): string | null {
  if (isWebUploadRef(filePath)) {
    if (userId === undefined) return null
    return resolveWebUploadPath(filePath, userId)
  }
  if (serverPathImportDisabled()) return null
  return filePath
}
