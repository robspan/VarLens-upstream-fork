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

export function expectCurrentUserApiAvailable(): void {
  cy.varlensApi('auth', 'currentUser').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.have.property('username', Cypress.env('varlensUsername'))
  })
}

export function expectCoreCaseApisAvailable(): void {
  cy.varlensApi('cases', 'list').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.be.an('array')
  })

  cy.varlensApi('cases', 'availableBuilds').then((response) => {
    expect(response.status).to.eq(200)
    expect(response.body).to.be.an('array')
  })

  cy.varlensApi('cases', 'query', [{ limit: 10, offset: 0, search_term: null }]).then(
    (response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.have.property('data').that.is.an('array')
      expect(response.body).to.have.property('total_count').that.is.a('number')
    }
  )
}

declare global {
  namespace Cypress {
    interface Chainable {
      varlensApi(domain: string, method: string, args?: unknown[]): Chainable<Response<unknown>>
    }
  }
}

export {}
