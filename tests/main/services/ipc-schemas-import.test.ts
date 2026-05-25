import { describe, expect, it } from 'vitest'
import {
  ImportStartMultiFileParamsSchema,
  ImportStartParamsSchema,
  ImportVcfOptionsSchema
} from '../../../src/shared/types/ipc-schemas'

describe('ImportVcfOptionsSchema', () => {
  it('accepts future genome build string values', () => {
    expect(ImportVcfOptionsSchema.safeParse({ genomeBuild: 'T2T-CHM13v2.0' }).success).toBe(true)
  })

  it('preserves leading and trailing spaces while validating nonblank strings', () => {
    const vcfOptionsResult = ImportVcfOptionsSchema.safeParse({ genomeBuild: ' GRCh39 ' })
    expect(vcfOptionsResult.success).toBe(true)
    if (!vcfOptionsResult.success) return

    expect(vcfOptionsResult.data?.genomeBuild).toBe(' GRCh39 ')

    const startParamsResult = ImportStartParamsSchema.safeParse([
      ' /tmp/input.vcf ',
      ' Case 1 ',
      undefined
    ])
    expect(startParamsResult.success).toBe(true)
    if (!startParamsResult.success) return

    expect(startParamsResult.data[0]).toBe(' /tmp/input.vcf ')
    expect(startParamsResult.data[1]).toBe(' Case 1 ')
  })
})

describe('ImportStartMultiFileParamsSchema', () => {
  const validMultiFileParams = [
    'Case 1',
    [
      {
        filePath: '/tmp/input.vcf',
        variantType: 'snv',
        caller: null,
        annotationFormat: 'VEP'
      }
    ],
    { selectedSample: 'sample-1', genomeBuild: 'GRCh38' },
    {
      bedFile: '/tmp/regions.bed',
      bedPadding: 50,
      passOnly: true,
      minQual: 20,
      minGq: null,
      minDp: 10
    }
  ] as const

  it('accepts a valid filters payload', () => {
    expect(ImportStartMultiFileParamsSchema.safeParse(validMultiFileParams).success).toBe(true)
  })

  it('rejects unknown fields on multi-file specs', () => {
    expect(
      ImportStartMultiFileParamsSchema.safeParse([
        validMultiFileParams[0],
        [
          {
            ...validMultiFileParams[1][0],
            unexpected: 'preserved by passthrough'
          }
        ],
        validMultiFileParams[2],
        validMultiFileParams[3]
      ]).success
    ).toBe(false)
  })

  it('rejects malformed filters payloads', () => {
    expect(
      ImportStartMultiFileParamsSchema.safeParse([
        validMultiFileParams[0],
        validMultiFileParams[1],
        validMultiFileParams[2],
        { bedPadding: -1 }
      ]).success
    ).toBe(false)

    expect(
      ImportStartMultiFileParamsSchema.safeParse([
        validMultiFileParams[0],
        validMultiFileParams[1],
        validMultiFileParams[2],
        { passOnly: 'true' }
      ]).success
    ).toBe(false)
  })
})
