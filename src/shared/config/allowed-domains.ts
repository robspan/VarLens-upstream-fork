/**
 * Built-in domain allowlist for external URL opening.
 * Both setWindowOpenHandler and shell:openExternal IPC use this.
 */
export const ALLOWED_DOMAINS = [
  'github.com',
  'github.io',
  'opensource.org',
  'gnomad.broadinstitute.org',
  'ncbi.nlm.nih.gov', // Covers PubTator, LitVar, ClinVar
  'omim.org',
  'genome.ucsc.edu',
  'varsome.com',
  'franklin.genoox.com',
  'deciphergenomics.org', // DECIPHER
  'clinicalgenome.org', // ClinGen
  'ensembl.org', // Ensembl
  'grch37.ensembl.org' // Ensembl GRCh37 subdomain
] as const
