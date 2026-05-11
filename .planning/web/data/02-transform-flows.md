# Transform Flows

The transformation layer is the missing developer affordance. It should turn public or cached source artifacts into small VarLens-ready fixtures with known expected results.

## Proposed Directory Layout

```text
scripts/test-data/
  sources.json
  download-fixtures.mjs
  transform-vcf-subset.mjs
  transform-vcf-to-varlens-json.mjs
  transform-longread-bundle.mjs
  verify-fixtures.mjs

tests/test-data/generated/
  vcf/
  json/
  bed/
  zip/

tests/web-gate/parity/__snapshots__/
  <fixture-id>.json
```

Raw downloads should go to a gitignored cache path, for example:

```text
tests/.cache/public-data/
```

Generated artifacts from opt-in parity runs should also stay out of git unless they are intentionally promoted to tiny offline smoke fixtures. The common path is:

```text
tests/.cache/public-data/raw/
tests/.cache/public-data/generated/
```

The transformed verification artifacts are different from raw downloads. If they are tiny, legally safe, and required for default offline smoke tests, they may be committed under `tests/test-data/generated/` with a manifest entry and checksum. Otherwise they should be regenerated on demand.

## Flow 0: Gather Public Data

```text
source manifest
  -> resolve cache path
  -> download missing raw files
  -> verify checksum
  -> verify expected size range
  -> expose local raw path to transform flows
```

Expected command:

```bash
node scripts/test-data/download-fixtures.mjs --fixture giab-chinese-trio-chr22-vep
```

The downloader should:

- be idempotent
- refuse checksum mismatches
- avoid re-downloading valid cached files
- print source URL and cache path
- never write into tracked fixture directories directly

## Flow A: Public VCF To Small VCF Fixture

```text
cached source VCF/VCF.GZ
  -> verify checksum
  -> subset region or explicit records
  -> preserve relevant headers
  -> normalize optional chromosome style only if documented
  -> write generated VCF/VCF.GZ fixture
  -> write expected normalized snapshot
```

Use for:

- SNV/indel
- VEP `CSQ`
- SnpEff `ANN`
- ClinVar `CLNSIG`
- multisample/trio

Expected script behavior:

```bash
node scripts/test-data/transform-vcf-subset.mjs --fixture giab-chinese-trio-chr22-vep
```

The script should fail if:

- the source checksum differs
- the output has zero variants
- required INFO/FORMAT/header fields are missing
- the output exceeds the configured size budget

## Flow B: Public VCF To VarLens JSON Fixtures

```text
cached source VCF/VCF.GZ
  -> parse stable variant identity and selected mapped fields
  -> emit simple JSON
  -> emit object JSON
  -> emit columnar JSON
  -> import each through desktop and web
  -> compare normalized DB rows
```

This is not meant to model public data formats. It is a way to keep VarLens JSON importers covered with real-looking data generated from a public source.

Required outputs:

- `json-simple`
- `json-object`
- `json-columnar-wrapped`
- `json-columnar-unwrapped`

## Flow C: Long-Read Multi-File Bundle

```text
cached source bundle or workflow output
  -> collect matching SNP/SV/CNV/STR VCFs
  -> subset each file to a small deterministic record set
  -> preserve caller headers
  -> keep names in .wf_snp/.wf_sv/.wf_cnv/.wf_str form
  -> run VarLens startMultiFile import
  -> compare per-file and total normalized results
```

Use for:

- `vcf-longread-bundle`
- `sv`
- `cnv`
- `str`
- caller detection
- multi-file progress and summary behavior

Expected target artifact names:

```text
DEMO.wf_snp.vcf.gz
DEMO.wf_sv.vcf.gz
DEMO.wf_cnv.vcf.gz
DEMO.wf_str.vcf.gz
```

## Flow D: BED Region Fixtures

```text
source BED/BED.GZ
  -> subset to regions overlapping the VCF fixture
  -> write small BED fixture
  -> run import once without BED and once with BED
  -> assert predictable row-count delta and exact retained identities
```

Use for:

- `bed-region-filter`
- range overlap for SV/CNV/STR
- point containment for SNV/indel

## Flow E: ZIP Import Fixture

```text
generated JSON or JSON.GZ fixtures
  -> package into zip
  -> run batch zip extraction
  -> import extracted files
  -> compare normalized results
```

Use for:

- `zip-extraction`
- batch import file discovery
- duplicate case behavior

## Normalization Output

Every parity fixture should produce a canonical JSON snapshot like:

```json
{
  "schemaVersion": 1,
  "fixtureId": "example",
  "cases": [
    {
      "name": "DEMO",
      "variantCount": 42
    }
  ],
  "variants": [
    {
      "chr": "chr22",
      "pos": 20000100,
      "ref": "A",
      "alt": "G",
      "variant_type": "snv",
      "gene_symbol": "GENE",
      "consequence": "MODERATE",
      "func": "missense_variant",
      "gnomad_af": 0.001,
      "cadd": 23.1,
      "clinvar": "Pathogenic"
    }
  ],
  "extensions": {
    "sv": [],
    "cnv": [],
    "str": []
  },
  "queries": {
    "all": ["chr22:20000100:A:G"],
    "highImpact": [],
    "clinvarPathogenic": ["chr22:20000100:A:G"]
  }
}
```

The snapshot is a contract for the data shape, not a biology claim.
