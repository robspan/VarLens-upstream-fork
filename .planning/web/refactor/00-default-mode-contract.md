# Default Mode Contract

Desktop is the default VarLens product path and must stay that way.

## Non-Negotiables

- Default `make ci`, `make test`, and `npm run test` are desktop/researcher workflows.
- Web checks remain opt-in through `VARLENS_WEB=1` or explicit `make web-*` targets.
- A populated `web-deploy/.env` must not silently opt default developer commands into web mode.
- Do not add Postgres, Docker, web image, or browser requirements to the default desktop lane.
- Web mode is currently for a sysadmin/operator deploying VarLens on their own infrastructure and providing access to users.
- Audit findings about skipped web tests are conditional findings: they are defects only in a web-track command, web release workflow, or deployment validation path that claims web coverage.

## Practical Consequence

It is correct for default desktop CI to avoid web behavior. The cleanup work is to make the opt-in web lane fail loudly when web prerequisites are missing, not to burden desktop-only contributors.

## Command Intent

| Command/lane | Intended audience | Expected scope |
|---|---|---|
| `make ci` | desktop contributors/researchers | desktop lint, format, typecheck, rebuild-node, tests |
| `VARLENS_WEB=1 make ci` | web-track contributors | desktop checks plus fast web gate additions, but still not a full deployment proof until upgraded |
| `make web-gate-static` | web-track contributors | structural web checks; skips are acceptable if documented |
| future `make web-ci` / `make web-gate-postgres` | web-track contributors/operators | fail-loud Postgres-backed web behavior gate |
| release/publish web workflows | operators | must depend on the fail-loud web lane before publish/deploy |
