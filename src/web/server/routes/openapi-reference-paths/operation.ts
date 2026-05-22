import { z } from 'zod'

import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function referenceFixtureOperation(options: {
  tag: string
  summary: string
  body: z.ZodType
  response: z.ZodType
}): OpenApiPathItem {
  return dispatcherMethodOperation({
    tag: options.tag,
    summary: options.summary,
    body: options.body,
    response: options.response,
    mayReturnUnsupported: true
  })
}
