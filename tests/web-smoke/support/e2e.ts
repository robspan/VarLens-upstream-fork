Cypress.Commands.add('varlensApi', (domain: string, method: string, args: unknown[] = []) => {
  const baseUrl = Cypress.config('baseUrl')
  const origin = typeof baseUrl === 'string' ? new URL(baseUrl).origin : undefined

  return cy.request({
    method: 'POST',
    url: `/api/${domain}/${method}`,
    failOnStatusCode: false,
    body: { args },
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(origin !== undefined ? { origin } : {})
    }
  })
})

function isSuccessfulLoginBody(body: unknown): body is { success: true; mustChangePassword?: boolean } {
  return body !== null && typeof body === 'object' && 'success' in body && body.success === true
}

function typeIntoVisibleInput(index: number, value: string, options: Partial<Cypress.TypeOptions> = {}): void {
  cy.get('input:visible', { timeout: 15000 }).eq(index).clear({ force: true }).type(value, {
    force: true,
    ...options
  })
}

let resolvedLoginPassword: string | undefined

Cypress.Commands.add('varlensResolveLoginPassword', () => {
  const username = Cypress.env('varlensUsername') as string
  const password = Cypress.env('varlensPassword') as string
  const configuredRotatedPassword = Cypress.env('varlensRotatedPassword') as string | undefined
  const rotatedPassword =
    configuredRotatedPassword !== undefined && configuredRotatedPassword !== ''
      ? configuredRotatedPassword
      : `${password}-rotated-2026`

  if (password === '') {
    throw new Error('VARLENS_ADMIN_PASSWORD is required for authenticated VarLens checks.')
  }

  if (resolvedLoginPassword !== undefined) {
    return cy.wrap(resolvedLoginPassword, { log: false })
  }

  const assertLoggedIn = (response: Cypress.Response<unknown>, candidatePassword: string): string => {
    expect(response.status, 'login HTTP status').to.eq(200)
    expect(response.body, 'login result').to.have.property('success', true)
    expect(response.body, 'bootstrap password must be rotated before E2E can continue').to.not.have.property(
      'mustChangePassword',
      true
    )
    Cypress.env('varlensPassword', candidatePassword)
    resolvedLoginPassword = candidatePassword
    return candidatePassword
  }

  const tryPassword = (
    candidatePassword: string,
    fallback?: () => Cypress.Chainable<string>
  ): Cypress.Chainable<string> => {
    return cy.varlensApi('auth', 'login', [username, candidatePassword]).then((response) => {
      if (response.status === 200 && isSuccessfulLoginBody(response.body)) {
        if (response.body.mustChangePassword === true) {
          if (rotatedPassword === candidatePassword) {
            throw new Error('VARLENS_ROTATED_ADMIN_PASSWORD must differ from VARLENS_ADMIN_PASSWORD.')
          }

          return cy
            .varlensApi('auth', 'changePassword', [candidatePassword, rotatedPassword])
            .then((changeResponse) => {
              expect(changeResponse.status, 'password rotation HTTP status').to.eq(200)
              expect(changeResponse.body, 'password rotation result').to.have.property('success', true)
              Cypress.env('varlensPassword', rotatedPassword)
              resolvedLoginPassword = rotatedPassword
              return rotatedPassword
            })
        }

        return assertLoggedIn(response, candidatePassword)
      }

      if (fallback !== undefined) {
        return fallback()
      }

      throw new Error(`login HTTP status ${response.status}`)
    }) as Cypress.Chainable<string>
  }

  if (rotatedPassword !== password) {
    return tryPassword(rotatedPassword, () => tryPassword(password))
  }

  return tryPassword(password)
})

Cypress.Commands.add('varlensLogin', () => {
  const username = Cypress.env('varlensUsername') as string

  return cy.varlensResolveLoginPassword().then((password) => {
    cy.session(
      ['varlens', username, password],
      () => {
        cy.varlensApi('auth', 'logout')
        cy.clearCookies()
        cy.clearLocalStorage()
        cy.visit('/login')
        cy.contains(/Sign in to continue/i, { timeout: 15000 }).should('be.visible')

        typeIntoVisibleInput(0, username)
        typeIntoVisibleInput(1, password, { log: false })
        cy.contains('button', /Sign in/i, { timeout: 15000 }).click({ force: true })

        cy.get('body', { timeout: 15000 }).then(($body) => {
          if (/Change your password/i.test($body.text())) {
            const rotatedPassword = Cypress.env('varlensPassword') as string
            typeIntoVisibleInput(0, rotatedPassword, { log: false })
            typeIntoVisibleInput(1, rotatedPassword, { log: false })
            cy.contains('button', /^Change Password$/i, { timeout: 15000 }).click({ force: true })
          }
        })

        cy.location('pathname', { timeout: 15000 }).should('not.contain', '/login')
      },
      {
        validate() {
          cy.varlensApi('auth', 'currentUser').then((response) => {
            expect(response.status, 'session validation HTTP status').to.eq(200)
          })
        }
      }
    )

    cy.visit('/')
    return cy.location('pathname', { timeout: 15000 }).should('not.contain', '/login').then(() => undefined)
  }) as unknown as Cypress.Chainable<void>
})

Cypress.Commands.add('varlensDismissResearchUseModal', () => {
  cy.contains('body', /Research Use Only|Select a case|Cohort|Import|VarLens Web/i, { timeout: 15000 })
  cy.wait(750)
  cy.get('body', { timeout: 15000 }).then(($body) => {
    const researchDialog = $body
      .find('.v-dialog, [role="dialog"]')
      .filter((_idx, el) => /Research Use Only|I Understand.*Continue/i.test(el.textContent ?? ''))
      .filter(':visible')
      .first()

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
      const visibleResearchDialog = $after
        .find('.v-dialog, [role="dialog"]')
        .filter((_idx, el) => /Research Use Only|I Understand.*Continue/i.test(el.textContent ?? ''))
        .filter(':visible')

      expect(visibleResearchDialog.length, 'visible research-use modal').to.eq(0)
    })
  })
})

declare global {
  namespace Cypress {
    interface Chainable {
      varlensApi(domain: string, method: string, args?: unknown[]): Chainable<Response<unknown>>
      varlensResolveLoginPassword(): Chainable<string>
      varlensLogin(): Chainable<void>
      varlensDismissResearchUseModal(): Chainable<void>
    }
  }
}

export {}
