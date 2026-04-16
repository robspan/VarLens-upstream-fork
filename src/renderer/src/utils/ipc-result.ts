import { unwrapIpcResult } from '../../../shared/types/errors'
import type { IpcResult } from '../../../shared/types/errors'

export function expectIpcResult<T>(result: IpcResult<T>): T {
  return unwrapIpcResult(result)
}
