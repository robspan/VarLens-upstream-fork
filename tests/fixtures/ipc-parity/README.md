# IPC Parity Fixtures

These fixtures are the data contract for stakeholder IPC parity reporting. The goal is not to prove that every repository method has a unit test. The goal is to prove that each stakeholder-visible IPC area can run the same realistic workflow through Electron and web and produce the same normalized result.

## Quality Bar

- Use connected domain data, not isolated placeholder rows.
- Keep raw external API fixtures shaped like upstream responses so the production clients still parse and transform them.
- Prefer two or three meaningful rows over a one-row happy path when a consumer naturally merges, filters, sorts, or aggregates data.
- Normalize only volatile runtime details in the parity assertion: generated IDs, timestamps, local paths, cache timestamps, and export output paths.

## Connected Data Threads

### Case/Variant Thread

Source: `tests/test-data/vcf/synthetic-unit-test.vcf`

This VCF is used twice:

- `primaryCase`: sample `HG005`, case name `ipc-parity-primary`
- `secondaryCase`: sample `HG006`, case name `ipc-parity-secondary`

The repeated import is intentional. It creates overlapping variants across two cases, so cohort IPCs can validate carrier counts, gene burden, and cohort summaries instead of only single-case reads.

Anchors:

- `COMT chr22:20000350 G>A`: high-impact stop-gained variant used for annotations, tags, transcripts, carriers, and export filters.
- `LZTR1 chr22:20006000 C>G`: moderate missense variant used as a second gene/variant in cohort and asset fixtures.
- `SNAP29`: third gene used by gene-list/panel fixtures so list and panel ordering are not one-row-only.

Additional local sources:

- `tests/test-data/vcf/test-regions.bed`: exercises `region-files:importBed` and panel-region linkage.
- `tests/.cache/public-data/generated/zip/json-batch.zip`: exercises ZIP extraction in `batch-import`.

### Reference/API Thread

The protein/reference fixtures deliberately connect to one biological story:

- HPO: `seizure` returns `HP:0001250`, which is also assigned to the primary case metadata.
- UniProt: `TP53` maps to `P04637`.
- InterPro: `P04637` returns TP53 protein domains.
- AlphaFold: `P04637` returns TP53 structure metadata.
- Ensembl gene lookup: `TP53` returns exon structure for the same gene.
- VEP: chr17 TP53-region variant returns transcript consequences and colocated clinical/frequency context.

This lets parity tests validate that separate IPCs still agree on connected identifiers instead of returning unrelated valid-looking data.

## Scenario Walkthrough

### `import-and-case-index`

Covers: `import`, `cases`, `variants`

What it proves:

- The same VCF import produces the same case and variant surface in Electron and web.
- The case index can search and count the imported case.
- The variant table can query high-impact variants, search genes, list gene symbols, count variant types, and return column metadata.

Primary consumers:

- Case list/search views.
- Variant table and filter drawer.
- Column metadata filter UI.

### `batch-import-zip`

Covers: `batch-import`

What it proves:

- ZIP extraction returns the same file inventory and cleanup behavior.
- The report can distinguish batch import tooling from normal single-file import.

Primary consumers:

- Batch import wizard and ZIP upload/extraction flows.

### `case-workbench`

Covers: `case-metadata`, `case-comments`, `case-metrics`, `audit`

What it proves:

- Case metadata, cohort assignment, HPO assignment, data provenance, external IDs, comments, and metrics survive the same write/read lifecycle.
- Audit results are produced from real mutations rather than manually inserted audit rows.

Primary consumers:

- Case metadata panel.
- Case comments and interpretation notes.
- Metrics/QC widgets.
- Audit/history views.

### `annotation-tags-transcripts`

Covers: `annotations`, `tags`, `transcripts`

What it proves:

- Global and per-case annotations attach to the same variant coordinate.
- Per-case tag assignment and lookup use the same imported variant ID.
- Transcript insertion/switching works on a real imported variant and can later be compared with VEP-only transcript rows.

Primary consumers:

- Variant annotation cells.
- Shortlist/star/ACMG flows.
- Tag management and variant tag chips.
- Transcript section and VEP transcript merge logic.

### `cohort-analysis`

Covers: `cohort`

What it proves:

- Two imported cases produce cohort-level variants, summaries, carriers, gene burden, column metadata, and summary freshness status.
- Carrier lookup uses the same COMT anchor variant used elsewhere, so the test checks cross-case aggregation rather than arbitrary cohort data.

Primary consumers:

- Cohort table.
- Carrier expanded rows.
- Cohort filter drawer and gene burden views.

### `knowledge-assets`

Covers: `gene-lists`, `region-files`, `panels`, `analysis-groups`, `presets`

What it proves:

- Reusable assets can be created, populated, linked to a case, and listed back.
- Gene lists, panels, and presets reuse real genes from the imported VCF.
- Region files use the repo BED fixture and are linked to the same chr22 test region.
- Analysis groups bind to the imported case and can be resolved from that case.

Primary consumers:

- Gene list editor.
- Region file import dialog.
- Panel manager and panel filters.
- Analysis group filters.
- Preset bar and preset manager.

### `database-and-export`

Covers: `database`, `export`

What it proves:

- Database info, capabilities, and overview agree after the same import.
- Variant and cohort exports can be compared by exported content hash, not by local output path.

Primary consumers:

- Database overview dialog.
- Backend capability gating.
- Variant and cohort export actions.

### `reference-apis`

Covers: `gene-ref`, `hpo`, `protein`, `vep`

What it proves:

- Reference endpoints use local, raw upstream-shaped fixtures rather than live network.
- HPO, VEP, UniProt, InterPro, AlphaFold, and Ensembl transformations remain exercised by production client logic.
- The TP53/P04637 chain stays internally consistent across mapping, domains, structure, gene structure, and VEP transcript consequences.

Primary consumers:

- HPO search/autocomplete.
- Protein visualization and lollipop plot data loading.
- VEP enrichment panel and transcript merge/dropdown logic.
- Gene reference info/assembly UI.

## Current Deliberate Boundaries

- The manifest targets workflow-level parity per IPC area, not every method in every IPC domain.
- External service tests use local fixtures only; live API recording is manual and opt-in.
- Export parity should compare file content hashes, not local paths.
- `gene-ref`, `hpo`, `protein`, `vep`, `transcripts`, and real `export` still require web dispatcher/client support before these fixtures can drive passing web parity tests.
