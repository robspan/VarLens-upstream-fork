import { isAbsolute } from 'node:path'

import {
  startImport,
  startMultiFileImport,
  type VcfImportOptions
} from '../../../main/ipc/handlers/import-logic'
import {
  cleanupZipTemp,
  extractZip,
  testZipPassword
} from '../../../main/ipc/handlers/batch-import-logic'
import type { MultiFileImportSpec } from '../../../shared/types/api'
import type { OverrideHandler } from './types'

const SERVER_PATH_IMPORT_ENV = 'VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT'

function serverPathImportDisabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1'
}

function serverPathImportDisabledResponse(): {
  error: string
  message: string
} {
  return {
    error: 'server-path-import-disabled',
    message:
      'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
  }
}

function normalizeVcfOptions(vcfOptions: unknown): VcfImportOptions | undefined {
  return vcfOptions !== null && typeof vcfOptions === 'object'
    ? {
        selectedSample:
          typeof (vcfOptions as { selectedSample?: unknown }).selectedSample === 'string'
            ? (vcfOptions as { selectedSample: string }).selectedSample
            : undefined,
        genomeBuild:
          typeof (vcfOptions as { genomeBuild?: unknown }).genomeBuild === 'string'
            ? (vcfOptions as { genomeBuild: string }).genomeBuild
            : undefined
      }
    : undefined
}

export function buildImportOverrides(): Record<string, OverrideHandler> {
  return {
    'import:start': {
      async handle(args, request, reply, { session, events }) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }

        const [filePath, caseName, vcfOptions] = args
        if (typeof filePath !== 'string' || filePath.trim() === '' || !isAbsolute(filePath)) {
          reply.code(400)
          return { error: 'invalid-file-path', message: 'filePath must be an absolute path' }
        }
        if (typeof caseName !== 'string' || caseName.trim() === '') {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }

        return await startImport(
          filePath,
          caseName,
          normalizeVcfOptions(vcfOptions),
          () => session,
          {
            onProgress: (progress) => {
              const userId = request.session.user?.id
              if (userId !== undefined) {
                events.publish(userId, 'import:progress', progress)
              }
            }
          }
        )
      }
    },

    'import:startMultiFile': {
      async handle(args, request, reply, { session, events }) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }

        const [caseName, files, vcfOptions, filters] = args
        if (typeof caseName !== 'string' || caseName.trim() === '') {
          reply.code(400)
          return { error: 'invalid-case-name', message: 'caseName must be a non-empty string' }
        }
        if (!Array.isArray(files) || files.length === 0) {
          reply.code(400)
          return { error: 'invalid-files', message: 'files must be a non-empty array' }
        }

        const normalizedFiles: MultiFileImportSpec[] = []
        for (const file of files) {
          if (file === null || typeof file !== 'object') {
            reply.code(400)
            return { error: 'invalid-file', message: 'Each file must be an object' }
          }
          const raw = file as Record<string, unknown>
          if (typeof raw.filePath !== 'string' || !isAbsolute(raw.filePath)) {
            reply.code(400)
            return { error: 'invalid-file-path', message: 'filePath must be absolute' }
          }
          if (typeof raw.variantType !== 'string' || raw.variantType.trim() === '') {
            reply.code(400)
            return { error: 'invalid-variant-type', message: 'variantType is required' }
          }
          normalizedFiles.push({
            filePath: raw.filePath,
            variantType: raw.variantType,
            caller: typeof raw.caller === 'string' ? raw.caller : null,
            annotationFormat: typeof raw.annotationFormat === 'string' ? raw.annotationFormat : null
          })
        }

        const normalizedFilters =
          filters !== null && typeof filters === 'object'
            ? (filters as {
                bedFile?: string | null
                bedPadding?: number
                passOnly?: boolean
                minQual?: number | null
                minGq?: number | null
                minDp?: number | null
              })
            : undefined

        return await startMultiFileImport(
          caseName,
          normalizedFiles,
          normalizeVcfOptions(vcfOptions),
          () => session,
          () => {
            throw new Error('SQLite database is not available in web mode')
          },
          {
            onProgress: (progress) => {
              const userId = request.session.user?.id
              if (userId !== undefined) {
                events.publish(userId, 'import:progress', progress)
              }
            }
          },
          undefined,
          normalizedFilters
        )
      }
    },

    'batch-import:extractZip': {
      async handle(args, _request, reply) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }
        const [zipPath, password] = args
        if (typeof zipPath !== 'string' || zipPath.trim() === '' || !isAbsolute(zipPath)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return await extractZip(zipPath, typeof password === 'string' ? password : undefined)
      }
    },

    'batch-import:testZipPassword': {
      handle(args, _request, reply) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }
        const [zipPath, password] = args
        if (typeof zipPath !== 'string' || zipPath.trim() === '' || !isAbsolute(zipPath)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return testZipPassword(zipPath, typeof password === 'string' ? password : '')
      }
    },

    'batch-import:cleanupZipTemp': {
      handle() {
        cleanupZipTemp()
      }
    }
  }
}
