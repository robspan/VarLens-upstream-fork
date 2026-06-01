describe('VarLens web smoke entry points', () => {
  beforeEach(() => {
    cy.clearCookies()
    cy.clearLocalStorage()
  })

  it('redirects anonymous browser users to the login screen', () => {
    cy.visit('/', { failOnStatusCode: false })
    cy.location('pathname', { timeout: 15000 }).should('contain', '/login')
    cy.contains(/Sign in to continue/i, { timeout: 15000 }).should('be.visible')
    cy.get('input:visible').should('have.length.at.least', 2)
    cy.contains('button', /Sign in/i).should('be.visible')
  })

  it('serves a healthy web process with database connectivity', () => {
    cy.request('/healthz').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.include({ status: 'ok' })
      expect(response.body.db).to.include({ open: true })
      expect(response.body.version).to.be.a('string').and.not.be.empty
    })
  })

  it('serves the login page without exposing the application shell anonymously over HTTP', () => {
    cy.request('/login').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.headers['content-type']).to.contain('text/html')
      expect(response.body).to.contain('Sign in to continue')
    })

    cy.request({
      url: '/',
      followRedirect: false,
      failOnStatusCode: false
    }).then((response) => {
      expect([302, 303], 'anonymous app shell redirect').to.include(response.status)
      expect(response.headers.location, 'redirect target').to.contain('/login')
    })
  })

  it('keeps the public login API documented and reachable', () => {
    cy.varlensApi('auth', 'isAccountsEnabled').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.be.a('boolean')
    })
  })

  it('serves the Swagger UI and OpenAPI contract publicly', () => {
    cy.request('/api/docs/').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.headers['content-type']).to.contain('text/html')
      expect(response.body).to.contain('VarLens Web API Docs')
      expect(response.body).to.contain('swagger-ui')
    })

    cy.request('/api/docs/static/swagger-initializer.js').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body).to.contain('/api/openapi.json')
    })

    cy.request('/api/openapi.json').then((response) => {
      expect(response.status).to.eq(200)
      expect(response.body.openapi).to.match(/^3\./)
      expect(response.body.info.title).to.eq('VarLens Web API')
      expect(response.body.paths).to.have.property('/api/auth/login')
      expect(response.body.paths).to.have.property('/api/import/upload')
      expect(response.body.paths).to.have.property('/api/import/start')
      expect(response.body.paths).to.have.property('/api/import/startMultiFile')
      expect(response.body.paths).to.have.property('/api/batch-import/testZipPassword')
      expect(response.body.paths).to.have.property('/api/batch-import/extractZip')
      expect(response.body.paths).to.have.property('/api/batch-import/cleanupZipTemp')
      expect(response.body.paths).to.have.property('/api/region-files/importBed')
      expect(response.body.paths).to.not.have.property('/login')
      expect(response.body.paths).to.not.have.property('/login/')
      expect(JSON.stringify(response.body)).to.not.contain('Generic RPC fallback')
    })
  })

  it('protects case data until a user signs in', () => {
    cy.varlensApi('cases', 'query', [{ limit: 10, offset: 0, search_term: null }]).then((response) => {
      expect(response.status, 'anonymous case query').to.be.oneOf([401, 403])
    })
  })
})
