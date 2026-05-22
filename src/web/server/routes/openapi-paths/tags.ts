import {
  TagSchema,
  TagsInvokeBodySchemas,
  TagsListResponseSchema,
  TagsUsageCountResponseSchema
} from '../../../../shared/api/schemas/tags'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildTagsOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/tags/list': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'List tags',
      body: TagsInvokeBodySchemas.empty,
      response: TagsListResponseSchema
    }),
    '/api/tags/create': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Create a tag',
      body: TagsInvokeBodySchemas.create,
      response: TagSchema
    }),
    '/api/tags/update': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Update a tag',
      body: TagsInvokeBodySchemas.update,
      response: TagSchema
    }),
    '/api/tags/delete': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Delete a tag',
      body: TagsInvokeBodySchemas.tagId
    }),
    '/api/tags/getUsageCount': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Return how often a tag is used',
      body: TagsInvokeBodySchemas.tagId,
      response: TagsUsageCountResponseSchema
    }),
    '/api/tags/getVariantTags': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Return tags assigned to a case variant',
      body: TagsInvokeBodySchemas.caseVariant,
      response: TagsListResponseSchema
    }),
    '/api/tags/assignVariantTag': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Assign a tag to a case variant',
      body: TagsInvokeBodySchemas.assign
    }),
    '/api/tags/removeVariantTag': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Remove a tag from a case variant',
      body: TagsInvokeBodySchemas.assign
    }),
    '/api/tags/setVariantTags': dispatcherMethodOperation({
      tag: 'tags',
      summary: 'Replace tags on a case variant',
      body: TagsInvokeBodySchemas.set
    })
  }
}
