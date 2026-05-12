# Report Model

The canonical report should be stable enough for future CI, local comparison, and PR discussion.

## Top-Level Manifest

`manifest.json` describes the run:

```json
{
  "schemaVersion": 1,
  "runId": "2026-05-12T18-42-00Z-2e098fe",
  "createdAt": "2026-05-12T18:42:00.000Z",
  "git": {
    "branch": "VarLens-Web",
    "sha": "2e098fe...",
    "dirty": false
  },
  "environment": {
    "node": "v24.14.1",
    "npm": "11.11.0",
    "platform": "darwin",
    "arch": "arm64"
  },
  "commands": [
    {
      "name": "web-gate-static",
      "command": "npx vitest run --project web-gate",
      "exitCode": 0
    }
  ],
  "artifacts": {
    "ctrf": "ctrf-report.json",
    "summary": "summary.md"
  }
}
```

## Suite Record

Each suite should preserve:

- suite id, display name, and layer
- command and environment variables that affect behavior
- start and stop timestamps
- exit code
- raw Vitest output paths
- setup failure versus test failure
- skip reason, if the whole suite is skipped

## Test Case Record

Each test case maps to CTRF and keeps VarLens metadata in `extra`:

```json
{
  "name": "imports VCF and matches filter counts",
  "status": "passed",
  "duration": 1532,
  "suite": "web-gate/parity-import-filter",
  "type": "parity",
  "filePath": "tests/web-gate/parity/import-and-filter.test.ts",
  "extra": {
    "layer": "Layer 3",
    "backendPair": ["desktop-sqlite", "web-postgres"],
    "featureArea": "import/filter"
  }
}
```

## Parity Scenario Record

Real-data parity scenarios need more than pass/fail:

```json
{
  "fixtureId": "clinvar-mini-json",
  "inputFormat": "json",
  "sourceKind": "public-fixture",
  "desktop": {
    "caseCount": 1,
    "variantCount": 128,
    "queryResultCount": 12
  },
  "web": {
    "caseCount": 1,
    "variantCount": 128,
    "queryResultCount": 12
  },
  "comparison": {
    "status": "passed",
    "normalizedFields": ["cases", "variantCounts", "filterResults"],
    "mismatches": []
  },
  "cleanup": {
    "desktopUserDataRemoved": true,
    "postgresSchemaDropped": true
  }
}
```

## Summary Markdown

`summary.md` should be short and structured:

1. Result banner: passed, failed, incomplete, or setup-failed.
2. Git/environment metadata.
3. Command table with exit codes.
4. Suite table with pass/fail/skip counts.
5. Parity scenario table with fixture ids, input format, backend counts, mismatch count, cleanup.
6. Failure details with file/test names and first useful diagnostic.
7. Artifact index.

The summary should avoid dumping full JSON. Full raw files stay linked by path.

