import { basename, isAbsolute } from 'node:path'

import { cancelImport, startImport } from '../../../main/ipc/handlers/import-logic'
import type { StorageWriteTask } from '../../../main/storage/write-executor'
import {
  cleanupZipTemp,
  extractZip,
  testZipPassword
} from '../../../main/ipc/handlers/batch-import-logic'
import { extractCaseName } from '../../../main/import/batch-utils'
import { ImportServerPathArgSchema } from '../../../shared/api/schemas/import'
import type { BatchResult, DuplicateChoice } from '../../../shared/types/api'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'
import { isWebUploadRef, resolveWebUploadRef, stageExistingFileUpload } from './upload-staging'

const DELETE_CASE_TASK_TYPE = ['cases', 'delete'].join(':')

interface ResolvedBatchFile {
  inputPath: string
  storedPath: string
  fileName: string
}

export function buildBatchImportOverrides(): Record<string, OverrideHandler> {
  return {
    'batch-import:selectFiles': {
      handle() {
        return []
      }
    },

    'batch-import:selectFolder': {
      handle() {
        return []
      }
    },

    'batch-import:selectZip': {
      handle() {
        return null
      }
    },

    'batch-import:checkDuplicates': {
      async handle(args, request, reply, { session }) {
        const [filePaths, stripText] = args
        if (!Array.isArray(filePaths)) {
          reply.code(400)
          return { error: 'invalid-files', message: 'filePaths must be an array' }
        }

        const resolved = resolveBatchFiles(filePaths, request.session.user?.id)
        if (resolved === null) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }

        const existingNames = new Set((await session.listCases()).map((item) => item.name))
        let duplicateCount = 0
        const files = resolved.map((file) => {
          const caseName = extractCaseName(
            file.fileName,
            typeof stripText === 'string' ? stripText : undefined
          )
          const isDuplicate = existingNames.has(caseName)
          if (isDuplicate) duplicateCount++
          return {
            filePath: file.inputPath,
            fileName: file.fileName,
            caseName,
            isDuplicate
          }
        })

        return { files, duplicateCount }
      }
    },

    'batch-import:start': {
      async handle(args, request, reply, { session, events }) {
        const [filePaths, duplicateStrategy, stripText] = args
        if (!Array.isArray(filePaths)) {
          reply.code(400)
          return { error: 'invalid-files', message: 'filePaths must be an array' }
        }
        if (duplicateStrategy !== 'skip' && duplicateStrategy !== 'overwrite') {
          reply.code(400)
          return { error: 'invalid-duplicate-strategy', message: 'duplicateStrategy is invalid' }
        }

        const resolved = resolveBatchFiles(filePaths, request.session.user?.id)
        if (resolved === null) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }

        return await startWebBatchImport(
          resolved,
          duplicateStrategy,
          typeof stripText === 'string' ? stripText : undefined,
          request.session.user?.id,
          session,
          events
        )
      }
    },

    'batch-import:cancel': {
      handle() {
        cancelImport()
      }
    },

    'batch-import:extractZip': {
      async handle(args, request, reply) {
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be a file path' }
        }

        if (isWebUploadRef(validatedZipPath.data)) {
          const result = await extractWebUploadZip(
            validatedZipPath.data,
            request.session.user?.id,
            typeof password === 'string' ? password : undefined
          )
          if (result === null) {
            reply.code(404)
            return { error: 'upload-not-found', message: 'Uploaded ZIP file is no longer available' }
          }
          return result
        }

        if (serverPathImportDisabled() || !isAbsolute(validatedZipPath.data)) {
          reply.code(serverPathImportDisabled() ? 403 : 400)
          return serverPathImportDisabled()
            ? serverPathImportDisabledResponse()
            : { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return await extractZip(
          validatedZipPath.data,
          typeof password === 'string' ? password : undefined
        )
      }
    },

    'batch-import:testZipPassword': {
      handle(args, request, reply) {
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be a file path' }
        }

        if (isWebUploadRef(validatedZipPath.data)) {
          const upload = resolveUploadedFile(validatedZipPath.data, request.session.user?.id)
          if (upload === null) {
            reply.code(404)
            return { error: 'upload-not-found', message: 'Uploaded ZIP file is no longer available' }
          }
          return testZipPassword(upload.storedPath, typeof password === 'string' ? password : '')
        }

        if (serverPathImportDisabled() || !isAbsolute(validatedZipPath.data)) {
          reply.code(serverPathImportDisabled() ? 403 : 400)
          return serverPathImportDisabled()
            ? serverPathImportDisabledResponse()
            : { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return testZipPassword(validatedZipPath.data, typeof password === 'string' ? password : '')
      }
    },

    'batch-import:cleanupZipTemp': {
      handle() {
        cleanupZipTemp()
      }
    }
  }
}

