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

type ImportBuffer = ReturnType<(typeof Cypress.Buffer)['from']>
type ImportSelectFile = string | { contents: ImportBuffer; fileName: string; mimeType?: string }
type RenderExpectation = string | RegExp

const SAMPLE_VCF_GZ_BASE64 =
  'H4sIAAAAAAAAE3XOUWuDMBDA8efzU5T6Wmxix8ZgKQSrTtBqTdbX4lxaAjVxiS0I+fDDlsEY29' +
  'txcP/f+f5RnsVRm64ZyD5Krg9B6Pl+tk1K8pJtSMR2i+2lexeGBAs+9oKwwUh1WmyEbY3sB6kV' +
  'mUdaWfF5EaoVs0YpPTTT3s6ORnezfVzN157vJ2VdUH6rpvw7iv+PpkLpYezFdBy91mUBVckg20' +
  'AdJ0BzDrs3mkOS5TyuYXoY7gIwWlR57GHACEEAFNLbVFHGIGI70klrhbLicG2MbNTgnOMx425b' +
  'HBDCAXa90YOQ6tDqD6lOzrk2wAjRder6IB/takXNCVIOaIm9EMKbEgGH5x+IHZVWY6cv9hcT3p' +
  '3wbydEKFpz1wf03Dw+kUnBS+x9AUNXnnunAQAA'

const JSON_GZ_BASE64 =
  'H4sIAAAAAAAAExXK0QqCMBiA0Xf5roeoFcV/FyVBUEJ5VYSsOSvQrZwFIb57dK7PwEd3D+36gJ' +
  'wHzL1DSFA8fUBm00maKDpbI6xQ6KZHKFDcrLNl+LZX3yBsTttjvkdhvAv29bbOWIRdvs4OyyL7' +
  'f+dbXZW6RuIojlOF0VWFJItoPl7GH337eGSIAAAA'

const CASE_SEARCH_DEBOUNCE_MS = 500
const CASE_SEARCH_POLL_MS = 1000
const CASE_SEARCH_POLLS = 8
const CASE_SEARCH_RELOADS = 2
const CASE_SEARCH_INPUT_SELECTOR = 'input[placeholder="Search cases..."]'

function jsonImportFile(fileName: string, geneSymbol: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/json',
    contents: Cypress.Buffer.from(
      JSON.stringify({
        variants: [
          {
            chr: '1',
            pos: 12345,
            ref: 'A',
            alt: 'G',
            gene_symbol: geneSymbol,
            consequence: 'HIGH',
            gnomad_af: 0.001,
            cadd: 25.3
          }
        ]
      })
    )
  }
}

function gzipJsonImportFile(fileName: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/gzip',
    contents: Cypress.Buffer.from(JSON_GZ_BASE64, 'base64')
  }
}

