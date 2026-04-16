# IPC Domain Inventory — 2026-04-16

## Measured Surface

- `wrapHandler(...)` handler files: `30`
- renderer files using `isIpcError(...)`: `7`
- renderer files using `unwrapIpcResult(...)`: `1`
- note: the single `unwrapIpcResult(...)` usage is `src/renderer/src/utils/ipc-result.ts`, not a scoped domain migration already completing this phase

## Handler Inventory

- `analysis-groups.ts` — logic `-`
- `annotations.ts` — logic `annotations-logic.ts`
- `audit-log.ts` — logic `-`
- `auth.ts` — logic `auth-logic.ts`
- `batch-import.ts` — logic `batch-import-logic.ts`
- `case-comments.ts` — logic `-`
- `case-metadata.ts` — logic `case-metadata-logic.ts`
- `case-metrics.ts` — logic `-`
- `cases.ts` — logic `cases-logic.ts`
- `cohort.ts` — logic `cohort-logic.ts`
- `database.ts` — logic `database-logic.ts`
- `export.ts` — logic `export-logic.ts`
- `filter-presets.ts` — logic `-`
- `gene-lists.ts` — logic `-`
- `gene-ref.ts` — logic `-`
- `gnomad.ts` — logic `-`
- `hpo.ts` — logic `-`
- `import.ts` — logic `import-logic.ts`, `import-logic-append.ts`
- `myvariant.ts` — logic `-`
- `panels.ts` — logic `panels-logic.ts`
- `protein.ts` — logic `-`
- `shell.ts` — logic `-`
- `shortlist.ts` — logic `-`
- `spliceai.ts` — logic `-`
- `system.ts` — logic `-`
- `tags.ts` — logic `tags-logic.ts`
- `transcripts.ts` — logic `-`
- `updater.ts` — logic `-`
- `variants.ts` — logic `variants-logic.ts`
- `vep.ts` — logic `-`

## Bucket A — Closed / Already Aligned

- `shell`
- `system`
- `shortlist`
- `updater`

## Bucket B — Handler / Logic Extraction Remaining

- `database`

## Bucket C — Renderer Error Standardization Remaining

- `cases`
- `case-metadata`
- `cohort`
- `export`
- `filter-presets`
- `import`

## Bucket D — Both Remaining

- `analysis-groups`
- `annotations`
- `audit-log`
- `auth`
- `batch-import`
- `case-comments`
- `case-metrics`
- `gene-lists`
- `gene-ref`
- `gnomad`
- `hpo`
- `myvariant`
- `panels`
- `protein`
- `spliceai`
- `tags`
- `transcripts`
- `variants`
- `vep`

## Circuit-Breaker

- Active domains in Buckets B + C + D: `26`
- Result: circuit-breaker remains active
- Execution stays split into Foundation, Sub-phase A, Sub-phase B, and Sub-phase C
