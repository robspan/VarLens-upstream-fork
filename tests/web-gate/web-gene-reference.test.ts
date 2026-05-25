import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  closeWebGeneReferenceDb,
  getWebGeneReferenceDb
} from '../../src/web/server/web-gene-reference'

const processWithResources = process as NodeJS.Process & { resourcesPath?: string }

describe('web gene reference path resolution', () => {
  const originalCwd = process.cwd()
  const originalExplicitPath = process.env.VARLENS_GENE_REF_DB_PATH
  const originalResourcesPath = processWithResources.resourcesPath

  afterEach(() => {
    process.chdir(originalCwd)
    if (originalExplicitPath === undefined) delete process.env.VARLENS_GENE_REF_DB_PATH
    else process.env.VARLENS_GENE_REF_DB_PATH = originalExplicitPath
    if (originalResourcesPath === undefined) delete processWithResources.resourcesPath
    else processWithResources.resourcesPath = originalResourcesPath
    closeWebGeneReferenceDb()
  })

  test('omits process.resourcesPath candidate when Node does not define it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'varlens-no-gene-ref-'))
    delete process.env.VARLENS_GENE_REF_DB_PATH
    delete processWithResources.resourcesPath

    try {
      process.chdir(cwd)

      expect(() => getWebGeneReferenceDb()).toThrow(
        new RegExp(
          `Checked: ${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/resources/gene_reference\\.db$`
        )
      )
    } finally {
      process.chdir(originalCwd)
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('reads gene reference info without relying on an external sqlite3 binary', () => {
    const db = getWebGeneReferenceDb()

    expect(db.getInfo()).toMatchObject({
      geneCount: expect.any(Number),
      aliasCount: expect.any(Number),
      coordinateCount: expect.any(Number),
      assemblies: ['GRCh38', 'GRCh37']
    })
    expect(db.getAssemblies().map((assembly) => assembly.id)).toEqual(['GRCh38', 'GRCh37'])
  })
})
