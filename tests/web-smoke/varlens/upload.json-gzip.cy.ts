import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { gzipJsonImportFile, uniqueSmokeName } from '../support/fixtures'
import { importSingleFileCase } from '../support/import-workflows'

describe('VarLens gzipped JSON browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports a browser-selected gzipped JSON file and renders the imported variant in the case view', () => {
    const caseName = uniqueSmokeName('single-json-gz')

    importSingleFileCase(caseName, gzipJsonImportFile(`${caseName}.json.gz`))
    expectImportedCaseRendered(caseName, [['GZJSON', /54,?321/]])
  })
})
