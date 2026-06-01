import { queryImportedCase } from './case-view'
import type { ImportSelectFile } from './fixtures'

interface BatchImportParams {
  sourceLabel: RegExp
  files: ImportSelectFile | ImportSelectFile[]
  uploadCount: number
  expectedCases: string[]
  waitForZipExtract?: boolean
}

export function importSingleVcfCase(caseName: string, file: ImportSelectFile): void {
  cy.intercept('POST', '**/api/import/upload').as('uploadApi')
  cy.intercept('POST', '**/api/import/vcfPreview').as('vcfPreviewApi')
  cy.intercept('POST', '**/api/import/start').as('importStartApi')

  openImportSurface()
  selectImportSource(/^Single File\b/i)
  selectPendingBrowserFile(file)

  waitForImportUploads(1)
  cy.wait('@vcfPreviewApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'VCF preview API status').to.be.within(200, 299)
  })

  fillVcfCaseName(caseName)
  startImportFromDialog()

  cy.wait('@importStartApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'import API status').to.be.within(200, 299)
  })

  expectImportSummaryVisible()
  queryImportedCase(caseName)
}

export function importSingleFileCase(caseName: string, file: ImportSelectFile): void {
  importBatchCases({
    sourceLabel: /^Single File\b/i,
    files: file,
    uploadCount: 1,
    expectedCases: [caseName]
  })
}

export function importMultipleFileCases(caseNames: string[], files: ImportSelectFile[]): void {
  importBatchCases({
    sourceLabel: /^Multiple Files\b/i,
    files,
    uploadCount: files.length,
    expectedCases: caseNames
  })
}

export function importFolderCases(caseNames: string[], files: ImportSelectFile[]): void {
  importBatchCases({
    sourceLabel: /^Folder\b/i,
    files,
    uploadCount: files.length,
    expectedCases: caseNames
  })
}

export function importZipCase(caseName: string, file: ImportSelectFile): void {
  importBatchCases({
    sourceLabel: /^ZIP Archive\b/i,
    files: file,
    uploadCount: 1,
    expectedCases: [caseName],
    waitForZipExtract: true
  })
}

function importBatchCases(params: BatchImportParams): void {
  cy.intercept('POST', '**/api/import/upload').as('uploadApi')
  cy.intercept('POST', '**/api/batch-import/checkDuplicates').as('duplicatesApi')
  cy.intercept('POST', '**/api/batch-import/testZipPassword').as('zipPasswordApi')
  cy.intercept('POST', '**/api/batch-import/extractZip').as('extractZipApi')
  cy.intercept('POST', '**/api/batch-import/start').as('batchStartApi')

  openImportSurface()
  selectImportSource(params.sourceLabel)
  selectPendingBrowserFile(params.files)

  waitForImportUploads(params.uploadCount)
  if (params.waitForZipExtract === true) {
    cy.wait('@zipPasswordApi', { timeout: 30000 }).then((interception) => {
      expect(interception.response?.statusCode ?? 0, 'ZIP password probe API status').to.be.within(200, 299)
    })
    cy.wait('@extractZipApi', { timeout: 30000 }).then((interception) => {
      expect(interception.response?.statusCode ?? 0, 'ZIP extract API status').to.be.within(200, 299)
    })
  }

  cy.wait('@duplicatesApi', { timeout: 30000 }).then((interception) => {
    expect(interception.response?.statusCode ?? 0, 'duplicate-check API status').to.be.within(200, 299)
  })

  expectPendingCasesVisible(params.expectedCases)
  startImportFromDialog()

  cy.wait('@batchStartApi', { timeout: 60000 }).then((interception) => {
    expect(
      interception.response?.statusCode ?? 0,
      `batch import API status ${JSON.stringify(interception.response?.body)}`
    ).to.be.within(200, 299)
  })

  expectImportSummaryVisible()
  for (const caseName of params.expectedCases) {
    queryImportedCase(caseName)
  }
}

function openImportSurface(): void {
  cy.varlensDismissResearchUseModal()

  openImportMenuItem()
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const researchDialog = $body
      .find('.v-dialog, [role="dialog"]')
      .filter((_idx, el) => /Research Use Only/i.test(el.textContent ?? ''))
      .filter(':visible')

    if (researchDialog.length > 0) {
      cy.varlensDismissResearchUseModal()
      openImportMenuItem()
    }
  })
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).should('be.visible')
}

function openImportMenuItem(): void {
  cy.get('[data-testid="app-settings-menu"]', { timeout: 15000 }).should('be.visible').click({ force: true })
  cy.contains('.v-list-item, [role="menuitem"]', /Import Data/i, { timeout: 15000 })
    .should('be.visible')
    .click({ force: true })
}

function selectImportSource(sourceLabel: RegExp): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.contains(sourceLabel, { timeout: 15000 }).click({ force: true })
  })
}

export function selectPendingBrowserFile(files: ImportSelectFile | ImportSelectFile[]): void {
  cy.get('input[type="file"]', { timeout: 15000 })
    .should(($inputs) => {
      expect(
        $inputs.length,
        'VarLens web upload contract missing: no browser file input is available. The web app may still be relying on Electron/server-path selection.'
      ).to.be.greaterThan(0)
    })
    .last()
    .selectFile(files, { force: true })
}

function waitForImportUploads(count: number): void {
  for (let index = 0; index < count; index++) {
    cy.wait('@uploadApi', { timeout: 30000 }).then((interception) => {
      expect(interception.response?.statusCode ?? 0, `upload API status ${index + 1}`).to.be.within(200, 299)
    })
  }
}

function fillVcfCaseName(caseName: string): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.get('input', { timeout: 15000 }).then(($inputs) => {
      const caseInputs = $inputs.filter((_idx, el) => {
        const label = `${el.getAttribute('name') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${
          el.getAttribute('placeholder') ?? ''
        }`.toLowerCase()
        return label.includes('case')
      })

      expect(caseInputs.length, 'VCF case-name input in import dialog').to.be.greaterThan(0)
      cy.wrap(caseInputs.first()).clear({ force: true }).type(caseName, { force: true })
    })
  })
}

function expectPendingCasesVisible(caseNames: string[]): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.contains(new RegExp(caseNames.map(escapeRegExp).join('|')), { timeout: 15000 }).should('be.visible')
  })
}

function startImportFromDialog(): void {
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.contains('button, [role="button"]', /^Import\b|Start Import/i, { timeout: 15000 }).click({
      force: true
    })
  })
}

function expectImportSummaryVisible(): void {
  cy.contains(/done|complete|imported|summary/i, { timeout: 60000 }).should('be.visible')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
