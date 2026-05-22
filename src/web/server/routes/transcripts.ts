import {
  TranscriptIdSchema,
  TranscriptInsertRowSchema,
  TranscriptVariantIdSchema
} from '../../../shared/api/schemas/transcripts'
import type { TranscriptInsertRow } from '../../../shared/types/transcript'
import type { OverrideHandler } from './types'

export function buildTranscriptOverrides(): Record<string, OverrideHandler> {
  return {
    'transcripts:list': {
      async handle(args, _request, reply, { session }) {
        const [variantId] = args
        const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
        if (!validatedVariantId.success) {
          reply.code(400)
          return { error: 'invalid-transcript-variant-id' }
        }
        return await session.getReadExecutor().execute({
          type: 'transcripts:list',
          params: [validatedVariantId.data]
        })
      }
    },

    'transcripts:switch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcriptId] = args
        const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
        const validatedTranscriptId = TranscriptIdSchema.safeParse(transcriptId)
        if (!validatedVariantId.success || !validatedTranscriptId.success) {
          reply.code(400)
          return { error: 'invalid-transcript-switch' }
        }
        return await session.getWriteExecutor().execute({
          type: 'transcripts:switch',
          params: [validatedVariantId.data, validatedTranscriptId.data]
        })
      }
    },

    'transcripts:insertAndSwitch': {
      async handle(args, _request, reply, { session }) {
        const [variantId, transcript] = args
        const validatedVariantId = TranscriptVariantIdSchema.safeParse(variantId)
        const validatedTranscript = TranscriptInsertRowSchema.safeParse(transcript)
        if (!validatedVariantId.success || !validatedTranscript.success) {
          reply.code(400)
          return { error: 'invalid-transcript-insert' }
        }
        const row = validatedTranscript.data as TranscriptInsertRow
        return await session.getWriteExecutor().execute({
          type: 'transcripts:insertAndSwitch',
          params: [validatedVariantId.data, row]
        })
      }
    }
  }
}
