import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { gzipSampleVcfImportFile, uniqueSmokeName } from '../support/fixtures'
import { importSingleVcfCase } from '../support/import-workflows'

describe('VarLens gzipped VCF browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports a browser-selected gzipped VCF and renders the imported variants in the case view', () => {
    const caseName = uniqueSmokeName('vcf-gz')

    importSingleVcfCase(caseName, gzipSampleVcfImportFile(`${caseName}.vcf.gz`))
    expectImportedCaseRendered(caseName, [
      [/\b1\b/, /\b100\b/, 'A', 'G', '0/1'],
      [/\b2\b/, /\b200\b/, 'C', 'T', '1/1']
    ])
  })
})
