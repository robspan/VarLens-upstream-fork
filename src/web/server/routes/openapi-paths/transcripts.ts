import {
  TranscriptInvokeBodySchemas,
  TranscriptSwitchResponseSchema,
  TranscriptUnknownResponseSchema
} from '../../../../shared/api/schemas/transcripts'
import { dispatcherMethodOperation, type OpenApiPathItem } from '../openapi-utils'

export function buildTranscriptOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/transcripts/list': dispatcherMethodOperation({
      tag: 'transcripts',
      summary: 'List transcripts for a variant',
      body: TranscriptInvokeBodySchemas.list,
      response: TranscriptUnknownResponseSchema
    }),
    '/api/transcripts/switch': dispatcherMethodOperation({
      tag: 'transcripts',
      summary: 'Switch the selected transcript for a variant',
      body: TranscriptInvokeBodySchemas.switch,
      response: TranscriptSwitchResponseSchema
    }),
    '/api/transcripts/insertAndSwitch': dispatcherMethodOperation({
      tag: 'transcripts',
      summary: 'Insert a transcript and make it selected',
      body: TranscriptInvokeBodySchemas.insertAndSwitch,
      response: TranscriptSwitchResponseSchema
    })
  }
}
