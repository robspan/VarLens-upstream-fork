import {
  expectAnonymousUsersRedirectToLogin,
  expectCaseDataRequiresAuthentication,
  expectLoginPageDoesNotExposeAppShell,
  resetAnonymousBrowser
} from '../support/public-contracts'

describe('VarLens public entrypoint smoke', () => {
  beforeEach(() => {
    resetAnonymousBrowser()
  })

  it('keeps anonymous browser users on the login boundary', () => {
    expectAnonymousUsersRedirectToLogin()
  })

  it('serves only the login shell to anonymous HTTP clients', () => {
    expectLoginPageDoesNotExposeAppShell()
  })

  it('protects case data until a user signs in', () => {
    expectCaseDataRequiresAuthentication()
  })
})
