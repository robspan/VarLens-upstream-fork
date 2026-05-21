import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod'
import { z } from 'zod'

import pkg from '../../../../package.json'
import {
  AuthBooleanSchema,
  AuthErrorSchema,
  AuthInvokeBodySchemas,
  AuthOkSchema,
  AuthResultSchema,
  AuthSessionUserSchema,
  AuthSuccessSchema,
  AuthUserSchema
} from '../../../shared/api/schemas/auth'
import { CaseInvokeBodySchemas, CaseUnknownResponseSchema } from '../../../shared/api/schemas/cases'
import {
  CohortInvokeBodySchemas,
  CohortSummaryStatusSchema,
  CohortUnknownResponseSchema
} from '../../../shared/api/schemas/cohort'
import {
  DatabaseInfoSchema,
  DatabaseInvokeBodySchemas,
  DatabaseRecentListSchema,
  DatabaseUnknownResponseSchema
} from '../../../shared/api/schemas/database'
import {
  ExportInvokeBodySchemas,
  ExportUnknownResponseSchema
} from '../../../shared/api/schemas/export'
import {
  BatchImportInvokeBodySchemas,
  ImportInvokeBodySchemas,
  ImportUnknownResponseSchema,
  ServerPathImportDisabledSchema
} from '../../../shared/api/schemas/import'
import {
  TranscriptInvokeBodySchemas,
  TranscriptSwitchResponseSchema,
  TranscriptUnknownResponseSchema
} from '../../../shared/api/schemas/transcripts'
import {
  VariantInvokeBodySchemas,
  VariantUnknownResponseSchema
} from '../../../shared/api/schemas/variants'

type JsonSchema = Record<string, unknown>
type OpenApiPathItem = Record<string, unknown>
type OpenApiDocument = {
  paths?: Record<string, OpenApiPathItem>
}

const UnsupportedCapabilitySchema = z.object({
  error: z.literal('unsupported-web-capability'),
  capability: z.string(),
  message: z.string()
})

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as JsonSchema
  delete jsonSchema.$schema
  return jsonSchema
}

function jsonContent(schema: z.ZodType): Record<string, unknown> {
  return {
    content: {
      'application/json': {
        schema: toJsonSchema(schema)
      }
    }
  }
}

function authOperation(options: {
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
          ...jsonContent(AuthErrorSchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(AuthErrorSchema)
        },
        403: {
          description: 'Forbidden',
          ...jsonContent(AuthErrorSchema)
        }
      }
    }
  }
}

function dispatcherMethodOperation(options: {
  tag: string
  summary: string
  body: z.ZodType
  response?: z.ZodType
  mayReturnUnsupported?: boolean
  forbiddenResponse?: z.ZodType
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
          ...jsonContent(options.response ?? z.unknown())
        },
        400: {
          description: 'Invalid request',
          ...jsonContent(AuthErrorSchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(AuthErrorSchema)
        },
        403: {
          description: options.forbiddenDescription ?? 'Forbidden',
          ...jsonContent(options.forbiddenResponse ?? AuthErrorSchema)
        },
        ...(options.mayReturnUnsupported === true
          ? {
              501: {
                description: 'Not available in web mode unless parity fixtures are enabled',
                ...jsonContent(UnsupportedCapabilitySchema)
              }
            }
          : {})
      }
    }
  }
}

function unsupportedDispatcherMethodOperation(options: {
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
          ...jsonContent(UnsupportedCapabilitySchema)
        },
        401: {
          description: 'Authentication required',
          ...jsonContent(AuthErrorSchema)
        },
        403: {
          description: 'Forbidden',
          ...jsonContent(AuthErrorSchema)
        }
      }
    }
  }
}

function buildAuthOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/auth/login': authOperation({
      summary: 'Authenticate and create a web session',
      body: AuthInvokeBodySchemas.login,
      response: AuthResultSchema,
      public: true
    }),
    '/api/auth/logout': authOperation({
      summary: 'Clear the current web session',
      body: AuthInvokeBodySchemas.logout,
      response: AuthOkSchema
    }),
    '/api/auth/currentUser': authOperation({
      summary: 'Return the authenticated session user',
      body: AuthInvokeBodySchemas.currentUser,
      response: AuthSessionUserSchema.nullable()
    }),
    '/api/auth/isAccountsEnabled': authOperation({
      summary: 'Return whether web accounts are enabled',
      body: AuthInvokeBodySchemas.isAccountsEnabled,
      response: AuthBooleanSchema,
      public: true
    }),
    '/api/auth/createUser': authOperation({
      summary: 'Create a user account',
      body: AuthInvokeBodySchemas.createUser,
      response: AuthUserSchema
    }),
    '/api/auth/listUsers': authOperation({
      summary: 'List user accounts',
      body: AuthInvokeBodySchemas.listUsers,
      response: z.array(AuthUserSchema)
    }),
    '/api/auth/deactivateUser': authOperation({
      summary: 'Deactivate a user account',
      body: AuthInvokeBodySchemas.deactivateUser
    }),
    '/api/auth/resetPassword': authOperation({
      summary: 'Reset a user password',
      body: AuthInvokeBodySchemas.resetPassword
    }),
    '/api/auth/changePassword': authOperation({
      summary: 'Change the current user password',
      body: AuthInvokeBodySchemas.changePassword,
      response: AuthSuccessSchema
    })
  }
}

function buildCaseOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/cases/list': dispatcherMethodOperation({
      tag: 'cases',
      summary: 'List cases available in the current workspace',
      body: CaseInvokeBodySchemas.list,
      response: CaseUnknownResponseSchema
    })
  }
}

function buildDatabaseOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/database/capabilities': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return web database capabilities',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    }),
    '/api/database/health': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return database health',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    }),
    '/api/database/info': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return current web database identity',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseInfoSchema
    }),
    '/api/database/getOverview': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return database overview',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseUnknownResponseSchema
    }),
    '/api/database/recentList': dispatcherMethodOperation({
      tag: 'database',
      summary: 'Return an empty recent database list in web mode',
      body: DatabaseInvokeBodySchemas.empty,
      response: DatabaseRecentListSchema
    })
  }
}

function buildExportOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/export/variants': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export variants for a case',
      body: ExportInvokeBodySchemas.variants,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    }),
    '/api/export/cohort': dispatcherMethodOperation({
      tag: 'export',
      summary: 'Export cohort variants',
      body: ExportInvokeBodySchemas.cohort,
      response: ExportUnknownResponseSchema,
      mayReturnUnsupported: true
    })
  }
}

function buildImportOpenApiPaths(): Record<string, OpenApiPathItem> {
  const forbiddenResponse = z.union([AuthErrorSchema, ServerPathImportDisabledSchema])
  const forbiddenDescription = 'Forbidden or server-path import disabled'

  return {
    '/api/import/start': dispatcherMethodOperation({
      tag: 'import',
      summary: 'Import one server-side variant file',
      body: ImportInvokeBodySchemas.start,
      response: ImportUnknownResponseSchema,
      forbiddenResponse,
      forbiddenDescription
    }),
    '/api/import/startMultiFile': dispatcherMethodOperation({
      tag: 'import',
      summary: 'Import multiple server-side variant files',
      body: ImportInvokeBodySchemas.startMultiFile,
      response: ImportUnknownResponseSchema,
      forbiddenResponse,
      forbiddenDescription
    }),
    '/api/batch-import/extractZip': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Extract a server-side ZIP archive for batch import',
      body: BatchImportInvokeBodySchemas.extractZip,
      response: ImportUnknownResponseSchema,
      forbiddenResponse,
      forbiddenDescription
    }),
    '/api/batch-import/testZipPassword': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Test a server-side ZIP archive password',
      body: BatchImportInvokeBodySchemas.testZipPassword,
      response: ImportUnknownResponseSchema,
      forbiddenResponse,
      forbiddenDescription
    }),
    '/api/batch-import/cleanupZipTemp': dispatcherMethodOperation({
      tag: 'batch-import',
      summary: 'Remove temporary files created during ZIP import',
      body: BatchImportInvokeBodySchemas.cleanupZipTemp,
      response: ImportUnknownResponseSchema
    })
  }
}

function buildTranscriptOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/transcripts/list': dispatcherMethodOperation({
      tag: 'transcripts',
      summary: 'List transcripts for a variant',
      body: TranscriptInvokeBodySchemas.list,
      response: TranscriptUnknownResponseSchema
    }),
    '/api/transcripts/insertAndSwitch': dispatcherMethodOperation({
      tag: 'transcripts',
      summary: 'Insert a transcript and make it selected',
      body: TranscriptInvokeBodySchemas.insertAndSwitch,
      response: TranscriptSwitchResponseSchema
    })
  }
}

function buildVariantOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/variants/search': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Search variants by gene symbol within a case',
      body: VariantInvokeBodySchemas.search,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/columnMeta': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Return variant column metadata for one case or a cohort scope',
      body: VariantInvokeBodySchemas.columnMeta,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/query': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Query variants for a case',
      body: VariantInvokeBodySchemas.query,
      response: VariantUnknownResponseSchema
    }),
    '/api/variants/getFilterOptions': dispatcherMethodOperation({
      tag: 'variants',
      summary: 'Return available filter options for a case',
      body: VariantInvokeBodySchemas.getFilterOptions,
      response: VariantUnknownResponseSchema
    })
  }
}

function buildCohortOpenApiPaths(): Record<string, OpenApiPathItem> {
  return {
    '/api/cohort/getVariants': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Query cohort variants',
      body: CohortInvokeBodySchemas.getVariants,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getColumnMeta': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort column metadata',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getSummary': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort summary',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getSummaryStatus': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort summary rebuild status',
      body: CohortInvokeBodySchemas.empty,
      response: CohortSummaryStatusSchema
    }),
    '/api/cohort/rebuildSummary': unsupportedDispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Rebuild cohort summary',
      body: CohortInvokeBodySchemas.unsupported
    }),
    '/api/cohort/runAssociation': unsupportedDispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Run cohort association analysis',
      body: CohortInvokeBodySchemas.unsupported
    }),
    '/api/cohort/cancelAssociation': unsupportedDispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Cancel cohort association analysis',
      body: CohortInvokeBodySchemas.unsupported
    }),
    '/api/cohort/getCarriers': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return carriers for a cohort variant coordinate',
      body: CohortInvokeBodySchemas.getCarriers,
      response: CohortUnknownResponseSchema
    }),
    '/api/cohort/getGeneBurden': dispatcherMethodOperation({
      tag: 'cohort',
      summary: 'Return cohort gene burden summary',
      body: CohortInvokeBodySchemas.empty,
      response: CohortUnknownResponseSchema
    })
  }
}

function appendDocumentedDispatcherPaths(document: OpenApiDocument): OpenApiDocument {
  return {
    ...document,
    paths: {
      ...document.paths,
      ...buildAuthOpenApiPaths(),
      ...buildCaseOpenApiPaths(),
      ...buildCohortOpenApiPaths(),
      ...buildDatabaseOpenApiPaths(),
      ...buildExportOpenApiPaths(),
      ...buildImportOpenApiPaths(),
      ...buildTranscriptOpenApiPaths(),
      ...buildVariantOpenApiPaths()
    }
  }
}

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'VarLens Web API',
        version: pkg.version
      },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-varlens.sid'
          }
        }
      },
      security: [{ sessionCookie: [] }]
    },
    transform: jsonSchemaTransform,
    transformObject: ({ openapiObject }) => appendDocumentedDispatcherPaths(openapiObject)
  })

  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/openapi.json',
    {
      schema: {
        hide: true,
        response: {
          200: z.record(z.string(), z.unknown())
        }
      }
    },
    async () => app.swagger()
  )
}
