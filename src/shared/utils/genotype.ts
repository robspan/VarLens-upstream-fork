/**
 * Convert a VCF GT string to allele dosage (count of non-reference alleles).
 *
 * Standard mapping per VCF v4.3 spec + PLINK/Hail conventions:
 * - 0/0, 0|0 → 0 (homozygous reference)
 * - 0/1, 1/0, 0|1, 1|0 → 1 (heterozygous)
 * - 1/1, 1|1 → 2 (homozygous alt)
 * - ./., .|., . → null (missing)
 * - Haploid: 0 → 0, 1 → 1
 * - Multi-allelic: counts non-zero alleles (e.g., 0/2 → 1, 2/2 → 2)
 */
export function gtToDosage(gt: string | null | undefined): number | null {
  if (gt == null) return null
  switch (gt) {
    case '0/0':
    case '0|0':
      return 0
    case '0/1':
    case '1/0':
    case '0|1':
    case '1|0':
      return 1
    case '1/1':
    case '1|1':
      return 2
    case '0':
      return 0
    case '1':
      return 1
    case './.':
    case '.|.':
    case '.':
      return null
    default: {
      const alleles = gt.split(/[/|]/)
      if (alleles.some((a) => a === '.')) return null
      return alleles.filter((a) => a !== '0').length
    }
  }
}