function gzipSampleVcfImportFile(fileName: string): ImportSelectFile {
  return {
    fileName,
    mimeType: 'application/gzip',
    contents: Cypress.Buffer.from(SAMPLE_VCF_GZ_BASE64, 'base64')
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZipFile(fileName: string, contents: string): ImportBuffer {
  const nameBytes = Cypress.Buffer.from(fileName)
  const fileBytes = Cypress.Buffer.from(contents)
  const checksum = crc32(fileBytes)
  const localHeader = Cypress.Buffer.alloc(30 + nameBytes.length)
  const centralHeader = Cypress.Buffer.alloc(46 + nameBytes.length)
  const endRecord = Cypress.Buffer.alloc(22)

  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)
  localHeader.writeUInt32LE(checksum, 14)
  localHeader.writeUInt32LE(fileBytes.length, 18)
  localHeader.writeUInt32LE(fileBytes.length, 22)
  localHeader.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(localHeader, 30)

  const centralOffset = localHeader.length + fileBytes.length
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt32LE(checksum, 16)
  centralHeader.writeUInt32LE(fileBytes.length, 20)
  centralHeader.writeUInt32LE(fileBytes.length, 24)
  centralHeader.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(centralHeader, 46)

  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(1, 8)
  endRecord.writeUInt16LE(1, 10)
  endRecord.writeUInt32LE(centralHeader.length, 12)
  endRecord.writeUInt32LE(centralOffset, 16)

  return Cypress.Buffer.concat([localHeader, fileBytes, centralHeader, endRecord])
}

function zipImportFile(caseName: string): ImportSelectFile {
  return {
    fileName: `${caseName}.zip`,
    mimeType: 'application/zip',
    contents: storedZipFile(
      `${caseName}.json`,
      JSON.stringify({
        variants: [
          {
            chr: '3',
            pos: 333,
            ref: 'C',
            alt: 'T',
            gene_symbol: 'ZIPGENE',
            consequence: 'MODERATE'
          }
        ]
      })
    )
  }
}

function visibleCaseListItem($root: JQuery<HTMLElement>, caseName: string): JQuery<HTMLElement> {
  return $root
    .find('.v-list-item')
    .filter((_idx, el) => (el.textContent ?? '').includes(caseName))
    .filter(':visible')
    .first()
}

function isCaseSearchVisible($root: JQuery<HTMLElement>): boolean {
  return $root.find(CASE_SEARCH_INPUT_SELECTOR).filter(':visible').length > 0
}

function visibleSidebarToggle($root: JQuery<HTMLElement>): JQuery<HTMLElement> {
  const stableToggle = $root
    .find('[data-testid="app-sidebar-toggle"], .sidebar-toggle-btn, [aria-label="Open sidebar"]')
    .filter(':visible')
    .first()
  if (stableToggle.length > 0) return stableToggle

  const appBarToggle = $root
    .find('.v-app-bar button, header button, .v-toolbar button')
    .filter(':visible')
    .filter((_idx, el) => {
      const label = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`
      return /Open sidebar|Close sidebar|»|«/.test(label)
    })
    .first()
  if (appBarToggle.length > 0) return appBarToggle

  return $root.find('.v-app-bar button:visible, header button:visible, .v-toolbar button:visible').first()
}

function ensureCaseSidebarOpen(attemptsRemaining = 3): void {
  cy.get('body', { timeout: 15000 }).then(($body) => {
    if (isCaseSearchVisible($body)) {
      return
    }

    if (attemptsRemaining <= 0) {
      throw new Error('Case sidebar did not open: case search input stayed hidden.')
    }

    const toggle = visibleSidebarToggle($body)
    expect(toggle.length, 'visible case sidebar toggle').to.be.greaterThan(0)
    cy.wrap(toggle).click({ force: true })
    cy.wait(250)
    ensureCaseSidebarOpen(attemptsRemaining - 1)
  })
}

function typeCaseSearch(caseName: string): void {
  cy.get(CASE_SEARCH_INPUT_SELECTOR, { timeout: 15000 })
    .should('be.visible')
    .click({ force: true })
    .clear({ force: true })
    .should('have.value', '')
    .type(caseName, { force: true })
}

function renderedCaseListSummary($root: JQuery<HTMLElement>): string {
  const renderedItems = $root
    .find('.v-list-item:visible')
    .map((_idx, el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 8)

  return renderedItems.length > 0 ? renderedItems.join(' | ') : '<no visible case rows>'
}

function clickVisibleCaseListItem(
  caseName: string,
  pollsRemaining: number,
  onNotFound: () => void
): void {
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const match = visibleCaseListItem($body, caseName)

    if (match.length > 0) {
      cy.wrap(match).scrollIntoView().click({ force: true })
      return
    }

    if (pollsRemaining <= 0) {
      onNotFound()
      return
    }

    if (!isCaseSearchVisible($body)) {
      ensureCaseSidebarOpen()
      typeCaseSearch(caseName)
      cy.wait(CASE_SEARCH_DEBOUNCE_MS)
      clickVisibleCaseListItem(caseName, pollsRemaining - 1, onNotFound)
      return
    }

    cy.wait(CASE_SEARCH_POLL_MS)
    clickVisibleCaseListItem(caseName, pollsRemaining - 1, onNotFound)
  })
}

function selectCaseFromSidebar(caseName: string, reloadsRemaining = CASE_SEARCH_RELOADS): void {
  queryImportedCase(caseName)
  ensureCaseSidebarOpen()
  typeCaseSearch(caseName)
  cy.wait(CASE_SEARCH_DEBOUNCE_MS)

  clickVisibleCaseListItem(caseName, CASE_SEARCH_POLLS, () => {
    if (reloadsRemaining > 0) {
      cy.reload()
      cy.varlensDismissResearchUseModal()
      selectCaseFromSidebar(caseName, reloadsRemaining - 1)
      return
    }

    cy.get('body').then(($body) => {
      throw new Error(
        `Imported case "${caseName}" is present in the API but not visible in the case sidebar after search. Visible rows: ${renderedCaseListSummary(
          $body
        )}`
      )
    })
  })
}

function selectPendingBrowserFile(files: ImportSelectFile | ImportSelectFile[]): void {
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
      const status = interception.response?.statusCode ?? 0
      expect(status, `upload API status ${index + 1}`).to.be.within(200, 299)
    })
  }
}

function queryImportedCase(caseName: string): Cypress.Chainable<{ id: number; name: string; variant_count: number }> {
  return cy
    .varlensApi('cases', 'query', [{ limit: 20, offset: 0, search_term: caseName }])
    .then((response) => {
      const body = response.body as { data: Array<{ id: number; name: string; variant_count: number }> }
      expect(response.status).to.eq(200)
      expect(body.data, `query result for ${caseName}`).to.be.an('array').and.have.length.greaterThan(0)
      const importedCase = body.data.find((item) => item.name === caseName) ?? body.data[0]
      expect(importedCase.name).to.contain(caseName)
      expect(importedCase.variant_count, `processed variant count for ${caseName}`).to.be.greaterThan(0)
      return importedCase
    })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderedTextMatches(text: string, expected: RenderExpectation): boolean {
  if (typeof expected === 'string') return text.includes(expected)
  expected.lastIndex = 0
  return expected.test(text)
}

function expectRenderedText(expected: RenderExpectation, timeout = 30000): void {
  const assertionLabel =
    typeof expected === 'string' ? expected : `/${expected.source}/${expected.flags}`

  cy.get('#app', { timeout }).should(($app) => {
    const visibleMatches = $app.find('*').filter((_idx, el) => {
      if (!Cypress.$(el).is(':visible')) return false
      const renderedText = (el as HTMLElement).innerText ?? el.textContent ?? ''
      if (renderedText.trim() === '') return false
      return renderedTextMatches(renderedText, expected)
    })

    expect(visibleMatches.length, `visible rendered UI text ${assertionLabel}`).to.be.greaterThan(0)
  })
}

function expectRenderedVariantRow(expectedValues: RenderExpectation[]): void {
  const assertionLabel = expectedValues
    .map((expected) => (typeof expected === 'string' ? expected : `/${expected.source}/${expected.flags}`))
    .join(', ')

  cy.get('.v-data-table tbody tr, table tbody tr', { timeout: 30000 }).should(($rows) => {
    const matchingRows = $rows.filter((_idx, row) => {
      if (!Cypress.$(row).is(':visible')) return false
      const rowText = (row as HTMLTableRowElement).innerText ?? row.textContent ?? ''
      return expectedValues.every((expected) => renderedTextMatches(rowText, expected))
    })

    expect(matchingRows.length, `visible variant row containing ${assertionLabel}`).to.be.greaterThan(0)
  })
}

function openSnvIndelTab(): void {
  cy.contains('.v-tab, [role="tab"]', /SNV\/Indel/i, { timeout: 15000 })
    .should('be.visible')
    .click({ force: true })
  cy.get('.per-type-region', { timeout: 15000 }).should('be.visible')
}

function expectImportedCaseRendered(caseName: string, expectedRows: RenderExpectation[][]): void {
  cy.reload()
  cy.varlensDismissResearchUseModal()
  selectCaseFromSidebar(caseName)
  openSnvIndelTab()
  cy.get('.table-container, .v-data-table, table', { timeout: 30000 }).should('be.visible')
  expectRenderedText(caseName, 15000)
  for (const expectedRow of expectedRows) {
    expectRenderedVariantRow(expectedRow)
  }
}

function expectRegionFilterSelectionRendered(regionName: string): void {
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
            (_idx, el) =>
              `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
          )
          .get()
        const renderedValue = [$field.text(), ...inputValues, ...metadata].join(' ')

        expect(renderedValue, 'rendered BED region select value').to.contain(expectedPrefix)
      })
  })
}

