import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { importSingleVcfCase } from '../support/import-workflows'
import { sampleVcfPath, uniqueSmokeName } from '../support/fixtures'

describe('VarLens VCF browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports a browser-selected VCF and renders the imported variants in the case view', () => {
    const caseName = uniqueSmokeName('vcf')

    importSingleVcfCase(caseName, sampleVcfPath)
    expectImportedCaseRendered(caseName, [
      [/\b1\b/, /\b100\b/, 'A', 'G', '0/1'],
      [/\b2\b/, /\b200\b/, 'C', 'T', '1/1']
    ])
  })
})
