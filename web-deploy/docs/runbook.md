# Runbook — Concept Pilot

Day-to-day. All commands run from the repo root. Web mode is auto-on whenever `web-deploy/.env` exists (= you've populated the operator-secrets file you need anyway for the pilot to work). To force one way or the other for a single command, set the env var explicitly: `VARLENS_WEB=1` or `VARLENS_WEB=0`. See [`AGENTS.md`](../../AGENTS.md) > Mode toggle for the rationale.

| Need                          | Command                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| First-time bring-up           | `make pilot` (read [`/DEPLOY.md`](../../DEPLOY.md) first)     |
| Start a stopped server        | `make -C web-deploy start && make -C web-deploy stack-up`     |
| Stop the server (save cost)   | `make -C web-deploy stop`                                     |
| Restart the stack (no reboot) | `make -C web-deploy stack-up`                                 |
| Is it running?                | `make pilot-status`                                           |
| Get a shell on the server     | `make pilot-ssh`                                              |
| Smoke test the live system    | `make pilot-smoke`                                            |
| Tail all container logs       | `make -C web-deploy stack-logs`                               |
| Ship a new app version (CI)   | `make web-release VERSION=web-v0.x.y NOTES_FROM=auto`         |
| Roll back the last release    | `gh workflow run release-web.yml -f version=web-v<previous> -f skip_build=true` |

⚠ `make pilot-down` deletes the server + 50 GB volume (you must type `pilot` to confirm). Restic snapshots survive.

| For…                 | See                                            |
| -------------------- | ---------------------------------------------- |
| Something is broken  | [`incident-runbook.md`](incident-runbook.md)   |
| Full command list    | [`operations.md`](operations.md)               |
| Smoke probe failures | [`smoke-remediation.md`](smoke-remediation.md) |
| Releases (CI deploy) | [`releases.md`](releases.md)                   |
