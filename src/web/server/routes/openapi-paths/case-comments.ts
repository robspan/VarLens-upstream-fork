import {
  CaseCommentInvokeBodySchemas,
  CaseCommentListResponseSchema,
  CaseCommentSchema
} from '../../../../shared/api/schemas/case-comments'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildCaseCommentOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/case-comments/list': dispatcherMethodOperation({
      tag: 'case-comments',
      summary: 'List comments for a case',
      body: CaseCommentInvokeBodySchemas.list,
      response: CaseCommentListResponseSchema
    }),
    '/api/case-comments/create': dispatcherMethodOperation({
      tag: 'case-comments',
      summary: 'Create a case comment',
      body: CaseCommentInvokeBodySchemas.create,
      response: CaseCommentSchema
    }),
    '/api/case-comments/update': dispatcherMethodOperation({
      tag: 'case-comments',
      summary: 'Update a case comment',
      body: CaseCommentInvokeBodySchemas.update,
      response: CaseCommentSchema
    }),
    '/api/case-comments/delete': dispatcherMethodOperation({
      tag: 'case-comments',
      summary: 'Delete a case comment',
      body: CaseCommentInvokeBodySchemas.delete
    })
  }
}
