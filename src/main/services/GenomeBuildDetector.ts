/**
 * Genome build detection from VCF header lines.
 *
 * Pure functions with no Electron dependencies — safe to use in worker threads.
 */

export type GenomeBuild = 'GRCh37' | 'GRCh38'

/** Known chr1 lengths for genome build identification */
const CHR1_LENGTH_GRCH38 = 248956422
const CHR1_LENGTH_GRCH37 = 249250621

/**
 * Detect genome build from VCF meta-information header lines.
 *
 * Detection priority:
 * 1. `##reference=` line keywords (grch38/hg38 or grch37/hg19/hs37)
 * 2. `##contig=` line with chr1 (or "1") length matching known builds
 * 3. Returns null if undetectable
 *
 * @param headerLines - Array of VCF header lines (lines starting with ##)
 * @returns Detected GenomeBuild or null
 */
export function detectGenomeBuildFromVcfHeaders(headerLines: string[]): GenomeBuild | null {
  // Priority 1: Check ##reference= lines
  for (const line of headerLines) {
    if (!line.startsWith('##reference=')) continue

    const lower = line.toLowerCase()
    if (lower.includes('grch38') || lower.includes('hg38')) {
      return 'GRCh38'
    }
    if (lower.includes('grch37') || lower.includes('hg19') || lower.includes('hs37')) {
      return 'GRCh37'
    }
  }

  // Priority 2: Check ##contig= lines for chr1 length
  for (const line of headerLines) {
    if (!line.startsWith('##contig=')) continue

    // Match ID=chr1 or ID=1 (with or without "chr" prefix)
    const idMatch = line.match(/ID=(chr)?1(?=,|>)/i)
    if (!idMatch) continue

    const lengthMatch = line.match(/length=(\d+)/i)
    if (!lengthMatch) continue

    const length = parseInt(lengthMatch[1], 10)
    if (length === CHR1_LENGTH_GRCH38) return 'GRCh38'
    if (length === CHR1_LENGTH_GRCH37) return 'GRCh37'
  }

  return null
}