function resolveUploadedFile(value: string, userId: number | undefined): ResolvedBatchFile | null {
  if (userId === undefined) return null
  const upload = resolveWebUploadRef(value, userId)
  if (upload === null) return null
  return {
    inputPath: upload.ref,
    storedPath: upload.storedPath,
    fileName: upload.originalName
  }
}

async function extractWebUploadZip(
  zipRef: string,
  userId: number | undefined,
  password: string | undefined
): Promise<{ files: string[]; errors: string[] } | null> {
  const upload = resolveUploadedFile(zipRef, userId)
  if (upload === null || userId === undefined) return null

  const result = await extractZip(upload.storedPath, password)
  const stagedFiles = []
  for (const filePath of result.files) {
    stagedFiles.push(
      await stageExistingFileUpload({
        userId,
        originalName: basename(filePath),
        sourcePath: filePath
      })
    )
  }
  cleanupZipTemp()
  return {
    files: stagedFiles.map((file) => file.ref),
    errors: result.errors
  }
}

function resolveBatchFiles(
  values: unknown[],
  userId: number | undefined
): ResolvedBatchFile[] | null {
  const resolved: ResolvedBatchFile[] = []
  for (const raw of values) {
    const parsed = ImportServerPathArgSchema.safeParse(raw)
    if (!parsed.success) return null

    if (isWebUploadRef(parsed.data)) {
      const upload = resolveUploadedFile(parsed.data, userId)
      if (upload === null) return null
      resolved.push(upload)
      continue
    }

    if (serverPathImportDisabled() || !isAbsolute(parsed.data)) return null
    resolved.push({
      inputPath: parsed.data,
      storedPath: parsed.data,
      fileName: basename(parsed.data) || 'unknown'
    })
  }
  return resolved
}

async function startWebBatchImport(
  files: ResolvedBatchFile[],
  duplicateStrategy: DuplicateChoice,
  stripText: string | undefined,
  userId: number | undefined,
  session: Parameters<OverrideHandler['handle']>[3]['session'],
  events: Parameters<OverrideHandler['handle']>[3]['events']
): Promise<BatchResult> {
  const existingCases = await session.listCases()
  const existingByName = new Map(existingCases.map((item) => [item.name, item]))
  const result: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
    details: []
  }

  for (let index = 0; index < files.length; index++) {
    const file = files[index]
    const caseName = extractCaseName(file.fileName, stripText)
    const existing = existingByName.get(caseName)

    if (existing !== undefined && duplicateStrategy === 'skip') {
      result.skipped++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'skipped'
      })
      continue
    }

    try {
      if (existing !== undefined) {
        await session
          .getWriteExecutor()
          .execute({ type: DELETE_CASE_TASK_TYPE, params: [existing.id] } as StorageWriteTask)
        existingByName.delete(caseName)
      }

      const importResult = await startImport(file.storedPath, caseName, undefined, () => session, {
        onProgress: (progress) => {
          if (userId === undefined) return
          events.publish(userId, 'batch-import:progress', {
            currentIndex: index + 1,
            totalFiles: files.length,
            currentFileName: file.fileName,
            overallPercent: Math.round(((index + 1) / files.length) * 100),
            fileProgress: progress
          })
        }
      })

      result.succeeded++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'success',
        variantCount: importResult.variantCount
      })
    } catch (error) {
      result.failed++
      result.details.push({
        filePath: file.inputPath,
        fileName: file.fileName,
        caseName,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (userId !== undefined) {
    events.publish(userId, 'batch-import:complete', result)
  }

  return result
}
