import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'
import { webParityFixturesEnabled } from '../api-fixture-responses'
import type { OverrideHandler } from './types'

function webCapabilities(base: StorageCapabilities): StorageCapabilities {
  if (webParityFixturesEnabled()) return base
  return {
    ...base,
    export: {
      variants: false,
      cohort: false,
      streaming: false
    }
  }
}

export function buildDatabaseOverrides(): Record<string, OverrideHandler> {
  return {
    'database:capabilities': {
      async handle(_args, _request, _reply, { session }) {
        return webCapabilities(session.capabilities)
      }
    },

    'database:health': {
      async handle(_args, _request, _reply, { session }) {
        return await session.health()
      }
    },

    'database:info': {
      handle(_args, _request, _reply, { session }) {
        return {
          path: `web:${session.capabilities.backend}`,
          name: 'VarLens Web',
          encrypted: false
        }
      }
    },

    'database:getOverview': {
      async handle(_args, _request, _reply, { session }) {
        return await session.getReadExecutor().execute({
          type: 'database:overview',
          params: []
        })
      }
    },

    'database:recentList': {
      handle() {
        return []
      }
    }
  }
}
