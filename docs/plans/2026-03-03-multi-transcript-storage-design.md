# Multi-Transcript Storage and Selection

**Date:** 2026-03-03
**Status:** Approved

## Problem

VarLens stores a single transcript per variant, chosen by the upstream annotation tool's `selectedTranscript` index. This causes:

1. **Inconsistent transcripts per gene** -- different variants for the same gene can have different selected transcripts, with no way to normalize.
2. **Data loss at import** -- the columnar JSON source contains multi-value arrays with annotations for ALL transcripts, but only one is kept.
3. **No MANE awareness** -- the import has no MANE Select flag. VEP knows about MANE but this info isn't persisted.
4. **No user control** -- users cannot view alternative transcripts or switch the selected one.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | Store all transcripts at import | Offline-first; data already in source JSON |
| Default transcript | Trust upstream selectedTranscript | No API dependency at import; users can switch later |
| Storage approach | Normalized `variant_transcripts` table | Natural for switch/filter/update operations; matches existing junction table patterns |
| UI location | Detail panel only | Focused scope; avoids complex table interactions |
| Persistence | Persist to DB on switch | User changes are durable; affect table display and export |

## Schema

### New table: `variant_transcripts`

```sql
CREATE TABLE IF NOT EXISTS variant_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant_id INTEGER NOT NULL,
  transcript_id TEXT NOT NULL,
  gene_symbol TEXT,
  consequence TEXT,
  cdna TEXT,
  aa_change TEXT,
  hpo_sim_score REAL,
  moi TEXT,
  is_selected INTEGER NOT NULL DEFAULT 0,
  is_mane_select INTEGER,
  is_canonical INTEGER,
  FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
  UNIQUE(variant_id, transcript_id)
);

CREATE INDEX IF NOT EXISTS idx_vt_variant_id ON variant_transcripts(variant_id);
CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
```

### Existing `variants` table

No schema changes. The existing `transcript`, `gene_symbol`, `consequence`, `cdna`, `aa_change`, `hpo_sim_score`, `moi` columns remain as a denormalized cache of the selected transcript for fast table display (no JOINs needed).

### Field classification

**Transcript-dependent** (stored per-transcript in `variant_transcripts`):
- `transcript_id`, `gene_symbol`, `consequence`, `cdna`, `aa_change`, `hpo_sim_score`, `moi`

**Variant-level** (stay on `variants`, shared across transcripts):
- `chr`, `pos`, `ref`, `alt`, `gnomad_af`, `cadd`, `clinvar`, `gt_num`, `func`, `qual`

### Migration

- New migration creates `variant_transcripts` table with indexes.
- Backfill: for every existing variant with non-null `transcript`, insert one row into `variant_transcripts` with `is_selected = 1`, copying `transcript_id`, `gene_symbol`, `consequence`, `cdna`, `aa_change`, `hpo_sim_score`, `moi` from the variant row.
- Non-destructive -- existing queries continue working unchanged.

## Import Pipeline

### Columnar format (`FieldMapper`)

New method `extractAllTranscripts()` iterates over multi-value arrays and builds a `TranscriptAnnotation[]`:

- For each index in the multi-value arrays (columns 24, 28, 21, 29, 30, 156, 162), extract the value at that index using dictionary resolution where applicable.
- Set `is_selected = 1` for the transcript at the `selectedTranscript` index (column 1).
- Emit both the `MappedVariant` (denormalized, unchanged) and the `transcripts` array.

`BatchAccumulator` and `DatabaseService.insertVariantsBatch()` extended to also insert into `variant_transcripts`.

### Object format (`ObjectFormatMapper`)

Pre-selected single values. One row in `variant_transcripts` with `is_selected = 1`.

### Simple format

Same as object format.

## Backend

### New DatabaseService methods

- `getVariantTranscripts(variantId: number): TranscriptAnnotation[]` -- all transcripts for a variant, ordered `is_selected DESC, transcript_id ASC`.
- `switchSelectedTranscript(variantId: number, transcriptId: string): void` -- within a single transaction:
  1. `UPDATE variant_transcripts SET is_selected = 0 WHERE variant_id = ?`
  2. `UPDATE variant_transcripts SET is_selected = 1 WHERE variant_id = ? AND transcript_id = ?`
  3. `UPDATE variants SET transcript = ?, gene_symbol = ?, consequence = ?, cdna = ?, aa_change = ?, hpo_sim_score = ?, moi = ? WHERE id = ?` (from the newly selected transcript row)
- `updateTranscriptManeStatus(variantId: number, transcriptId: string, isMane: boolean, isCanonical: boolean): void` -- for VEP enrichment.

### New IPC channels

- `transcripts:list` -- calls `getVariantTranscripts(variantId)`
- `transcripts:switch` -- calls `switchSelectedTranscript(variantId, transcriptId)`

## Frontend

### New component: `TranscriptSection.vue`

Placed in `VariantDetailsPanel.vue` between Identity and Annotation Scores sections.

**UI:**
- Section header: "Transcripts" with count badge
- Compact `v-data-table` with columns: Transcript ID, Gene, Consequence (colored chip), cDNA, Protein Change, Status badges
- Badges: "MANE Select" (teal `v-chip`), "Canonical" (grey), "Selected" (primary color)
- Row action: "Use this transcript" button on non-selected rows
- Switching calls `transcripts:switch` IPC, updates local state, emits `variant-updated` event

### New composable: `useTranscripts(variantId)`

- Calls `transcripts:list` IPC on mount
- Returns reactive `transcripts` ref and `switchTranscript(transcriptId)` method
- `switchTranscript` calls IPC, then emits event for parent refresh

### VEP enrichment integration

When VEP data loads via existing `useVepEnrichment`, match VEP transcript IDs to stored transcripts and populate `is_mane_select`/`is_canonical` flags.

### Changes to existing components

- `VariantDetailsPanel.vue`: Add `<TranscriptSection>` component
- `VariantTable.vue`: Listen for `variant-updated` event to refresh specific row
- No changes to `VariantIdentitySection.vue` or `AnnotationScoresSection.vue`

## Types

### New shared type (`src/shared/types/transcript.ts`)

```typescript
export interface TranscriptAnnotation {
  id: number
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: boolean
  is_mane_select: boolean | null
  is_canonical: boolean | null
}
```

### Preload API extension

```typescript
transcripts: {
  list: (variantId: number) => ipcRenderer.invoke('transcripts:list', variantId),
  switch: (variantId: number, transcriptId: string) =>
    ipcRenderer.invoke('transcripts:switch', variantId, transcriptId)
}
```

## Testing

- `FieldMapper.extractAllTranscripts()` -- multi-value array extraction with dictionaries
- `switchSelectedTranscript()` -- transaction integrity (both tables update atomically)
- Migration backfill -- existing variants get one transcript row
- `TranscriptSection.vue` -- component render, switch action, badge display

## Out of Scope

- Cohort-level transcript aggregation changes
- Automatic MANE-based transcript normalization at import
- Gene-level preferred transcript settings
- Object/simple format multi-transcript (they don't have the data)
- Transcript filtering in the variant table
