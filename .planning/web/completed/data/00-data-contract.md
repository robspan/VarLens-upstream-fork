# Data Contract

## Problem

VarLens has importers, and the parity test-data story now has a reproducible manifest contract. A developer should not need to know what a clinical geneticist expects from a VCF. They should be able to read a manifest, run a command, and compare normalized data.

## Fixture Unit

Each fixture has one manifest entry following this shape:

```json
{
  "id": "giab-chinese-trio-chr22-vep",
  "purpose": "VCF CSQ annotation parity",
  "source": {
    "url": "https://...",
    "retrievedAt": "2026-05-12",
    "licenseOrTerms": "public; verify before commit",
    "cachePolicy": "download-if-missing",
    "rawFiles": [
      {
        "path": "cache/raw/input.vcf.gz",
        "sha256": "...",
        "sizeBytes": 123
      }
    ]
  },
  "sourceType": {
    "container": "vcf.gz",
    "producer": "GIAB+VEP",
    "genomeBuild": "GRCh38",
    "samples": ["HG005"]
  },
  "transform": {
    "command": "node scripts/data-fixtures/transform-vcf-subset.mjs --fixture giab-chinese-trio-chr22-vep",
    "inputs": ["cache/raw/input.vcf.gz"],
    "outputs": ["tests/test-data/generated/giab-chinese-trio-chr22-vep.vcf.gz"]
  },
  "varlensTarget": {
    "importMode": "single-vcf",
    "artifact": "tests/test-data/generated/giab-chinese-trio-chr22-vep.vcf.gz",
    "options": {
      "selectedSample": "HG005",
      "genomeBuild": "GRCh38"
    }
  },
  "expectedCoverage": [
    "snv",
    "indel",
    "vcf-csq",
    "gnomad-af",
    "cadd",
    "clinvar"
  ],
  "assertions": {
    "normalizedRowsSnapshot": "tests/web-gate/parity/__snapshots__/giab-chinese-trio-chr22-vep.json",
    "compare": ["desktop-sqlite", "web-postgres"]
  }
}
```

## Data Type Vocabulary

### Containers

- `json`
- `json.gz`
- `vcf`
- `vcf.gz`
- `zip`
- `bed`
- `bed.gz`

### VarLens JSON Source Types

- `json-simple`: top-level `variants`.
- `json-object`: top-level `metadata` plus `samples`.
- `json-columnar-wrapped`: top-level case key containing `header` and `data`.
- `json-columnar-unwrapped`: top-level `header` and `data`.

These are VarLens-specific shapes. Public sources are unlikely to provide them directly, so they should be generated from public source data when we need JSON parity.

### VCF Source Types

- `vcf-small`: SNV and small indel.
- `vcf-multisample`: more than one sample column.
- `vcf-csq`: VEP annotation in `INFO/CSQ`.
- `vcf-ann`: SnpEff annotation in `INFO/ANN`.
- `vcf-unannotated`: no `CSQ` or `ANN`.
- `vcf-sv`: structural variants.
- `vcf-cnv`: copy-number variants.
- `vcf-str`: short tandem repeat calls.
- `vcf-longread-bundle`: multi-file set such as SNP, SV, CNV, STR.

### Target Coverage Tags

Use these tags in manifests so test intent is searchable:

- `snv`
- `indel`
- `multisample`
- `trio`
- `vcf-csq`
- `vcf-ann`
- `vcf-unannotated`
- `gnomad-af`
- `cadd`
- `clinvar`
- `sv`
- `sv-breakend`
- `cnv`
- `str`
- `bed-region-filter`
- `pass-only-filter`
- `quality-filter`
- `json-simple`
- `json-object`
- `json-columnar`
- `zip-extraction`

## Normalized Result Contract

Parity assertions should compare normalized data, not volatile DB internals.

Do compare:

- case name and imported source format
- variant count
- stable variant identity: `chr`, `pos`, `ref`, `alt`, `variant_type`
- mapped annotation fields: `gene_symbol`, `consequence`, `func`, `gnomad_af`, `cadd`, `clinvar`
- genotype fields where present: `gt`, `gq`, `dp`, `ad_ref`, `ad_alt`, `ab`
- extension rows for SV, CNV, and STR
- selected transcript fields
- filter query results for representative filters

Do not compare:

- database row IDs
- timestamps
- absolute local paths
- worker elapsed times
- raw unordered JSON blobs without canonicalization

## Reproducibility Rules

- Raw downloads go under a gitignored cache path.
- Public data gathering is part of the opt-in parity workflow.
- Every source download needs a pinned URL, expected size, and checksum.
- Download commands must be idempotent and cache-aware.
- Transforms must fail if checksum verification fails.
- Committed fixtures are for tiny offline smoke coverage and must be small enough for review.
- Every committed fixture needs a manifest entry and checksum.
- Every transform must be deterministic and runnable from a clean checkout.
- Generated snapshots must be updated only through the documented command.
- External source terms must be recorded before committing derived data.

## What Belongs In Git

Commit:

- `scripts/data-fixtures/` source manifests and transform scripts
- tiny generated verification fixtures under `tests/test-data/generated/` when needed for offline smoke coverage
- small hand-authored edge-case fixtures when a public source cannot cover the type
- normalized parity snapshots under `tests/web-gate/parity/__snapshots__/`

Do not commit:

- raw public downloads
- full WGS/large VCF datasets
- large ZIP archives
- generated cache directories
- perf outputs or parity run reports under `.planning/artifacts/`

If a fixture is needed for default offline verification and is tiny/reviewable, commit it. If it is only an upstream source artifact or a large derived artifact, download or generate it reproducibly instead.

## Data Gathering Workflow

Opt-in parity commands should execute this sequence:

```text
1. Read source manifest.
2. For each source:
   a. check gitignored cache for raw file
   b. download if missing
   c. verify checksum and expected size
   d. refuse to continue on mismatch
3. Run deterministic transform into a generated fixture directory.
4. Verify transformed fixture checksum and expected coverage tags.
5. Run desktop-vs-web parity tests against transformed artifacts.
```

Default desktop tests must not perform step 2. Networked data gathering is only for explicit web/data parity commands.
