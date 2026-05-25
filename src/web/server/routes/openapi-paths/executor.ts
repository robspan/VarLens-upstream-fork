import { z } from 'zod'

import { READ_TASK_TYPES, WRITE_TASK_TYPES } from '../../task-types'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

const ExecutorTaskUnknownResponseSchema = z.unknown()

function pathForTaskType(taskType: string): string {
  const [domain, method] = taskType.split(':')
  return `/api/${domain}/${method}`
}

export function buildExecutorAutorouteOpenApiPaths(): Record<string, OpenApiPathItem> {
  const taskTypes = [...READ_TASK_TYPES, ...WRITE_TASK_TYPES]
  return Object.fromEntries(
    taskTypes.map((taskType) => {
      const [domain = 'dispatcher'] = taskType.split(':')
      return [
        pathForTaskType(taskType),
        dispatcherMethodOperation({
          tag: domain,
          summary: `Generic RPC fallback for ${taskType}`,
          body: z.object({ args: z.array(z.unknown()).optional() }),
          response: ExecutorTaskUnknownResponseSchema
        })
      ] as const
    })
  )
}
