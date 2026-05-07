import type { AnnotationsDomainContract } from '../../shared/ipc/domains/annotations'
import { httpInvoke } from './http-invoke'

export const createAnnotationsApi = (): AnnotationsDomainContract => ({
  getGlobal: (chr, pos, ref, alt) =>
    httpInvoke('/api/annotations/getGlobal', [chr, pos, ref, alt]),
  upsertGlobal: (chr, pos, ref, alt, updates) =>
    httpInvoke('/api/annotations/upsertGlobal', [chr, pos, ref, alt, updates]),
  deleteGlobal: (chr, pos, ref, alt) =>
    httpInvoke('/api/annotations/deleteGlobal', [chr, pos, ref, alt]),
  getPerCase: (caseId, variantId) =>
    httpInvoke('/api/annotations/getPerCase', [caseId, variantId]),
  upsertPerCase: (caseId, variantId, updates) =>
    httpInvoke('/api/annotations/upsertPerCase', [caseId, variantId, updates]),
  deletePerCase: (caseId, variantId) =>
    httpInvoke('/api/annotations/deletePerCase', [caseId, variantId]),
  getForVariant: (caseId, chr, pos, ref, alt) =>
    httpInvoke('/api/annotations/getForVariant', [caseId, chr, pos, ref, alt]),
  batchGet: (caseId, variantKeys) =>
    httpInvoke('/api/annotations/batchGet', [caseId, variantKeys])
})
