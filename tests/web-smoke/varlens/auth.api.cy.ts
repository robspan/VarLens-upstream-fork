import { expectCoreCaseApisAvailable, expectCurrentUserApiAvailable } from '../support/api'
import { beforeEachAuthenticatedSmoke } from '../support/auth'

describe('VarLens authenticated API smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('returns the current user and core case APIs after login', () => {
    expectCurrentUserApiAvailable()
    expectCoreCaseApisAvailable()
  })
})
