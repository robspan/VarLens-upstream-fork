import type {
  GlobalAnnotationUpdates,
  PerCaseAnnotationUpdates,
  VariantAnnotationsResult,
  VariantKey
} from '../../types/api'
import type {
  VariantAnnotation,
  CaseVariantAnnotation
} from '../../types/database-entities'
import type { IpcResult } from '../../types/errors'

export interface AnnotationsDomainContract {
  getGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<VariantAnnotation | null>>
  upsertGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ) => Promise<IpcResult<VariantAnnotation>>
  deleteGlobal: (chr: string, pos: number, ref: string, alt: string) => Promise<IpcResult<void>>
  getPerCase: (
    caseId: number,
    variantId: number
  ) => Promise<IpcResult<CaseVariantAnnotation | null>>
  upsertPerCase: (
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ) => Promise<IpcResult<CaseVariantAnnotation>>
  deletePerCase: (caseId: number, variantId: number) => Promise<IpcResult<void>>
  getForVariant: (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<VariantAnnotationsResult>>
  batchGet: (
    caseId: number | null,
    variantKeys: VariantKey[]
  ) => Promise<IpcResult<Record<string, VariantAnnotationsResult>>>
}
