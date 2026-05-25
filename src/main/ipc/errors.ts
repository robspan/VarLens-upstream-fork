/**
 * Error class for IPC payload validation failures.
 *
 * Throw from a handler when a `safeParse` against an ipc-schemas.ts
 * schema returns `.success === false`. `wrapHandler` will catch it and
 * `toSerializableError` will map it to a SerializableError with
 * code === ErrorCode.INVALID_PARAMETERS.
 */
export class InvalidParametersError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string = 'The request contained invalid parameters.'
  ) {
    super(message)
    this.name = 'InvalidParametersError'
  }
}
