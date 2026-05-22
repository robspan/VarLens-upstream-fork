import { z } from 'zod'

import { DispatcherErrorResponseSchema } from '../../../shared/api/schemas/dispatcher'

export type JsonSchema = Record<string, unknown>
export type OpenApiPathItem = Record<string, unknown>
export type OpenApiDocument = {
  paths?: Record<string, OpenApiPathItem>
}

function normalizeSchemaForOpenApi(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchemaForOpenApi(item))
  }
  if (schema === null || typeof schema !== 'object') {
    return schema
  }

  const normalized = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, normalizeSchemaForOpenApi(value)])
  ) as JsonSchema

  if (Array.isArray(normalized.items)) {
    const tupleItems = normalized.items
    normalized['x-varlens-prefixItems'] = tupleItems
    normalized.minItems ??= tupleItems.length
    normalized.maxItems ??= tupleItems.length
    normalized.items = tupleItems.length === 1 ? tupleItems[0] : { anyOf: tupleItems }
  }

  return normalized
}

export function toOpenApiJsonSchema(schema: z.ZodType): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as JsonSchema
  delete jsonSchema.$schema
  return normalizeSchemaForOpenApi(jsonSchema) as JsonSchema
}

function jsonContent(schema: z.ZodType): Record<string, unknown> {
  return {
    content: {
      'application/json': {
        schema: toOpenApiJsonSchema(schema)
      }
    }
  }
}

export function authOperation(options: {
  summary: string
  body?: z.ZodType
  response?: z.ZodType
  public?: boolean
}): OpenApiPathItem {
  return {
    post: {
      tags: ['auth'],
      summary: options.summary,
      ...(options.public === true ? { security: [] } : {}),
      ...(options.body === undefined ? {} : { requestBody: jsonContent(options.body) }),
      responses: {
        200:
          options.response === undefined
            ? { description: 'OK' }
            : {
                description: 'OK',
                ...jsonContent(options.response)
              },
        400: {
          description: 'Invalid request',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        403: {
          description: 'Forbidden',
          ...jsonContent(DispatcherErrorResponseSchema)
        }
      }
    }
  }
}

export function dispatcherMethodOperation(options: {
  tag: string
  summary: string
  body: z.ZodType
  response?: z.ZodType
  mayReturnUnsupported?: boolean
  forbiddenDescription?: string
}): OpenApiPathItem {
  return {
    post: {
      tags: [options.tag],
      summary: options.summary,
      requestBody: jsonContent(options.body),
      responses: {
        200: {
          description: 'OK',
          ...(options.response === undefined ? {} : jsonContent(options.response))
        },
        400: {
          description: 'Invalid request',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        403: {
          description: options.forbiddenDescription ?? 'Forbidden',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        ...(options.mayReturnUnsupported === true
          ? {
              501: {
                description: 'Not available in web mode unless parity fixtures are enabled',
                ...jsonContent(DispatcherErrorResponseSchema)
              }
            }
          : {})
      }
    }
  }
}

export function unsupportedDispatcherMethodOperation(options: {
  tag: string
  summary: string
  body: z.ZodType
}): OpenApiPathItem {
  return {
    post: {
      tags: [options.tag],
      summary: options.summary,
      requestBody: jsonContent(options.body),
      responses: {
        501: {
          description: 'Not available in web mode',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(DispatcherErrorResponseSchema)
        },
        403: {
          description: 'Forbidden',
          ...jsonContent(DispatcherErrorResponseSchema)
        }
      }
    }
  }
}