function importSingleVcfThroughDialog(caseName: string, file: ImportSelectFile): void {
  cy.intercept('POST', '**/api/import/upload').as('uploadApi')
  cy.intercept('POST', '**/api/import/vcfPreview').as('vcfPreviewApi')
  cy.intercept('POST', '**/api/import/start').as('importStartApi')

  openImportSurface()
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.contains(/^Single File\b/i, { timeout: 15000 }).click({ force: true })
  })
  selectPendingBrowserFile(file)

  waitForImportUploads(1)
  cy.wait('@vcfPreviewApi', { timeout: 30000 }).then((interception) => {
    const status = interception.response?.statusCode ?? 0
    expect(status, 'VCF preview API status').to.be.within(200, 299)
  })

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

  cy.contains('button, [role="button"]', /^Import\b|Start Import/i, { timeout: 15000 }).click({ force: true })

  cy.wait('@importStartApi', { timeout: 30000 }).then((interception) => {
    const status = interception.response?.statusCode ?? 0
    expect(status, 'import API status').to.be.within(200, 299)
  })

  cy.contains(/done|complete|imported|summary/i, { timeout: 60000 }).should('be.visible')
  queryImportedCase(caseName)
}

function importFilesThroughDialog(params: {
  sourceLabel: RegExp
  files: ImportSelectFile | ImportSelectFile[]
  uploadCount: number
  expectedCases: string[]
  waitForZipExtract?: boolean
}): void {
  cy.intercept('POST', '**/api/import/upload').as('uploadApi')
  cy.intercept('POST', '**/api/batch-import/checkDuplicates').as('duplicatesApi')
  cy.intercept('POST', '**/api/batch-import/testZipPassword').as('zipPasswordApi')
  cy.intercept('POST', '**/api/batch-import/extractZip').as('extractZipApi')
  cy.intercept('POST', '**/api/batch-import/start').as('batchStartApi')

  openImportSurface()
  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    cy.contains(params.sourceLabel, { timeout: 15000 }).click({ force: true })
  })
  selectPendingBrowserFile(params.files)

  waitForImportUploads(params.uploadCount)
  if (params.waitForZipExtract === true) {
    cy.wait('@zipPasswordApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, 'ZIP password probe API status').to.be.within(200, 299)
    })
    cy.wait('@extractZipApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, 'ZIP extract API status').to.be.within(200, 299)
    })
  }
  cy.wait('@duplicatesApi', { timeout: 30000 }).then((interception) => {
    const status = interception.response?.statusCode ?? 0
    expect(status, 'duplicate-check API status').to.be.within(200, 299)
  })

  cy.contains('.v-dialog, [role="dialog"]', /Import Data/i, { timeout: 15000 }).within(() => {
    const expectedText = params.expectedCases.map(escapeRegExp).join('|')
    cy.contains(new RegExp(expectedText), { timeout: 15000 }).should('be.visible')
    cy.contains('button, [role="button"]', /^Import\b|Start Import/i, { timeout: 15000 }).click({
      force: true
    })
  })

  cy.wait('@batchStartApi', { timeout: 60000 }).then((interception) => {
    const status = interception.response?.statusCode ?? 0
    expect(status, `batch import API status ${JSON.stringify(interception.response?.body)}`).to.be.within(
      200,
      299
    )
  })
  cy.contains(/done|complete|imported|summary/i, { timeout: 60000 }).should('be.visible')

  for (const caseName of params.expectedCases) {
    queryImportedCase(caseName)
  }
}

