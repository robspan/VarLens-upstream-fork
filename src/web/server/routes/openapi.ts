import type { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod'
import { z } from 'zod'

import pkg from '../../../../package.json'
import { appendDocumentedDispatcherPaths } from './openapi-paths'

export { appendDocumentedDispatcherPaths } from './openapi-paths'
export { toOpenApiJsonSchema } from './openapi-utils'

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

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    staticCSP: true,
    uiConfig: {
      url: '/api/openapi.json',
      deepLinking: true,
      docExpansion: 'list'
    },
    theme: {
      title: 'VarLens Web API Docs'
    }
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
