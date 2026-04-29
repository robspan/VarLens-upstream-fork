# Workflow Scope Decisions

| Domain | Scope | Rationale |
| --- | --- | --- |
| Tags | workspace | Tags classify variants inside a specific dataset and must follow PostgreSQL workspaces. |
| Annotations and ACMG | workspace | Clinical interpretation state is part of the dataset record. |
| Case comments and metrics | workspace | Case-level workflow notes and measurements belong with the case data. |
| Panels, gene lists, and region files | workspace | These drive filtering/import metadata and need shared behavior across PostgreSQL sessions. |
| Filter presets | workspace | Presets encode variant filter state tied to available workspace fields and clinical workflows. |
| Analysis groups | workspace | Family/tumor-normal grouping is dataset structure, not local UI preference. |
| Audit log | deferred | Audit semantics need a separate workspace-vs-local decision before enabling PostgreSQL parity. |
