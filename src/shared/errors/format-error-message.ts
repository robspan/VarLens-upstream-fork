import { isIpcError } from '../types/errors'

export function formatErrorMessage(error: unknown, fallback: string): string {
  if (isIpcError(error)) return error.userMessage ?? error.message
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.userMessage === 'string') return record.userMessage
    if (typeof record.message === 'string') return record.message
    if (typeof record.error === 'string') return record.error
  }
  return typeof error === 'string' && error.length > 0 ? error : fallback
}
