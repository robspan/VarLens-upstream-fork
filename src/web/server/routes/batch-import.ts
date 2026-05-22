import { isAbsolute } from 'node:path'

import {
  cleanupZipTemp,
  extractZip,
  testZipPassword
} from '../../../main/ipc/handlers/batch-import-logic'
import { ImportServerPathArgSchema } from '../../../shared/api/schemas/import'
import { serverPathImportDisabled, serverPathImportDisabledResponse } from './server-path-import'
import type { OverrideHandler } from './types'

export function buildBatchImportOverrides(): Record<string, OverrideHandler> {
  return {
    'batch-import:extractZip': {
      async handle(args, _request, reply) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success || !isAbsolute(validatedZipPath.data)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
        }
        return await extractZip(
          validatedZipPath.data,
          typeof password === 'string' ? password : undefined
        )
      }
    },

    'batch-import:testZipPassword': {
      handle(args, _request, reply) {
        if (serverPathImportDisabled()) {
          reply.code(403)
          return serverPathImportDisabledResponse()
        }
        const [zipPath, password] = args
        const validatedZipPath = ImportServerPathArgSchema.safeParse(zipPath)
        if (!validatedZipPath.success || !isAbsolute(validatedZipPath.data)) {
          reply.code(400)
          return { error: 'invalid-zip-path', message: 'zipPath must be an absolute path' }
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
