function visibleResearchUseDialog($body: JQuery<HTMLElement>): JQuery<HTMLElement> {
  return $body
    .find('.v-dialog, [role="dialog"]')
    .filter((_idx, el) => /Research Use Only|I Understand.*Continue/i.test(el.textContent ?? ''))
    .filter(':visible')
    .first()
}

Cypress.Commands.add('varlensDismissResearchUseModal', () => {
  cy.contains('body', /Research Use Only|Select a case|Cohort|Import|VarLens Web/i, { timeout: 15000 })
  cy.wait(750)
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const researchDialog = visibleResearchUseDialog($body)

    if (researchDialog.length === 0) {
      return
    }

    cy.wrap(researchDialog).within(() => {
      cy.contains('button, [role="button"]', /I Understand.*Continue|I Understand|Continue|Accept/i, {
        timeout: 15000
      })
        .should('be.visible')
        .click({ force: true })
    })

    cy.get('body', { timeout: 15000 }).should(($after) => {
      expect(visibleResearchUseDialog($after).length, 'visible research-use modal').to.eq(0)
    })
  })
})

export function openSettingsMenu(): void {
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

export function expectAuthenticatedShellVisible(): void {
  cy.get('[data-testid="app-settings-menu"]', { timeout: 15000 }).should('be.visible')
  cy.get('body', { timeout: 15000 }).should(($body) => {
    expect($body.text()).to.match(/Cases|Select a case|Cohort/i)
    expect($body.text()).to.not.match(/uncaught|fatal|application error|cannot read/i)
  })
}

export function expectCoreSettingsMenuItemsVisible(): void {
  openSettingsMenu()
  cy.contains('.v-list-item, [role="menuitem"]', /Database Overview/i, { timeout: 15000 }).should('be.visible')
  cy.contains('.v-list-item, [role="menuitem"]', /Application Preferences/i, { timeout: 15000 }).should(
    'be.visible'
  )
}

declare global {
  namespace Cypress {
    interface Chainable {
      varlensDismissResearchUseModal(): Chainable<void>
    }
  }
}

export {}
