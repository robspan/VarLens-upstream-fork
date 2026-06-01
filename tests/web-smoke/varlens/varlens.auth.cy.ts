function visibleResearchUseDialog($body: JQuery<HTMLElement>): JQuery<HTMLElement> {
  return $body
    .find('.v-dialog, [role="dialog"]')
    .filter((_idx, el) => /Research Use Only|I Understand.*Continue/i.test(el.textContent ?? ''))
    .filter(':visible')
    .first()
}

function openSettingsMenu(): void {
  cy.varlensDismissResearchUseModal()
  cy.get('[data-testid="app-settings-menu"]', { timeout: 15000 }).should('be.visible').click({ force: true })
  cy.get('body', { timeout: 15000 }).then(($body) => {
    if (visibleResearchUseDialog($body).length === 0) {
      return
    }

    cy.varlensDismissResearchUseModal()
    cy.get('[data-testid="app-settings-menu"]', { timeout: 15000 }).should('be.visible').click({ force: true })
  })
}

describe('VarLens authenticated web smoke checks', () => {
  beforeEach(function () {
    if ((Cypress.env('varlensPassword') as string) === '') {
      this.skip()
    }

    cy.varlensLogin()
  })

  it('drives the authenticated app shell through the visible navigation', () => {
    cy.varlensDismissResearchUseModal()
    cy.get('body', { timeout: 15000 }).should(($body) => {
      expect($body.text()).to.match(/Cases|Select a case|Cohort/i)
    })
    openSettingsMenu()
    cy.contains('.v-list-item, [role="menuitem"]', /Database Overview/i, { timeout: 15000 }).should('be.visible')
    cy.contains('.v-list-item, [role="menuitem"]', /Application Preferences/i, { timeout: 15000 }).should(
      'be.visible'
    )
  })

  it('returns the current user and core case APIs after login', () => {
    cy.varlensDismissResearchUseModal()

    cy.varlensApi('auth', 'currentUser').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.have.property('username', Cypress.env('varlensUsername'))
    })

    cy.varlensApi('cases', 'list').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.be.an('array')
    })

    cy.varlensApi('cases', 'availableBuilds').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.be.an('array')
    })

    cy.varlensApi('cases', 'query', [{ limit: 10, offset: 0, search_term: null }]).then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.have.property('data').that.is.an('array')
      expect(response.body).to.have.property('total_count').that.is.a('number')
    })
  })

  it('loads the authenticated app shell without a fatal browser error', () => {
    cy.varlensDismissResearchUseModal()
    cy.get('[data-testid="app-settings-menu"]', { timeout: 15000 }).should('be.visible')
    cy.get('body', { timeout: 15000 }).should(($body) => {
      expect($body.text()).to.match(/Cases|Select a case|Cohort/i)
      expect($body.text()).to.not.match(/uncaught|fatal|application error|cannot read/i)
    })
  })
})
