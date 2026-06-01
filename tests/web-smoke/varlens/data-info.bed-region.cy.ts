import { beforeEachAuthenticatedSmoke } from '../support/auth'
import {
  attachBedRegionFilterThroughDataInfo,
  expectBedRegionFilterPersisted,
  expectBedRegionFilterRendered
} from '../support/data-info'
import { importSingleFileCase } from '../support/import-workflows'
import { jsonImportFile, uniqueSmokeName } from '../support/fixtures'

describe('VarLens BED region filter Data Info smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('uploads a BED file through Data Info and renders the selected region filter', () => {
    const caseName = uniqueSmokeName('bed-json')
    const regionName = uniqueSmokeName('iac-regions')

    importSingleFileCase(caseName, jsonImportFile(`${caseName}.json`, 'BEDJSON'))
    attachBedRegionFilterThroughDataInfo(caseName, regionName).then((attachment) => {
      expectBedRegionFilterPersisted(attachment, regionName)
      expectBedRegionFilterRendered(regionName)
    })
  })
})
