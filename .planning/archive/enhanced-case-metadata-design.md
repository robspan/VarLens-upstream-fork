# Enhanced Case Metadata — Design Document

## Goal

Extend VarLens case metadata with structured comments (timestamped, categorized, editable) and flexible key-value metrics (predefined clinical catalog + user-defined entries), presented in a tabbed modal UI.

## Design Decisions

### Comments
- **Categories**: 6 predefined — `Clinical Note`, `Lab Result`, `Interpretation`, `Follow-up`, `Family History`, `Treatment`
- **Editing**: Simple overwrite with `updated_at` timestamp (no edit history — single-user desktop app)
- **Display**: Newest-first, inline edit, category chips with icons/colors

### Metrics (Key-Value Pairs)
- **Schema**: EAV pattern with typed value columns (`numeric_value REAL`, `text_value TEXT`, `date_value TEXT`)
- **Value types**: numeric, text, date (booleans covered by existing tag system)
- **Catalog**: `metric_definitions` table with ~120 predefined clinical/lab metrics + user-created custom entries
- **Predefined categories**: Demographics, Anthropometrics, Vitals, Hematology, Coagulation, Biochemistry, Liver, Lipids, Endocrinology, Urinalysis, Immunology, Lysosomal Enzymes, Rare Disease Biomarkers, Genetics, Clinical Scores
- **Autocomplete**: Metric selection uses v-autocomplete showing name + category + unit, filtered to exclude already-assigned metrics
- **Custom metrics**: Created inline when autocomplete has no match (Enter key triggers create dialog)
- **Units**: Stored per definition, displayed next to values. Predefined metrics have verified standard units.
- **Unique constraint**: One value per metric per case (`UNIQUE(case_id, metric_id)`)
- **Future queryability**: Typed columns enable range queries (e.g., `WHERE numeric_value > 7.0 AND metric_id = X`)

### UI
- **Tabbed modal**: Existing `CaseMetadataModal` converted to 3 tabs — Overview (existing card), Comments, Metrics
- **Tab badges**: Show count of comments/metrics on tab labels
- **Vuetify components**: `v-tabs`, `v-autocomplete`, `v-textarea`, `v-table`, `v-chip`
- **Tab bar color**: `secondary` (#424242) per UI patterns

### Database
- **Migration v5**: Creates `case_comments`, `metric_definitions`, `case_metrics` tables with appropriate indexes and foreign keys
- **Seed data**: Predefined metrics inserted via `INSERT OR IGNORE` in migration transaction
- **Cascade deletes**: All tables use `ON DELETE CASCADE` for `case_id` FK
- **PostgreSQL ready**: All SQL patterns (UPSERT, RETURNING, EAV) work identically in PostgreSQL

### Architecture
- **Separate composables**: `useCaseComments` and `useCaseMetrics` (not crammed into `useCaseMetadata`)
- **Separate IPC handlers**: `case-comments.ts` and `case-metrics.ts` (separate files, self-registering)
- **Cache clearing**: Integrated into existing `useCaseMetadata.clearCache()`
