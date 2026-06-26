export function serverPathImportDisabled(): boolean {
  return true
}

export function serverPathImportDisabledResponse(): {
  error: string
  message: string
} {
  return {
    error: 'server-path-import-disabled',
    message: 'Server-path import is disabled in web mode. Use browser upload refs instead.'
  }
}
