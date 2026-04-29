import type { StorageBackendKind } from '../../shared/types/storage-capabilities'

export type {
  StorageBackendKind,
  StorageCapabilities
} from '../../shared/types/storage-capabilities'

export type WorkspaceRef =
  | {
      kind: 'sqlite'
      path: string
      name: string
      encrypted: boolean
    }
  | {
      kind: 'postgres'
      connectionLabel: string
      connectionUrlRedacted: string
      schema: string
    }

export interface StorageHealth {
  ok: boolean
  backend: StorageBackendKind
  message?: string
  roundTripMs?: number
}
