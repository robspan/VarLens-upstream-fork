import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import type { OverrideHandler } from './types'

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

export function buildAssetOverrides(): Record<string, OverrideHandler> {
  return {
    'case-metadata:createCohort': {
      async handle(args, _request, reply, { session }) {
        const [name, description] = args
        if (typeof name !== 'string') {
          reply.code(400)
          return { error: 'invalid-cohort-name' }
        }
        return await session.getWriteExecutor().execute({
          type: 'case-metadata:createCohort',
          params: [{ name, description: typeof description === 'string' ? description : null }]
        })
      }
    },

    'analysis-groups:create': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        if (params === null || typeof params !== 'object') {
          reply.code(400)
          return { error: 'invalid-analysis-group' }
        }
        const raw = params as { name?: unknown; groupType?: unknown; description?: unknown }
        if (typeof raw.name !== 'string') {
          reply.code(400)
          return { error: 'invalid-analysis-group-name' }
        }
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:create',
          params: [
            raw.name,
            raw.groupType === 'tumor_normal' ? raw.groupType : 'family',
            typeof raw.description === 'string' ? raw.description : undefined
          ]
        })
      }
    },

    'analysis-groups:addMember': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        if (params === null || typeof params !== 'object') {
          reply.code(400)
          return { error: 'invalid-analysis-group-member' }
        }
        const raw = params as {
          groupId?: unknown
          caseId?: unknown
          role?: unknown
          affectedStatus?: unknown
          individualId?: unknown
        }
        if (
          typeof raw.groupId !== 'number' ||
          typeof raw.caseId !== 'number' ||
          typeof raw.role !== 'string'
        ) {
          reply.code(400)
          return { error: 'invalid-analysis-group-member' }
        }
        return await session.getWriteExecutor().execute({
          type: 'analysis-groups:addMember',
          params: [
            raw.groupId,
            raw.caseId,
            raw.role as never,
            typeof raw.affectedStatus === 'string' ? (raw.affectedStatus as never) : undefined,
            typeof raw.individualId === 'string' ? raw.individualId : undefined
          ]
        })
      }
    },

    'region-files:importBed': {
      async handle(args, _request, reply, { session }) {
        const [fileId, filePath] = args
        if (typeof fileId !== 'number' || typeof filePath !== 'string' || !isAbsolute(filePath)) {
          reply.code(400)
          return { error: 'invalid-bed-import' }
        }
        return await session.getWriteExecutor().execute({
          type: 'region-files:importBed',
          params: [fileId, await readBedEntries(filePath)]
        })
      }
    },

    'gene-lists:setGenes': {
      async handle(args, _request, reply, { session }) {
        const [listId, genes] = args
        if (
          typeof listId !== 'number' ||
          !Array.isArray(genes) ||
          !genes.every((gene) => typeof gene === 'string')
        ) {
          reply.code(400)
          return { error: 'invalid-gene-list-genes' }
        }
        await session.getWriteExecutor().execute({
          type: 'gene-lists:setGenes',
          params: [listId, genes]
        })
        return await session.getReadExecutor().execute({
          type: 'gene-lists:getGenes',
          params: [listId]
        })
      }
    }
  }
}
