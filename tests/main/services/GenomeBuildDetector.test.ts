import { describe, it, expect } from 'vitest'
import { detectGenomeBuildFromVcfHeaders } from '../../../src/main/services/GenomeBuildDetector'

describe('detectGenomeBuildFromVcfHeaders', () => {
  // --- ##reference= line detection ---

  it('detects GRCh38 from ##reference= line (grch38)', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##reference=ftp://ftp.ncbi.nlm.nih.gov/genomes/GRCh38/assembly.fasta'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  it('detects GRCh38 from ##reference= line (hg38)', () => {
    const headers = ['##fileformat=VCFv4.2', '##reference=file:///path/to/hg38.fa']
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  it('detects GRCh37 from ##reference= line (grch37)', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##reference=ftp://ftp.ncbi.nlm.nih.gov/genomes/GRCh37/assembly.fasta'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  it('detects GRCh37 from ##reference= line (hg19)', () => {
    const headers = ['##fileformat=VCFv4.2', '##reference=file:///path/to/hg19.fa']
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  it('detects GRCh37 from ##reference= line (hs37)', () => {
    const headers = ['##fileformat=VCFv4.2', '##reference=hs37d5.fa']
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  // --- ##contig= line detection ---

  it('detects GRCh38 from ##contig chr1 length', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##contig=<ID=chr1,length=248956422>',
      '##contig=<ID=chr2,length=242193529>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  it('detects GRCh37 from ##contig chr1 length', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##contig=<ID=chr1,length=249250621>',
      '##contig=<ID=chr2,length=243199373>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  it('detects GRCh38 from ##contig with ID=1 (no chr prefix)', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##contig=<ID=1,length=248956422>',
      '##contig=<ID=2,length=242193529>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  it('detects GRCh37 from ##contig with ID=1 (no chr prefix)', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##contig=<ID=1,length=249250621>',
      '##contig=<ID=2,length=243199373>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  // --- Priority: ##reference wins over ##contig ---

  it('reference wins when reference says hg38 and contig says hg19', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##reference=file:///path/to/hg38.fa',
      '##contig=<ID=chr1,length=249250621>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  it('reference wins when reference says hg19 and contig says hg38', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##reference=file:///path/to/hg19.fa',
      '##contig=<ID=chr1,length=248956422>'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh37')
  })

  // --- No detection ---

  it('returns null when no genome build info is present', () => {
    const headers = [
      '##fileformat=VCFv4.2',
      '##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">'
    ]
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBeNull()
  })

  it('returns null for empty headers', () => {
    expect(detectGenomeBuildFromVcfHeaders([])).toBeNull()
  })

  // --- Case insensitivity ---

  it('detects genome build case-insensitively from reference line', () => {
    const headers = ['##reference=GRCH38.fa']
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBe('GRCh38')
  })

  // --- Contig with unknown chr1 length ---

  it('returns null when contig has chr1 but unknown length', () => {
    const headers = ['##fileformat=VCFv4.2', '##contig=<ID=chr1,length=999999999>']
    expect(detectGenomeBuildFromVcfHeaders(headers)).toBeNull()
  })
})
