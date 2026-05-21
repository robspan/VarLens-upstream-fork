import { z } from 'zod'

export interface ImportVcfOptions {
  selectedSample?: string
  genomeBuild?: string
}

export const ImportServerPathArgSchema = z.string().refine((value) => value.trim() !== '')
export const ImportCaseNameArgSchema = z.string().refine((value) => value.trim() !== '')
export const ImportVariantTypeArgSchema = z.string().refine((value) => value.trim() !== '')

export const ImportVcfOptionsSchema = z
  .object({
    selectedSample: z.string().optional(),
    genomeBuild: z.string().optional()
  })
  .passthrough()

export const ImportFiltersPayloadSchema = z
  .object({
    bedFile: z.string().nullable().optional(),
    bedPadding: z.number().optional(),
    passOnly: z.boolean().optional(),
    minQual: z.number().nullable().optional(),
    minGq: z.number().nullable().optional(),
    minDp: z.number().nullable().optional()
  })
  .passthrough()

const ImportMultiFileSpecOpenApiSchema = z.object({
  filePath: z.string().min(1),
  variantType: z.string().min(1),
  caller: z.string().nullable().optional(),
  annotationFormat: z.string().nullable().optional()
})

export const ServerPathImportDisabledSchema = z.object({
  error: z.literal('server-path-import-disabled'),
  message: z.string()
})

export const ImportInvokeBodySchemas = {
  start: z.object({
    args: z.tuple([z.string().min(1), z.string().min(1), ImportVcfOptionsSchema.optional()])
  }),
  startMultiFile: z.object({
    args: z.tuple([
      z.string().min(1),
      z.array(ImportMultiFileSpecOpenApiSchema).min(1),
      ImportVcfOptionsSchema.optional(),
      ImportFiltersPayloadSchema.optional()
    ])
  })
} as const

export const BatchImportInvokeBodySchemas = {
  extractZip: z.object({
    args: z.tuple([z.string().min(1), z.string().optional()])
  }),
  testZipPassword: z.object({
    args: z.tuple([z.string().min(1), z.string()])
  }),
  cleanupZipTemp: z.object({
    args: z.tuple([])
  })
} as const

export const ImportUnknownResponseSchema = z.unknown()

export function normalizeImportVcfOptions(vcfOptions: unknown): ImportVcfOptions | undefined {
  return vcfOptions !== null && typeof vcfOptions === 'object'
    ? {
        selectedSample:
          typeof (vcfOptions as { selectedSample?: unknown }).selectedSample === 'string'
            ? (vcfOptions as { selectedSample: string }).selectedSample
            : undefined,
        genomeBuild:
          typeof (vcfOptions as { genomeBuild?: unknown }).genomeBuild === 'string'
            ? (vcfOptions as { genomeBuild: string }).genomeBuild
            : undefined
      }
    : undefined
}
