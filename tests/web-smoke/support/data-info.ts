import { queryImportedCase, selectCaseFromSidebar } from './case-view'
import { bedRegionPath } from './fixtures'
import { selectPendingBrowserFile } from './import-workflows'

export interface BedRegionFilterAttachment {
  caseId: number
  regionFileId: number
}

export function attachBedRegionFilterThroughDataInfo(
  caseName: string,
  regionName: string
): Cypress.Chainable<BedRegionFilterAttachment> {
  let caseId: number | undefined
  let regionFileId: number | undefined

  queryImportedCase(caseName).then((importedCase) => {
    caseId = importedCase.id
  })

  cy.reload()
  cy.varlensDismissResearchUseModal()
  cy.intercept('POST', '**/api/import/upload').as('bedUploadApi')
  cy.intercept('POST', /\/api\/(?:regionFiles|region-files)\/create$/).as('regionCreateApi')
  cy.intercept('POST', /\/api\/(?:regionFiles|region-files)\/importBed$/).as('regionImportApi')
  cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/upsertDataInfo$/).as(
    'dataInfoSaveApi'
  )

  openCaseDataInfo(caseName)
  openBedRegionImportDialog(caseName)
  fillBedRegionImportDialog(regionName)
  selectPendingBrowserFile(bedRegionPath)

  cy.wait('@bedUploadApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'BED upload API status').to.be.within(200, 299)
  })

  submitBedRegionImport()

  cy.wait('@regionCreateApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'region file create status').to.be.within(
      200,
      299
    )
    regionFileId = (interception.response?.body as { id?: number } | undefined)?.id
    expect(regionFileId, 'created region file id').to.be.a('number')
  })
  cy.wait('@regionImportApi', { timeout: 30000 }).then((interception) => {
    expect(
      interception.response?.statusCode ?? 0,
      `BED import status ${JSON.stringify(interception.response?.body)}`
    ).to.be.within(200, 299)
  })
  cy.wait('@dataInfoSaveApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'case metadata save status').to.be.within(
      200,
      299
    )
  })

  return cy.then(() => {
    expect(caseId, 'BED case id').to.be.a('number')
    expect(regionFileId, 'BED region file id').to.be.a('number')
    return { caseId: caseId as number, regionFileId: regionFileId as number }
  })
}

export function expectBedRegionFilterPersisted(
  attachment: BedRegionFilterAttachment,
  regionName: string
): void {
  cy.varlensApi('region-files', 'list').then((listResponse) => {
    expect(listResponse.status, 'region file list status').to.eq(200)
    const regionFiles = listResponse.body as Array<{ name: string }>
    expect(
      regionFiles.some((regionFile) => regionFile.name === regionName),
      'region file appears in list'
    ).to.eq(true)
  })

  cy.varlensApi('case-metadata', 'getDataInfo', [attachment.caseId]).then((metadataResponse) => {
    expect(metadataResponse.status, 'case metadata status').to.eq(200)
    expect((metadataResponse.body as { region_file_id?: number }).region_file_id).to.eq(
      attachment.regionFileId
    )
  })
}

export function expectBedRegionFilterRendered(regionName: string): void {
  const expectedPrefix = regionName.slice(0, 18)

  cy.contains('.v-dialog, [role="dialog"]', /Data Info/i, { timeout: 15000 }).within(() => {
    cy.contains(/Region filter \(BED\)/i)
      .parents('.v-col')
      .first()
      .should(($field) => {
        const inputValues = $field
          .find('input')
          .map((_idx, el) => (el as HTMLInputElement).value ?? '')
          .get()
        const metadata = $field
          .find('[title], [aria-label]')
          .map(
            (_idx, el) => `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
          )
          .get()
        const renderedValue = [$field.text(), ...inputValues, ...metadata].join(' ')

        expect(renderedValue, 'rendered BED region select value').to.contain(expectedPrefix)
      })
  })
}

function openCaseDataInfo(caseName: string): void {
  selectCaseFromSidebar(caseName)
  cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/getDataInfo$/).as('dataInfoGetApi')
  cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/listExternalIds$/).as(
    'dataInfoExternalIdsApi'
  )
  cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/distinctPlatforms$/).as(
    'dataInfoPlatformsApi'
  )
  cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/distinctExternalIdTypes$/).as(
    'dataInfoIdTypesApi'
  )
  cy.intercept('POST', /\/api\/(?:geneLists|gene-lists)\/list$/).as('dataInfoGeneListsApi')
  cy.intercept('POST', /\/api\/(?:regionFiles|region-files)\/list$/).as('dataInfoRegionFilesApi')

  cy.contains('.context-indicator', caseName, { timeout: 15000 }).within(() => {
    cy.get('button:visible').last().click({ force: true })
  })
  cy.contains('.v-dialog, [role="dialog"]', caseName, { timeout: 15000 }).should('be.visible')
  cy.contains('.v-dialog button:visible, .v-dialog [role="tab"]:visible', /Data\s*Info/i, {
    timeout: 15000
  }).click({ force: true })
  cy.contains('.v-dialog, [role="dialog"]', caseName, { timeout: 15000 }).within(() => {
    cy.get('[data-active-tab="data"]', { timeout: 15000 }).should('exist')
    cy.get('[data-testid="metadata-data-pane"]', { timeout: 15000 }).should('exist')
    cy.get('[data-testid="case-data-info-tab"]', { timeout: 15000 }).should('exist')
    for (const alias of [
      '@dataInfoGetApi',
      '@dataInfoExternalIdsApi',
      '@dataInfoPlatformsApi',
      '@dataInfoIdTypesApi',
      '@dataInfoGeneListsApi',
      '@dataInfoRegionFilesApi'
    ]) {
      cy.wait(alias, { timeout: 15000 }).then((interception) => {
        expect(interception.response?.statusCode ?? 0, `${alias} status`).to.be.within(200, 299)
      })
    }
    cy.contains(/Pre-filtering Applied/i, { timeout: 15000 }).should('be.visible')
  })
}

function openBedRegionImportDialog(caseName: string): void {
  cy.contains('.v-dialog, [role="dialog"]', caseName, { timeout: 15000 }).within(() => {
    cy.contains(/Region filter \(BED\)/i)
      .parents('.v-col')
      .first()
      .find('button:visible')
      .last()
      .click({ force: true })
  })
}

function fillBedRegionImportDialog(regionName: string): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).within(
    () => {
      cy.get('input').first().clear({ force: true }).type(regionName, { force: true })
      cy.contains('button, [role="button"]', /Select BED file/i).click({ force: true })
    }
  )
}

function submitBedRegionImport(): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).should(
    'be.visible'
  )
  cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).within(
    () => {
      cy.get('button, [role="button"]').then(($buttons) => {
        const importButton = $buttons
          .filter((_idx, el) => /^Import$/i.test((el.textContent ?? '').trim()))
          .last()

        expect(importButton.length, 'visible BED import button').to.be.greaterThan(0)
        cy.wrap(importButton)
          .should(($button) => {
            expect(
              $button.is(':disabled') ||
                $button.hasClass('v-btn--disabled') ||
                $button.hasClass('v-btn--loading'),
              'BED import button ready'
            ).to.eq(false)
          })
          .click({ force: true })
      })
    }
  )
}
