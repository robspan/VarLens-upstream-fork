import { describe, expect, it } from 'vitest'

import { formatErrorMessage } from '../../../src/shared/errors/format-error-message'
import { ErrorCode } from '../../../src/shared/types/errors'

describe('formatErrorMessage', () => {
  it('uses SerializableError user messages instead of object stringification', () => {
    const message = formatErrorMessage(
      {
        code: ErrorCode.UNIQUE_CONSTRAINT,
        message: "case 'SAMPLE' already exists",
        userMessage: "case 'SAMPLE' already exists"
      },
      'Import failed'
    )

    expect(message).toBe("case 'SAMPLE' already exists")
    expect(message).not.toBe('[object Object]')
  })

  it('falls back for unrecognized object payloads', () => {
    expect(formatErrorMessage({ details: 'opaque' }, 'Import failed')).toBe('Import failed')
  })
})
