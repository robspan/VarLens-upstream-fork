import type { SerializableError } from '../../shared/types/errors'
import { mainLogger } from '../services/MainLogger'
import { toSerializableError } from './serializable-error'

export { toSerializableError }

/**
 * Wrap an IPC handler function to catch errors and convert to serializable format.
 * Use this around all ipcMain.handle callbacks.
 */
export async function wrapHandler<T>(handler: () => Promise<T>): Promise<T | SerializableError> {
  try {
    return await handler()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.error(`IPC handler error: ${message}`, 'ipc')
    return toSerializableError(error)
  }
}
