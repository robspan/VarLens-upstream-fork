import { expectAuthenticatedShellVisible, expectCoreSettingsMenuItemsVisible } from '../support/app-shell'
import { beforeEachAuthenticatedSmoke } from '../support/auth'

describe('VarLens authenticated shell smoke', () => {
  beforeEachAuthenticatedSmoke()

  it('loads the authenticated app shell without a fatal browser error', () => {
    expectAuthenticatedShellVisible()
  })

  it('drives the authenticated app shell through visible navigation', () => {
    expectCoreSettingsMenuItemsVisible()
  })
})
