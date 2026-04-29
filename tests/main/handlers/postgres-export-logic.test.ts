import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { exportPostgresVariants } from '../../../src/main/ipc/handlers/export-logic'

describe('postgres export logic', () => {
  it('returns an export error when the CSV stream cannot be opened', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'varlens-pg-export-'))
    await rm(tempDir, { recursive: true, force: true })

    const result = await Promise.race([
      exportPostgresVariants(
        (async function* () {
          yield { id: 1, chr: '1' }
        })(),
        join(tempDir, 'missing', 'variants.csv'),
        {}
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('export did not settle')), 1000)
      )
    ])

    expect(result.success).toBe(false)
    expect(result.error).toContain('ENOENT')
  })
})
