import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { importSingleFileCase } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

describe('VarLens single JSON browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports a browser-selected JSON file and renders the imported variant in the case view', () => {
    const caseName = uniqueSmokeName('single-json')

    importSingleFileCase(caseName, jsonImportFile(`${caseName}.json`, 'SINGLEJSON'))
    expectImportedCaseRendered(caseName, [['SINGLEJSON', /12,?345/]])
  })
})
