import { describe, expect, it } from 'vitest'

import { toSerializableError } from '../../../src/main/ipc/errorHandler'
import { InvalidParametersError } from '../../../src/main/ipc/errors'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('toSerializableError -> InvalidParametersError', () => {
  it('maps the new error class to ErrorCode.INVALID_PARAMETERS', () => {
    const err = new InvalidParametersError('foo is required')
    const result = toSerializableError(err)

    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
    expect(result.message).toBe('foo is required')
    expect(result.userMessage).toBe('The request contained invalid parameters.')
  })

  it('honours a custom userMessage', () => {
    const err = new InvalidParametersError('chunked', 'The file path was not valid.')
    const result = toSerializableError(err)

    expect(result.userMessage).toBe('The file path was not valid.')
  })

  it('maps invalid parameter parse messages before generic parse errors', () => {
    const err = new InvalidParametersError('failed to parse import payload')
    const result = toSerializableError(err)

    expect(result.code).toBe(ErrorCode.INVALID_PARAMETERS)
  })
})