function openCaseDataInfo(caseName: string): void {
  selectCaseFromSidebar(caseName)
  cy.contains('.context-indicator', caseName, { timeout: 15000 }).within(() => {
    cy.get('button:visible').last().click({ force: true })
  })
  cy.contains('.v-dialog, [role="dialog"]', caseName, { timeout: 15000 }).should('be.visible')
  cy.get('body').then(($body) => {
    const dataInfoTab = $body
      .find('*')
      .filter((_idx, el) => /Data\s*Info/i.test((el.textContent ?? '').trim()))
      .last()

    expect(dataInfoTab.length, 'visible Data Info tab').to.be.greaterThan(0)
    cy.wrap(dataInfoTab).click({ force: true })
  })
  cy.contains(/Pre-filtering Applied/i, { timeout: 15000 }).should('be.visible')
}

describe('VarLens web smoke data workflows', () => {
  beforeEach(function () {
    if ((Cypress.env('varlensPassword') as string) === '') {
      this.skip()
    }

    cy.varlensLogin()
    cy.varlensDismissResearchUseModal()
  })

  it('imports a browser-selected VCF and renders the imported variants in the case view', () => {
    const caseName = `iac-smoke-${Date.now()}`

    importSingleVcfThroughDialog(caseName, 'tests/web-smoke/fixtures/varlens/sample.vcf')
    expectImportedCaseRendered(caseName, [
      [/\b1\b/, /\b100\b/, 'A', 'G', '0/1'],
      [/\b2\b/, /\b200\b/, 'C', 'T', '1/1']
    ])
  })

  it('imports a browser-selected gzipped VCF and renders the imported variants in the case view', () => {
    const caseName = `iac-smoke-gz-${Date.now()}`

    importSingleVcfThroughDialog(caseName, gzipSampleVcfImportFile(`${caseName}.vcf.gz`))
    expectImportedCaseRendered(caseName, [
      [/\b1\b/, /\b100\b/, 'A', 'G', '0/1'],
      [/\b2\b/, /\b200\b/, 'C', 'T', '1/1']
    ])
  })

  it('imports a browser-selected JSON file and renders the imported variant in the case view', () => {
    const caseName = `single-json-${Date.now()}`

    importFilesThroughDialog({
      sourceLabel: /^Single File\b/i,
      files: jsonImportFile(`${caseName}.json`, 'SINGLEJSON'),
      uploadCount: 1,
      expectedCases: [caseName]
    })

    expectImportedCaseRendered(caseName, [['SINGLEJSON', /12,?345/]])
  })

  it('imports a browser-selected gzipped JSON file and renders the imported variant in the case view', () => {
    const caseName = `single-json-gz-${Date.now()}`

    importFilesThroughDialog({
      sourceLabel: /^Single File\b/i,
      files: gzipJsonImportFile(`${caseName}.json.gz`),
      uploadCount: 1,
      expectedCases: [caseName]
    })

    expectImportedCaseRendered(caseName, [['GZJSON', /54,?321/]])
  })

  it('imports browser-selected JSON files through the Multiple Files path and renders both cases', () => {
    const suffix = Date.now()
    const firstCase = `multi-json-a-${suffix}`
    const secondCase = `multi-json-b-${suffix}`

    importFilesThroughDialog({
      sourceLabel: /^Multiple Files\b/i,
      files: [
        jsonImportFile(`${firstCase}.json`, 'MULTIA'),
        jsonImportFile(`${secondCase}.json`, 'MULTIB')
      ],
      uploadCount: 2,
      expectedCases: [firstCase, secondCase]
    })

    expectImportedCaseRendered(firstCase, [['MULTIA', /12,?345/]])
    expectImportedCaseRendered(secondCase, [['MULTIB', /12,?345/]])
  })

  it('imports browser-selected JSON files through the Folder path and renders both cases', () => {
    const suffix = Date.now()
    const firstCase = `folder-json-a-${suffix}`
    const secondCase = `folder-json-b-${suffix}`

    importFilesThroughDialog({
      sourceLabel: /^Folder\b/i,
      files: [
        jsonImportFile(`${firstCase}.json`, 'FOLDERA'),
        jsonImportFile(`${secondCase}.json`, 'FOLDERB')
      ],
      uploadCount: 2,
      expectedCases: [firstCase, secondCase]
    })

    expectImportedCaseRendered(firstCase, [['FOLDERA', /12,?345/]])
    expectImportedCaseRendered(secondCase, [['FOLDERB', /12,?345/]])
  })

  it('uploads a ZIP archive, extracts it, imports the contained JSON case, and renders it', () => {
    const caseName = `zip-web-case-${Date.now()}`

    importFilesThroughDialog({
      sourceLabel: /^ZIP Archive\b/i,
      files: zipImportFile(caseName),
      uploadCount: 1,
      expectedCases: [caseName],
      waitForZipExtract: true
    })

    expectImportedCaseRendered(caseName, [['ZIPGENE', /\b333\b/]])
  })

  it('uploads a BED file from the browser through the case Data Info region filter dialog', () => {
    const caseName = `bed-json-${Date.now()}`
    const regionName = `iac-regions-${Date.now()}`
    let caseId: number | undefined
    let regionFileId: number | undefined

    importFilesThroughDialog({
      sourceLabel: /^Single File\b/i,
      files: jsonImportFile(`${caseName}.json`, 'BEDJSON'),
      uploadCount: 1,
      expectedCases: [caseName]
    })
    queryImportedCase(caseName).then((importedCase) => {
      caseId = importedCase.id
    })

    cy.reload()
    cy.varlensDismissResearchUseModal()
    cy.intercept('POST', '**/api/import/upload').as('uploadApi')
    cy.intercept('POST', /\/api\/(?:regionFiles|region-files)\/create$/).as('regionCreateApi')
    cy.intercept('POST', /\/api\/(?:regionFiles|region-files)\/importBed$/).as('regionImportApi')
    cy.intercept('POST', /\/api\/(?:caseMetadata|case-metadata)\/upsertDataInfo$/).as('dataInfoSaveApi')

    openCaseDataInfo(caseName)
    cy.contains('.v-dialog, [role="dialog"]', caseName, { timeout: 15000 }).within(() => {
      cy.contains(/Region filter \(BED\)/i)
        .parents('.v-col')
        .first()
        .find('button:visible')
        .last()
        .click({ force: true })
    })

    cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).within(() => {
      cy.get('input').first().clear({ force: true }).type(regionName, { force: true })
      cy.contains('button, [role="button"]', /Select BED file/i).click({ force: true })
    })
    selectPendingBrowserFile('tests/web-smoke/fixtures/varlens/regions.bed')

    cy.wait('@uploadApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, 'BED upload API status').to.be.within(200, 299)
    })

    cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).should(
      'be.visible'
    )
    cy.contains('.v-dialog, [role="dialog"]', /Import BED Region File/i, { timeout: 15000 }).within(() => {
      cy.get('button, [role="button"]').then(($buttons) => {
        const importButton = $buttons
          .filter((_idx, el) => /^Import$/i.test((el.textContent ?? '').trim()))
          .last()

        expect(importButton.length, 'visible BED import button').to.be.greaterThan(0)
        cy.wrap(importButton)
          .should(($button) => {
            expect(
              $button.is(':disabled') || $button.hasClass('v-btn--disabled') || $button.hasClass('v-btn--loading'),
              'BED import button ready'
            ).to.eq(false)
          })
          .click({ force: true })
      })
    })

    cy.wait('@regionCreateApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, 'region file create status').to.be.within(200, 299)
      regionFileId = (interception.response?.body as { id?: number } | undefined)?.id
      expect(regionFileId, 'created region file id').to.be.a('number')
    })
    cy.wait('@regionImportApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, `BED import status ${JSON.stringify(interception.response?.body)}`).to.be.within(
        200,
        299
      )
    })
    cy.wait('@dataInfoSaveApi', { timeout: 30000 }).then((interception) => {
      const status = interception.response?.statusCode ?? 0
      expect(status, 'case metadata save status').to.be.within(200, 299)
    })

    cy.varlensApi('region-files', 'list').then((listResponse) => {
      expect(listResponse.status, 'region file list status').to.eq(200)
      const regionFiles = listResponse.body as Array<{ name: string }>
      expect(
        regionFiles.some((regionFile) => regionFile.name === regionName),
        'region file appears in list'
      ).to.eq(true)
    })
    cy.then(() => {
      expect(caseId, 'BED case id').to.be.a('number')
      expect(regionFileId, 'BED region file id').to.be.a('number')
      cy.varlensApi('case-metadata', 'getDataInfo', [caseId]).then((metadataResponse) => {
        expect(metadataResponse.status, 'case metadata status').to.eq(200)
        expect((metadataResponse.body as { region_file_id?: number }).region_file_id).to.eq(regionFileId)
      })
    })
    expectRegionFilterSelectionRendered(regionName)
  })
})
