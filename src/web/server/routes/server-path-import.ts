const SERVER_PATH_IMPORT_ENV = 'VARLENS_WEB_ALLOW_SERVER_PATH_IMPORT'

export function serverPathImportDisabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env[SERVER_PATH_IMPORT_ENV] !== '1'
}

export function serverPathImportDisabledResponse(): {
  error: string
  message: string
} {
  return {
    error: 'server-path-import-disabled',
    message:
      'Server-path import is disabled. Browser upload support must use a dedicated upload route.'
  }
}
