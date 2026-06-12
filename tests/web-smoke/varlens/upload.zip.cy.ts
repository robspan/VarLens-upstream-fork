import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { importZipCase } from '../support/import-workflows'
import { uniqueSmokeName, zipImportFile } from '../support/fixtures'

describe('VarLens ZIP browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('uploads a ZIP archive, extracts it, imports the contained JSON case, and renders it', () => {
    const caseName = uniqueSmokeName('zip-web-case')

    importZipCase(caseName, zipImportFile(caseName))
    expectImportedCaseRendered(caseName, [['ZIPGENE', /\b333\b/]])
  })
})
