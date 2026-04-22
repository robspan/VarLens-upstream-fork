declare module 'stream-json' {
  import type { Transform } from 'node:stream'

  interface ParserInstance extends Transform {}

  interface ParserFactory {
    (options?: Record<string, unknown>): ParserInstance
  }

  const parser: ParserFactory
  export default parser
}

declare module 'stream-json/filters/pick.js' {
  import type { Transform } from 'node:stream'

  interface PickStream extends Transform {}

  interface PickOptions {
    filter: string
  }

  interface PickApi {
    asStream(options: PickOptions): PickStream
  }

  export const pick: PickApi
}

declare module 'stream-json/streamers/stream-array.js' {
  import type { Transform } from 'node:stream'

  interface StreamArrayApi {
    asStream(): Transform
  }

  export const streamArray: StreamArrayApi
}
