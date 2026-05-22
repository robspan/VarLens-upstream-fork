import type { OverrideHandler } from './types'

export function buildCasesOverrides(): Record<string, OverrideHandler> {
  return {
    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
      }
    }
  }
}
