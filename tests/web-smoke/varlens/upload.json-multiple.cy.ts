import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { importMultipleFileCases } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

describe('VarLens multiple JSON browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports browser-selected JSON files through the Multiple Files path and renders both cases', () => {
    const firstCase = uniqueSmokeName('multi-json-a')
    const secondCase = uniqueSmokeName('multi-json-b')

    importMultipleFileCases(
      [firstCase, secondCase],
      [jsonImportFile(`${firstCase}.json`, 'MULTIA'), jsonImportFile(`${secondCase}.json`, 'MULTIB')]
    )

    expectImportedCaseRendered(firstCase, [['MULTIA', /12,?345/]])
    expectImportedCaseRendered(secondCase, [['MULTIB', /12,?345/]])
  })
})
