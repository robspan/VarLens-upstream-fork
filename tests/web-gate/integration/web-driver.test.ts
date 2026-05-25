import { existsSync } from 'fs'
import { resolve } from 'path'

import { describe, expect, test } from 'vitest'

import { startWebDriver } from '../helpers/web-driver'

const WEB_BUILD_PATH = resolve(process.cwd(), 'out/web/server.cjs')
const isWebBuilt = existsSync(WEB_BUILD_PATH)
const HAS_PG = typeof process.env.VARLENS_PG_URL === 'string' && process.env.VARLENS_PG_URL !== ''

describe.skipIf(!isWebBuilt || !HAS_PG)('web driver helper', () => {
  test('bootstraps, logs in, rotates password, and calls an authenticated API', async () => {
    const driver = await startWebDriver()
    try {
      const res = await driver.api('database', 'info')
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({
        path: 'web:postgres',
        name: 'VarLens Web',
        encrypted: false
      })
    } finally {
      await driver.close()
    }
  })
})
