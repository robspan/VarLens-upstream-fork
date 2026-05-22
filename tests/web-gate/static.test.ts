import { afterEach, describe, expect, test } from 'vitest'
import fastify from 'fastify'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { registerStatic } from '../../src/web/server/static'

describe('web static serving', () => {
  const previousPublicDir = process.env.VARLENS_WEB_PUBLIC_DIR

  afterEach(() => {
    if (previousPublicDir === undefined) delete process.env.VARLENS_WEB_PUBLIC_DIR
    else process.env.VARLENS_WEB_PUBLIC_DIR = previousPublicDir
  })

  test('serves index.html for non-API SPA route misses', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'varlens-web-public-'))
    process.env.VARLENS_WEB_PUBLIC_DIR = publicDir
    await writeFile(join(publicDir, 'index.html'), '<html><body>VarLens web</body></html>')

    const app = fastify()
    try {
      await registerStatic(app)

      const response = await app.inject({ method: 'GET', url: '/cases/123' })

      expect(response.statusCode, response.body).toBe(200)
      expect(response.headers['content-type']).toMatch(/text\/html/)
      expect(response.body).toContain('VarLens web')
    } finally {
      await app.close()
      await rm(publicDir, { recursive: true, force: true })
    }
  })
})
