export type RenderExpectation = string | RegExp

const CASE_SEARCH_DEBOUNCE_MS = 500
const CASE_SEARCH_POLL_MS = 1000
const CASE_SEARCH_POLLS = 8
const CASE_SEARCH_INPUT_SELECTOR = 'input[placeholder="Search cases..."]'

export interface ImportedCase {
  id: number
  name: string
  variant_count: number
}

export function queryImportedCase(caseName: string): Cypress.Chainable<ImportedCase> {
  return cy
    .varlensApi('cases', 'query', [{ limit: 20, offset: 0, search_term: caseName }])
    .then((response) => {
      const body = response.body as { data: ImportedCase[] }
      expect(response.status).to.eq(200)
      expect(body.data, `query result for ${caseName}`)
        .to.be.an('array')
        .and.have.length.greaterThan(0)
      const importedCase = body.data.find((item) => item.name === caseName) ?? body.data[0]
      expect(importedCase.name).to.contain(caseName)
      expect(
        importedCase.variant_count,
        `processed variant count for ${caseName}`
      ).to.be.greaterThan(0)
      return importedCase
    })
}

export function expectImportedCaseRendered(
  caseName: string,
  expectedRows: RenderExpectation[][]
): void {
  selectCaseFromSidebar(caseName)
  openSnvIndelTab()
  cy.get('.table-container, .v-data-table, table', { timeout: 30000 }).should('be.visible')
  expectRenderedText(caseName, 15000)
  for (const expectedRow of expectedRows) {
    expectRenderedVariantRow(expectedRow)
  }
}

export function selectCaseFromSidebar(caseName: string): void {
  queryImportedCase(caseName)
  ensureCaseSidebarOpen()
  typeCaseSearch(caseName)
  cy.wait(CASE_SEARCH_DEBOUNCE_MS)

  clickVisibleCaseListItem(caseName, CASE_SEARCH_POLLS, () => {
    cy.get('body').then(($body) => {
      throw new Error(
        `Imported case "${caseName}" is present in the API but not visible in the case sidebar after search. Visible rows: ${renderedCaseListSummary(
          $body
        )}`
      )
    })
  })
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

  return $root
    .find('.v-app-bar button:visible, header button:visible, .v-toolbar button:visible')
    .first()
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
    .map((expected) =>
      typeof expected === 'string' ? expected : `/${expected.source}/${expected.flags}`
    )
    .join(', ')

  cy.get('.v-data-table tbody tr, table tbody tr', { timeout: 30000 }).should(($rows) => {
    const matchingRows = $rows.filter((_idx, row) => {
      if (!Cypress.$(row).is(':visible')) return false
      const rowText = (row as HTMLTableRowElement).innerText ?? row.textContent ?? ''
      return expectedValues.every((expected) => renderedTextMatches(rowText, expected))
    })

    expect(
      matchingRows.length,
      `visible variant row containing ${assertionLabel}`
    ).to.be.greaterThan(0)
  })
}

function openSnvIndelTab(): void {
  cy.contains('.v-tab, [role="tab"]', /SNV\/Indel/i, { timeout: 15000 })
    .should('be.visible')
    .click({ force: true })
}
