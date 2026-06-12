import Fastify from 'fastify'
import { describe, expect, test } from 'vitest'

import { registerOpenApi } from '../../src/web/server/routes/openapi'

describe('web OpenAPI UI', () => {
  test('serves Swagger UI configured for the canonical OpenAPI JSON route', async () => {
    const app = Fastify()
    await registerOpenApi(app)
    await app.ready()

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/docs/'
      })

      expect(response.statusCode, response.body).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('VarLens Web API Docs')
      expect(response.body).toContain('swagger-ui')

      const initializer = await app.inject({
        method: 'GET',
        url: '/api/docs/static/swagger-initializer.js'
      })

      expect(initializer.statusCode, initializer.body).toBe(200)
      expect(initializer.body).toContain('/api/openapi.json')
      expect(initializer.body).toContain('"urls.primaryName":"VarLens Web API"')
    } finally {
      await app.close()
    }
  })
})
