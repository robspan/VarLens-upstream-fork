# Drop Annotation-Bundle Import

**Status:** Implemented
**Decision:** Drop the unaccepted annotation-bundle and public-snapshot manifest path
**Scope:** VarLens annotation-bundle and public-snapshot manifest schemas, web import override, operation metric mapping, and runtime regression gate
**Related contract:** [Single-DB Web Runtime Contract](./2026-07-14-single-db-web-runtime.md)

## Context and Caller Inventory

The accepted LB-MAP runtime has one VarLens database per approved user. VARVIS
performs annotation outside VarLens, and users import the resulting annotated
JSON through the normal `import:start` surface. Normal JSON and VCF imports also
use `import:start`; multi-file VCF imports use `import:startMultiFile`.

The `varlens-annotation-workflows` repository still emits annotation bundles on
its `origin/main`. That workflow is historical and explicitly excluded from the
accepted ADR15 delivery, so there is no accepted producer-consumer path into
VarLens. Within this repository, the bundle has no in-app caller:

- `src/shared/annotations/annotation-bundle.ts` defines the manifest schema and
  import-plan helpers. Its only production consumer is the web route below.
- `src/shared/annotations/public-snapshot.ts` defines the public-snapshot
  manifest referenced by the bundle. It has no production consumer after the
  rejected shared/public annotation topology was removed.
- `src/web/server/routes/import.ts` exposes `import:startAnnotationBundle`
  through the generic web dispatcher. No renderer, preload, or other application
  module invokes that channel.
- `src/web/server/dispatcher.ts` maps that channel to the generic import
  operation metric.
- `tests/shared/annotations/annotation-bundle.test.ts` tests the otherwise
  unconsumed schema.
- `tests/shared/annotations/public-snapshot.test.ts` tests the otherwise
  unconsumed public-snapshot manifest schema.

The path encodes the superseded shared/public annotation snapshot topology and
adds a second manifest-driven import contract beside the intended VARVIS JSON
flow. Keeping it would preserve unsupported provenance and reference-data
semantics without an accepted delivery path. Generic JSON/VCF imports are
implemented and preserved, but acceptance against a representative VARVIS JSON
shape and fixture remains open; this decision does not close that contract.

## Acceptance Criteria

1. Remove the annotation-bundle and public-snapshot manifest schema/modules and
   their obsolete schema tests.
2. Remove the `import:startAnnotationBundle` web override and all helpers and
   imports used only by that override.
3. Remove `import:startAnnotationBundle` from dispatcher operation metrics.
4. Extend the single-database runtime boundary gate so both manifest modules and
   the annotation-bundle channel cannot return through overrides, task routing,
   or another production source path unnoticed.
5. The same gate explicitly proves that `import:start` and
   `import:startMultiFile` remain active web import overrides.
6. Existing behavior-level tests for generic single-file JSON/VCF and multi-file
   VCF imports remain green.
7. Update the active single-DB runtime contract to record this decision as
   resolved and link this specification.

## Non-Goals

- No changes to normal JSON, VCF, multi-file, batch, preview, or cancellation
  import behavior.
- No new VARVIS-specific parser or import endpoint.
- No claim that a representative VARVIS JSON export shape or fixture has been
  accepted; that remains an app-owner integration contract.
- No removal or redesign of optional same-database reference-annotation read
  repositories, tables, or API types. Only the unused manifest contract is
  removed.
- No rewrite of superseded historical annotation or topology plans.
- No infrastructure, deployment, storage, or retention change.

## Validation

- Run the single-database runtime boundary test and the focused web import and
  dispatcher tests.
- Run format, lint, typecheck, `make agent-check`, and
  `VARLENS_WEB=1 make ci`.
