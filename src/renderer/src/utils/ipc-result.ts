import { isIpcError, type SerializableError } from '../../../shared/types/errors'
import { logService } from '../services/LogService'

/**
 * Unwrap an IPC result, logging and returning null on error.
 * Use for wrapHandler-backed channels only (Track 1 error contract).
 *
 * Track 2 channels (those returning { success, error? }) should NOT use this helper.
 */
export function unwrapIpcResult<T>(
  result: T | SerializableError,
  context: string
): T | null {
  if (isIpcError(result)) {
    logService.error(`${context}: ${result.userMessage}`, context)
    return null
  }
  return result
}
