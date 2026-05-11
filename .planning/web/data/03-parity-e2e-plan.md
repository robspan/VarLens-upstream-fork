# True Parity E2E Plan

## Goal

Prove that the same VarLens-ready data produces the same normalized behavior on:

- desktop Electron plus SQLite
- web server plus Postgres

The test should exercise the app through real import APIs, not direct repository calls.

## Gate Shape

Parity remains opt-in.

Proposed commands:

```bash
make web-data-gather
make web-data-prepare
make web-parity-e2e
```

Or one combined command:

```bash
VARLENS_WEB=1 VARLENS_RUN_WEB_PARITY_E2E=1 make web-parity-e2e
```

This must not alter:

```bash
make test
make ci
npm run test
```

## Harness Flow

```text
1. Build Electron and web artifacts.
2. Ensure local Postgres is available for web mode.
3. Gather public source data from manifests when cache is missing.
4. Verify source checksums and expected sizes.
5. Prepare or verify generated fixtures from manifests.
6. For each fixture:
   a. import into desktop SQLite through Electron preload API
   b. query normalized results through renderer/API surface
   c. import into web Postgres through HTTP RPC
   d. query normalized results through HTTP RPC
   e. compare normalized outputs
7. Write machine-readable parity report under .planning/artifacts/.
```

## Test Driver Contract

Each backend driver should implement the same interface:

```ts
interface ParityBackendDriver {
  importSingle(params: {
    artifact: string
    caseName: string
    options?: { selectedSample?: string; genomeBuild?: string }
  }): Promise<{ caseId: number; variantCount: number }>

  importMultiFile(params: {
    caseName: string
    files: Array<{
      filePath: string
      variantType: 'snv' | 'indel' | 'sv' | 'cnv' | 'str'
      caller: string | null
      annotationFormat: 'csq' | 'ann' | null
    }>
    options?: { selectedSample?: string; genomeBuild?: string }
    filters?: {
      bedFile?: string | null
      bedPadding?: number
      passOnly?: boolean
      minQual?: number | null
      minGq?: number | null
      minDp?: number | null
    }
  }): Promise<{ caseId: number; totalVariants: number }>

  queryNormalized(caseId: number): Promise<NormalizedParityResult>
  close(): Promise<void>
}
```

The driver abstraction should live under `tests/web-gate/parity/helpers/` once the second real scenario lands. The current `import-and-filter.test.ts` can then be migrated to it.

## Scenario Matrix

| Scenario | Import API | Fixture Coverage | Required Comparison |
| --- | --- | --- | --- |
| Small VCF baseline | `import.start` | SNV, indel, unannotated | row identity, counts, genotype basics |
| VEP VCF | `import.start` | `CSQ`, transcript selection, gnomAD/CADD/ClinVar | mapped annotation fields and selected transcript |
| SnpEff VCF | `import.start` | `ANN`, transcript selection | mapped annotation fields and selected transcript |
| Multisample VCF | `import.start` | selected sample | same sample-specific genotype fields |
| Long-read bundle | `import.startMultiFile` | SNP, SV, CNV, STR | per-file counts, extension rows, merged case result |
| BED-filtered import | `import.startMultiFile` | region filtering | retained identities and count delta |
| JSON simple | `import.start` or batch import | generated simple JSON | same normalized rows |
| JSON object | `import.start` or batch import | generated object JSON | same normalized rows |
| JSON columnar | `import.start` or batch import | generated columnar JSON | same normalized rows |
| ZIP batch | batch import | zip extraction plus JSON/GZ | extracted imports and duplicate handling |

## Snapshot Policy

Snapshots should be generated from normalized results, not raw backend rows.

Snapshot updates require:

- manifest checksum change or transform code change
- reviewed diff
- explicit update command in the PR description

Example update command:

```bash
UPDATE_PARITY_SNAPSHOTS=1 VARLENS_RUN_WEB_PARITY_E2E=1 make web-parity-e2e
```

## Artifact Report

Each full run should write:

```text
.planning/artifacts/web-parity/
  latest.json
  <timestamp>-summary.json
```

Minimum report fields:

```json
{
  "startedAt": "2026-05-12T00:00:00.000Z",
  "fixtures": [
    {
      "id": "example",
      "desktop": { "variantCount": 42 },
      "web": { "variantCount": 42 },
      "status": "passed"
    }
  ]
}
```

These artifacts are diagnostics and should stay gitignored unless a specific report is intentionally attached to a planning review.

## Acceptance Criteria

The first complete parity E2E milestone is done when:

- every minimum coverage row in `01-source-inventory.md` has a manifest-backed fixture
- the data gathering command downloads public sources on demand, verifies checksums, and reuses cache
- the fixture preparation command is deterministic from a clean checkout plus network/cache
- desktop import and web import both run through their real app-facing APIs
- normalized outputs match for every fixture
- the command is opt-in and documented
- default desktop CI still passes without Docker, Postgres, web build, or public data downloads
