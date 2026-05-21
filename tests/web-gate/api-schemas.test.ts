import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import {
  TagsInvokeBodySchemas,
  TagsListResponseSchema,
  TagsUsageCountResponseSchema
} from '../../src/shared/api/schemas/tags'
import { toOpenApiJsonSchema } from '../../src/web/server/routes/openapi'

type JsonObject = Record<string, unknown>

function toJsonSchema(schema: z.ZodType): JsonObject {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as JsonObject
}

function argsItems(schema: z.ZodType): unknown[] {
  const jsonSchema = toJsonSchema(schema)
  const properties = jsonSchema.properties as Record<string, JsonObject>
  const args = properties.args
  return args.items as unknown[]
}

function openApiArgs(schema: z.ZodType): JsonObject {
  const jsonSchema = toOpenApiJsonSchema(schema)
  const properties = jsonSchema.properties as Record<string, JsonObject>
  return properties.args
}

describe('shared API schemas', () => {
  test('documents tag request argument tuples', () => {
    expect(argsItems(TagsInvokeBodySchemas.create)).toEqual([
      expect.objectContaining({ type: 'string', minLength: 1, maxLength: 100 }),
      expect.objectContaining({ type: 'string', minLength: 4, maxLength: 9 })
    ])

    expect(argsItems(TagsInvokeBodySchemas.update)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          name: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 100 }),
          color: expect.objectContaining({ type: 'string', minLength: 4, maxLength: 9 })
        })
      })
    ])

    expect(argsItems(TagsInvokeBodySchemas.set)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
      expect.objectContaining({
        type: 'array',
        items: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 })
      })
    ])
  })

  test('documents tag response contracts', () => {
    const listSchema = toJsonSchema(TagsListResponseSchema)
    const tagItem = (listSchema.items as JsonObject).properties as JsonObject

    expect(listSchema).toEqual(expect.objectContaining({ type: 'array' }))
    expect(tagItem).toEqual(
      expect.objectContaining({
        id: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
        name: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 100 }),
        color: expect.objectContaining({ type: 'string', minLength: 4, maxLength: 9 }),
        created_at: expect.objectContaining({ type: 'integer', minimum: 0 })
      })
    )

    expect(toJsonSchema(TagsUsageCountResponseSchema)).toEqual(
      expect.objectContaining({ type: 'integer', minimum: 0 })
    )
  })

  test('renders tuple request bodies as OpenAPI-compatible arrays', () => {
    const createArgs = openApiArgs(TagsInvokeBodySchemas.create)
    expect(Array.isArray(createArgs.items)).toBe(false)
    expect(createArgs).toEqual(
      expect.objectContaining({
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: expect.objectContaining({ anyOf: expect.any(Array) })
      })
    )
    expect(createArgs['x-varlens-prefixItems']).toEqual([
      expect.objectContaining({ type: 'string', minLength: 1, maxLength: 100 }),
      expect.objectContaining({ type: 'string', minLength: 4, maxLength: 9 })
    ])
  })

  test('validates representative tag payloads', () => {
    expect(TagsInvokeBodySchemas.create.safeParse({ args: ['Review', '#6A1B9A'] }).success).toBe(
      true
    )
    expect(
      TagsInvokeBodySchemas.update.safeParse({ args: [1, { name: 'Follow up' }] }).success
    ).toBe(true)
    expect(TagsInvokeBodySchemas.set.safeParse({ args: [1, 2, [3, 4]] }).success).toBe(true)

    expect(TagsInvokeBodySchemas.create.safeParse({ args: ['', '#6A1B9A'] }).success).toBe(false)
    expect(TagsInvokeBodySchemas.update.safeParse({ args: [0, { color: '#fff' }] }).success).toBe(
      false
    )
    expect(TagsInvokeBodySchemas.set.safeParse({ args: [1, 2, [0]] }).success).toBe(false)
  })
})
