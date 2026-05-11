# Web Parity Test Data Plan

Date: 2026-05-12

This folder plans the data layer needed for true desktop-vs-web parity E2E testing. The goal is developer clarity, not human-genetics expertise.

We treat every fixture as a reproducible data pipeline:

```text
public source descriptor
  -> download or reuse local cache
  -> verify checksum/size
  -> source type contract
  -> deterministic transform
  -> VarLens import artifact
  -> expected normalized result
  -> desktop SQLite vs web Postgres parity assertion
```

Desktop remains the default. These data pipelines and parity E2E gates are opt-in for web work and must not make plain `make ci`, `make test`, or `npm run test` depend on web data, Docker, Postgres, or internet access.

## Documents

- `00-data-contract.md` defines the vocabulary and the typed manifest we expect every dataset flow to satisfy.
- `01-source-inventory.md` lists source classes we need and likely public sources.
- `02-transform-flows.md` describes how external files become small VarLens-ready fixtures.
- `03-parity-e2e-plan.md` describes the E2E parity harness that consumes those fixtures.

## Non-Goals

- Do not require a developer to understand clinical genetics before they can run or update parity tests.
- Do not commit large public datasets directly.
- Do not make web parity tests part of desktop-default CI.
- Do not treat ad hoc downloaded files as fixtures. Every fixture needs provenance, checksums, and a regeneration command.

## Data Gathering Policy

The preferred path for non-trivial verification data is download-on-demand from public sources:

- keep source descriptors and transforms in git
- download raw public data only when an opt-in data/parity command runs
- verify checksum and expected size before transformation
- cache raw downloads under gitignored paths
- transform/subset into deterministic test artifacts for that run

Committed fixtures are the exception. Commit only tiny, legally safe verification artifacts that are needed for offline smoke coverage:

- manifest entries with source URL, retrieval date, checksum, transform command, and license/terms note
- deterministic transform scripts
- tiny derived VCF/BED/JSON fixtures that are reviewable in a PR
- normalized parity snapshots

Do not commit raw upstream datasets, full WGS callsets, large public archives, or downloaded source caches. Those belong in gitignored cache paths and must be reproducible from the manifest plus transform scripts.
