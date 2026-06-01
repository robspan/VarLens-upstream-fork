import { expectImportedCaseRendered } from '../support/case-view'
import { beforeEachAuthenticatedSmoke } from '../support/auth'
import { importFolderCases } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

describe('VarLens folder JSON browser import smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('imports browser-selected JSON files through the Folder path and renders both cases', () => {
    const firstCase = uniqueSmokeName('folder-json-a')
    const secondCase = uniqueSmokeName('folder-json-b')

    importFolderCases(
      [firstCase, secondCase],
      [jsonImportFile(`${firstCase}.json`, 'FOLDERA'), jsonImportFile(`${secondCase}.json`, 'FOLDERB')]
    )

    expectImportedCaseRendered(firstCase, [['FOLDERA', /12,?345/]])
    expectImportedCaseRendered(secondCase, [['FOLDERB', /12,?345/]])
  })
})
