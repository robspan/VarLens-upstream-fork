import { describe, expect, test } from 'vitest'
import { z } from 'zod'

import {
  CaseCommentInvokeBodySchemas,
  CaseCommentListResponseSchema,
  CaseCommentSchema
} from '../../src/shared/api/schemas/case-comments'
import {
  TagsInvokeBodySchemas,
  TagsListResponseSchema,
  TagsUsageCountResponseSchema
} from '../../src/shared/api/schemas/tags'
import {
  appendDocumentedDispatcherPaths,
  toOpenApiJsonSchema
} from '../../src/web/server/routes/openapi'

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

function responseSchema(path: string, status: string): JsonObject | undefined {
  const document = appendDocumentedDispatcherPaths({ paths: {} }) as {
    paths?: Record<
      string,
      {
        post?: {
          requestBody?: { content?: { 'application/json'?: { schema?: JsonObject } } }
          responses?: Record<string, { content?: { 'application/json'?: { schema?: JsonObject } } }>
        }
      }
    >
  }
  return document.paths?.[path]?.post?.responses?.[status]?.content?.['application/json']?.schema
}

function requestSchema(path: string): JsonObject | undefined {
  const document = appendDocumentedDispatcherPaths({ paths: {} }) as {
    paths?: Record<
      string,
      {
        post?: { requestBody?: { content?: { 'application/json'?: { schema?: JsonObject } } } }
      }
    >
  }
  return document.paths?.[path]?.post?.requestBody?.content?.['application/json']?.schema
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

  test('documents case comment request and response contracts', () => {
    expect(argsItems(CaseCommentInvokeBodySchemas.list)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 })
    ])
    expect(argsItems(CaseCommentInvokeBodySchemas.create)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
      expect.objectContaining({
        type: 'string',
        enum: [
          'Clinical Note',
          'Lab Result',
          'Interpretation',
          'Follow-up',
          'Family History',
          'Treatment'
        ]
      }),
      expect.objectContaining({ type: 'string', minLength: 1 })
    ])
    expect(argsItems(CaseCommentInvokeBodySchemas.update)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
      expect.objectContaining({ type: 'string', minLength: 1 })
    ])
    expect(argsItems(CaseCommentInvokeBodySchemas.delete)).toEqual([
      expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 })
    ])

    const listSchema = toJsonSchema(CaseCommentListResponseSchema)
    const comment = (listSchema.items as JsonObject).properties as JsonObject
    const commentSchema = toJsonSchema(CaseCommentSchema)
    const commentProperties = commentSchema.properties as JsonObject
    expect(comment).toEqual(
      expect.objectContaining({
        id: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
        case_id: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
        category: expect.objectContaining({
          type: 'string',
          enum: [
            'Clinical Note',
            'Lab Result',
            'Interpretation',
            'Follow-up',
            'Family History',
            'Treatment'
          ]
        }),
        content: expect.objectContaining({ type: 'string' }),
        created_at: expect.objectContaining({ type: 'integer', minimum: 0 }),
        updated_at: expect.objectContaining({ anyOf: expect.any(Array) })
      })
    )
    expect(commentProperties.updated_at).toEqual(
      expect.objectContaining({
        anyOf: [
          expect.objectContaining({ type: 'integer', minimum: 0 }),
          expect.objectContaining({ type: 'null' })
        ]
      })
    )

    expect(
      CaseCommentInvokeBodySchemas.create.safeParse({
        args: [1, 'Interpretation', 'Initial review']
      }).success
    ).toBe(true)
    expect(
      CaseCommentInvokeBodySchemas.create.safeParse({ args: [1, 'Unknown', 'Initial review'] })
        .success
    ).toBe(false)
    expect(CaseCommentInvokeBodySchemas.update.safeParse({ args: [1, ''] }).success).toBe(false)
  })

  test('documents generated OpenAPI case comment paths', () => {
    expect(requestSchema('/api/case-comments/create')).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          args: expect.objectContaining({
            minItems: 3,
            maxItems: 3,
            items: expect.objectContaining({ anyOf: expect.any(Array) }),
            'x-varlens-prefixItems': [
              expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
              expect.objectContaining({ type: 'string', enum: expect.any(Array) }),
              expect.objectContaining({ type: 'string', minLength: 1 })
            ]
          })
        })
      })
    )
    expect(requestSchema('/api/case-comments/update')).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          args: expect.objectContaining({ minItems: 2, maxItems: 2 })
        })
      })
    )
    expect(requestSchema('/api/case-comments/delete')).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          args: expect.objectContaining({ minItems: 1, maxItems: 1 })
        })
      })
    )
    expect(responseSchema('/api/case-comments/list', '200')).toEqual(
      expect.objectContaining({
        type: 'array',
        items: expect.objectContaining({
          properties: expect.objectContaining({
            id: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
            category: expect.objectContaining({ type: 'string', enum: expect.any(Array) })
          })
        })
      })
    )
    expect(responseSchema('/api/case-comments/create', '200')).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          id: expect.objectContaining({ type: 'integer', exclusiveMinimum: 0 }),
          updated_at: expect.objectContaining({ anyOf: expect.any(Array) })
        })
      })
    )
    expect(responseSchema('/api/case-comments/update', '200')).toEqual(
      expect.objectContaining({ type: 'object' })
    )
    expect(responseSchema('/api/case-comments/delete', '200')).toBeUndefined()
  })
})
